import type { SkillInfo } from "./utils/types";
import { formatTokenCount } from "./utils/token-count";
import { formatInvocability } from "./utils/frontmatter";
import {
  useColor,
  ansi,
  colorEffort,
  colorProvider,
  providerBadge,
} from "./formatter-colors";
// Split from formatter-core.ts (issue #677).

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
    "Invoke",
    "Tool",
    "Scope",
    "Type",
    "Path",
  ];

  const rows = skills.map((s) => [
    // Append a `[disabled]` tag to the name cell for disabled instances so the
    // column width accounts for it; the whole line is dimmed below (issue #91).
    s.disabled ? `${s.name} [disabled]` : s.name,
    s.version,
    s.creator || "\u2014",
    s.effort || "\u2014",
    formatInvocability(s.modelInvocable, s.userInvocable),
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
  const dataLines = rows.map((row, idx) => {
    const line = row.map((cell, i) => pad(cell, widths[i])).join("  ");
    // Dim the entire row for disabled instances.
    return skills[idx].disabled ? ansi.dim(line) : line;
  });

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
  invoke: string;
  tokens: string;
  providers: Array<{ provider: string; label: string }>;
  scope: "global" | "project" | "mixed";
  type: "symlink" | "directory" | "mixed";
  path: string;
  warningCount: number;
  /** True when every instance in this group is disabled (issue #91). */
  disabled: boolean;
}

export function groupSkills(skills: SkillInfo[]): GroupedSkill[] {
  const groups = new Map<string, SkillInfo[]>();

  for (const s of skills) {
    // Include disabled state in the key so a disabled instance never collapses
    // into the same row as an active instance of the same dirName+scope.
    const key = `${s.dirName}||${s.scope}||${s.disabled ? "off" : "on"}`;
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
      invoke: formatInvocability(ref.modelInvocable, ref.userInvocable),
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
      disabled: members.every((m) => m.disabled === true),
    });
  }

  return result;
}

/**
 * Display name for a grouped row — appends ` [disabled]` for disabled groups so
 * column-width math and the rendered cell stay consistent (issue #91).
 */
function groupDisplayName(g: GroupedSkill): string {
  return g.disabled ? `${g.name} [disabled]` : g.name;
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

  const nameW = Math.max(4, ...grouped.map((g) => groupDisplayName(g).length));
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
    const name = pad(groupDisplayName(g), nameW);
    const version = ansi.dim(pad(g.version, versionW));
    const provPadding = providerW - providerPlain[i].length;
    const prov = providerStrs[i] + " ".repeat(Math.max(0, provPadding));
    const scope = ansi.dim(pad(g.scope, scopeW));
    const invoke = pad(g.invoke, 5);
    const row = `${name}  ${version}  ${invoke}  ${prov}  ${scope}`;
    lines.push(g.disabled ? ansi.dim(row) : row);
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
  const invokeW = Math.max(6, ...grouped.map((g) => g.invoke.length));
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
  const header = `${pad("Name", nameW)}  ${pad("Version", versionW)}  ${pad("Creator", creatorW)}  ${pad("Effort", effortW)}  ${pad("Invoke", invokeW)}${tokensHeader}  ${pad("Tools", providerW)}  ${pad("Scope", scopeW)}  ${pad("Type", typeW)}`;
  lines.push(useColor() ? ansi.bold(header) : header);
  const tokensSep = hasAnyTokens ? `  ${"-".repeat(tokensW)}` : "";
  lines.push(
    `${"-".repeat(nameW)}  ${"-".repeat(versionW)}  ${"-".repeat(creatorW)}  ${"-".repeat(effortW)}  ${"-".repeat(invokeW)}${tokensSep}  ${"-".repeat(providerW)}  ${"-".repeat(scopeW)}  ${"-".repeat(typeW)}`,
  );

  // Data rows
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    // Disabled groups get a `[disabled]` tag on the name; the whole row is
    // dimmed below (issue #91).
    const name = pad(groupDisplayName(g), nameW);
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

    const invoke = pad(g.invoke, invokeW);
    const row = `${name}  ${version}  ${creator}  ${effort}  ${invoke}${tokensCell}  ${prov}  ${scope}  ${type}${warn}`;
    lines.push(g.disabled ? ansi.dim(row) : row);
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
