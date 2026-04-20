import type { SkillInfo } from "./utils/types";
import { countFiles } from "./scanner";
import { formatTokenCount } from "./utils/token-count";

// ─── Color helpers ──────────────────────────────────────────────────────────

const useColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false;
  if ((globalThis as any).__CLI_NO_COLOR) return false;
  if (!process.stdout.isTTY) return false;
  return true;
};

const ansi = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor() ? `\x1b[36m${s}\x1b[0m` : s),
  green: (s: string) => (useColor() ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor() ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
  white: (s: string) => (useColor() ? `\x1b[37m${s}\x1b[0m` : s),
  red: (s: string) => (useColor() ? `\x1b[31m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor() ? `\x1b[34m${s}\x1b[0m` : s),
  blueBold: (s: string) => (useColor() ? `\x1b[34;1m${s}\x1b[0m` : s),
  magenta: (s: string) => (useColor() ? `\x1b[35m${s}\x1b[0m` : s),
  bgDim: (s: string) => (useColor() ? `\x1b[48;5;236m${s}\x1b[0m` : s),
  bgRed: (s: string) => (useColor() ? `\x1b[41m\x1b[37m\x1b[1m${s}\x1b[0m` : s),
  bgYellow: (s: string) =>
    useColor() ? `\x1b[43m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgGreen: (s: string) =>
    useColor() ? `\x1b[42m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgCyan: (s: string) =>
    useColor() ? `\x1b[46m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
};

export { ansi };

// ─── Effort colors ─────────────────────────────────────────────────────────

export function colorEffort(effort: string | undefined): string {
  if (!effort) return "";
  switch (effort.toLowerCase()) {
    case "low":
      return ansi.green(effort);
    case "medium":
      return ansi.yellow(effort);
    case "high":
      return ansi.red(effort);
    case "max":
      return ansi.magenta(effort);
    default:
      return effort;
  }
}

// ─── Provider colors ───────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, (s: string) => string> = {
  claude: ansi.blueBold,
  codex: ansi.cyan,
  "codex-plugin": ansi.cyan,
  openclaw: ansi.yellow,
  agents: ansi.green,
  custom: ansi.magenta,
  cursor: ansi.blue,
  windsurf: ansi.cyan,
  cline: ansi.green,
  roocode: ansi.magenta,
  continue: ansi.yellow,
  copilot: ansi.white,
  aider: ansi.red,
  opencode: ansi.cyan,
  zed: ansi.blue,
  augment: ansi.green,
  amp: ansi.yellow,
};

export function colorProvider(provider: string, label: string): string {
  const colorFn = PROVIDER_COLORS[provider] || ansi.dim;
  return colorFn(label);
}

function providerBadge(provider: string, label: string): string {
  if (!useColor()) return `[${label}]`;
  const colorFn = PROVIDER_COLORS[provider] || ansi.dim;
  return colorFn(`[${label}]`);
}

// ─── Path shortening ───────────────────────────────────────────────────────

export function shortenPath(fullPath: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }
  return fullPath;
}

// ─── Table formatter ────────────────────────────────────────────────────────

export function formatSkillTable(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const headers = [
    "Name",
    "Version",
    "Creator",
    "Effort",
    "Tool",
    "Scope",
    "Type",
    "Path",
  ];

  const rows = skills.map((s) => [
    s.name,
    s.version,
    s.creator || "\u2014",
    s.effort || "\u2014",
    s.providerLabel,
    s.scope,
    s.isSymlink ? "symlink" : "directory",
    shortenPath(s.path),
  ]);

  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const pad = (str: string, width: number) => str.padEnd(width);

  const headerLine = headers.map((h, i) => pad(h, widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("--");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => pad(cell, widths[i])).join("  "),
  );

  return [
    useColor() ? ansi.bold(headerLine) : headerLine,
    separator,
    ...dataLines,
  ].join("\n");
}

// ─── Grouped table formatter ────────────────────────────────────────────────

interface GroupedSkill {
  name: string;
  version: string;
  creator: string;
  effort: string;
  tokens: string;
  providers: Array<{ provider: string; label: string }>;
  scope: "global" | "project" | "mixed";
  type: "symlink" | "directory" | "mixed";
  path: string;
  warningCount: number;
}

function groupSkills(skills: SkillInfo[]): GroupedSkill[] {
  const groups = new Map<string, SkillInfo[]>();

  for (const s of skills) {
    const key = `${s.dirName}||${s.scope}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const result: GroupedSkill[] = [];
  for (const [, members] of groups) {
    const ref = members[0];
    const scopes = new Set(members.map((m) => m.scope));
    const types = new Set(
      members.map((m) => (m.isSymlink ? "symlink" : "directory")),
    );

    result.push({
      name: ref.name,
      version: ref.version,
      creator: ref.creator || "",
      effort: ref.effort || "",
      tokens:
        typeof ref.tokenCount === "number"
          ? formatTokenCount(ref.tokenCount)
          : "",
      providers: members.map((m) => ({
        provider: m.provider,
        label: m.providerLabel,
      })),
      scope: scopes.size > 1 ? "mixed" : ref.scope,
      type: types.size > 1 ? "mixed" : ref.isSymlink ? "symlink" : "directory",
      path: shortenPath(ref.path),
      warningCount: members.reduce(
        (sum, m) => sum + (m.warnings?.length ?? 0),
        0,
      ),
    });
  }

  return result;
}

/**
 * Threshold above which `asm list` automatically prepends a compact summary
 * section before the full table. Chosen so that installations with "many"
 * skills (issue #192) surface a scannable overview, while small inventories
 * keep the existing output verbatim (regression safety for formatter tests).
 */
export const LARGE_LIST_THRESHOLD = 50;

/**
 * Build a compact, human-scannable summary of a skill list.
 *
 * Used in two places:
 *   1. `asm list --summary` — prints the summary alone, no table.
 *   2. `asm list` when the result set exceeds LARGE_LIST_THRESHOLD — the
 *      summary is prepended above the full grouped table so users can see
 *      the shape of their inventory at a glance.
 *
 * The summary includes total counts, top tools, top scopes, and top efforts
 * (up to `topN` entries per category). A trailing hint suggests refining
 * commands like `asm list -p <tool>` or `asm search <query>`.
 */
export function formatListSummary(
  skills: SkillInfo[],
  options: { topN?: number; showHint?: boolean } = {},
): string {
  const topN = options.topN ?? 5;
  const showHint = options.showHint ?? true;

  if (skills.length === 0) {
    return "No skills found.";
  }

  const lines: string[] = [];
  const grouped = groupSkills(skills);
  const uniqueCount = grouped.length;
  const totalCount = skills.length;
  const providerSet = new Set(skills.map((s) => s.provider));
  const globalCount = skills.filter((s) => s.scope === "global").length;
  const projectCount = skills.filter((s) => s.scope === "project").length;

  const header = `${totalCount} skills (${uniqueCount} unique) across ${providerSet.size} tools | ${globalCount} global, ${projectCount} project`;
  lines.push(useColor() ? ansi.bold(header) : header);
  lines.push("");

  // Top tools (by skill install count)
  const toolCounts = new Map<string, { label: string; count: number }>();
  for (const s of skills) {
    const entry = toolCounts.get(s.provider) ?? {
      label: s.providerLabel,
      count: 0,
    };
    entry.count += 1;
    toolCounts.set(s.provider, entry);
  }
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN);

  lines.push(useColor() ? ansi.bold("Top tools:") : "Top tools:");
  for (const [provider, { label, count }] of topTools) {
    const badge = useColor()
      ? colorProvider(provider, `[${label}]`)
      : `[${label}]`;
    lines.push(`  ${badge}  ${count} skill${count === 1 ? "" : "s"}`);
  }

  // Scope breakdown (always full — only 2 scopes)
  lines.push("");
  lines.push(useColor() ? ansi.bold("Scopes:") : "Scopes:");
  lines.push(`  global   ${globalCount} skill${globalCount === 1 ? "" : "s"}`);
  lines.push(
    `  project  ${projectCount} skill${projectCount === 1 ? "" : "s"}`,
  );

  // Top efforts (only if at least one skill has an effort)
  const effortCounts = new Map<string, number>();
  for (const s of skills) {
    if (s.effort) {
      effortCounts.set(s.effort, (effortCounts.get(s.effort) ?? 0) + 1);
    }
  }
  if (effortCounts.size > 0) {
    const topEfforts = [...effortCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);
    lines.push("");
    lines.push(useColor() ? ansi.bold("Top efforts:") : "Top efforts:");
    for (const [effort, count] of topEfforts) {
      const coloredEffort = colorEffort(effort);
      // Pad by visual width, not string length — `colorEffort` wraps the
      // value in ANSI escape codes when colors are enabled, which inflates
      // `.padEnd()` char count and breaks alignment in real terminals.
      const effortPad = Math.max(0, 6 - effort.length);
      lines.push(
        `  ${coloredEffort}${" ".repeat(effortPad)}  ${count} skill${count === 1 ? "" : "s"}`,
      );
    }
  }

  if (showHint) {
    lines.push("");
    const hint =
      "Tip: refine with `asm list -p <tool>`, `asm search <query>`, or `asm list --compact`";
    lines.push(useColor() ? ansi.dim(hint) : hint);
  }

  return lines.join("\n");
}

/**
 * One-line-per-skill compact table format.
 *
 * Designed for users with 100+ skills who want to scan their whole inventory
 * without sacrificing readability. Each row is `name  version  [tools]  scope`
 * with aligned columns and colorized provider badges.
 */
export function formatCompactTable(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const grouped = groupSkills(skills);
  const lines: string[] = [];

  const nameW = Math.max(4, ...grouped.map((g) => g.name.length));
  const versionW = Math.max(7, ...grouped.map((g) => g.version.length));

  const providerStrs = grouped.map((g) =>
    g.providers.map((p) => providerBadge(p.provider, p.label)).join(" "),
  );
  const providerPlain = grouped.map((g) =>
    g.providers.map((p) => `[${p.label}]`).join(" "),
  );
  const providerW = Math.max(5, ...providerPlain.map((s) => s.length));
  const scopeW = 7;

  const pad = (s: string, w: number) => s.padEnd(w);

  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    const name = pad(g.name, nameW);
    const version = ansi.dim(pad(g.version, versionW));
    const provPadding = providerW - providerPlain[i].length;
    const prov = providerStrs[i] + " ".repeat(Math.max(0, provPadding));
    const scope = ansi.dim(pad(g.scope, scopeW));
    lines.push(`${name}  ${version}  ${prov}  ${scope}`);
  }

  // Footer — short, just total/unique count
  lines.push("");
  const totalCount = skills.length;
  const uniqueCount = grouped.length;
  const footer = `${totalCount} skills (${uniqueCount} unique)`;
  lines.push(ansi.dim(footer));

  return lines.join("\n");
}

/** Supported group-by axes for `asm list --group-by <axis>`. */
export type GroupByAxis = "tool" | "scope" | "effort";

/**
 * Group-by formatter: rows are collapsed under category headers. Each
 * skill appears once per axis value (e.g., skills installed in multiple
 * tools appear under each tool when grouping by `tool`). Uses the compact
 * one-line-per-skill renderer under each header to keep output dense.
 */
export function formatGroupByTable(
  skills: SkillInfo[],
  axis: GroupByAxis,
): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const buckets = new Map<string, SkillInfo[]>();

  const labelFor = (s: SkillInfo): string[] => {
    switch (axis) {
      case "tool":
        return [s.providerLabel];
      case "scope":
        return [s.scope];
      case "effort":
        return [s.effort && s.effort.length > 0 ? s.effort : "(unset)"];
    }
  };

  for (const s of skills) {
    for (const label of labelFor(s)) {
      const list = buckets.get(label) ?? [];
      list.push(s);
      buckets.set(label, list);
    }
  }

  // Deterministic ordering: by count desc, then alpha
  const ordered = [...buckets.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const lines: string[] = [];
  for (const [label, members] of ordered) {
    const header = `${label} (${members.length})`;
    lines.push(useColor() ? ansi.bold(header) : header);
    // Reuse compact formatter for dense rows
    const body = formatCompactTable(members);
    // Drop the trailing footer from compact (we'll add one at the bottom)
    const bodyLines = body.split("\n");
    // Indent every non-empty body line and drop final footer (last two lines)
    const indented = bodyLines
      .slice(0, -2)
      .filter((l) => l.length > 0)
      .map((l) => `  ${l}`);
    lines.push(...indented);
    lines.push("");
  }

  // Footer
  const totalCount = skills.length;
  const uniqueCount = groupSkills(skills).length;
  const footer = `${totalCount} skills (${uniqueCount} unique), grouped by ${axis}`;
  lines.push(ansi.dim(footer));

  return lines.join("\n");
}

/**
 * Truncate a skill list to `limit` entries when `limit > 0`, returning the
 * slice plus a hint line for the caller to append. When no truncation is
 * needed, returns the original list and an empty hint.
 */
export function applyListLimit(
  skills: SkillInfo[],
  limit: number,
): { skills: SkillInfo[]; hint: string } {
  if (!Number.isFinite(limit) || limit <= 0 || skills.length <= limit) {
    return { skills, hint: "" };
  }
  const truncated = skills.slice(0, limit);
  const remaining = skills.length - limit;
  const hint = ansi.dim(
    `... ${remaining} more not shown. Re-run with --limit ${skills.length} (or 0) to see all, or refine with -p <tool>.`,
  );
  return { skills: truncated, hint };
}

export function formatGroupedTable(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const grouped = groupSkills(skills);
  const lines: string[] = [];

  // Calculate column widths
  const nameW = Math.max(4, ...grouped.map((g) => g.name.length));
  const versionW = Math.max(7, ...grouped.map((g) => g.version.length));
  const creatorW = Math.max(
    7,
    ...grouped.map((g) => Math.min((g.creator || "\u2014").length, 15)),
  );
  const effortW = Math.max(
    6,
    ...grouped.map((g) => (g.effort || "\u2014").length),
  );
  // Tokens column — render `~N tokens` directly (e.g. "~1.2k tokens").
  // Width follows the longest cell; header label fallback `Tokens` is 6.
  const hasAnyTokens = grouped.some((g) => g.tokens.length > 0);
  const tokensW = hasAnyTokens
    ? Math.max(6, ...grouped.map((g) => (g.tokens || "\u2014").length))
    : 0;
  const scopeW = 7; // "project" is longest
  const typeW = 9; // "directory" is longest

  // Build provider badges (measure without ANSI codes)
  const providerStrs = grouped.map((g) =>
    g.providers.map((p) => providerBadge(p.provider, p.label)).join(" "),
  );
  const providerPlain = grouped.map((g) =>
    g.providers.map((p) => `[${p.label}]`).join(" "),
  );
  const providerW = Math.max(9, ...providerPlain.map((s) => s.length));

  const pad = (s: string, w: number) => s.padEnd(w);

  // Header
  const tokensHeader = hasAnyTokens ? `  ${pad("Tokens", tokensW)}` : "";
  const header = `${pad("Name", nameW)}  ${pad("Version", versionW)}  ${pad("Creator", creatorW)}  ${pad("Effort", effortW)}${tokensHeader}  ${pad("Tools", providerW)}  ${pad("Scope", scopeW)}  ${pad("Type", typeW)}`;
  lines.push(useColor() ? ansi.bold(header) : header);
  const tokensSep = hasAnyTokens ? `  ${"-".repeat(tokensW)}` : "";
  lines.push(
    `${"-".repeat(nameW)}  ${"-".repeat(versionW)}  ${"-".repeat(creatorW)}  ${"-".repeat(effortW)}${tokensSep}  ${"-".repeat(providerW)}  ${"-".repeat(scopeW)}  ${"-".repeat(typeW)}`,
  );

  // Data rows
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    const name = pad(g.name, nameW);
    const version = pad(g.version, versionW);
    const creatorDisplay = (g.creator || "\u2014").slice(0, 15);
    const creator = pad(creatorDisplay, creatorW);
    const effortPlain = g.effort || "\u2014";
    const effortColored = g.effort ? colorEffort(g.effort) : "\u2014";
    const effortPad = effortW - effortPlain.length;
    const effort = effortColored + " ".repeat(Math.max(0, effortPad));
    const tokensCell = hasAnyTokens
      ? `  ${pad(g.tokens || "\u2014", tokensW)}`
      : "";
    // Provider badges have ANSI codes, so we pad based on plain text width
    const provPadding = providerW - providerPlain[i].length;
    const prov = providerStrs[i] + " ".repeat(Math.max(0, provPadding));
    const scope = pad(g.scope, scopeW);
    const type = pad(g.type, typeW);
    const warn =
      g.warningCount > 0
        ? ` ${ansi.yellow(`(${g.warningCount} warning${g.warningCount > 1 ? "s" : ""})`)}`
        : "";

    lines.push(
      `${name}  ${version}  ${creator}  ${effort}${tokensCell}  ${prov}  ${scope}  ${type}${warn}`,
    );
  }

  // Footer summary
  const uniqueCount = grouped.length;
  const totalCount = skills.length;
  const providerSet = new Set(skills.map((s) => s.provider));
  const globalCount = skills.filter((s) => s.scope === "global").length;
  const projectCount = skills.filter((s) => s.scope === "project").length;

  lines.push("");
  const footer = `${totalCount} skills (${uniqueCount} unique) across ${providerSet.size} tools | ${globalCount} global, ${projectCount} project`;
  lines.push(ansi.dim(footer));

  return lines.join("\n");
}

// ─── Search result formatter ────────────────────────────────────────────────

function highlightMatch(text: string, query: string): string {
  if (!useColor() || !query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${before}${ansi.bold(ansi.yellow(match))}${after}`;
}

export function formatSearchResults(
  skills: SkillInfo[],
  query: string,
): string {
  if (skills.length === 0) {
    return `No skills matching "${query}". Try ${ansi.bold("asm list")} to see all skills.`;
  }

  const grouped = groupSkills(skills);
  const lines: string[] = [];

  // Summary header
  lines.push(
    ansi.dim(
      `Found ${skills.length} result${skills.length === 1 ? "" : "s"} (${grouped.length} unique) matching "${query}"`,
    ) + "\n",
  );

  // Calculate column widths
  const nameW = Math.max(4, ...grouped.map((g) => g.name.length));
  const versionW = Math.max(7, ...grouped.map((g) => g.version.length));
  const creatorW = Math.max(
    7,
    ...grouped.map((g) => Math.min((g.creator || "\u2014").length, 15)),
  );
  const effortW = Math.max(
    6,
    ...grouped.map((g) => (g.effort || "\u2014").length),
  );

  const providerStrs = grouped.map((g) =>
    g.providers.map((p) => providerBadge(p.provider, p.label)).join(" "),
  );
  const providerPlain = grouped.map((g) =>
    g.providers.map((p) => `[${p.label}]`).join(" "),
  );
  const providerW = Math.max(9, ...providerPlain.map((s) => s.length));

  const scopeW = 7;
  const typeW = 9;

  const pad = (s: string, w: number) => s.padEnd(w);

  // Header
  const header = `${pad("Name", nameW)}  ${pad("Version", versionW)}  ${pad("Creator", creatorW)}  ${pad("Effort", effortW)}  ${pad("Tools", providerW)}  ${pad("Scope", scopeW)}  ${pad("Type", typeW)}`;
  lines.push(useColor() ? ansi.bold(header) : header);
  lines.push(
    `${"-".repeat(nameW)}  ${"-".repeat(versionW)}  ${"-".repeat(creatorW)}  ${"-".repeat(effortW)}  ${"-".repeat(providerW)}  ${"-".repeat(scopeW)}  ${"-".repeat(typeW)}`,
  );

  // Data rows with highlighting
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    const nameHighlighted = highlightMatch(g.name, query);
    // Pad based on original name length (without ANSI)
    const namePad = nameW - g.name.length;
    const name = nameHighlighted + " ".repeat(Math.max(0, namePad));
    const version = pad(g.version, versionW);
    const creatorDisplay = (g.creator || "\u2014").slice(0, 15);
    const creator = pad(creatorDisplay, creatorW);
    const effortPlain = g.effort || "\u2014";
    const effortColored = g.effort ? colorEffort(g.effort) : "\u2014";
    const effortPad = effortW - effortPlain.length;
    const effort = effortColored + " ".repeat(Math.max(0, effortPad));
    const provPadding = providerW - providerPlain[i].length;
    const prov = providerStrs[i] + " ".repeat(Math.max(0, provPadding));
    const scope = pad(g.scope, scopeW);
    const type = pad(g.type, typeW);

    lines.push(
      `${name}  ${version}  ${creator}  ${effort}  ${prov}  ${scope}  ${type}`,
    );
  }

  return lines.join("\n");
}

// ─── Available (index) search result formatter ──────────────────────────────

export interface AvailableSkillResult {
  name: string;
  version: string;
  description: string;
  verified?: boolean;
  repoLabel: string;
  installUrl: string;
}

export function formatAvailableSearchResults(
  results: AvailableSkillResult[],
  query: string,
): string {
  if (results.length === 0) {
    return "";
  }

  const lines: string[] = [];

  // Summary header with total count
  lines.push(
    ansi.dim(
      `Found ${results.length} available skill${results.length === 1 ? "" : "s"} matching "${query}"`,
    ) + "\n",
  );

  for (const result of results) {
    // Install command hint
    lines.push(
      `  ${ansi.dim("To install:")} ${ansi.green(`asm install ${result.installUrl}`)}`,
    );
    // Skill name + version + verified badge + repo
    const verifiedTag = result.verified ? ansi.blue(" [verified]") : "";
    lines.push(
      `  ${ansi.cyan(result.name)} ${ansi.dim(`v${result.version}`)}${verifiedTag} ${ansi.dim(`[${result.repoLabel}]`)}`,
    );
    // Description
    for (const dl of wordWrap(result.description, 76)) {
      lines.push(`    ${dl}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Allowed-tools risk coloring ────────────────────────────────────────────

export const HIGH_RISK_TOOLS = new Set([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
]);
export const MEDIUM_RISK_TOOLS = new Set(["WebFetch", "WebSearch"]);

export function colorTool(tool: string): string {
  if (HIGH_RISK_TOOLS.has(tool)) return ansi.red(tool);
  if (MEDIUM_RISK_TOOLS.has(tool)) return ansi.yellow(tool);
  return ansi.green(tool);
}

export function formatAllowedTools(tools: string[]): string {
  if (tools.length === 0) return "";
  return tools.map(colorTool).join("  ");
}

function toolRiskWarning(tools: string[]): string | null {
  const high = tools.filter((t) => HIGH_RISK_TOOLS.has(t));
  if (high.length === 0) return null;
  const actions: string[] = [];
  if (high.includes("Bash")) actions.push("execute shell commands");
  if (
    high.includes("Write") ||
    high.includes("Edit") ||
    high.includes("NotebookEdit")
  )
    actions.push("modify files");
  return `This skill can ${actions.join(" and ")}`;
}

// ─── Detail formatter ───────────────────────────────────────────────────────

export async function formatSkillDetail(skill: SkillInfo): Promise<string> {
  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${useColor() ? ansi.bold(key + ":") : key + ":"} ${value}`;

  lines.push(label("Name", skill.name));
  lines.push(label("Version", skill.version));
  lines.push(label("Creator", skill.creator || "\u2014"));
  lines.push(label("License", skill.license || "\u2014"));
  if (skill.compatibility) {
    lines.push(label("Compatibility", skill.compatibility));
  }
  if (skill.effort) {
    lines.push(label("Effort", colorEffort(skill.effort)));
  }
  lines.push(label("Tool", skill.providerLabel));
  lines.push(label("Scope", skill.scope));
  lines.push(label("Location", skill.location));
  lines.push(label("Path", shortenPath(skill.path)));
  lines.push(label("Type", skill.isSymlink ? "symlink" : "directory"));
  if (skill.isSymlink && skill.symlinkTarget) {
    lines.push(label("Symlink Target", skill.symlinkTarget));
  }
  const fileCount = skill.fileCount ?? (await countFiles(skill.path));
  lines.push(label("File Count", String(fileCount)));
  if (typeof skill.tokenCount === "number") {
    lines.push(label("Est. Tokens", formatTokenCount(skill.tokenCount)));
  }
  if (skill.description) {
    lines.push("");
    lines.push(label("Description", skill.description));
  }

  if (skill.allowedTools && skill.allowedTools.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("Allowed Tools:") : "Allowed Tools:");
    lines.push(`  ${formatAllowedTools(skill.allowedTools)}`);
    const warning = toolRiskWarning(skill.allowedTools);
    if (warning) {
      lines.push(`  ${useColor() ? ansi.yellow("\u26A0") : "!"} ${warning}`);
    }
  }

  // Eval summary section — fulfills issue #187 acceptance criteria.
  // Show empty state explicitly when not available so it never reads as
  // "broken or missing".
  lines.push("");
  lines.push(useColor() ? ansi.bold("Eval Score:") : "Eval Score:");
  if (skill.evalSummary) {
    const ev = skill.evalSummary;
    const overallColored = colorEvalScore(ev.overallScore);
    lines.push(`  Overall: ${overallColored} / 100  (${ev.grade})`);
    const evVer = ev.evaluatedVersion
      ? ` — version ${ev.evaluatedVersion}`
      : "";
    lines.push(
      `  ${useColor() ? ansi.dim("Evaluated:") : "Evaluated:"} ${ev.evaluatedAt}${evVer}`,
    );
    if (ev.categories.length > 0) {
      lines.push(useColor() ? ansi.dim("  Categories:") : "  Categories:");
      for (const c of ev.categories) {
        lines.push(`    ${c.name.padEnd(28)} ${c.score}/${c.max}`);
      }
    }
  } else {
    lines.push(
      useColor()
        ? ansi.dim(
            "  Not available — run `asm eval " +
              skill.path +
              "` to generate one.",
          )
        : "  Not available — run `asm eval " +
            skill.path +
            "` to generate one.",
    );
  }

  if (skill.warnings && skill.warnings.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("Warnings:") : "Warnings:");
    for (const w of skill.warnings) {
      lines.push(
        `  ${useColor() ? ansi.yellow("!") : "!"} [${w.category}] ${w.message}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Color an `asm eval` overall score (0..100) by quality tier.
 *   90+ green, 80+ cyan, 65+ yellow, else red.
 */
export function colorEvalScore(score: number): string {
  const txt = String(score);
  if (!useColor()) return txt;
  if (score >= 90) return ansi.green(txt);
  if (score >= 80) return ansi.cyan(txt);
  if (score >= 65) return ansi.yellow(txt);
  return ansi.red(txt);
}

// ─── Multi-instance detail formatter ────────────────────────────────────────

export async function formatSkillInspect(skills: SkillInfo[]): Promise<string> {
  if (skills.length === 0) return "No skills found.";
  if (skills.length === 1) return formatSkillDetail(skills[0]);

  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${useColor() ? ansi.bold(key + ":") : key + ":"} ${value}`;
  const ref = skills[0];

  // ── Header ──
  const title = ref.name;
  lines.push("");
  lines.push(useColor() ? ansi.blueBold(`  ${title}`) : `  ${title}`);
  lines.push(
    useColor()
      ? ansi.dim("  " + "-".repeat(title.length + 2))
      : "  " + "-".repeat(title.length + 2),
  );
  lines.push("");

  // ── Shared info ──
  lines.push(label("  Version", ref.version));
  lines.push(label("  Creator", ref.creator || "\u2014"));
  lines.push(label("  License", ref.license || "\u2014"));
  if (ref.compatibility) {
    lines.push(label("  Compatibility", ref.compatibility));
  }
  if (ref.effort) {
    lines.push(label("  Effort", colorEffort(ref.effort)));
  }

  const fileCount = ref.fileCount ?? (await countFiles(ref.path));
  lines.push(label("  File Count", String(fileCount)));
  if (typeof ref.tokenCount === "number") {
    lines.push(label("  Est. Tokens", formatTokenCount(ref.tokenCount)));
  }

  // Provider badges
  const badges = skills
    .map((s) => providerBadge(s.provider, s.providerLabel))
    .join(" ");
  lines.push(label("  Installed in", badges));

  // Eval summary block
  lines.push("");
  lines.push(useColor() ? ansi.bold("  Eval Score:") : "  Eval Score:");
  if (ref.evalSummary) {
    const ev = ref.evalSummary;
    const overallColored = colorEvalScore(ev.overallScore);
    lines.push(`    Overall: ${overallColored} / 100  (${ev.grade})`);
    const evVer = ev.evaluatedVersion
      ? ` — version ${ev.evaluatedVersion}`
      : "";
    lines.push(
      `    ${useColor() ? ansi.dim("Evaluated:") : "Evaluated:"} ${ev.evaluatedAt}${evVer}`,
    );
    if (ev.categories.length > 0) {
      for (const c of ev.categories) {
        lines.push(`      ${c.name.padEnd(28)} ${c.score}/${c.max}`);
      }
    }
  } else {
    lines.push(
      useColor()
        ? ansi.dim(
            `    Not available — run \`asm eval ${ref.path}\` to generate one.`,
          )
        : `    Not available — run \`asm eval ${ref.path}\` to generate one.`,
    );
  }

  // ── Description ──
  if (ref.description) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("  Description:") : "  Description:");
    const wrapped = wordWrap(ref.description, 72);
    for (const wl of wrapped) {
      lines.push("    " + wl);
    }
  }

  // ── Allowed Tools ──
  if (ref.allowedTools && ref.allowedTools.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("  Allowed Tools:") : "  Allowed Tools:");
    lines.push(`    ${formatAllowedTools(ref.allowedTools)}`);
    const warning = toolRiskWarning(ref.allowedTools);
    if (warning) {
      lines.push(`    ${useColor() ? ansi.yellow("\u26A0") : "!"} ${warning}`);
    }
  }

  // ── Installations ──
  lines.push("");
  const instHeader = `  Installations (${skills.length})`;
  lines.push(useColor() ? ansi.bold(instHeader) : instHeader);

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const provider = colorProvider(s.provider, s.providerLabel);
    const type = s.isSymlink ? "symlink" : "directory";
    const scope = ansi.dim(s.scope);

    lines.push(`    ${provider} (${scope}, ${type})`);
    lines.push(`      ${ansi.dim("Path:")} ${shortenPath(s.path)}`);
    if (s.isSymlink && s.symlinkTarget) {
      lines.push(`      ${ansi.dim("Target:")} ${s.symlinkTarget}`);
    }
  }

  // ── Warnings (aggregate) ──
  const allWarnings = skills.flatMap((s) => {
    if (!s.warnings || s.warnings.length === 0) return [];
    return s.warnings.map((w) => ({ ...w, provider: s.providerLabel }));
  });

  if (allWarnings.length > 0) {
    lines.push("");
    const warnHeader = `  Warnings (${allWarnings.length})`;
    lines.push(useColor() ? ansi.bold(warnHeader) : warnHeader);
    for (const w of allWarnings) {
      const icon = useColor() ? ansi.yellow("!") : "!";
      lines.push(`    ${icon} [${w.category}] ${w.message}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── JSON formatter ─────────────────────────────────────────────────────────

export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
