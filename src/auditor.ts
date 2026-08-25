import { ansi, colorProvider, shortenPath } from "./formatter";
import type { SkillInfo, DuplicateGroup, AuditReport } from "./utils/types";

// ─── Detection ─────────────────────────────────────────────────────────────

/**
 * Normalizes a grouping key so skills differing only by case or by
 * separator characters (`_`, whitespace vs `-`) group as duplicates
 * (issue #564). Dots and digits are never folded — `skill.v2` and
 * `skill-v2` stay distinct.
 */
export function normalizeSkillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compares dotted version strings segment-wise; numeric segments compare
 * numerically, a missing segment sorts below a present one, and
 * non-numeric segments fall back to lexical order. Returns <0, 0, or >0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const sa = pa[i] ?? "";
    const sb = pb[i] ?? "";
    if (sa === sb) continue;
    if (sa === "") return -1;
    if (sb === "") return 1;
    const na = /^\d+$/.test(sa) ? Number.parseInt(sa, 10) : null;
    const nb = /^\d+$/.test(sb) ? Number.parseInt(sb, 10) : null;
    if (na !== null && nb !== null && na !== nb) return na - nb;
    if (na === null || nb === null) {
      const cmp = sa.localeCompare(sb);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/** Distinct non-empty versions among instances, ascending (issue #567). */
export function distinctVersions(instances: SkillInfo[]): string[] {
  const versions = new Set<string>();
  for (const s of instances) {
    const v = (s.version ?? "").trim();
    if (v) versions.add(v);
  }
  return [...versions].sort(compareVersions);
}

function groupVersionDivergence(instances: SkillInfo[]): boolean {
  return distinctVersions(instances).length >= 2;
}

export function detectDuplicates(skills: SkillInfo[]): AuditReport {
  const groups: DuplicateGroup[] = [];
  const coveredPaths = new Set<string>();

  // Deduplicate skills that resolve to the same real path (e.g. symlinks).
  // Keep the non-symlink (real directory) when possible; otherwise keep the first.
  const seenRealPaths = new Map<string, SkillInfo>();
  const deduped: SkillInfo[] = [];
  for (const s of skills) {
    const existing = seenRealPaths.get(s.realPath);
    if (existing) {
      // Prefer the non-symlink entry
      if (s.isSymlink) continue;
      // Current is not a symlink but existing is — replace it
      if (existing.isSymlink) {
        deduped[deduped.indexOf(existing)] = s;
        seenRealPaths.set(s.realPath, s);
      }
      // Both non-symlinks with the same realPath — one physical install
      // (e.g. cwd === $HOME so ~/.agents/skills and ./.agents/skills collide).
      // Prefer global scope; otherwise keep the first seen instance.
      else if (s.scope === "global" && existing.scope !== "global") {
        deduped[deduped.indexOf(existing)] = s;
        seenRealPaths.set(s.realPath, s);
      }
    } else {
      seenRealPaths.set(s.realPath, s);
      deduped.push(s);
    }
  }

  // Rule 1: same dirName across different locations. Grouping keys are
  // normalized (#564) so `Code-Review`, `code_review` and `code review`
  // land in one bucket; the first-seen spelling becomes the display key.
  const byDirName = new Map<
    string,
    { key: string; variants: Set<string>; members: SkillInfo[] }
  >();
  for (const s of deduped) {
    const norm = normalizeSkillKey(s.dirName);
    const entry = byDirName.get(norm) ?? {
      key: s.dirName,
      variants: new Set<string>(),
      members: [],
    };
    entry.variants.add(s.dirName);
    entry.members.push(s);
    byDirName.set(norm, entry);
  }

  for (const entry of byDirName.values()) {
    const uniqueLocations = new Set(entry.members.map((m) => m.location));
    if (uniqueLocations.size >= 2) {
      groups.push({
        key: entry.key,
        reason: "same-dirName",
        instances: entry.members,
        versionDivergence: groupVersionDivergence(entry.members),
        ...(entry.variants.size > 1 ? { variants: [...entry.variants] } : {}),
      });
      for (const m of entry.members) coveredPaths.add(m.path);
    }
  }

  // Rule 2: same frontmatter name but different dirName (names normalized
  // per #564; the dirName-distinctness guard stays on raw spellings).
  const byName = new Map<
    string,
    { key: string; variants: Set<string>; members: SkillInfo[] }
  >();
  for (const s of deduped) {
    if (!s.name) continue;
    const norm = normalizeSkillKey(s.name);
    const entry = byName.get(norm) ?? {
      key: s.name,
      variants: new Set<string>(),
      members: [],
    };
    entry.variants.add(s.name);
    entry.members.push(s);
    byName.set(norm, entry);
  }

  for (const entry of byName.values()) {
    const members = entry.members;
    const uniqueDirNames = new Set(members.map((m) => m.dirName));
    if (uniqueDirNames.size < 2) continue;

    // Skip members already covered by Rule 1
    const uncovered = members.filter((m) => !coveredPaths.has(m.path));
    if (uncovered.length < 2) continue;

    // Also need at least 2 distinct dirNames among uncovered
    const uncoveredDirNames = new Set(uncovered.map((m) => m.dirName));
    if (uncoveredDirNames.size < 2) continue;

    const uncoveredVariants = new Set(uncovered.map((m) => m.name));
    groups.push({
      key: entry.key,
      reason: "same-frontmatterName",
      instances: uncovered,
      versionDivergence: groupVersionDivergence(uncovered),
      ...(uncoveredVariants.size > 1
        ? { variants: [...uncoveredVariants] }
        : {}),
    });
  }

  // Sort: same-dirName groups first, then same-frontmatterName; within each,
  // by normalized key so case/separator variants order deterministically.
  groups.sort((a, b) => {
    if (a.reason !== b.reason) {
      return a.reason === "same-dirName" ? -1 : 1;
    }
    return (
      normalizeSkillKey(a.key).localeCompare(normalizeSkillKey(b.key)) ||
      a.key.localeCompare(b.key)
    );
  });

  const totalDuplicateInstances = groups.reduce(
    (sum, g) => sum + g.instances.length,
    0,
  );

  return {
    scannedAt: new Date().toISOString(),
    totalSkills: skills.length,
    duplicateGroups: groups,
    totalDuplicateInstances,
  };
}

// ─── Deterministic sort for "which instance to keep" ───────────────────────

export function sortInstancesForKeep(instances: SkillInfo[]): SkillInfo[] {
  return [...instances].sort((a, b) => {
    // Global before project
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    // Then by provider label alphabetically
    const provCmp = a.providerLabel.localeCompare(b.providerLabel);
    if (provCmp !== 0) return provCmp;
    // Then by path
    return a.path.localeCompare(b.path);
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function reasonLabel(reason: DuplicateGroup["reason"]): string {
  return reason === "same-dirName" ? "same dirName" : "same name";
}

// ─── CLI Formatters ────────────────────────────────────────────────────────

export function formatAuditReport(report: AuditReport): string {
  if (report.duplicateGroups.length === 0) {
    return ansi.green("No duplicate skills found.");
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(
    ansi.bold(
      `  Found ${report.duplicateGroups.length} duplicate group(s) (${report.totalDuplicateInstances} total instances):`,
    ),
  );
  lines.push("");

  for (const group of report.duplicateGroups) {
    lines.push(
      `  ${ansi.yellow(`"${group.key}"`)} ${ansi.dim(`(${reasonLabel(group.reason)})`)}`,
    );
    if (group.variants && group.variants.length > 1) {
      const spellings = group.variants.map((v) => `"${v}"`).join(", ");
      lines.push(ansi.dim(`     variants: ${spellings}`));
    }
    if (group.versionDivergence) {
      const newestFirst = distinctVersions(group.instances).slice().reverse();
      lines.push(
        ansi.red(
          `     ⚠ versions differ: ${newestFirst.map((v) => `v${v}`).join(", ")} — possible upgrade/shadow, not identical copies`,
        ),
      );
    }
    const sorted = sortInstancesForKeep(group.instances);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const provider = colorProvider(s.provider, s.providerLabel);
      const keepTag = i === 0 ? ansi.green(" [keep]") : ansi.dim("       ");
      const scope = ansi.dim(`(${s.scope})`);
      const version = (s.version ?? "").trim();
      const versionTag = version ? ansi.dim(` (v${version})`) : "";
      lines.push(
        `   ${keepTag} ${provider} ${scope}${versionTag}  ${ansi.dim(shortenPath(s.path))}`,
      );
    }
    lines.push("");
  }

  lines.push(
    ansi.dim(`  Run ${ansi.bold("asm audit -y")} to auto-remove duplicates`),
  );
  lines.push("");
  return lines.join("\n");
}

export function formatAuditReportJSON(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
