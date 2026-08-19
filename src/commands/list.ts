import { loadConfig } from "../config";
import { scanAllSkills, sortSkills } from "../scanner";
import { matchesInvocabilityFilters } from "../utils/frontmatter";
import { loadSkillState } from "../skill-state";
import {
  formatSkillTable,
  formatGroupedTable,
  formatJSON,
  formatListSummary,
  formatCompactTable,
  formatGroupByTable,
  applyListLimit,
  LARGE_LIST_THRESHOLD,
  ansi,
} from "../formatter";
import { formatMachineOutput } from "../utils/machine";

import { enrichWithHealth } from "./shared";
import { reconstructDisabledSkills } from "./toggle";
import type { ParsedArgs } from "../cli";

function printListHelp() {
  console.log(`${ansi.bold("Usage:")} asm list [options]

List all discovered skills. By default, skills installed across multiple
tools are grouped into a single row with tool badges. When more than
${LARGE_LIST_THRESHOLD} skills are present, a compact summary is
automatically prepended above the table.

${ansi.bold("Options:")}
  --sort <field>       Sort by: name, version, or location (default: name)
  -s, --scope <s>      Filter: global, project, or both (default: both)
  -p, --tool <p>       Filter by tool (claude, codex, openclaw, agents)
  --flat               Show one row per tool instance (ungrouped)
  --compact            One-line-per-skill dense view
  --summary            Print only the summary (counts by tool/scope/effort)
  --group-by <axis>    Group rows under headers (axis: tool | scope | effort)
  --limit <N>          Limit rendered rows (0 = no limit)
  --model-invocable    Only skills the model can invoke
  --user-invocable     Only skills the user can invoke (slash command)
  --json               Output as JSON array
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm list                          ${ansi.dim("List all skills (grouped)")}
  asm list --flat                   ${ansi.dim("One row per tool instance")}
  asm list --compact                ${ansi.dim("One line per skill (dense)")}
  asm list --summary                ${ansi.dim("Counts by tool/scope/effort only")}
  asm list --group-by tool          ${ansi.dim("Group rows under tool headers")}
  asm list --group-by scope         ${ansi.dim("Group rows under scope headers")}
  asm list --group-by effort        ${ansi.dim("Group rows under effort headers")}
  asm list --limit 20               ${ansi.dim("Show first 20 rows only")}
  asm list -p claude                ${ansi.dim("Only Claude Code skills")}
  asm list -s project               ${ansi.dim("Only project-scoped skills")}
  asm list --sort version           ${ansi.dim("Sort by version")}
  asm list --json                   ${ansi.dim("Output as JSON")}
  asm list --machine                ${ansi.dim("Machine-readable v1 envelope output")}`);
}

export async function cmdList(args: ParsedArgs) {
  if (args.flags.help) {
    printListHelp();
    return;
  }

  const startTime = performance.now();
  const config = await loadConfig();
  let allSkills = await scanAllSkills(config, args.flags.scope);

  // Re-surface skills asm has disabled: the scanner can't see them because
  // their SKILL.md was renamed, so reconstruct them from the state file
  // (issue #91). They render dimmed with a [disabled] tag. Pass the keys of
  // already-scanned (active) instances so disk/state drift never double-lists.
  const skillState = await loadSkillState();
  const activeKeys = new Set(
    allSkills.map((s) => `${s.dirName}||${s.provider}||${s.scope}`),
  );
  const disabledSkills = await reconstructDisabledSkills(
    config,
    skillState,
    args.flags.scope,
    args.flags.provider,
    activeKeys,
  );
  allSkills = [...allSkills, ...disabledSkills];

  // Provider filter (for list/search — not for install/init where it means target)
  if (args.flags.provider && args.command === "list") {
    allSkills = allSkills.filter((s) => s.provider === args.flags.provider);
  }
  if (args.flags.modelInvocable || args.flags.userInvocable) {
    allSkills = allSkills.filter((s) =>
      matchesInvocabilityFilters(s, {
        modelInvocable: args.flags.modelInvocable,
        userInvocable: args.flags.userInvocable,
      }),
    );
  }

  await enrichWithHealth(allSkills);
  const sorted = sortSkills(allSkills, args.flags.sort);

  if (args.flags.machine) {
    const data = sorted.map((s) => ({
      name: s.name,
      version: s.version,
      description: s.description,
      scope: s.scope,
      provider: s.provider,
      path: s.path,
    }));
    console.log(formatMachineOutput("list", data, startTime));
    return;
  }

  if (args.flags.json) {
    console.log(formatJSON(sorted));
  } else if (args.flags.flat) {
    let output = formatSkillTable(sorted);
    const withWarnings = sorted.filter(
      (s) => s.warnings && s.warnings.length > 0,
    );
    if (withWarnings.length > 0) {
      output += `\n${ansi.yellow(`${withWarnings.length} skill${withWarnings.length === 1 ? "" : "s"} with warnings -- use --json for details`)}`;
    }
    console.log(output);
  } else if (args.flags.summary) {
    // `asm list --summary` — print just the compact summary, no table.
    console.log(formatListSummary(sorted));
  } else if (args.flags.groupBy) {
    // `asm list --group-by <axis>` — rows grouped under category headers.
    const { skills: limited, hint } = applyListLimit(sorted, args.flags.limit);
    console.log(formatGroupByTable(limited, args.flags.groupBy));
    if (hint) console.log(hint);
  } else if (args.flags.compact) {
    // `asm list --compact` — one-line-per-skill dense view.
    const { skills: limited, hint } = applyListLimit(sorted, args.flags.limit);
    console.log(formatCompactTable(limited));
    if (hint) console.log(hint);
  } else {
    // Default grouped table. When the inventory is large, prepend a compact
    // summary section so users see inventory shape before the full table.
    const lines: string[] = [];
    if (sorted.length > LARGE_LIST_THRESHOLD) {
      lines.push(formatListSummary(sorted, { showHint: false }));
      lines.push("");
    }
    const { skills: limited, hint } = applyListLimit(sorted, args.flags.limit);
    lines.push(formatGroupedTable(limited));
    if (hint) lines.push(hint);
    console.log(lines.join("\n"));
  }
}
