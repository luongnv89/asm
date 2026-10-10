import { stat } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
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
  formatLocatedSearchResults,
  type LocatedSearchResult,
} from "../formatter-search";
import { locateSkills, DEFAULT_MAX_DEPTH } from "../skill-locator";
import { scoreSkill, MIN_SCORE } from "../fuzzy-score";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";
import { searchSkills as searchIndexSkills } from "../skill-index";
import {
  applySkillTagState,
  loadSkillTagState,
  matchesAllTags,
  parseTagInputs,
} from "../skill-tags";

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
  --tag <tag[,tag]>    Require every tag; repeatable
  --flat               Show one row per tool instance (ungrouped)
  --json               Output as JSON array
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Fuzzy search (find a skill installed elsewhere on this machine):")}
  --fuzzy              Fuzzy-rank installed skills in every tool's global
                       skill dir (~/.claude/skills, ~/.agents/skills, ...).
                       Tolerates partial or misspelled names and matches
                       descriptions. Best match first, with a Score column.
  --root <dir>         Implies --fuzzy. Also search project-local installs
                       (e.g. <project>/.claude/skills) in projects under <dir>,
                       up to ${DEFAULT_MAX_DEPTH} levels deep. Only <dir> is walked; nothing
                       else on disk is scanned.
  In fuzzy mode --scope and --sort are ignored and --available is rejected;
  -p/--tool, --tag, and the invocability filters still apply.

${ansi.bold("Examples:")}
  asm search code                   ${ansi.dim("Search installed and available skills")}
  asm search review -p claude       ${ansi.dim("Search within Claude Code only")}
  asm search "test" --installed     ${ansi.dim("Search installed skills only")}
  asm search "test" --available     ${ansi.dim("Search available skills only")}
  asm search code --tag cli,testing  ${ansi.dim("Require both tags")}
  asm search openspec --json        ${ansi.dim("Output matches as JSON")}
  asm search openspec --machine     ${ansi.dim("Machine-readable v1 envelope output")}
  asm search revew --fuzzy          ${ansi.dim("Fuzzy-find a global skill by a misspelled name")}
  asm search "review pull requests" --root ~/projects
                                    ${ansi.dim("Find it in global dirs or any project under ~/projects")}`);
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

  const parsedTags = parseTagInputs(args.flags.tagFilters);
  if (parsedTags.invalid.length > 0) {
    restoreConsole?.();
    error(
      `Invalid tag value(s): ${parsedTags.invalid.map((tag) => JSON.stringify(tag)).join(", ")}.`,
    );
    process.exitCode = 2;
    return;
  }

  if (args.flags.fuzzy || args.flags.root) {
    await runFuzzySearch(
      args,
      query,
      parsedTags.tags,
      startTime,
      restoreConsole,
    );
    return;
  }

  const showInstalled = !args.flags.available;
  const showAvailable = !args.flags.installed;

  // --- Installed skills ---
  let installedResults: ReturnType<typeof sortSkills> = [];
  if (showInstalled) {
    const config = await loadConfig();
    let allSkills = await scanAllSkills(config, args.flags.scope);
    applySkillTagState(allSkills, await loadSkillTagState());
    if (parsedTags.tags.length > 0) {
      allSkills = allSkills.filter((skill) =>
        matchesAllTags(skill.tags, parsedTags.tags),
      );
    }
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
    const filters = {
      modelInvocable: args.flags.modelInvocable || undefined,
      userInvocable: args.flags.userInvocable || undefined,
      tags: parsedTags.tags.length > 0 ? parsedTags.tags : undefined,
    };
    indexResults = await searchIndexSkills(query, 20, filters);
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
      tags: s.tags || [],
      match_count: 1,
    }));
    const available = indexResults.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      source: "index" as const,
      url: r.skill.installUrl,
      tags: r.skill.tags || [],
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
      tags: s.tags || [],
      status: "installed" as const,
    }));
    const available = indexResults.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      version: r.skill.version,
      repo: `${r.repo.owner}/${r.repo.repo}`,
      installCommand: `asm install ${r.skill.installUrl}`,
      tags: r.skill.tags || [],
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

/** Expand a leading `~` and resolve against the current directory. */
function resolveRootDir(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return resolve(input);
}

/**
 * `asm search --fuzzy` / `--root <dir>` (issue #735): fuzzy-rank installed
 * skills found in global skill dirs and, with `--root`, in projects under
 * that directory. Results carry where each skill is installed.
 */
async function runFuzzySearch(
  args: ParsedArgs,
  query: string,
  tags: string[],
  startTime: number,
  restoreConsole: (() => void) | undefined,
): Promise<void> {
  const fail = (message: string): never => {
    restoreConsole?.();
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "search",
          ErrorCodes.INVALID_ARGUMENT,
          message,
          startTime,
        ),
      );
    } else {
      error(message);
      console.error(`Run "asm search --help" for usage.`);
    }
    return process.exit(2);
  };

  if (args.flags.available) {
    fail(
      "--fuzzy and --root search installed skills only; they cannot be combined with --available.",
    );
  }

  let root: string | undefined;
  if (args.flags.root) {
    root = resolveRootDir(args.flags.root);
    let isDir = false;
    try {
      isDir = (await stat(root)).isDirectory();
    } catch {
      // missing or unreadable — reported below
    }
    if (!isDir) fail(`--root is not an existing directory: ${args.flags.root}`);
  }

  const config = await loadConfig();
  let located = await locateSkills(config, { root });
  applySkillTagState(
    located.map((l) => l.skill),
    await loadSkillTagState(),
  );
  if (tags.length > 0) {
    located = located.filter((l) => matchesAllTags(l.skill.tags, tags));
  }
  if (args.flags.provider) {
    located = located.filter((l) => l.skill.provider === args.flags.provider);
  }
  if (args.flags.modelInvocable || args.flags.userInvocable) {
    located = located.filter((l) =>
      matchesInvocabilityFilters(l.skill, {
        modelInvocable: args.flags.modelInvocable,
        userInvocable: args.flags.userInvocable,
      }),
    );
  }

  const results: LocatedSearchResult[] = located
    .map((l) => ({ ...l, score: scoreSkill(query, l.skill) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.skill.name.localeCompare(b.skill.name) ||
        a.skill.path.localeCompare(b.skill.path),
    );

  if (args.flags.machine) {
    restoreConsole?.();
    const data = results.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      source: "installed" as const,
      url: null,
      tags: r.skill.tags || [],
      match_count: 1,
      score: r.score,
      scope: r.skill.scope,
      provider: r.skill.provider,
      project_root: r.projectRoot,
      path: r.skill.path,
    }));
    console.log(formatMachineOutput("search", data, startTime));
    return;
  }

  if (args.flags.json) {
    const data = results.map((r) => ({
      name: r.skill.name,
      description: r.skill.description,
      version: r.skill.version,
      scope: r.skill.scope,
      provider: r.skill.provider,
      projectRoot: r.projectRoot,
      path: r.skill.path,
      score: r.score,
      tags: r.skill.tags || [],
      status: "installed" as const,
    }));
    console.log(formatJSON(data));
    return;
  }

  const where = root
    ? `global skill dirs and projects under ${root}`
    : "global skill dirs";
  if (results.length === 0) {
    console.error(`No installed skills matching "${query}" in ${where}.`);
    if (!root) {
      console.error(
        ansi.dim("Add --root <dir> to also search projects under <dir>."),
      );
    }
    return;
  }

  console.error(
    ansi.bold(
      `Installed skills matching "${query}" in ${where}, best match first:\n`,
    ),
  );
  console.log(formatLocatedSearchResults(results));
}
