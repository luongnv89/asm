import {
  loadConfig,
  getConfigPath,
  getDefaultConfig,
  saveConfig,
} from "./config";
import { scanAllSkills, searchSkills, sortSkills } from "./scanner";
import {
  buildFullRemovalPlan,
  executeRemoval,
  getExistingTargets,
} from "./uninstaller";
import {
  formatSkillTable,
  formatSkillDetail,
  formatJSON,
  ansi,
} from "./formatter";
import { VERSION_STRING } from "./utils/version";
import type { Scope, SortBy } from "./utils/types";

// ─── Arg Parser ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  subcommand: string | null;
  positional: string[];
  flags: {
    help: boolean;
    version: boolean;
    json: boolean;
    yes: boolean;
    noColor: boolean;
    scope: Scope;
    sort: SortBy;
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip bun and script path

  const result: ParsedArgs = {
    command: null,
    subcommand: null,
    positional: [],
    flags: {
      help: false,
      version: false,
      json: false,
      yes: false,
      noColor: false,
      scope: "both",
      sort: "name",
    },
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Flags
    if (arg === "--help" || arg === "-h") {
      result.flags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.flags.version = true;
    } else if (arg === "--json") {
      result.flags.json = true;
    } else if (arg === "--yes" || arg === "-y") {
      result.flags.yes = true;
    } else if (arg === "--no-color") {
      result.flags.noColor = true;
    } else if (arg === "--scope" || arg === "-s") {
      i++;
      const val = args[i];
      if (val === "global" || val === "project" || val === "both") {
        result.flags.scope = val;
      } else {
        error(`Invalid scope: "${val}". Must be global, project, or both.`);
        process.exit(2);
      }
    } else if (arg === "--sort") {
      i++;
      const val = args[i];
      if (val === "name" || val === "version" || val === "location") {
        result.flags.sort = val;
      } else {
        error(`Invalid sort: "${val}". Must be name, version, or location.`);
        process.exit(2);
      }
    } else if (arg.startsWith("-")) {
      error(`Unknown option: ${arg}`);
      console.error(`Run "asm --help" for usage.`);
      process.exit(2);
    } else {
      // Positional: first is command, second is subcommand, rest are positional args
      if (!result.command) {
        result.command = arg;
      } else if (!result.subcommand) {
        result.subcommand = arg;
      } else {
        result.positional.push(arg);
      }
    }

    i++;
  }

  return result;
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function error(msg: string) {
  console.error(ansi.red(`Error: ${msg}`));
}

// ─── Help text ──────────────────────────────────────────────────────────────

function printMainHelp() {
  console.log(`${ansi.blueBold("agent-skill-manager")} (${ansi.bold("asm")}) ${VERSION_STRING}

Interactive TUI and CLI for managing installed skills for AI coding agents.

${ansi.bold("Usage:")}
  asm                        Launch interactive TUI
  asm <command> [options]     Run a CLI command

${ansi.bold("Commands:")}
  list                   List all discovered skills
  search <query>         Search skills by name/description/provider
  inspect <skill-name>   Show detailed info for a skill
  uninstall <skill-name> Remove a skill (with confirmation)
  config show            Print current config
  config path            Print config file path
  config reset           Reset config to defaults
  config edit            Open config in $EDITOR

${ansi.bold("Global Options:")}
  -h, --help             Show help for any command
  -v, --version          Print version and exit
  --json                 Output as JSON (list, search, inspect)
  -s, --scope <scope>    Filter: global, project, or both (default: both)
  --no-color             Disable ANSI colors
  --sort <field>         Sort by: name, version, or location (default: name)
  -y, --yes              Skip confirmation prompts`);
}

function printListHelp() {
  console.log(`${ansi.bold("Usage:")} asm list [options]

List all discovered skills.

${ansi.bold("Options:")}
  --sort <field>     Sort by: name, version, or location (default: name)
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --json             Output as JSON array
  --no-color         Disable ANSI colors`);
}

function printSearchHelp() {
  console.log(`${ansi.bold("Usage:")} asm search <query> [options]

Search skills by name, description, or provider.

${ansi.bold("Options:")}
  --sort <field>     Sort by: name, version, or location (default: name)
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --json             Output as JSON array
  --no-color         Disable ANSI colors`);
}

function printInspectHelp() {
  console.log(`${ansi.bold("Usage:")} asm inspect <skill-name> [options]

Show detailed information for a skill. The <skill-name> is the directory name.

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --json             Output as JSON object
  --no-color         Disable ANSI colors`);
}

function printUninstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm uninstall <skill-name> [options]

Remove a skill and its associated rule files.

${ansi.bold("Options:")}
  -y, --yes          Skip confirmation prompt
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors`);
}

function printConfigHelp() {
  console.log(`${ansi.bold("Usage:")} asm config <subcommand>

Manage configuration.

${ansi.bold("Subcommands:")}
  show     Print current config as JSON
  path     Print config file path
  reset    Reset config to defaults (with confirmation)
  edit     Open config in $EDITOR`);
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function cmdList(args: ParsedArgs) {
  if (args.flags.help) {
    printListHelp();
    return;
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const sorted = sortSkills(allSkills, args.flags.sort);

  if (args.flags.json) {
    console.log(formatJSON(sorted));
  } else {
    console.log(formatSkillTable(sorted));
  }
}

async function cmdSearch(args: ParsedArgs) {
  if (args.flags.help) {
    printSearchHelp();
    return;
  }

  const query = args.subcommand;
  if (!query) {
    error("Missing required argument: <query>");
    console.error(`Run "asm search --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const filtered = searchSkills(allSkills, query);
  const sorted = sortSkills(filtered, args.flags.sort);

  if (args.flags.json) {
    console.log(formatJSON(sorted));
  } else {
    console.log(formatSkillTable(sorted));
  }
}

