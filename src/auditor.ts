import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { ansi, colorProvider, shortenPath } from "./formatter";
import { cacheSkillMdContent } from "./scanner";
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

// ─── Content fingerprinting (#562) ─────────────────────────────────────────

/**
 * Returns the SKILL.md body — everything after the closing `---` of the
 * frontmatter. Content without a frontmatter block is returned whole.
 * Frontmatter is excluded so renamed copies (whose `name:` differs by
 * design) still fingerprint identically.
 */
export function extractSkillMdBody(content: string): string {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") return content;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(i + 1).join("\n");
  }
  return content;
}

/**
 * Stable sha256 fingerprint of a skill's SKILL.md body (frontmatter
 * excluded, issue #562). Returns null when the scanner's content cache is
 * absent — callers should treat null as "unknown", never as "diverged".
 */
export function skillContentFingerprint(skill: SkillInfo): string | null {
  const cached = skill._skillMdContent;
  if (cached === undefined) return null;
  return createHash("sha256").update(extractSkillMdBody(cached)).digest("hex");
}

/**
 * Fills the scanner's SKILL.md content cache from disk when absent, using
 * the same fallback read as `checkHealth` and the scanner's non-enumerable
 * caching so the refilled cache never leaks into serialized output.
 * Unreadable content leaves the cache unset so fingerprint checks degrade
 * to "unknown" safely.
 */
export async function ensureSkillMdContent(skill: SkillInfo): Promise<void> {
  if (skill._skillMdContent !== undefined) return;
  try {
    const content = await readFile(join(skill.path, "SKILL.md"), "utf-8");
    cacheSkillMdContent(skill, content);
  } catch {
    // unreadable — leave uncached; fingerprint stays unavailable
  }
}

/**
 * Classifies a group's instances by body fingerprint. Only fully-fingerprinted
 * groups get a class; any unknown content yields undefined (never guessed).
 */
function classifyContent(
  fingerprints: (string | null)[],
): "identical" | "diverged" | undefined {
  if (fingerprints.length < 2 || fingerprints.some((f) => f === null)) {
    return undefined;
  }
  return new Set(fingerprints).size === 1 ? "identical" : "diverged";
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

  // Content fingerprints for the deduped set (#562). Computed once; groups
  // classify as identical/diverged only when every member has one.
  const fingerprints = new Map<SkillInfo, string | null>(
    deduped.map((s) => [s, skillContentFingerprint(s)]),
  );

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
      const contentClass = classifyContent(
        entry.members.map((m) => fingerprints.get(m) ?? null),
      );
      groups.push({
        key: entry.key,
        reason: "same-dirName",
        instances: entry.members,
        versionDivergence: groupVersionDivergence(entry.members),
        ...(contentClass ? { contentClass } : {}),
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
    const contentClass = classifyContent(
      uncovered.map((m) => fingerprints.get(m) ?? null),
    );
    groups.push({
      key: entry.key,
      reason: "same-frontmatterName",
      instances: uncovered,
      versionDivergence: groupVersionDivergence(uncovered),
      ...(contentClass ? { contentClass } : {}),
      ...(uncoveredVariants.size > 1
        ? { variants: [...uncoveredVariants] }
        : {}),
    });
    // Mark grouped instances so Rule 3 never re-reports them (#562).
    for (const m of uncovered) coveredPaths.add(m.path);
  }

  // Rule 3: byte-identical bodies under different names (#562). Only skills
  // not already grouped by the name rules participate, so no skill is
  // reported in overlapping groups. Frontmatter is excluded from the
  // fingerprint, which is exactly what lets renamed copies match.
  const byFingerprint = new Map<string, SkillInfo[]>();
  for (const s of deduped) {
    if (coveredPaths.has(s.path)) continue;
    const fp = fingerprints.get(s);
    if (!fp) continue;
    const members = byFingerprint.get(fp) ?? [];
    members.push(s);
    byFingerprint.set(fp, members);
  }
  for (const members of byFingerprint.values()) {
    if (members.length < 2) continue;
    if (new Set(members.map((m) => m.dirName)).size < 2) continue;
    groups.push({
      key: members[0].dirName,
      reason: "same-content",
      instances: members,
      versionDivergence: groupVersionDivergence(members),
      contentClass: "identical",
    });
  }

  // Sort: same-dirName groups first, then same-frontmatterName, then
  // same-content; within each, by normalized key so case/separator variants
  // order deterministically.
  const reasonRank: Record<DuplicateGroup["reason"], number> = {
    "same-dirName": 0,
    "same-frontmatterName": 1,
    "same-content": 2,
  };
  groups.sort((a, b) => {
    if (a.reason !== b.reason) {
      return reasonRank[a.reason] - reasonRank[b.reason];
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
  if (reason === "same-dirName") return "same dirName";
  if (reason === "same-content") return "identical content";
  return "same name";
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
    if (group.contentClass === "identical") {
      lines.push(ansi.green("     ✓ identical copies"));
    } else if (group.contentClass === "diverged") {
      lines.push(ansi.yellow("     ⚠ diverged copies"));
      lines.push(
        ansi.dim(
          "     auto-remove skips copies that differ unless you pass --force",
        ),
      );
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
