import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import { formatJSON, ansi } from "../formatter";
import {
  computeStats,
  formatStatsReport,
  computeRepoStats,
  computeAuthorStats,
  computeIndexStats,
  formatRepoStatsReport,
  formatAuthorStatsReport,
  formatIndexStatsReport,
  computeTokenBudget,
  formatTokenBudgetReport,
} from "../stats";
import { detectDuplicates } from "../auditor";
import { formatMachineOutput } from "../utils/machine";
import { loadAllIndices } from "../skill-index";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printStatsHelp() {
  console.log(`${ansi.bold("Usage:")} asm stats [subcommand] [options]

Show aggregate skill metrics with provider distribution charts,
scope breakdown, disk usage, resident context cost, and duplicate summary.

${ansi.bold("Subcommands:")}
  repo <owner/repo>    Show per-repo stats from the skill index
  author <owner>       Show per-author stats from the skill index
  index                Show index-wide statistics

${ansi.bold("Options:")}
  --tokens           Attention budget: resident vs body tokens per tool/scope
  --json             Output as JSON
  --machine          Output in stable machine-readable v1 envelope format
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm stats                         ${ansi.dim("Show installed skills dashboard")}
  asm stats --tokens                ${ansi.dim("Resident context cost per tool")}
  asm stats --tokens --json         ${ansi.dim("Attention budget as JSON")}
  asm stats -s global               ${ansi.dim("Global skills only")}
  asm stats --json                  ${ansi.dim("Output raw data as JSON")}
  asm stats --machine               ${ansi.dim("Machine-readable v1 envelope output")}
  asm stats repo anthropics/skills  ${ansi.dim("Show indexed repo stats")}
  asm stats author luongnv89        ${ansi.dim("Show indexed author stats")}
  asm stats index                   ${ansi.dim("Show index-wide stats")}`);
}

export async function cmdStats(args: ParsedArgs) {
  if (args.flags.help) {
    printStatsHelp();
    return;
  }

  // Dispatch to subcommands
  const subcommand = args.subcommand;
  if (subcommand === "repo") {
    await cmdStatsRepo(args);
    return;
  }
  if (subcommand === "author") {
    await cmdStatsAuthor(args);
    return;
  }
  if (subcommand === "index") {
    await cmdStatsIndex(args);
    return;
  }

  // Default: installed skills stats (original behavior)
  const startTime = performance.now();
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  // `--tokens` is the attention-budget view (issue #421): the resident cost
  // of the installed set, which is paid on every message, reported apart from
  // the body cost, which is only paid when a skill fires.
  if (args.flags.tokens) {
    const budget = computeTokenBudget(allSkills);
    if (args.flags.machine) {
      console.log(formatMachineOutput("stats tokens", budget, startTime));
      return;
    }
    if (args.flags.json) {
      console.log(formatJSON(budget));
      return;
    }
    console.log(formatTokenBudgetReport(budget));
    return;
  }

  // Structured consumers always get a parseable report, even when nothing is
  // installed; only the human dashboard degrades to a sentence (it charts
  // maxima that an empty set has none of).
  if (allSkills.length === 0 && !args.flags.json && !args.flags.machine) {
    console.log("  No installed skills.");
    return;
  }

  const duplicates = detectDuplicates(allSkills);
  const report = await computeStats(allSkills, duplicates);

  if (args.flags.machine) {
    const { perSkillDiskBytes: _machineDetail, ...summary } = report;
    console.log(
      formatMachineOutput(
        "stats",
        args.flags.verbose ? report : summary,
        startTime,
      ),
    );
    return;
  }

  if (args.flags.json) {
    if (!args.flags.verbose) {
      // Omit per-skill disk bytes for cleaner JSON output
      const { perSkillDiskBytes: _, ...summary } = report;
      console.log(formatJSON(summary));
    } else {
      console.log(formatJSON(report));
    }
  } else {
    console.log(formatStatsReport(report));
  }
}

