import { ansi } from "./formatter";
import type { InstallMethod } from "./utils/types";
import { getVersionString } from "./utils/version";
import { buildShadowingReport } from "./utils/path-shadowing";
import { setVerbose } from "./logger";
import type { Scope, SortBy, TransportMode } from "./utils/types";

// ─── Shared helpers (re-exported for backward compat) ─────────────────────────
import {
  enrichWithHealth,
  readLine,
  groupBySource,
  type SiblingGroup,
} from "./commands/shared";
export { enrichWithHealth, readLine, groupBySource, type SiblingGroup };

export interface ParsedArgs {
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
    provider: string | null;
    name: string | null;
    force: boolean;
    path: string | null;
    all: boolean;
    library: boolean;
    verbose: boolean;
    flat: boolean;
    transport: TransportMode;
    method: InstallMethod;
    installed: boolean;
    available: boolean;
    has: string[];
    missing: string[];
    modelInvocable: boolean;
    userInvocable: boolean;
    dryRun: boolean;
    /** `asm import --diff` — show unified diffs for conflicts. */
    diff: boolean;
    machine: boolean;
    noCache: boolean;
    fix: boolean;
    /** `asm list --compact` — one-line-per-skill dense view (issue #192). */
    compact: boolean;
    /**
     * `asm list --summary` — print only the compact summary (counts by
     * tool/scope/effort), no full table (issue #192).
     */
    summary: boolean;
    /** `asm list --group-by <tool|scope|effort>` axis (issue #192). */
    groupBy: "tool" | "scope" | "effort" | null;
    /**
     * `asm list --limit <N>` — cap rendered rows; 0 or negative means no
     * limit. When truncated, the formatter prints a "… N more not shown"
     * hint (issue #192).
     */
    limit: number;
    /**
     * `asm eval --concurrency <N>` — cap parallel per-skill evaluations in
     * batch mode (issue #194). 0 = use the default (4).
     */
    concurrency: number;
    /**
     * `asm eval --keep` — preserve the temp dir used for remote clones so
     * users can inspect what was fetched (issue #193).
     */
    keep: boolean;
    /**
     * `asm stats --tokens` — attention-budget view over the installed set:
     * resident (frontmatter description, paid every message) vs body (full
     * SKILL.md, paid only when the skill fires) tokens (issue #421).
     */
    tokens: boolean;
    /** `asm bundle modify --add <installUrl>` — skill install URL to add (issue #204). */
    add: string | null;
    /** `asm bundle modify --remove <skillName>` — skill name to remove (issue #204). */
    remove: string | null;
    /** `asm bundle modify --description <desc>` — new description for bundle (issue #204). */
    description: string | null;
    /** `asm bundle modify --author <author>` — new author for bundle (issue #204). */
    author: string | null;
    /** `asm bundle modify --tags <tag,...>` — comma-separated tags for bundle (issue #204). */
    tags: string | null;
    /** `asm bundle list --predefined` — show pre-defined bundles shipped with ASM (issue #206). */
    predefined: boolean;
    /** `asm get --audit` — print the full security audit report for a fetched skill (issue #422). */
    audit: boolean;
  };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node and script path

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
      provider: null,
      name: null,
      force: false,
      path: null,
      all: false,
      library: false,
      verbose: false,
      flat: false,
      transport: "auto",
      method: "default",
      installed: false,
      available: false,
      has: [],
      missing: [],
      modelInvocable: false,
      userInvocable: false,
      dryRun: false,
      diff: false,
      machine: false,
      noCache: false,
      fix: false,
      compact: false,
      summary: false,
      groupBy: null,
      limit: 0,
      concurrency: 0,
      keep: false,
      tokens: false,
      add: null,
      remove: null,
      description: null,
      author: null,
      tags: null,
      predefined: false,
      audit: false,
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
      // Accept "local" as an alias for "project" (issue #91 examples use it);
      // normalize internally to "project".
      const normalized = val === "local" ? "project" : val;
      if (
        normalized === "global" ||
        normalized === "project" ||
        normalized === "both"
      ) {
        result.flags.scope = normalized;
      } else {
        error(
          `Invalid scope: "${val}". Must be global, local, project, or both.`,
        );
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
    } else if (arg === "--provider" || arg === "-p" || arg === "--tool") {
      i++;
      result.flags.provider = args[i] || null;
    } else if (arg === "--name") {
      i++;
      result.flags.name = args[i] || null;
    } else if (arg === "--force" || arg === "-f") {
      result.flags.force = true;
    } else if (arg === "--path") {
      i++;
      result.flags.path = args[i] || null;
    } else if (arg === "--all") {
      result.flags.all = true;
    } else if (arg === "--library") {
      result.flags.library = true;
    } else if (arg === "--verbose" || arg === "-V") {
      result.flags.verbose = true;
    } else if (arg === "--flat") {
      result.flags.flat = true;
    } else if (arg === "--compact") {
      result.flags.compact = true;
    } else if (arg === "--summary") {
      result.flags.summary = true;
    } else if (arg === "--group-by") {
      i++;
      const val = args[i];
      if (val === "tool" || val === "scope" || val === "effort") {
        result.flags.groupBy = val;
      } else {
        error(`Invalid --group-by: "${val}". Must be tool, scope, or effort.`);
        process.exit(2);
      }
    } else if (arg === "--limit") {
      i++;
      const val = args[i];
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        error(
          `Invalid --limit: "${val}". Must be a non-negative integer (0 means no limit).`,
        );
        process.exit(2);
      }
      result.flags.limit = n;
    } else if (arg === "--installed") {
      result.flags.installed = true;
    } else if (arg === "--available") {
      result.flags.available = true;
    } else if (arg === "--concurrency") {
      i++;
      const val = args[i];
      const n = Number(val);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        error(`Invalid --concurrency: "${val}". Must be a positive integer.`);
        process.exit(2);
      }
      result.flags.concurrency = n;
    } else if (arg === "--keep") {
      result.flags.keep = true;
    } else if (arg === "--tokens") {
      result.flags.tokens = true;
    } else if (arg === "--transport" || arg === "-t") {
      i++;
      const val = args[i];
      if (val === "https" || val === "ssh" || val === "auto") {
        result.flags.transport = val;
      } else {
        error(`Invalid transport: "${val}". Must be https, ssh, or auto.`);
        process.exit(2);
      }
    } else if (arg === "--method" || arg === "-m") {
      i++;
      const val = args[i];
      if (val === "default" || val === "vercel") {
        result.flags.method = val;
      } else {
        error(`Invalid method: "${val}". Must be default or vercel.`);
        process.exit(2);
      }
    } else if (arg === "--skill") {
      // Vercel-style --skill flag: capture as --path for compatibility
      i++;
      result.flags.path = args[i] || null;
    } else if (arg === "--dry-run") {
      result.flags.dryRun = true;
    } else if (arg === "--diff") {
      result.flags.diff = true;
    } else if (arg === "--fix") {
      result.flags.fix = true;
    } else if (arg === "--machine") {
      result.flags.machine = true;
    } else if (arg === "--no-cache") {
      result.flags.noCache = true;
    } else if (arg === "--has") {
      i++;
      if (args[i]) result.flags.has.push(args[i]);
    } else if (arg === "--missing") {
      i++;
      if (args[i]) result.flags.missing.push(args[i]);
    } else if (arg === "--model-invocable") {
      result.flags.modelInvocable = true;
    } else if (arg === "--user-invocable") {
      result.flags.userInvocable = true;
    } else if (arg === "--add") {
      i++;
      result.flags.add = args[i] || null;
    } else if (arg === "--remove") {
      i++;
      result.flags.remove = args[i] || null;
    } else if (arg === "--description") {
      i++;
      result.flags.description = args[i] || null;
    } else if (arg === "--author") {
      i++;
      result.flags.author = args[i] || null;
    } else if (arg === "--tags") {
      i++;
      result.flags.tags = args[i] || null;
    } else if (arg === "--predefined") {
      result.flags.predefined = true;
    } else if (arg === "--audit") {
      result.flags.audit = true;
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
  console.log(`${ansi.blueBold("agent-skill-manager")} (${ansi.bold("asm")}) ${getVersionString()}

Interactive TUI and CLI for managing installed skills for AI coding agents.

${ansi.bold("Usage:")}
  asm                        Launch interactive TUI
  asm <command> [options]     Run a CLI command

${ansi.bold("Commands:")}
  list                   List all discovered skills
  search <query>         Search skills by name/description/tool
  inspect <skill-name>   Show detailed info for a skill
  get <skill>            Print a skill's SKILL.md body (installs nothing)
  uninstall <skill-name> Remove a skill (with confirmation)
  disable <target>       Disable skill(s) without uninstalling
  enable <target>        Re-enable disabled skill(s)
  install <source>       Install a skill from GitHub or local path
  activate <skill>       Link a library skill into a provider
  deactivate <skill>     Remove a library activation from a provider
  library                Manage centrally installed library skills
  audit                  Detect duplicate skills across tools
  audit security <name>  Run security audit on a skill (or GitHub source)
  export                 Export skill inventory as JSON manifest
  import <file>          Import skills from a previously exported manifest
  init <name>            Scaffold a new skill with SKILL.md template
  stats                  Show aggregate skill metrics dashboard
  stats repo <repo>      Show per-repo stats (indexed skills)
  stats author <owner>   Show per-author stats (indexed skills)
  stats index            Show index-wide statistics
  link <path>            Symlink a local skill directory into an agent
  outdated               Show which installed skills have newer versions
  update [name...]       Update outdated skills with security re-audit
  publish [path]         Validate, audit, and submit a skill to the registry
  eval <skill-path>      Evaluate a skill against best practices and score it
  eval-providers list    List registered eval providers (id, version, schema, …)
  bundle                 Manage skill bundles (create, install, list, show, remove)
  index                  Manage skill index (ingest, search, list)
  doctor                 Run environment health checks and diagnostics
  config show            Print current config
  config path            Print config file path
  config reset           Reset config to defaults
  config edit            Open config in $EDITOR

${ansi.bold("Global Options:")}
  -h, --help             Show help for any command
  -v, --version          Print version and exit
  --json                 Output as JSON (list, search, inspect)
  --machine              Stable machine-readable JSON envelope (v1)
  -s, --scope <scope>    Filter: global, project, or both (default: both)
  -p, --tool <name>      Filter by tool (list, search)
  --no-color             Disable ANSI colors
  --sort <field>         Sort by: name, version, or location (default: name)
  --flat                 Show one row per tool instance (list, search)
  -y, --yes              Skip confirmation prompts
  -V, --verbose          Show debug output`);
}

