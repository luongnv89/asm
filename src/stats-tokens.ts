import { ansi, colorProvider } from "./formatter";
import {
  bodyTokens,
  formatTokenCount,
  residentTokens,
} from "./utils/token-count";
import type {
  SkillInfo,
  TokenBudgetReport,
  TokenBudgetGroup,
  ResidentSkillCost,
} from "./utils/types";
// Split from stats.ts (issue #677).

// ─── Attention Budget (issue #421) ──────────────────────────────────────────

/** How many heaviest resident descriptions the report lists by default. */
export const HEAVIEST_RESIDENT_LIMIT = 10;

/** Median of a numeric list; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addToGroup(
  groups: Map<string, TokenBudgetGroup>,
  key: string,
  label: string,
  resident: number,
  body: number,
): void {
  let group = groups.get(key);
  if (!group) {
    group = { key, label, skills: 0, residentTokens: 0, bodyTokens: 0 };
    groups.set(key, group);
  }
  group.skills++;
  group.residentTokens += resident;
  group.bodyTokens += body;
}

/**
 * Attention-budget view over the *installed* set (issue #421).
 *
 * Every installed skill's frontmatter description is resident in the agent's
 * system prompt on every message whether or not the skill ever fires, so the
 * resident total — not the disk total and not the body total — is the number
 * that competes with the user's actual work for context.
 */
export function computeTokenBudget(
  skills: SkillInfo[],
  limit: number = HEAVIEST_RESIDENT_LIMIT,
): TokenBudgetReport {
  const providerGroups = new Map<string, TokenBudgetGroup>();
  const scopeGroups = new Map<string, TokenBudgetGroup>();
  const perSkill: ResidentSkillCost[] = [];
  let totalResidentTokens = 0;
  let totalBodyTokens = 0;

  for (const skill of skills) {
    const resident = residentTokens(skill);
    const body = bodyTokens(skill);
    totalResidentTokens += resident;
    totalBodyTokens += body;

    addToGroup(
      providerGroups,
      skill.provider,
      skill.providerLabel || skill.provider,
      resident,
      body,
    );
    addToGroup(scopeGroups, skill.scope, skill.scope, resident, body);

    perSkill.push({
      name: skill.name,
      dirName: skill.dirName,
      provider: skill.provider,
      providerLabel: skill.providerLabel || skill.provider,
      scope: skill.scope,
      path: skill.path,
      residentTokens: resident,
      bodyTokens: body,
    });
  }

  const ranked = [...perSkill].sort(
    (a, b) =>
      b.residentTokens - a.residentTokens || a.name.localeCompare(b.name),
  );
  const cap = limit > 0 ? limit : ranked.length;
  const heaviestResident = ranked.slice(0, cap);

  return {
    totalSkills: skills.length,
    totalResidentTokens,
    totalBodyTokens,
    medianResidentTokens: median(perSkill.map((p) => p.residentTokens)),
    byProvider: [...providerGroups.values()].sort(
      (a, b) => b.residentTokens - a.residentTokens || b.skills - a.skills,
    ),
    byScope: [...scopeGroups.values()].sort(
      (a, b) => b.residentTokens - a.residentTokens,
    ),
    heaviestResident,
    heaviestResidentTotal: perSkill.length,
    heaviestResidentTruncated: heaviestResident.length < perSkill.length,
  };
}

/** Render the attention-budget report as CLI text. */
export function formatTokenBudgetReport(report: TokenBudgetReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(ansi.blueBold("  Attention Budget"));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");
  lines.push(
    ansi.dim(
      "  Resident = frontmatter descriptions, paid on every message.\n" +
        "  Bodies   = full SKILL.md, paid only when a skill fires.",
    ),
  );
  lines.push("");

  if (report.totalSkills === 0) {
    lines.push("  No installed skills.");
    lines.push("");
    return lines.join("\n");
  }

  const rows: Array<[string, TokenBudgetGroup]> = [
    ...report.byProvider.map(
      (g) => ["provider", g] as [string, TokenBudgetGroup],
    ),
  ];
  const labelWidth = Math.max(
    8,
    ...rows.map(([, g]) => g.label.length),
    "Total".length,
  );
  const residentStrings = report.byProvider.map((g) =>
    formatTokenCount(g.residentTokens),
  );
  const residentWidth = Math.max(
    ...residentStrings.map((r) => r.length),
    formatTokenCount(report.totalResidentTokens).length,
  );

  const header =
    "  " +
    "Tool".padEnd(labelWidth) +
    "  " +
    "Skills".padStart(6) +
    "  " +
    "Resident".padStart(residentWidth) +
    "  " +
    "Bodies";
  lines.push(ansi.bold(header));

  for (const group of report.byProvider) {
    lines.push(
      "  " +
        colorProvider(group.key, group.label.padEnd(labelWidth)) +
        "  " +
        String(group.skills).padStart(6) +
        "  " +
        ansi.cyan(
          formatTokenCount(group.residentTokens).padStart(residentWidth),
        ) +
        "  " +
        ansi.dim(formatTokenCount(group.bodyTokens)),
    );
  }

  lines.push(ansi.dim("  " + "-".repeat(labelWidth + residentWidth + 22)));
  lines.push(
    "  " +
      ansi.bold("Total".padEnd(labelWidth)) +
      "  " +
      String(report.totalSkills).padStart(6) +
      "  " +
      ansi.cyan(
        formatTokenCount(report.totalResidentTokens).padStart(residentWidth),
      ) +
      "  " +
      ansi.dim(formatTokenCount(report.totalBodyTokens)),
  );
  lines.push("");

  // By scope
  lines.push(ansi.bold("  By Scope"));
  for (const group of report.byScope) {
    lines.push(
      "  " +
        group.label.padEnd(labelWidth) +
        "  " +
        String(group.skills).padStart(6) +
        "  " +
        ansi.cyan(
          formatTokenCount(group.residentTokens).padStart(residentWidth),
        ) +
        "  " +
        ansi.dim(formatTokenCount(group.bodyTokens)),
    );
  }
  lines.push("");

  // Heaviest resident descriptions
  if (report.heaviestResident.length > 0) {
    lines.push(ansi.bold("  Heaviest resident descriptions"));
    const nameWidth = Math.max(
      ...report.heaviestResident.map((s) => s.name.length),
    );
    // Right-align the token column like the provider/scope tables above, so
    // mixed widths (`~1.2k tokens` vs `~289 tokens`) stay comparable.
    const heaviestWidth = Math.max(
      ...report.heaviestResident.map(
        (s) => formatTokenCount(s.residentTokens).length,
      ),
    );
    for (const skill of report.heaviestResident) {
      lines.push(
        "    " +
          skill.name.padEnd(nameWidth) +
          "  " +
          ansi.cyan(
            formatTokenCount(skill.residentTokens).padStart(heaviestWidth),
          ) +
          "  " +
          ansi.dim(`(${skill.provider}, ${skill.scope})`),
      );
    }
    const hidden =
      report.heaviestResidentTotal - report.heaviestResident.length;
    if (hidden > 0) {
      lines.push(
        ansi.dim(`  … ${hidden} more not shown — use --json for the full list`),
      );
    }
    lines.push("");
    lines.push(
      ansi.dim(
        `  Median resident cost: ${formatTokenCount(report.medianResidentTokens)}`,
      ),
    );
    lines.push(
      ansi.dim(`  Run ${ansi.bold("asm audit residency")} for demotion advice`),
    );
    lines.push("");
  }

  return lines.join("\n");
}
