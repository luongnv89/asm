import { readdir, stat } from "fs/promises";
import { join } from "path";
import { ansi } from "./formatter";
import type { SkillInfo, AuditReport, StatsReport } from "./utils/types";

export async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { recursive: true } as any);
    const statPromises = entries.map(async (entry) => {
      try {
        const s = await stat(join(dirPath, entry));
        if (s.isFile()) return s.size;
      } catch {
        // skip unreadable entries
      }
      return 0;
    });
    const sizes = await Promise.all(statPromises);
    total = sizes.reduce((sum, s) => sum + s, 0);
  } catch {
    // directory doesn't exist or unreadable
  }
  return total;
}

export async function computeStats(
  skills: SkillInfo[],
  duplicates: AuditReport,
): Promise<StatsReport> {
  const byProvider: Record<string, number> = {};
  const byScope = { global: 0, project: 0 };
  const perSkillDiskBytes: Record<string, number> = {};

  const diskPromises = skills.map(async (skill) => {
    // Provider counts
    byProvider[skill.provider] = (byProvider[skill.provider] || 0) + 1;

    // Scope counts
    byScope[skill.scope]++;

    // Disk usage
    const bytes = await dirSize(skill.path);
    perSkillDiskBytes[skill.path] = bytes;
    return bytes;
  });

  const diskSizes = await Promise.all(diskPromises);
  const totalDiskBytes = diskSizes.reduce((sum, s) => sum + s, 0);

  return {
    totalSkills: skills.length,
    byProvider,
    byScope,
    totalDiskBytes,
    perSkillDiskBytes,
    duplicateGroups: duplicates.duplicateGroups.length,
    duplicateInstances: duplicates.totalDuplicateInstances,
  };
}

export function formatHumanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatStatsReport(report: StatsReport): string {
  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${ansi.bold(key + ":")} ${value}`;

  lines.push(ansi.bold("Skill Statistics"));
  lines.push("");
  lines.push(label("Total Skills", String(report.totalSkills)));
  lines.push(label("Disk Usage", formatHumanSize(report.totalDiskBytes)));
  lines.push("");

  // By provider
  lines.push(ansi.bold("By Provider:"));
  for (const [provider, count] of Object.entries(report.byProvider).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${provider}: ${count}`);
  }
  lines.push("");

  // By scope
  lines.push(ansi.bold("By Scope:"));
  lines.push(`  global: ${report.byScope.global}`);
  lines.push(`  project: ${report.byScope.project}`);
  lines.push("");

  // Duplicates
  lines.push(ansi.bold("Duplicates:"));
  if (report.duplicateGroups > 0) {
    lines.push(
      `  ${ansi.yellow(`${report.duplicateGroups} group(s), ${report.duplicateInstances} total instance(s)`)}`,
    );
  } else {
    lines.push(`  ${ansi.green("None")}`);
  }

  return lines.join("\n");
}