function printStatsRepoHelp() {
  console.log(`${ansi.bold("Usage:")} asm stats repo <owner/repo> [options]

Show statistics for a specific indexed repository.

${ansi.bold("Arguments:")}
  owner/repo           Repository identifier (e.g. anthropics/skills)

${ansi.bold("Options:")}
  --json               Output as JSON
  --no-color           Disable ANSI colors

${ansi.bold("Examples:")}
  asm stats repo anthropics/skills
  asm stats repo luongnv89/asm --json`);
}

export async function cmdStatsRepo(args: ParsedArgs) {
  if (args.flags.help) {
    printStatsRepoHelp();
    return;
  }

  const repoArg = args.positional[0];
  if (!repoArg) {
    error("Missing required argument: <owner/repo>");
    console.error(`Run "asm stats repo --help" for usage.`);
    process.exit(2);
  }

  const [owner, repo] = repoArg.split("/");
  if (!owner || !repo) {
    error(`Invalid repository: "${repoArg}". Expected format: owner/repo`);
    process.exit(2);
  }

  const indices = await loadAllIndices();
  const repoIndex = indices.find((i) => i.owner === owner && i.repo === repo);

  if (!repoIndex) {
    error(`Repository "${owner}/${repo}" not found in the skill index.`);
    console.error(
      ansi.dim(`Run "asm index list" to see all indexed repositories.`),
    );
    process.exit(1);
  }

  const repoStats = computeRepoStats([repoIndex]);
  if (repoStats.length === 0) {
    console.log(`No stats for "${owner}/${repo}".`);
    return;
  }

  if (args.flags.json) {
    console.log(formatJSON(repoStats[0]));
  } else {
    console.log(formatRepoStatsReport(repoStats[0]));
  }
}

function printStatsAuthorHelp() {
  console.log(`${ansi.bold("Usage:")} asm stats author <owner> [options]

Show statistics for a specific author across all indexed repositories.

${ansi.bold("Arguments:")}
  owner                Author/organization name (e.g. luongnv89)

${ansi.bold("Options:")}
  --json               Output as JSON
  --no-color           Disable ANSI colors

${ansi.bold("Examples:")}
  asm stats author anthropics
  asm stats author luongnv89 --json`);
}

export async function cmdStatsAuthor(args: ParsedArgs) {
  if (args.flags.help) {
    printStatsAuthorHelp();
    return;
  }

  const owner = args.positional[0];
  if (!owner) {
    error("Missing required argument: <owner>");
    console.error(`Run "asm stats author --help" for usage.`);
    process.exit(2);
  }

  const indices = await loadAllIndices();
  const authorStats = computeAuthorStats(indices);
  const author = authorStats.find((a) => a.owner === owner);

  if (!author) {
    error(`Author "${owner}" not found in the skill index.`);
    console.error(ansi.dim(`Run "asm stats index" to see all authors.`));
    process.exit(1);
  }

  if (args.flags.json) {
    console.log(formatJSON(author));
  } else {
    console.log(formatAuthorStatsReport(author));
  }
}

function printStatsIndexHelp() {
  console.log(`${ansi.bold("Usage:")} asm stats index [options]

Show aggregate statistics across all indexed repositories.

${ansi.bold("Options:")}
  --json               Output as JSON
  --no-color           Disable ANSI colors

${ansi.bold("Examples:")}
  asm stats index
  asm stats index --json`);
}

export async function cmdStatsIndex(args: ParsedArgs) {
  if (args.flags.help) {
    printStatsIndexHelp();
    return;
  }

  const indices = await loadAllIndices();

  if (indices.length === 0) {
    console.log("No indexed repositories found.");
    console.error(
      ansi.dim(`Run "asm index ingest <repo>" to add repositories.`),
    );
    return;
  }

  const report = computeIndexStats(indices);

  if (args.flags.json) {
    console.log(formatJSON(report));
  } else {
    console.log(formatIndexStatsReport(report));
  }
}

// ─── Doctor ─────────────────────────────────────────────────────────────────