// ─── Command handlers ──────────────────────────────────────────────────────
import { cmdList } from "./commands/list";
import { cmdSearch } from "./commands/search";
import { cmdInspect } from "./commands/inspect";
import { cmdGet } from "./commands/get";
import { cmdUninstall } from "./commands/uninstall";
import { cmdDisable, cmdEnable } from "./commands/toggle";
import { cmdAudit } from "./commands/audit";
import { cmdInstall } from "./commands/install";
import { cmdActivate, cmdDeactivate } from "./commands/activate";
import { cmdLibrary } from "./commands/library";
import { cmdConfig } from "./commands/config";
import { cmdExport, cmdImport } from "./commands/export-import";
import { cmdInit } from "./commands/init";
import { cmdStats } from "./commands/stats";
import { cmdLink } from "./commands/link";
import { cmdIndex } from "./commands/index-cmd";
import { cmdBundle } from "./commands/bundle";
import { cmdPublish } from "./commands/publish";
import { cmdOutdated, cmdUpdate } from "./commands/outdated-update";
import { cmdDoctor } from "./commands/doctor";
import { cmdEval, cmdEvalProviders } from "./commands/eval";

// ─── Re-exports for backward compat (cli.test.ts, skill-state.test.ts) ──────
export {
  promptForImportConflict,
  printImportConflictDiffs,
} from "./commands/export-import";

