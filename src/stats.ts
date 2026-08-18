import { readdir, stat } from "fs/promises";
import { join } from "path";
import { ansi, colorProvider } from "./formatter";
import {
  bodyTokens,
  formatTokenCount,
  residentTokens,
} from "./utils/token-count";
import type {
  SkillInfo,
  AuditReport,
  StatsReport,
  RepoIndex,
  RepoStatsReport,
  AuthorStatsReport,
  IndexStatsReport,
  IndexedSkill,
  TokenBudgetReport,
  TokenBudgetGroup,
  ResidentSkillCost,
} from "./utils/types";

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

function bar(value: number, maxValue: number, maxWidth: number = 20): string {
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

  const heaviestResident = [...perSkill]
    .sort(
      (a, b) =>
        b.residentTokens - a.residentTokens || a.name.localeCompare(b.name),
    )
    .slice(0, limit > 0 ? limit : perSkill.length);

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

// ─── Per-Repo Stats ─────────────────────────────────────────────────────────

/**
 * Aggregate statistics across all indexed repos, grouped per-repo.
 */
export function computeRepoStats(indices: RepoIndex[]): RepoStatsReport[] {
  const results: RepoStatsReport[] = [];

  for (const index of indices) {
    const categories: Record<string, number> = {};
    let verifiedCount = 0;
    let totalTokens = 0;
    let evalScoreSum = 0;
    let evalScoreCount = 0;

    for (const skill of index.skills) {
      // Categories — derive from skill name/description keywords
      const cats = categorizeSkill(skill.name, skill.description);
      for (const cat of cats) {
        categories[cat] = (categories[cat] || 0) + 1;
      }

      if (skill.verified) verifiedCount++;
      totalTokens += skill.tokenCount ?? 0;

      if (skill.evalSummary) {
        evalScoreSum += skill.evalSummary.overallScore;
        evalScoreCount++;
      }
    }

    const avgEvalScore =
      evalScoreCount > 0
        ? Math.round(evalScoreSum / evalScoreCount)
        : undefined;

    results.push({
      owner: index.owner,
      repo: index.repo,
      repoUrl: index.repoUrl,
      skillCount: index.skills.length,
      categories,
      verifiedCount,
      totalTokens,
      avgEvalScore,
    });
  }

  return results.sort((a, b) => b.skillCount - a.skillCount);
}

// ─── Per-Author Stats ────────────────────────────────────────────────────────

/**
 * Aggregate statistics per author (owner) across all indexed repos.
 */
export function computeAuthorStats(indices: RepoIndex[]): AuthorStatsReport[] {
  const authorMap = new Map<string, AuthorStatsReport>();

  for (const index of indices) {
    let author = authorMap.get(index.owner);
    if (!author) {
      author = {
        owner: index.owner,
        totalSkills: 0,
        repos: [],
        categories: {},
        verifiedCount: 0,
        totalTokens: 0,
        topSkills: [],
      };
      authorMap.set(index.owner, author);
    }

    author.repos.push(`${index.owner}/${index.repo}`);

    for (const skill of index.skills) {
      author.totalSkills++;

      const cats = categorizeSkill(skill.name, skill.description);
      for (const cat of cats) {
        author.categories[cat] = (author.categories[cat] || 0) + 1;
      }

      if (skill.verified) author.verifiedCount++;
      author.totalTokens += skill.tokenCount ?? 0;

      // Track top skills by token count
      author.topSkills.push({
        name: skill.name,
        repo: `${index.owner}/${index.repo}`,
      });
    }
  }

  // Sort top skills by token count (descending) and keep top 10
  const results: AuthorStatsReport[] = [];
  for (const [owner, author] of authorMap) {
    const sortedSkills = author.topSkills
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 10);
    results.push({
      ...author,
      topSkills: sortedSkills,
    });
  }

  return results.sort((a, b) => b.totalSkills - a.totalSkills);
}

// ─── Cross-Index Stats ──────────────────────────────────────────────────────

/**
 * Aggregate stats across all indexed repos — global index overview.
 */
