import type { SkillInfo } from "./utils/types";
import { useColor, ansi, colorEffort, providerBadge } from "./formatter-colors";
import { groupSkills } from "./formatter-table";
// Split from formatter-core.ts (issue #677).

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
  const invokeW = 6;
  const header = `${pad("Name", nameW)}  ${pad("Version", versionW)}  ${pad("Creator", creatorW)}  ${pad("Effort", effortW)}  ${pad("Invoke", invokeW)}  ${pad("Tools", providerW)}  ${pad("Scope", scopeW)}  ${pad("Type", typeW)}`;
  lines.push(useColor() ? ansi.bold(header) : header);
  lines.push(
    `${"-".repeat(nameW)}  ${"-".repeat(versionW)}  ${"-".repeat(creatorW)}  ${"-".repeat(effortW)}  ${"-".repeat(invokeW)}  ${"-".repeat(providerW)}  ${"-".repeat(scopeW)}  ${"-".repeat(typeW)}`,
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

    const invoke = pad(g.invoke, invokeW);
    lines.push(
      `${name}  ${version}  ${creator}  ${effort}  ${invoke}  ${prov}  ${scope}  ${type}`,
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
  invocability?: string;
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
    const invokeTag = result.invocability
      ? ansi.dim(` [${result.invocability}]`)
      : "";
    lines.push(
      `  ${ansi.cyan(result.name)} ${ansi.dim(`v${result.version}`)}${verifiedTag}${invokeTag} ${ansi.dim(`[${result.repoLabel}]`)}`,
    );
    // Description
    for (const dl of wordWrap(result.description, 76)) {
      lines.push(`    ${dl}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Word wrap ──────────────────────────────────────────────────────────────

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