export async function runCLI(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  // --json and --machine are mutually exclusive
  if (args.flags.json && args.flags.machine) {
    error("--json and --machine are mutually exclusive. Use one or the other.");
    process.exit(2);
  }

  // --machine implies --yes so non-interactive agents don't get stuck on prompts
  if (args.flags.machine) {
    args.flags.yes = true;
  }

  // Apply --no-color
  if (args.flags.noColor) {
    globalThis.__CLI_NO_COLOR = true;
  }

  // Apply --verbose
  if (args.flags.verbose) {
    setVerbose(true);
  }

  // --version at top level
  if (args.flags.version) {
    console.log(`asm ${getVersionString()}`);
    const report = await buildShadowingReport();
    if (args.flags.verbose && report.resolved) {
      console.log(`  path: ${report.resolved.path}`);
      if (report.resolved.realPath !== report.resolved.path) {
        console.log(`  real: ${report.resolved.realPath}`);
      }
    }
    if (report.shadowed.length > 0 && report.resolved) {
      console.error("");
      console.error(
        ansi.yellow(
          `Warning: ${report.shadowed.length + 1} \`asm\` binaries on PATH — you may be running a shadowed install.`,
        ),
      );
      console.error(`  resolved: ${report.resolved.path}`);
      for (const other of report.shadowed) {
        console.error(`  shadowed: ${other.path}`);
      }
      console.error(
        ansi.dim(
          "  Remove the stale global install (npm uninstall -g agent-skill-manager) and keep only one.",
        ),
      );
      console.error(
        ansi.dim("  See: https://github.com/luongnv89/asm#troubleshooting"),
      );
    }
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
    case "get":
      await cmdGet(args);
      break;
    case "uninstall":
      await cmdUninstall(args);
      break;
    case "disable":
      await cmdDisable(args);
      break;
    case "enable":
      await cmdEnable(args);
      break;
    case "audit":
      await cmdAudit(args);
      break;
    case "install":
      await cmdInstall(args);
      break;
    case "activate":
      await cmdActivate(args);
      break;
    case "deactivate":
      await cmdDeactivate(args);
      break;
    case "library":
      await cmdLibrary(args);
      break;
    case "config":
      await cmdConfig(args);
      break;
    case "export":
      await cmdExport(args);
      break;
    case "import":
      await cmdImport(args);
      break;
    case "init":
      await cmdInit(args);
      break;
    case "stats":
      await cmdStats(args);
      break;
    case "link":
      await cmdLink(args);
      break;
    case "index":
      await cmdIndex(args);
      break;
    case "bundle":
      await cmdBundle(args);
      break;
    case "publish":
      await cmdPublish(args);
      break;
    case "outdated":
      await cmdOutdated(args);
      break;
    case "update":
      await cmdUpdate(args);
      break;
    case "doctor":
      await cmdDoctor(args);
      break;
    case "eval":
      await cmdEval(args);
      break;
    case "eval-providers":
      await cmdEvalProviders(args);
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
  const commands = [
    "list",
    "search",
    "inspect",
    "get",
    "uninstall",
    "audit",
    "config",
    "install",
    "activate",
    "deactivate",
    "library",
    "export",
    "import",
    "init",
    "stats",
    "link",
    "index",
    "bundle",
    "publish",
    "outdated",
    "update",
    "doctor",
    "eval",
    "eval-providers",
    "disable",
    "enable",
  ];
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