export function computeIndexStats(indices: RepoIndex[]): IndexStatsReport {
  let totalSkills = 0;
  let verifiedCount = 0;
  let totalTokens = 0;
  const categoryDist: Record<string, number> = {};
  const owners = new Set<string>();

  for (const index of indices) {
    owners.add(index.owner);
    totalSkills += index.skills.length;

    for (const skill of index.skills) {
      if (skill.verified) verifiedCount++;
      totalTokens += skill.tokenCount ?? 0;

      const cats = categorizeSkill(skill.name, skill.description);
      for (const cat of cats) {
        categoryDist[cat] = (categoryDist[cat] || 0) + 1;
      }
    }
  }

  return {
    totalRepos: indices.length,
    totalSkills,
    totalAuthors: owners.size,
    categoryDistribution: categoryDist,
    verifiedCount,
    totalTokens,
    avgTokensPerSkill:
      totalSkills > 0 ? Math.round(totalTokens / totalSkills) : 0,
  };
}

// ─── Format Functions ────────────────────────────────────────────────────────

/**
 * Format a per-repo stats report as CLI text with bar charts.
 */
export function formatRepoStatsReport(report: RepoStatsReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(ansi.blueBold(`  Repo: ${report.owner}/${report.repo}`));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");

  // Overview
  lines.push(
    `  ${ansi.bold("Skills: ")}${ansi.cyan(String(report.skillCount))}`,
  );
  lines.push(
    `  ${ansi.bold("Verified: ")}${ansi.cyan(String(report.verifiedCount))}`,
  );
  lines.push(
    `  ${ansi.bold("Tokens: ")}${ansi.cyan(formatTokenCount(report.totalTokens))}`,
  );
  if (report.avgEvalScore !== undefined) {
    lines.push(
      `  ${ansi.bold("Avg Eval: ")}${ansi.cyan(String(report.avgEvalScore))}`,
    );
  }
  lines.push("");

  // Category distribution with bar chart
  const catEntries = Object.entries(report.categories).sort(
    (a, b) => b[1] - a[1],
  );
  if (catEntries.length > 0) {
    lines.push(ansi.bold("  Categories"));
    const maxCount = Math.max(...catEntries.map(([, c]) => c));
    for (const [cat, count] of catEntries) {
      const label = cat.padEnd(18);
      const countStr = String(count).padStart(4);
      lines.push(`    ${label}  ${countStr}  ${bar(count, maxCount, 20)}`);
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Format a per-author stats report as CLI text with bar charts.
 */
export function formatAuthorStatsReport(report: AuthorStatsReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(ansi.blueBold(`  Author: ${report.owner}`));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");

  // Overview
  lines.push(
    `  ${ansi.bold("Total Skills: ")}${ansi.cyan(String(report.totalSkills))}`,
  );
  lines.push(
    `  ${ansi.bold("Repos: ")}${ansi.cyan(String(report.repos.length))}`,
  );
  lines.push(
    `  ${ansi.bold("Verified: ")}${ansi.cyan(String(report.verifiedCount))}`,
  );
  lines.push(
    `  ${ansi.bold("Tokens: ")}${ansi.cyan(formatTokenCount(report.totalTokens))}`,
  );
  lines.push("");

  // Category distribution with bar chart
  const catEntries = Object.entries(report.categories).sort(
    (a, b) => b[1] - a[1],
  );
  if (catEntries.length > 0) {
    lines.push(ansi.bold("  Categories"));
    const maxCount = Math.max(...catEntries.map(([, c]) => c));
    for (const [cat, count] of catEntries) {
      const label = cat.padEnd(18);
      const countStr = String(count).padStart(4);
      lines.push(`    ${label}  ${countStr}  ${bar(count, maxCount, 20)}`);
    }
    lines.push("");
  }

  // Top skills
  if (report.topSkills.length > 0) {
    lines.push(ansi.bold("  Top Skills"));
    for (let i = 0; i < report.topSkills.length; i++) {
      const s = report.topSkills[i];
      lines.push(
        `    ${ansi.dim(`${i + 1}.`)} ${ansi.cyan(s.name)} ${ansi.dim(`(${s.repo})`)}`,
      );
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Format the cross-index stats report as CLI text.
 */
export function formatIndexStatsReport(report: IndexStatsReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(ansi.blueBold("  Index Statistics"));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");

  // Overview
  lines.push(
    `  ${ansi.bold("Repos: ")}${ansi.cyan(String(report.totalRepos))}`,
  );
  lines.push(
    `  ${ansi.bold("Skills: ")}${ansi.cyan(String(report.totalSkills))}`,
  );
  lines.push(
    `  ${ansi.bold("Authors: ")}${ansi.cyan(String(report.totalAuthors))}`,
  );
  lines.push(
    `  ${ansi.bold("Verified: ")}${ansi.cyan(String(report.verifiedCount))}`,
  );
  lines.push(
    `  ${ansi.bold("Avg Tokens/Skill: ")}${ansi.cyan(formatTokenCount(report.avgTokensPerSkill))}`,
  );
  lines.push("");

  // Category distribution with bar chart
  const catEntries = Object.entries(report.categoryDistribution).sort(
    (a, b) => b[1] - a[1],
  );
  if (catEntries.length > 0) {
    lines.push(ansi.bold("  Category Distribution"));
    const maxCount = Math.max(...catEntries.map(([, c]) => c));
    for (const [cat, count] of catEntries) {
      const label = cat.padEnd(18);
      const countStr = String(count).padStart(4);
      lines.push(`    ${label}  ${countStr}  ${bar(count, maxCount, 20)}`);
    }
    lines.push("");
  }

  lines.push("");
  return lines.join("\n");
}

// ─── Category helper (used by stats computation) ─────────────────────────────

/**
 * Simple keyword-based categorization mirroring build-catalog.ts logic.
 * Returns an array of matched category names.
 */
function categorizeSkill(name: string, description: string): string[] {
  const text = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  const matched: string[] = [];

  const categoryKeywords: Record<string, string[]> = {
    "ai-agents": [
      "agent",
      "llm",
      "claude",
      "gpt",
      "prompt",
      "openai",
      "anthropic",
      "model",
      "skill-creator",
      "mcp",
      "orchestrat",
    ],
    security: [
      "security",
      "auth",
      "oauth",
      "jwt",
      "ssl",
      "vulnerab",
      "audit",
      "pentest",
      "owasp",
      "encrypt",
      "threat",
      "cso",
    ],
    devops: [
      "docker",
      "kubernetes",
      "deploy",
      "pipeline",
      "terraform",
      "ansible",
      "github action",
      "pre-commit",
      "devops",
    ],
    frontend: [
      "ui",
      "ux",
      "css",
      "html",
      "react",
      "vue",
      "svelte",
      "frontend",
      "component",
      "layout",
      "landing page",
      "web artifact",
      "design system",
    ],
    design: [
      "design",
      "visual",
      "algorithmic art",
      "generative art",
      "canvas",
      "color",
      "logo",
      "brand",
      "theme",
      "figma",
      "typography",
      "illustration",
    ],
    backend: [
      "api",
      "rest",
      "graphql",
      "database",
      "sql",
      "postgres",
      "redis",
      "server",
      "backend",
      "microservice",
    ],
    testing: [
      "test",
      "spec",
      "e2e",
      "unit test",
      "coverage",
      "mock",
      "qa",
      "benchmark",
      "playwright",
    ],
    coding: [
      "code review",
      "refactor",
      "debug",
      "lint",
      "typescript",
      "python",
      "javascript",
      "rust",
      "golang",
      "build",
      "cli",
      "optimizer",
    ],
    writing: [
      "write",
      "blog",
      "article",
      "documentation",
      "docs",
      "draft",
      "content",
      "copy",
      "proposal",
      "readme",
      "changelog",
    ],
    mobile: [
      "ios",
      "android",
      "mobile",
      "xcode",
      "swift",
      "kotlin",
      "flutter",
      "app store",
      "testflight",
      "asc",
    ],
    finance: [
      "finance",
      "trading",
      "stock",
      "crypto",
      "payment",
      "billing",
      "fintech",
      "invest",
      "revenue",
    ],
    marketing: [
      "seo",
      "aso",
      "marketing",
      "analytics",
      "growth",
      "conversion",
      "affiliate",
      "campaign",
      "social media",
      "reddit",
      "twitter",
    ],
    git: ["git", "commit", "branch", "pull request", "pr review", "merge"],
    productivity: [
      "workflow",
      "automation",
      "task",
      "schedule",
      "pdf",
      "xlsx",
      "docx",
      "pptx",
      "spreadsheet",
      "presentation",
    ],
    research: [
      "research",
      "scholar",
      "paper",
      "academic",
      "peer review",
      "investigation",
    ],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const kw of keywords) {
      if (matchesKeyword(text, kw)) {
        matched.push(category);
        break;
      }
    }
  }

  return matched.length > 0 ? matched : ["general"];
}

function matchesKeyword(text: string, kw: string): boolean {
  if (kw.length <= 3) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(text);
  }
  return text.includes(kw);
}
