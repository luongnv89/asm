import { loadConfig } from "../config";
import { scanAllSkills, searchSkills, sortSkills } from "../scanner";
import {
  matchesInvocabilityFilters,
  formatInvocability,
} from "../utils/frontmatter";
import {
  formatSkillTable,
  formatSearchResults,
  formatAvailableSearchResults,
  formatJSON,
  ansi,
} from "../formatter";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";
import { searchSkills as searchIndexSkills } from "../skill-index";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printSearchHelp() {
  console.log(`${ansi.bold("Usage:")} asm search <query> [options]

Search both installed skills and the skill index. Results show installation
status and include copy-paste install commands for available skills.

${ansi.bold("Options:")}
  --sort <field>       Sort by: name, version, or location (default: name)
  -s, --scope <s>      Filter: global, project, or both (default: both)
  -p, --tool <p>       Filter by tool (claude, codex, openclaw, agents)
  --installed          Show only installed skills
  --available          Show only available (not installed) skills
  --model-invocable    Only skills the model can invoke
  --user-invocable     Only skills the user can invoke (slash command)
  --flat               Show one row per tool instance (ungrouped)
  --json               Output as JSON array
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm search code                   ${ansi.dim("Search installed and available skills")}
  asm search review -p claude       ${ansi.dim("Search within Claude Code only")}
  asm search "test" --installed     ${ansi.dim("Search installed skills only")}
  asm search "test" --available     ${ansi.dim("Search available skills only")}
  asm search openspec --json        ${ansi.dim("Output matches as JSON")}
  asm search openspec --machine     ${ansi.dim("Machine-readable v1 envelope output")}`);
}

export async function cmdSearch(args: ParsedArgs) {
  if (args.flags.help) {
    printSearchHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  const query = args.subcommand;
  if (!query) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "search",
          ErrorCodes.INVALID_ARGUMENT,
          "Missing required argument: <query>",
          startTime,
        ),
      );
      process.exit(2);
    }
    error("Missing required argument: <query>");
    console.error(`Run "asm search --help" for usage.`);
    process.exit(2);
  }

  const showInstalled = !args.flags.available;
  const showAvailable = !args.flags.installed;

  // --- Installed skills ---
  let installedResults: ReturnType<typeof sortSkills> = [];
  if (showInstalled) {
    const config = await loadConfig();
    let allSkills = await scanAllSkills(config, args.flags.scope);
    if (args.flags.provider) {
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
    const filtered = searchSkills(allSkills, query);
    installedResults = sortSkills(filtered, args.flags.sort);
  }

  // --- Available (index) skills ---
  let indexResults: Awaited<ReturnType<typeof searchIndexSkills>> = [];
  if (showAvailable) {
    indexResults = await searchIndexSkills(
      query,
      20,
      args.flags.modelInvocable || args.flags.userInvocable
        ? {
            modelInvocable: args.flags.modelInvocable || undefined,
            userInvocable: args.flags.userInvocable || undefined,
          }
        : undefined,
    );
    // Deduplicate: remove index results that match an installed skill by name
    if (installedResults.length > 0) {
      const installedNames = new Set(
        installedResults.map((s) => s.name.toLowerCase()),
      );
      indexResults = indexResults.filter(
        (r) => !installedNames.has(r.skill.name.toLowerCase()),
      );
    }
  }

  // --- Output ---
  if (args.flags.machine) {
    restoreConsole?.();
    const installed = installedResults.map((s) => ({
      name: s.name,
      description: s.description,
      source: "installed" as const,
      url: null,
      match_count: 1,
    }));
    const available = indexResults.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      source: "index" as const,
      url: r.skill.installUrl,
      match_count: 1,
    }));
    console.log(
      formatMachineOutput("search", [...installed, ...available], startTime),
    );
    return;
  }

  if (args.flags.json) {
    const installed = installedResults.map((s) => ({
      name: s.name,
      description: s.description,
      version: s.version,
      scope: s.scope,
      provider: s.provider,
      status: "installed" as const,
    }));
    const available = indexResults.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      version: r.skill.version,
      repo: `${r.repo.owner}/${r.repo.repo}`,
      installCommand: `asm install ${r.skill.installUrl}`,
      status: "available" as const,
    }));
    console.log(formatJSON([...installed, ...available]));
    return;
  }

  const hasInstalled = installedResults.length > 0;
  const hasAvailable = indexResults.length > 0;

  if (!hasInstalled && !hasAvailable) {
    console.error(`No skills matching "${query}".`);
    console.error(
      ansi.dim("Try ingesting more repos with: asm index ingest <repo>"),
    );
    return;
  }

  if (hasInstalled) {
    console.error(ansi.bold(`Installed skills matching "${query}":\n`));
    if (args.flags.flat) {
      console.log(formatSkillTable(installedResults));
    } else {
      console.log(formatSearchResults(installedResults, query));
    }
  }

  if (hasAvailable) {
    if (hasInstalled) console.error(""); // separator
    const availableFormatted = formatAvailableSearchResults(
      indexResults.map((r) => ({
        name: r.skill.name,
        version: r.skill.version,
        description: r.skill.description,
        verified: r.skill.verified,
        repoLabel: `${r.repo.owner}/${r.repo.repo}`,
        installUrl: r.skill.installUrl,
        invocability: formatInvocability(
          r.skill.modelInvocable,
          r.skill.userInvocable,
        ),
      })),
      query,
    );
    console.error(availableFormatted);
  }
}
