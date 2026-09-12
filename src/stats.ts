import { readdir, stat } from "fs/promises";
import { join } from "path";
import { ansi, colorProvider } from "./formatter";
import {
  bodyTokens,
  formatTokenCount,
  residentTokens,
} from "./utils/token-count";
import type { SkillInfo, AuditReport, StatsReport } from "./utils/types";

export async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { recursive: true });
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
  let totalResidentTokens = 0;
  let totalBodyTokens = 0;

  const diskPromises = skills.map(async (skill) => {
    // Provider counts
    byProvider[skill.provider] = (byProvider[skill.provider] || 0) + 1;

    // Scope counts
    byScope[skill.scope]++;

    // Context cost (issue #421) — resident is paid every message, the body
    // only when the skill fires. Never conflate the two.
    totalResidentTokens += residentTokens(skill);
    totalBodyTokens += bodyTokens(skill);

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
    totalResidentTokens,
    totalBodyTokens,
  };
}

export function formatHumanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── Bar chart helper ───────────────────────────────────────────────────────

export function bar(
  value: number,
  maxValue: number,
  maxWidth: number = 20,
): string {
  const filled = Math.round((value / maxValue) * maxWidth);
  const empty = maxWidth - filled;
  return ansi.green("#".repeat(filled)) + ansi.dim("-".repeat(empty));
}

// ─── Provider label mapping ─────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  openclaw: "OpenClaw",
  agents: "Agents",
};

export function formatStatsReport(report: StatsReport): string {
  const lines: string[] = [];

  // Title
  lines.push("");
  lines.push(ansi.blueBold("  Skill Statistics"));
  lines.push(ansi.dim("  " + "-".repeat(20)));
  lines.push("");

  // Overview
  lines.push(
    `  ${ansi.bold("Total:")}      ${ansi.cyan(String(report.totalSkills))} skills`,
  );
  lines.push(
    `  ${ansi.bold("Disk:")}       ${ansi.cyan(formatHumanSize(report.totalDiskBytes))}`,
  );
  lines.push(
    `  ${ansi.bold("Resident:")}   ${ansi.cyan(formatTokenCount(report.totalResidentTokens))} ${ansi.dim("(every message)")}`,
  );
  lines.push(
    `  ${ansi.bold("Bodies:")}     ${ansi.cyan(formatTokenCount(report.totalBodyTokens))} ${ansi.dim("(only when a skill fires)")}`,
  );
  lines.push(
    ansi.dim(
      `  Run ${ansi.bold("asm stats --tokens")} for the attention budget`,
    ),
  );
  lines.push("");

  // By Provider (with bar chart)
  lines.push(ansi.bold("  By Tool"));
  const providerEntries = Object.entries(report.byProvider).sort(
    (a, b) => b[1] - a[1],
  );
  const maxProviderCount = Math.max(...providerEntries.map(([, c]) => c));
  const labelWidth = Math.max(
    ...providerEntries.map(([p]) => (PROVIDER_LABELS[p] || p).length),
  );

  for (const [provider, count] of providerEntries) {
    const label = PROVIDER_LABELS[provider] || provider;
    const coloredLabel = colorProvider(provider, label.padEnd(labelWidth));
    const countStr = String(count).padStart(4);
    lines.push(
      `    ${coloredLabel}  ${countStr}  ${bar(count, maxProviderCount)}`,
    );
  }
  lines.push("");

  // By Scope (with bar chart)
  lines.push(ansi.bold("  By Scope"));
  const maxScopeCount = Math.max(report.byScope.global, report.byScope.project);
  const globalStr = String(report.byScope.global).padStart(4);
  const projectStr = String(report.byScope.project).padStart(4);
  lines.push(
    `    ${"global ".padEnd(labelWidth)}  ${globalStr}  ${bar(report.byScope.global, maxScopeCount)}`,
  );
  lines.push(
    `    ${"project".padEnd(labelWidth)}  ${projectStr}  ${bar(report.byScope.project, maxScopeCount)}`,
  );
  lines.push("");

  // Duplicates
  lines.push(ansi.bold("  Duplicates"));
  if (report.duplicateGroups > 0) {
    lines.push(
      `    ${ansi.yellow(`${report.duplicateGroups} group(s), ${report.duplicateInstances} total instance(s)`)}`,
    );
    lines.push(ansi.dim(`    Run ${ansi.bold("asm audit")} to review`));
  } else {
    lines.push(`    ${ansi.green("None")}`);
  }

  lines.push("");
  return lines.join("\n");
}

// Re-exports — public surface preserved after the split (#677).
export {
  formatTokenBudgetReport,
  computeTokenBudget,
  HEAVIEST_RESIDENT_LIMIT,
  median,
} from "./stats-tokens";
export {
  computeAuthorStats,
  formatRepoStatsReport,
  computeRepoStats,
  formatAuthorStatsReport,
  formatIndexStatsReport,
  computeIndexStats,
} from "./stats-index";