async function cmdInspect(args: ParsedArgs) {
  if (args.flags.help) {
    printInspectHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing required argument: <skill-name>");
    console.error(`Run "asm inspect --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const matches = allSkills.filter((s) => s.dirName === skillName);

  if (matches.length === 0) {
    error(`Skill "${skillName}" not found.`);
    process.exit(1);
  }

  if (args.flags.json) {
    console.log(formatJSON(matches.length === 1 ? matches[0] : matches));
  } else {
    for (let i = 0; i < matches.length; i++) {
      if (i > 0) console.log("\n" + "─".repeat(40) + "\n");
      console.log(formatSkillDetail(matches[i]));
    }
  }
}

async function cmdUninstall(args: ParsedArgs) {
  if (args.flags.help) {
    printUninstallHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing required argument: <skill-name>");
    console.error(`Run "asm uninstall --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const plan = buildFullRemovalPlan(skillName, allSkills, config);

  const existing = await getExistingTargets(plan);
  if (existing.length === 0) {
    error(`Skill "${skillName}" not found or nothing to remove.`);
    process.exit(1);
  }

  // Show removal plan
  console.error(ansi.bold("Removal plan:"));
  for (const target of existing) {
    console.error(`  ${ansi.red("•")} ${target}`);
  }

  if (!args.flags.yes) {
    // Interactive confirmation
    if (!process.stdin.isTTY) {
      error(
        "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
      );
      process.exit(2);
    }
    process.stderr.write(`\n${ansi.bold("Proceed with removal?")} [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  const log = await executeRemoval(plan);
  for (const entry of log) {
    console.error(entry);
  }
  console.error(ansi.green("\nDone."));
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.removeAllListeners("data");
        resolve(data.trim());
      }
    });
    process.stdin.resume();
  });
}

async function cmdConfig(args: ParsedArgs) {
  if (args.flags.help) {
    printConfigHelp();
    return;
  }

  const sub = args.subcommand;

  if (!sub) {
    error("Missing subcommand. Use: show, path, reset, or edit.");
    console.error(`Run "asm config --help" for usage.`);
    process.exit(2);
  }

  switch (sub) {
    case "show": {
      const config = await loadConfig();
      console.log(formatJSON(config));
      break;
    }
    case "path": {
      console.log(getConfigPath());
      break;
    }
    case "reset": {
      if (!args.flags.yes) {
        if (!process.stdin.isTTY) {
          error(
            "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
          );
          process.exit(2);
        }
        process.stderr.write(
          `${ansi.bold("Reset config to defaults?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }
      const defaults = getDefaultConfig();
      await saveConfig(defaults);
      console.error(ansi.green("Config reset to defaults."));
      break;
    }
    case "edit": {
      const editor = process.env.VISUAL || process.env.EDITOR || "vi";
      const configPath = getConfigPath();
      // Ensure config file exists
      await loadConfig();
      const proc = Bun.spawn([editor, configPath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      break;
    }
    default: {
      error(
        `Unknown config subcommand: "${sub}". Use: show, path, reset, or edit.`,
      );
      process.exit(2);
    }
  }
}

// ─── Main CLI dispatcher ────────────────────────────────────────────────────

export async function runCLI(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  // Apply --no-color
  if (args.flags.noColor) {
    (globalThis as any).__CLI_NO_COLOR = true;
  }

  // --version at top level
  if (args.flags.version) {
    console.log(`asm ${VERSION_STRING}`);
    return;
  }

  // --help at top level (no command)
  if (!args.command && args.flags.help) {
    printMainHelp();
    return;
  }

  // No command → return null to signal TUI launch
  if (!args.command) {
    return;
  }

  switch (args.command) {
    case "list":
      await cmdList(args);
      break;
    case "search":
      await cmdSearch(args);
      break;
    case "inspect":
      await cmdInspect(args);
      break;
    case "uninstall":
      await cmdUninstall(args);
      break;
    case "config":
      await cmdConfig(args);
      break;
    default:
      error(`Unknown command: "${args.command}"`);
      console.error(`Run "asm --help" for usage.`);
      process.exit(2);
  }
}

// ─── Check if CLI mode should run ──────────────────────────────────────────

export function isCLIMode(argv: string[]): boolean {
  const args = argv.slice(2);
  if (args.length === 0) return false;

  // Known commands
  const commands = ["list", "search", "inspect", "uninstall", "config"];
  const first = args[0];

  // If the first arg is a known command, it's CLI mode
  if (commands.includes(first)) return true;

  // --help and --version are handled in CLI mode too
  if (first === "--help" || first === "-h") return true;
  if (first === "--version" || first === "-v") return true;

  // Unknown flags/commands → CLI mode (will show error)
  if (first.startsWith("-") || first.length > 0) return true;

  return false;
}
