import { ansi, colorProvider, shortenPath } from "./formatter";
import type { SkillInfo, DuplicateGroup, AuditReport } from "./utils/types";

// ─── Detection ─────────────────────────────────────────────────────────────

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

  // Rule 1: same dirName across different locations
  const byDirName = new Map<string, SkillInfo[]>();
  for (const s of deduped) {
    const bucket = byDirName.get(s.dirName) ?? [];
    bucket.push(s);
    byDirName.set(s.dirName, bucket);
  }

  for (const [dirName, members] of byDirName) {
    const uniqueLocations = new Set(members.map((m) => m.location));
    if (uniqueLocations.size >= 2) {
      groups.push({ key: dirName, reason: "same-dirName", instances: members });
      for (const m of members) coveredPaths.add(m.path);
    }
  }

  // Rule 2: same frontmatter name but different dirName
  const byName = new Map<string, SkillInfo[]>();
  for (const s of deduped) {
    if (!s.name) continue;
    const bucket = byName.get(s.name) ?? [];
    bucket.push(s);
    byName.set(s.name, bucket);
  }

  for (const [name, members] of byName) {
    const uniqueDirNames = new Set(members.map((m) => m.dirName));
    if (uniqueDirNames.size < 2) continue;

    // Skip members already covered by Rule 1
    const uncovered = members.filter((m) => !coveredPaths.has(m.path));
    if (uncovered.length < 2) continue;

    // Also need at least 2 distinct dirNames among uncovered
    const uncoveredDirNames = new Set(uncovered.map((m) => m.dirName));
    if (uncoveredDirNames.size < 2) continue;

    groups.push({
      key: name,
      reason: "same-frontmatterName",
      instances: uncovered,
    });
  }

  // Sort: same-dirName groups first, then same-frontmatterName; within each, by key
  groups.sort((a, b) => {
    if (a.reason !== b.reason) {
      return a.reason === "same-dirName" ? -1 : 1;
    }
    return a.key.localeCompare(b.key);
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
    const sorted = sortInstancesForKeep(group.instances);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const provider = colorProvider(s.provider, s.providerLabel);
      const keepTag = i === 0 ? ansi.green(" [keep]") : ansi.dim("       ");
      const scope = ansi.dim(`(${s.scope})`);
      lines.push(
        `   ${keepTag} ${provider} ${scope}  ${ansi.dim(shortenPath(s.path))}`,
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
