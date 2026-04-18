import {
  loadConfig,
  getConfigPath,
  getDefaultConfig,
  saveConfig,
} from "./config";
import { scanAllSkills, searchSkills, sortSkills } from "./scanner";
import {
  buildFullRemovalPlan,
  buildRemovalPlan,
  executeRemoval,
  getExistingTargets,
} from "./uninstaller";
import {
  formatSkillTable,
  formatGroupedTable,
  formatSkillDetail,
  formatSkillInspect,
  formatSearchResults,
  formatAvailableSearchResults,
  formatJSON,
  ansi,
  colorEffort,
  shortenPath,
  wordWrap,
} from "./formatter";
import {
  parseSource,
  isLocalPath,
  sanitizeName,
  checkGitAvailable,
  cloneToTemp,
  validateSkill,
  discoverSkills,
  scanForWarnings,
  executeInstall,
  executeInstallAllProviders,
  cleanupTemp,
  resolveProvider,
  resolveSubpath,
  buildInstallPlan,
  checkConflict,
  findDuplicateInstallNames,
  checkNpxAvailable,
  executeNpxSkillsAdd,
  buildRepoUrl,
} from "./installer";
import type {
  InstallResult,
  ProviderConfig,
  SkillInfo,
  InstallMethod,
} from "./utils/types";
import { checkboxPicker } from "./utils/checkbox-picker";
import { checkHealth } from "./health";
import {
  isBareOrScopedName,
  isScopedName,
  resolveFromRegistry,
} from "./registry";
import type { RegistryManifest, ResolutionSource } from "./registry";
import { buildManifest } from "./exporter";
import { readManifestFile, importSkills } from "./importer";
import { scaffoldSkill, directoryExists } from "./initializer";
import { computeStats, formatStatsReport } from "./stats";
import {
  validateLinkSource,
  createLink,
  discoverLinkableSkills,
} from "./linker";
import {
  buildBundle,
  skillInfoToRef,
  saveBundle,
  loadBundle,
  listBundles,
  removeBundle,
} from "./bundler";
import { publishSkill, formatFallbackInstructions } from "./publisher";
import type { BundleSkillRef } from "./utils/types";
import {
  detectDuplicates,
  sortInstancesForKeep,
  formatAuditReport,
  formatAuditReportJSON,
} from "./auditor";
import {
  auditSkillSecurity,
  formatSecurityReport,
  formatSecurityReportJSON,
} from "./security-auditor";
import { writeLockEntry, removeLockEntry, getCommitHash } from "./utils/lock";
import {
  checkOutdated,
  updateSkills,
  formatOutdatedTable,
  formatOutdatedJSON,
  formatUpdateJSON,
} from "./updater";
import { runAllChecks, formatDoctorReport, formatDoctorJSON } from "./doctor";
import {
  applyFix,
  detectGitAuthor,
  formatReport,
  formatReportJSON,
  formatFixPreview,
  buildEvalMachineData,
  type EvaluationReport,
} from "./evaluator";
import { runProvider } from "./eval/runner";
import {
  resolve as resolveEvalProvider,
  list as listEvalProviders,
} from "./eval/registry";
import { registerBuiltins } from "./eval/providers";
import { loadEvalConfig } from "./eval/config";
import { scaffoldEvalYaml } from "./eval/providers/skillgrade/v1/scaffold";
import { compareResults, parseCompareArg } from "./eval/compare";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "./utils/machine";
import { ingestRepo, listIndexedRepos, removeRepoIndex } from "./ingester";
import {
  searchSkills as searchIndexSkills,
  getTotalSkillCount,
  getMissingMetadataFields,
} from "./skill-index";
import type { SearchFilters } from "./skill-index";
import { VERSION_STRING } from "./utils/version";
import { parseEditorCommand } from "./utils/editor";
import { setVerbose } from "./logger";
import { join as joinPath } from "path";
import type {
  Scope,
  SortBy,
  TransportMode,
  SecurityAuditReport,
} from "./utils/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a security audit verdict string to a numeric risk score.
 *   dangerous → 3, warning → 2, caution → 1, safe/other → 0
 */
function verdictToRiskScore(verdict: string): number {
  switch (verdict) {
    case "dangerous":
      return 3;
    case "warning":
      return 2;
    case "caution":
      return 1;
    default:
      return 0;
  }
}

/**
 * Build the common machine-output data shape for security audit commands.
 * Accepts one or more SecurityAuditReports and returns { verdict, findings, risk_score }.
 */
function formatAuditMachineData(reports: SecurityAuditReport[]) {
  return {
    verdict: reports.every((r) => r.verdict === "safe")
      ? "safe"
      : reports.some((r) => r.verdict === "dangerous")
        ? "dangerous"
        : "warning",
    findings: reports.map((r) => ({
      skill: r.skillName,
      verdict: r.verdict,
      verdict_reason: r.verdictReason,
      total_files: r.totalFiles,
      total_lines: r.totalLines,
    })),
    risk_score: reports.reduce(
      (sum, r) => sum + verdictToRiskScore(r.verdict),
      0,
    ),
  };
}

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
    provider: string | null;
    name: string | null;
    force: boolean;
    path: string | null;
    all: boolean;
    verbose: boolean;
    flat: boolean;
    transport: TransportMode;
    method: InstallMethod;
    installed: boolean;
    available: boolean;
    has: string[];
    missing: string[];
    dryRun: boolean;
    machine: boolean;
    noCache: boolean;
    fix: boolean;
    /** `asm eval --runtime` toggles the skillgrade runtime provider. */
    runtime: boolean;
    /** `asm eval --preset smoke|reliable|regression` — skillgrade preset. */
    preset: string | null;
    /** `asm eval --threshold 0.8` — accepts `0..1` or `0..100`. */
    threshold: number | null;
    /**
     * `asm eval --compare <id>@<v1>,<id>@<v2>` — run two provider versions
     * on the same skill and render the diff. Value is the raw comma-separated
     * spec; parsing lives in `src/eval/compare.ts` so the CLI stays thin.
     */
    compare: string | null;
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
      provider: null,
      name: null,
      force: false,
      path: null,
      all: false,
      verbose: false,
      flat: false,
      transport: "auto",
      method: "default",
      installed: false,
      available: false,
      has: [],
      missing: [],
      dryRun: false,
      machine: false,
      noCache: false,
      fix: false,
      runtime: false,
      preset: null,
      threshold: null,
      compare: null,
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
    } else if (arg === "--verbose" || arg === "-V") {
      result.flags.verbose = true;
    } else if (arg === "--flat") {
      result.flags.flat = true;
    } else if (arg === "--installed") {
      result.flags.installed = true;
    } else if (arg === "--available") {
      result.flags.available = true;
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
    } else if (arg === "--runtime") {
      result.flags.runtime = true;
    } else if (arg === "--preset") {
      i++;
      result.flags.preset = args[i] || null;
    } else if (arg === "--threshold") {
      i++;
      const val = args[i];
      if (val === undefined) {
        error("--threshold requires a numeric value");
        process.exit(2);
      }
      const n = Number(val);
      if (!Number.isFinite(n)) {
        error(
          `Invalid --threshold: "${val}". Must be a number (e.g. 0.8 or 80).`,
        );
        process.exit(2);
      }
      result.flags.threshold = n;
    } else if (arg === "--compare") {
      // Raw value passed through verbatim; parsing lives in the compare
      // module so `parseArgs` stays dumb and does not depend on eval/.
      i++;
      result.flags.compare = args[i] || null;
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
  search <query>         Search skills by name/description/tool
  inspect <skill-name>   Show detailed info for a skill
  uninstall <skill-name> Remove a skill (with confirmation)
  install <source>       Install a skill from GitHub or local path
  audit                  Detect duplicate skills across tools
  audit security <name>  Run security audit on a skill (or GitHub source)
  export                 Export skill inventory as JSON manifest
  import <file>          Import skills from a previously exported manifest
  init <name>            Scaffold a new skill with SKILL.md template
  stats                  Show aggregate skill metrics dashboard
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

function printListHelp() {
  console.log(`${ansi.bold("Usage:")} asm list [options]

List all discovered skills. By default, skills installed across multiple
tools are grouped into a single row with tool badges.

${ansi.bold("Options:")}
  --sort <field>       Sort by: name, version, or location (default: name)
  -s, --scope <s>      Filter: global, project, or both (default: both)
  -p, --tool <p>       Filter by tool (claude, codex, openclaw, agents)
  --flat               Show one row per tool instance (ungrouped)
  --json               Output as JSON array
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm list                          ${ansi.dim("List all skills (grouped)")}
  asm list --flat                   ${ansi.dim("One row per tool instance")}
  asm list -p claude                ${ansi.dim("Only Claude Code skills")}
  asm list -s project               ${ansi.dim("Only project-scoped skills")}
  asm list --sort version           ${ansi.dim("Sort by version")}
  asm list --json                   ${ansi.dim("Output as JSON")}
  asm list --machine                ${ansi.dim("Machine-readable v1 envelope output")}`);
}

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

function printInspectHelp() {
  console.log(`${ansi.bold("Usage:")} asm inspect <skill-name> [options]

Show detailed information for a skill. The <skill-name> is the directory name.
Shows version, description, file count, and all provider installations.

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --json             Output as JSON object
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm inspect code-review           ${ansi.dim("Show details for code-review")}
  asm inspect code-review --json    ${ansi.dim("Output as JSON")}
  asm inspect code-review -s global ${ansi.dim("Global installations only")}`);
}

function printUninstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm uninstall <skill-name> [options]

Remove a skill and its associated rule files. Shows a removal plan
before proceeding and asks for confirmation.

${ansi.bold("Options:")}
  -y, --yes          Skip confirmation prompt
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm uninstall code-review         ${ansi.dim("Remove with confirmation")}
  asm uninstall code-review -y      ${ansi.dim("Remove without confirmation")}
  asm uninstall code-review -s project  ${ansi.dim("Remove project copy only")}`);
}

function printAuditHelp() {
  console.log(`${ansi.bold("Usage:")} asm audit [subcommand] [options]

Detect duplicate skills or run security audits on installed/remote skills.

${ansi.bold("Subcommands:")}
  duplicates             Find duplicate skills (default)
  security <name|source> Run security audit on an installed skill or GitHub source

${ansi.bold("Options:")}
  --json             Output as JSON
  --machine          Output in stable machine-readable v1 envelope format
  -y, --yes          Auto-remove duplicates, keeping one instance per group
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm audit                                    ${ansi.dim("Find duplicates")}
  asm audit -y                                 ${ansi.dim("Auto-remove duplicates")}
  asm audit --json                             ${ansi.dim("Output as JSON")}
  asm audit security code-review               ${ansi.dim("Audit an installed skill")}
  asm audit security github:user/repo          ${ansi.dim("Audit a remote skill before installing")}
  asm audit security --all                     ${ansi.dim("Audit all installed skills")}
  asm audit security code-review --json        ${ansi.dim("Output audit as JSON")}
  asm audit security code-review --machine     ${ansi.dim("Machine-readable v1 envelope output")}
  asm audit security https://github.com/user/skills/tree/main/skills/agent-config
                                               ${ansi.dim("Audit a skill from a subfolder URL")}`);
}

function printPublishHelp() {
  console.log(`${ansi.bold("Usage:")} asm publish [path] [options]

Validate a skill, run a security audit, generate a registry manifest,
and open a PR against the asm-registry.

${ansi.bold("Arguments:")}
  path                 Path to skill directory (default: current directory)

${ansi.bold("Options:")}
  --dry-run            Print generated manifest without opening a PR
  --force              Override 'warning' security verdict (blocks 'dangerous')
  -y, --yes            Skip confirmation prompts
  --json               Output result as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm publish                       ${ansi.dim("Publish skill in current directory")}
  asm publish ./my-skill            ${ansi.dim("Publish skill at the given path")}
  asm publish --dry-run             ${ansi.dim("Preview manifest without side effects")}
  asm publish --force               ${ansi.dim("Override warning-level security findings")}
  asm publish --json                ${ansi.dim("Output as JSON")}
  asm publish --machine             ${ansi.dim("Machine-readable v1 envelope output")}`);
}

function printOutdatedHelp() {
  console.log(`${ansi.bold("Usage:")} asm outdated [options]

Show which installed skills have newer versions available.

${ansi.bold("Options:")}
  --json               Output as JSON
  --machine            Output in stable machine-readable format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm outdated                       ${ansi.dim("Show outdated skills")}
  asm outdated --json                ${ansi.dim("Output as JSON")}
  asm outdated --machine             ${ansi.dim("Machine-readable output")}`);
}

function printUpdateHelp() {
  console.log(`${ansi.bold("Usage:")} asm update [name...] [options]

Update outdated skills to their latest version with security re-audit.

${ansi.bold("Arguments:")}
  name          Specific skill(s) to update (default: all outdated)

${ansi.bold("Options:")}
  -y, --yes            Skip confirmation prompts
  --json               Output as JSON
  --machine            Output in stable machine-readable format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm update                         ${ansi.dim("Update all outdated skills")}
  asm update code-review             ${ansi.dim("Update a specific skill")}
  asm update --yes                   ${ansi.dim("Skip confirmation prompts")}
  asm update --json                  ${ansi.dim("Output as JSON")}`);
}

function printConfigHelp() {
  console.log(`${ansi.bold("Usage:")} asm config <subcommand>

Manage configuration. Config is stored at ~/.config/agent-skill-manager/.

${ansi.bold("Subcommands:")}
  show     Print current config as JSON
  path     Print config file path
  reset    Reset config to defaults (with confirmation)
  edit     Open config in $EDITOR

${ansi.bold("Options:")}
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm config show                   ${ansi.dim("View current config")}
  asm config edit                   ${ansi.dim("Edit in $EDITOR")}
  asm config reset -y               ${ansi.dim("Reset without confirmation")}`);
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function enrichWithHealth(skills: SkillInfo[]): Promise<void> {
  for (const skill of skills) {
    skill.warnings = await checkHealth(skill);
  }
}

async function cmdList(args: ParsedArgs) {
  if (args.flags.help) {
    printListHelp();
    return;
  }

  const startTime = performance.now();
  const config = await loadConfig();
  let allSkills = await scanAllSkills(config, args.flags.scope);

  // Provider filter (for list/search — not for install/init where it means target)
  if (args.flags.provider && args.command === "list") {
    allSkills = allSkills.filter((s) => s.provider === args.flags.provider);
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
  } else {
    console.log(formatGroupedTable(sorted));
  }
}

async function cmdSearch(args: ParsedArgs) {
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
    const filtered = searchSkills(allSkills, query);
    installedResults = sortSkills(filtered, args.flags.sort);
  }

  // --- Available (index) skills ---
  let indexResults: Awaited<ReturnType<typeof searchIndexSkills>> = [];
  if (showAvailable) {
    indexResults = await searchIndexSkills(query);
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
      })),
      query,
    );
    console.error(availableFormatted);
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
    console.error(
      ansi.dim(
        `Try ${ansi.bold("asm list")} to see all skills or ${ansi.bold(`asm search "${skillName}"`)} to search.`,
      ),
    );
    process.exit(1);
  }

  await enrichWithHealth(matches);

  if (args.flags.json) {
    console.log(formatJSON(matches.length === 1 ? matches[0] : matches));
  } else {
    console.log(await formatSkillInspect(matches));
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
    console.error(`  ${ansi.red("•")} ${shortenPath(target)}`);
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

  // Remove lock entry for tracking
  try {
    await removeLockEntry(skillName);
  } catch {
    // Lock removal failure is non-fatal
  }

  console.error(ansi.green("\nDone."));
}

export function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;

    function cleanup() {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.pause();
      clearTimeout(timer);
    }

    function finish(value: string) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    function onData(chunk: string) {
      data += chunk;
      if (data.includes("\n")) {
        finish(data.trim());
      }
    }

    function onEnd() {
      finish(data.trim());
    }

    const timer = setTimeout(() => {
      finish(data.trim());
    }, 30_000);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

async function cmdAudit(args: ParsedArgs) {
  if (args.flags.help) {
    printAuditHelp();
    return;
  }

  const startTime = performance.now();
  const sub = args.subcommand ?? "duplicates";

  if (sub === "security") {
    await cmdAuditSecurity(args, startTime);
    return;
  }

  if (sub !== "duplicates") {
    error(`Unknown audit subcommand: "${sub}". Use: duplicates, security`);
    process.exit(2);
  }

  const config = await loadConfig();
  // Always scan all providers regardless of --scope
  const allSkills = await scanAllSkills(config, "both");
  const report = detectDuplicates(allSkills);

  if (args.flags.machine) {
    const data = {
      duplicate_groups: report.duplicateGroups.map((g) => ({
        name: g.key,
        count: g.instances.length,
        instances: g.instances.map((i) => ({
          path: i.path,
          scope: i.scope,
          provider: i.provider,
        })),
      })),
      total_duplicates: report.duplicateGroups.length,
    };
    console.log(formatMachineOutput("audit duplicates", data, startTime));
    return;
  }

  if (args.flags.json) {
    console.log(formatAuditReportJSON(report));
    return;
  }

  console.log(formatAuditReport(report));

  if (args.flags.yes && report.duplicateGroups.length > 0) {
    // Auto-remove all but the first (recommended keep) instance per group
    console.error(ansi.bold("\nAuto-removing duplicates..."));
    for (const group of report.duplicateGroups) {
      const sorted = sortInstancesForKeep(group.instances);
      const keptPath = sorted[0].path;
      // Keep the first, remove the rest (replace with symlinks)
      for (let i = 1; i < sorted.length; i++) {
        const skill = sorted[i];
        const plan = buildRemovalPlan(skill, config);
        const log = await executeRemoval(plan, keptPath);
        for (const entry of log) {
          console.error(entry);
        }
      }
    }
    console.error(ansi.green("\nDone."));
  }
}

async function cmdAuditSecurity(args: ParsedArgs, startTime: number) {
  const target = args.positional[0];

  if (args.flags.all) {
    await cmdAuditSecurityAll(args, startTime);
  } else if (!target) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.INVALID_ARGUMENT,
          "Missing target. Provide a skill name, GitHub source, or use --all.",
          startTime,
        ),
      );
      process.exit(2);
    }
    error(
      "Missing target. Provide a skill name, GitHub source, or use --all.\nUsage: asm audit security <name|github:owner/repo> [--all]",
    );
    process.exit(2);
  } else if (
    target.startsWith("github:") ||
    target.startsWith("https://github.com/")
  ) {
    await cmdAuditSecuritySource(args, target, startTime);
  } else {
    await cmdAuditSecurityInstalled(args, target, startTime);
  }
}

async function cmdAuditSecurityAll(args: ParsedArgs, startTime: number) {
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  if (allSkills.length === 0) {
    if (args.flags.machine) {
      console.log(formatMachineOutput("audit security", [], startTime));
    } else if (args.flags.json) {
      console.log("[]");
    } else {
      console.log("No skills found to audit.");
    }
    return;
  }

  // Deduplicate by realPath to avoid scanning the same skill multiple times
  const seen = new Set<string>();
  const uniqueSkills = allSkills.filter((s) => {
    if (seen.has(s.realPath)) return false;
    seen.add(s.realPath);
    return true;
  });

  console.error(
    `Auditing ${uniqueSkills.length} skill${uniqueSkills.length > 1 ? "s" : ""}...\n`,
  );

  const reports = [];
  for (const skill of uniqueSkills) {
    console.error(`  Scanning ${ansi.bold(skill.name)}...`);
    const report = await auditSkillSecurity(skill.realPath, skill.name);
    reports.push(report);
  }

  if (args.flags.machine) {
    console.log(
      formatMachineOutput(
        "audit security",
        formatAuditMachineData(reports),
        startTime,
      ),
    );
  } else if (args.flags.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      console.log(formatSecurityReport(report));
    }

    const verdictCounts = { safe: 0, caution: 0, warning: 0, dangerous: 0 };
    for (const r of reports) {
      verdictCounts[r.verdict]++;
    }
    console.log(ansi.bold("\n  Summary:"));
    if (verdictCounts.dangerous > 0)
      console.log(`    ${ansi.red(`${verdictCounts.dangerous} dangerous`)}`);
    if (verdictCounts.warning > 0)
      console.log(`    ${ansi.yellow(`${verdictCounts.warning} warning`)}`);
    if (verdictCounts.caution > 0)
      console.log(`    ${verdictCounts.caution} caution`);
    if (verdictCounts.safe > 0)
      console.log(`    ${ansi.green(`${verdictCounts.safe} safe`)}`);
    console.log("");
  }
}

async function cmdAuditSecuritySource(
  args: ParsedArgs,
  target: string,
  startTime: number,
) {
  let tempDir: string | null = null;
  try {
    let source = parseSource(target);

    if (source.isLocal) {
      throw new Error(
        "Local paths are not supported for remote security audits. Use: asm audit security <installed-skill-name>",
      );
    }

    await checkGitAvailable();

    // Resolve ref/subpath for subfolder URLs
    source = await resolveSubpath(source);
    console.error(`Cloning ${target} for audit...`);

    tempDir = await cloneToTemp(source, args.flags.transport);

    // Use subpath if available (from URL like /tree/main/skills/agent-config)
    const { join: joinPath } = await import("path");
    const auditDir = source.subpath
      ? joinPath(tempDir, source.subpath)
      : tempDir;

    const { name } = await validateSkill(auditDir);
    const report = await auditSkillSecurity(
      auditDir,
      name,
      source.owner,
      source.repo,
    );

    if (args.flags.machine) {
      console.log(
        formatMachineOutput(
          "audit security",
          formatAuditMachineData([report]),
          startTime,
        ),
      );
    } else if (args.flags.json) {
      console.log(formatSecurityReportJSON(report));
    } else {
      console.log(formatSecurityReport(report));
    }
  } catch (err: any) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.AUDIT_FAILED,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  } finally {
    if (tempDir) {
      await cleanupTemp(tempDir);
    }
  }
}

async function cmdAuditSecurityInstalled(
  args: ParsedArgs,
  target: string,
  startTime: number,
) {
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const matches = allSkills.filter((s) => s.dirName === target);

  if (matches.length === 0) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.SKILL_NOT_FOUND,
          `Skill "${target}" not found.`,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(
      `Skill "${target}" not found. Use "asm list" to see installed skills.`,
    );
    process.exit(1);
  }

  const skill = matches[0];

  console.error(`Auditing installed skill: ${ansi.bold(skill.name)}...\n`);

  const report = await auditSkillSecurity(skill.realPath, skill.name);

  if (args.flags.machine) {
    console.log(
      formatMachineOutput(
        "audit security",
        formatAuditMachineData([report]),
        startTime,
      ),
    );
  } else if (args.flags.json) {
    console.log(formatSecurityReportJSON(report));
  } else {
    console.log(formatSecurityReport(report));
  }
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
      const editorCmd = process.env.VISUAL || process.env.EDITOR || "vi";
      const [editorBin, editorArgs] = parseEditorCommand(editorCmd);
      const configPath = getConfigPath();
      // Ensure config file exists
      await loadConfig();
      const { spawn: spawnProcess } = await import("child_process");
      await new Promise<void>((resolve, reject) => {
        const proc = spawnProcess(editorBin, [...editorArgs, configPath], {
          stdio: "inherit",
        });
        proc.on("close", () => resolve());
        proc.on("error", reject);
      });
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

function printInstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm install <source> [options]

Install a skill from a GitHub repository, the curated registry, or a local path.

${ansi.bold("Source Format:")}
  code-review                    Install by name from the curated registry
  author/code-review             Install a scoped name (author/name) from registry
  github:owner/repo              Install from default branch
  github:owner/repo#ref          Install from specific branch or tag
  github:owner/repo#ref:path     Install from a subfolder on a specific branch
  https://github.com/owner/repo  Install via HTTPS URL
  https://github.com/owner/repo/tree/branch/path/to/skill
                                 Install from a subfolder URL (auto-detects branch)
  /absolute/path/to/skill        Install from a local folder (absolute path)
  ./relative/path/to/skill       Install from a local folder (relative path)
  ~/path/to/skill                Install from a local folder (home-relative path)

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents, all)
                         Use "all" to install to all tools (shared + symlinks)
  -s, --scope <scope>    Installation scope: global or project (default: prompt)
                         global installs to ~/.claude/skills/ (available everywhere)
                         project installs to .claude/skills/ (this project only)
  --name <name>          Override skill directory name
  --path <subdir>        Install skill from a subdirectory of the repo
  --skill <name>         Alias for --path (Vercel skills CLI compatibility)
  --all                  Install all skills found in the repo
  -m, --method <method>  Install method: default or vercel (default: default)
                         vercel delegates to npx skills add for tracking
  -t, --transport <mode> Transport: https, ssh, or auto (default: auto)
                         auto tries HTTPS first, falls back to SSH on auth error
  --no-cache             Force fresh registry fetch (bypass 1-hour TTL cache)
  -f, --force            Overwrite if skill already exists
  -y, --yes              Skip confirmation prompt
  --json                 Output result as JSON
  --machine              Machine-readable output (includes resolution source)
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Registry (bare name):")}
  asm install code-review                  ${ansi.dim("(resolve from registry)")}
  asm install luongnv89/code-review        ${ansi.dim("(scoped name, no ambiguity)")}
  asm install code-review --no-cache       ${ansi.dim("(force fresh registry fetch)")}

${ansi.bold("Local folder:")}
  asm install ./my-skill                   ${ansi.dim("(relative path)")}
  asm install /home/user/skills/my-skill   ${ansi.dim("(absolute path)")}
  asm install ~/skills/my-skill            ${ansi.dim("(home-relative path)")}
  asm install ../other-project/skill       ${ansi.dim("(parent-relative path)")}
  asm install ./skills-dir --all           ${ansi.dim("(all skills in directory)")}

${ansi.bold("Single-skill repo:")}
  asm install github:user/my-skill
  asm install github:user/my-skill#v1.0.0 -p claude
  asm install https://github.com/user/my-skill
  asm install github:user/my-skill -p all    ${ansi.dim("(install to all tools)")}
  asm install github:user/private-skill -t ssh  ${ansi.dim("(clone via SSH)")}

${ansi.bold("Multi-skill repo:")}
  asm install github:user/skills --path skills/code-review
  asm install github:user/skills --all -p claude -y
  asm install github:user/skills --all -p all -y  ${ansi.dim("(all skills, all tools)")}
  asm install https://github.com/user/skills --all
  asm install github:user/skills              ${ansi.dim("(interactive picker)")}

${ansi.bold("Subfolder URL:")}
  asm install https://github.com/user/skills/tree/main/skills/agent-config
  asm install github:user/skills#main:skills/agent-config

${ansi.bold("Vercel skills CLI:")}
  asm install github:user/skills --method vercel --skill my-skill
  asm install https://github.com/user/skills -m vercel --skill my-skill -y
  ${ansi.dim("Delegates to npx skills add for Vercel tracking, then registers in asm")}`);
}

// ─── Install: inspect a single skill (returns metadata for review) ──────────

interface SkillInspection {
  metadata: {
    name: string;
    version: string;
    description: string;
    effort?: string;
  };
  skillName: string;
  warnings: Awaited<ReturnType<typeof scanForWarnings>>;
  installStatus: string;
  riskLevel: "high" | "medium" | "safe";
  riskLabel: string;
  plan: ReturnType<typeof buildInstallPlan>;
}

async function inspectSkillForInstall(
  args: ParsedArgs,
  source: ReturnType<typeof parseSource>,
  tempDir: string,
  skillDir: string,
  skillNameOverride: string | null,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: ProviderConfig,
  existingSkills: SkillInfo[],
  scope: "global" | "project" = "global",
): Promise<SkillInspection> {
  const metadata = await validateSkill(skillDir);
  const warnings = await scanForWarnings(skillDir);

  const dirName = skillDir === tempDir ? null : skillDir.split(/[/\\]/).pop();
  const rawName = skillNameOverride || dirName || source.repo;
  const skillName = sanitizeName(rawName);

  // Check NEW vs UPDATE status
  const existingMatch = existingSkills.find(
    (s) =>
      s.name.toLowerCase() === metadata.name.toLowerCase() &&
      s.provider === provider.name,
  );
  let installStatus: string;
  const alreadyExists = !!existingMatch;
  if (existingMatch) {
    if (existingMatch.version === metadata.version) {
      installStatus = args.flags.force
        ? "REINSTALL"
        : `UPDATE: ${existingMatch.version} (same version)`;
    } else {
      installStatus = `UPDATE: ${existingMatch.version} → ${metadata.version}`;
    }
  } else {
    installStatus = "NEW";
  }

  // If skill already exists, force overwrite (user will confirm at the end)
  const plan = buildInstallPlan(
    source,
    tempDir,
    skillDir,
    skillName,
    provider,
    args.flags.force || alreadyExists,
    scope,
  );

  const hasHighRisk = warnings.some((w) =>
    ["Shell commands", "Code execution", "Credentials"].includes(w.category),
  );
  const hasMedRisk = warnings.some((w) =>
    ["External URLs"].includes(w.category),
  );
  const riskLevel = hasHighRisk ? "high" : hasMedRisk ? "medium" : "safe";
  const riskLabel = hasHighRisk
    ? ansi.red("[!] High Risk")
    : hasMedRisk
      ? ansi.yellow("[~] Medium Risk")
      : ansi.green("[ok] Safe");

  return {
    metadata,
    skillName,
    warnings,
    installStatus,
    riskLevel,
    riskLabel,
    plan,
  };
}

// ─── Install: display inspection details ────────────────────────────────────

function displaySkillInspection(
  inspection: SkillInspection,
  sourceStr: string,
  provider: ProviderConfig,
  allProviders: ProviderConfig[] | null,
  isBatch: boolean,
  batchContext?: { index: number; total: number },
) {
  const { metadata, warnings, installStatus, riskLabel, plan } = inspection;

  if (isBatch && batchContext) {
    const progress = ansi.dim(`[${batchContext.index}/${batchContext.total}]`);
    const statusColor =
      installStatus === "NEW"
        ? ansi.green(`[${installStatus}]`)
        : ansi.yellow(`[${installStatus}]`);
    console.info(
      `${progress} ${ansi.bold(metadata.name)} v${metadata.version} ${statusColor} ${riskLabel}`,
    );
  } else {
    const statusColor =
      installStatus === "NEW"
        ? ansi.green(`[${installStatus}]`)
        : ansi.yellow(`[${installStatus}]`);
    console.info(
      `  ${ansi.bold(metadata.name)} v${metadata.version} ${statusColor}`,
    );

    console.info(`\n  ${ansi.bold("Install preview:")}`);
    console.info(`    ${ansi.bold("Name:")}        ${metadata.name}`);
    console.info(`    ${ansi.bold("Version:")}     ${metadata.version}`);
    if (metadata.description) {
      console.info(
        `    ${ansi.bold("Description:")} ${ansi.dim(metadata.description)}`,
      );
    }
    if (metadata.effort) {
      console.info(
        `    ${ansi.bold("Effort:")}      ${colorEffort(metadata.effort)}`,
      );
    }
    console.info(`    ${ansi.bold("Source:")}      ${sourceStr}`);
    if (allProviders) {
      console.info(
        `    ${ansi.bold("Tool:")}    All (${allProviders.map((p) => p.label).join(", ")})`,
      );
      console.info(
        `    ${ansi.bold("Primary:")}     ${provider.label} (${provider.name})`,
      );
      console.info(
        `    ${ansi.bold("Symlinks:")}    ${allProviders
          .filter((p) => p.name !== provider.name)
          .map((p) => p.label)
          .join(", ")}`,
      );
    } else {
      console.info(
        `    ${ansi.bold("Tool:")}    ${provider.label} (${provider.name})`,
      );
    }
    console.info(
      `    ${ansi.bold("Scope:")}       ${plan.scope === "project" ? "Project" : "Global"}`,
    );
    console.info(`    ${ansi.bold("Target:")}      ${plan.targetDir}`);
    console.info(`    ${ansi.bold("Status:")}      ${statusColor}`);
    console.info(`    ${ansi.bold("Risk:")}        ${riskLabel}`);

    if (warnings.length > 0) {
      console.info(`\n  ${ansi.bold("Security warnings:")}`);
      const grouped = new Map<string, typeof warnings>();
      for (const w of warnings) {
        const list = grouped.get(w.category) || [];
        list.push(w);
        grouped.set(w.category, list);
      }
      for (const [category, items] of grouped) {
        const isHighRiskCategory = [
          "Shell commands",
          "Code execution",
          "Credentials",
        ].includes(category);
        const categoryLabel = isHighRiskCategory
          ? ansi.red(`[${category}]`)
          : ansi.yellow(`[${category}]`);
        console.info(
          `\n    ${categoryLabel} ${ansi.dim(`(${items.length} match${items.length > 1 ? "es" : ""})`)}`,
        );
        for (const item of items.slice(0, 5)) {
          console.info(
            `      ${ansi.dim(`${item.file}:${item.line}`)} -- ${item.match}`,
          );
        }
        if (items.length > 5) {
          console.info(ansi.dim(`      ... and ${items.length - 5} more`));
        }
      }
    }
  }
}

// ─── Install: execute a single skill install ────────────────────────────────

async function executeSkillInstall(
  plan: ReturnType<typeof buildInstallPlan>,
  allProviders: ProviderConfig[] | null,
): Promise<InstallResult> {
  if (allProviders) {
    return await executeInstallAllProviders(plan, allProviders);
  }
  return await executeInstall(plan);
}

async function cmdInstall(args: ParsedArgs) {
  if (args.flags.help) {
    printInstallHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  let sourceStr = args.subcommand;
  if (!sourceStr) {
    error("Missing required argument: <source>");
    console.error(`Run "asm install --help" for usage.`);
    process.exit(2);
  }

  let tempDir: string | null = null;
  let resolutionSource: ResolutionSource = "github";
  const totalSteps = 8;
  let currentStep = 0;
  const stepHeader = (label: string) => {
    currentStep++;
    return `\n${ansi.cyan(`[Step ${currentStep}/${totalSteps}]`)} ${ansi.bold(label)}`;
  };

  // SIGINT/SIGTERM cleanup handler
  const cleanup = () => {
    if (tempDir) {
      cleanupTemp(tempDir).finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // Step 0: Registry resolution for bare/scoped names
    if (isBareOrScopedName(sourceStr)) {
      console.info(
        `\n${ansi.cyan("●")} Resolving "${ansi.bold(sourceStr)}" from registry...`,
      );

      const { resolved, multipleMatches, suggestions } =
        await resolveFromRegistry(sourceStr, {
          noCache: args.flags.noCache,
        });

      if (resolved) {
        // Single match — use the resolved manifest
        resolutionSource = "registry";
        const m = resolved.manifest;
        const repoPath = m.repository.replace("https://github.com/", "");
        sourceStr = m.skill_path
          ? `github:${repoPath}#${m.commit}:${m.skill_path}`
          : `github:${repoPath}#${m.commit}`;
        console.info(
          `  ${ansi.green("✓")} Resolved: ${ansi.bold(`${m.author}/${m.name}`)} @ ${m.commit.slice(0, 7)}`,
        );
      } else if (multipleMatches.length > 0) {
        // Multiple authors publish this name — disambiguate
        console.info(
          `\n  ${ansi.yellow("⚠")} Multiple skills found for "${ansi.bold(sourceStr)}":`,
        );

        const top = multipleMatches.slice(0, 5);
        for (let idx = 0; idx < top.length; idx++) {
          const m = top[idx];
          console.info(
            `    ${ansi.cyan(`${idx + 1}.`)} ${ansi.bold(`${m.author}/${m.name}`)} — ${m.description}`,
          );
        }

        if (!process.stdin.isTTY) {
          error(
            `Ambiguous skill name "${sourceStr}". Use a scoped name: asm install author/name`,
          );
          process.exit(2);
        }

        const prompt = `\n  Select a skill [1-${top.length}]: `;
        process.stderr.write(prompt);
        const response = await new Promise<string>((resolve) => {
          let data = "";
          let done = false;
          const timer = setTimeout(() => {
            if (!done) {
              done = true;
              process.stdin.removeListener("data", onData);
              resolve(data.trim());
            }
          }, 30_000);
          function onData(chunk: string | Buffer) {
            data = chunk.toString().trim();
            if (!done) {
              done = true;
              clearTimeout(timer);
              process.stdin.removeListener("data", onData);
              resolve(data);
            }
          }
          process.stdin.setEncoding("utf-8");
          process.stdin.on("data", onData);
        });

        const choice = parseInt(response, 10);
        if (isNaN(choice) || choice < 1 || choice > top.length) {
          error("Invalid selection. Aborting.");
          process.exit(2);
        }

        const selected = top[choice - 1];
        resolutionSource = "registry";
        const selectedRepoPath = selected.repository.replace(
          "https://github.com/",
          "",
        );
        sourceStr = selected.skill_path
          ? `github:${selectedRepoPath}#${selected.commit}:${selected.skill_path}`
          : `github:${selectedRepoPath}#${selected.commit}`;
        console.info(
          `  ${ansi.green("✓")} Selected: ${ansi.bold(`${selected.author}/${selected.name}`)} @ ${selected.commit.slice(0, 7)}`,
        );
      } else if (isScopedName(sourceStr)) {
        // Scoped name not found in registry — error (no fallback)
        error(`Skill "${sourceStr}" not found in the registry.`);
        if (suggestions.length > 0) {
          console.error(
            `\n  Did you mean: ${suggestions.map((s) => ansi.cyan(s)).join(", ")}?`,
          );
        }
        process.exit(1);
      } else {
        // Bare name not in registry — fall back to existing behavior
        console.info(
          `  ${ansi.dim("Not found in registry — trying existing sources...")}`,
        );
        resolutionSource = "pre-indexed";
      }
    }

    // Step 1: Parse source
    console.info(stepHeader("Parsing source"));
    let source = parseSource(sourceStr);
    const isLocal = !!source.isLocal;

    if (isLocal) {
      // Local path — validate it exists and is a directory
      const localPath = source.localPath!;
      console.info(`  ${ansi.dim(`local: ${localPath}`)}`);
      const { stat: fsStat } = await import("fs/promises");
      try {
        const stats = await fsStat(localPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path is not a directory: ${localPath}`);
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          throw new Error(`Path does not exist: ${localPath}`);
        }
        throw err;
      }
    } else {
      // Remote — resolve subpath via git ls-remote
      await checkGitAvailable();
      source = await resolveSubpath(source);
      console.info(`  ${ansi.dim(sourceStr)}`);
    }

    // Vercel method: delegate to npx skills add and then continue with
    // standard asm install to register in asm's local inventory
    if (args.flags.method === "vercel") {
      console.info(stepHeader("Installing via Vercel skills CLI"));
      await checkNpxAvailable();

      const repoUrl = buildRepoUrl(source);
      const skillName = args.flags.path || null;
      console.info(
        `  ${ansi.dim(`npx skills add ${repoUrl}${skillName ? ` --skill ${skillName}` : ""}`)}`,
      );

      const { stdout, stderr } = await executeNpxSkillsAdd(repoUrl, skillName);
      if (stdout.trim()) {
        console.info(`  ${ansi.dim(stdout.trim())}`);
      }
      if (stderr.trim()) {
        console.error(`  ${ansi.dim(stderr.trim())}`);
      }
      console.info(`  ${ansi.green("✓")} Vercel skills CLI install completed`);

      // Now continue with the standard asm install flow so the skill is
      // also tracked in asm's local inventory via the normal pipeline.
      // The --force flag is implicitly set since npx may have already
      // placed files that asm would see as a conflict.
      args.flags.force = true;
      console.info(
        `  ${ansi.dim("Continuing with asm install to register in local inventory...")}`,
      );
    }

    // Step 2: Select provider (before cloning — no wasted time if user cancels)
    console.info(stepHeader("Selecting provider"));
    const config = await loadConfig();
    const { provider, allProviders } = await resolveProvider(
      config,
      args.flags.provider,
      !!process.stdin.isTTY,
    );

    // Step 3: Select scope (global or project)
    console.info(stepHeader("Selecting scope"));
    let installScope: "global" | "project";

    if (args.flags.scope === "global" || args.flags.scope === "project") {
      // Explicit --scope flag provided
      installScope = args.flags.scope;
      console.info(
        `  ${ansi.dim(`scope: ${installScope}`)}${installScope === "global" ? ` (${provider.global})` : ` (${provider.project})`}`,
      );
    } else if (!process.stdin.isTTY || args.flags.yes) {
      // Non-interactive mode: default to global
      installScope = "global";
      console.info(
        `  ${ansi.dim(`scope: global (default)`)} (${provider.global})`,
      );
    } else {
      // Interactive: prompt user to choose
      const scopeItems = [
        {
          label: `Global (${provider.global})`,
          hint: "Available in all projects",
          checked: true,
        },
        {
          label: `Project (${provider.project})`,
          hint: "Available only in this project",
          checked: false,
        },
      ];
      console.info(""); // blank line before picker
      const scopeIndices = await checkboxPicker({ items: scopeItems });
      if (scopeIndices.length === 0) {
        throw new Error("No scope selected. Aborting.");
      }
      // Use the first selected scope (single-select behavior)
      installScope = scopeIndices[0] === 0 ? "global" : "project";
      console.info(
        `  Selected: ${ansi.bold(installScope)} ${ansi.dim(`(${installScope === "global" ? provider.global : provider.project})`)}`,
      );
    }

    // Step 4: Clone repository (or read local source)
    if (isLocal) {
      console.info(stepHeader("Reading local source"));
      console.info(`  ${ansi.dim(source.localPath!)}`);
      // For local sources, use the local path directly — no temp dir needed
      tempDir = null;
    } else {
      console.info(stepHeader("Cloning repository"));
      const transport = args.flags.transport;
      const displayUrl =
        transport === "ssh"
          ? source.sshCloneUrl
          : transport === "https"
            ? source.cloneUrl
            : `${source.cloneUrl} ${ansi.dim("(auto)")}`;
      console.info(
        `  ${displayUrl}${source.ref ? ` ${ansi.dim(`(ref: ${source.ref})`)}` : ""}${source.subpath ? ` ${ansi.dim(`(path: ${source.subpath})`)}` : ""}`,
      );
      tempDir = await cloneToTemp(source, transport);
    }

    // The base directory to scan for skills
    const scanBaseDir = isLocal ? source.localPath! : tempDir!;

    // Step 5: Scan for skills
    console.info(stepHeader("Scanning for skills"));
    const { join: joinPath } = await import("path");
    let results: InstallResult[] = [];

    // Effective path: explicit --path flag takes precedence over URL-derived subpath
    const effectivePath = args.flags.path || source.subpath;

    // Discover skills based on source type
    let selectedDirs: Array<{ skillDir: string; nameOverride: string | null }> =
      [];

    if (effectivePath) {
      // Case 1: path specified — install specific subdirectory
      const skillDir = joinPath(scanBaseDir, effectivePath);
      try {
        await validateSkill(skillDir);
      } catch {
        throw new Error(
          `No SKILL.md found at path "${effectivePath}" in the repository.`,
        );
      }
      console.info(`  Found skill at ${ansi.bold(effectivePath)}`);
      selectedDirs = [{ skillDir, nameOverride: args.flags.name }];
    } else {
      let isRootSkill = false;
      try {
        await validateSkill(scanBaseDir);
        isRootSkill = true;
      } catch {
        // Not a root-level skill
      }

      if (isRootSkill) {
        // Case 2: SKILL.md at root — single-skill directory/repo
        const metadata = await validateSkill(scanBaseDir);
        console.info(
          `  Found: ${ansi.bold(metadata.name)} v${metadata.version}`,
        );
        selectedDirs = [
          { skillDir: scanBaseDir, nameOverride: args.flags.name },
        ];
      } else {
        // Case 3: Multi-skill directory/repo — discover skills in subdirectories
        console.info(`  No SKILL.md at root. Scanning subdirectories...`);
        const discovered = await discoverSkills(scanBaseDir);

        if (discovered.length === 0) {
          throw new Error(
            "No skills found in this repository. Skills must have a SKILL.md file.",
          );
        }

        console.info(
          `  Found ${ansi.bold(String(discovered.length))} skill(s):\n`,
        );
        for (let i = 0; i < discovered.length; i++) {
          const num = ansi.cyan(
            `  ${String(i + 1).padStart(String(discovered.length).length)})`,
          );
          console.info(
            `${num} ${ansi.bold(discovered[i].name)} ${ansi.dim(`v${discovered[i].version}`)} ${ansi.dim(`(${discovered[i].relPath})`)}`,
          );
          if (discovered[i].description) {
            console.info(`     ${ansi.dim(discovered[i].description)}`);
          }
        }

        // Step 6: Select skills
        console.info(stepHeader("Selecting skills"));
        currentStep--; // will be re-incremented by stepHeader for next step

        let selectedPaths: string[];

        if (args.flags.all && (args.flags.yes || !process.stdin.isTTY)) {
          // Non-interactive --all: auto-select everything
          selectedPaths = discovered.map((s) => s.relPath);
          console.info(
            `  Selected all ${ansi.bold(String(selectedPaths.length))} skills`,
          );
        } else if (process.stdin.isTTY) {
          // Interactive checkbox picker
          if (discovered.length === 1) {
            // Single skill: auto-select without showing picker
            selectedPaths = [discovered[0].relPath];
            console.info(
              `  Auto-selected: ${ansi.bold(discovered[0].name)} ${ansi.dim(`v${discovered[0].version}`)}`,
            );
          } else {
            const pickerItems = discovered.map((s) => ({
              label: s.name,
              hint: `v${s.version}${s.description ? "  " + s.description : ""}`,
              checked: !!args.flags.all,
            }));

            console.info(""); // blank line before picker
            const selectedIndices = await checkboxPicker({
              items: pickerItems,
            });

            if (selectedIndices.length === 0) {
              throw new Error("No skills selected. Aborting.");
            }

            selectedPaths = selectedIndices.map((i) => discovered[i].relPath);
            console.info(
              `  Selected ${ansi.bold(String(selectedPaths.length))} skill(s)`,
            );
          }
        } else {
          error(
            `Repository contains ${discovered.length} skills. Use --path <subdir> to pick one or --all to install all.\n` +
              `Available skills:\n${discovered.map((s) => `  --path ${s.relPath}`).join("\n")}`,
          );
          process.exit(2);
          return; // unreachable but helps TypeScript
        }

        const duplicateInstallNames = findDuplicateInstallNames(selectedPaths);
        if (duplicateInstallNames.length > 0) {
          const lines = duplicateInstallNames
            .map(
              (dup) =>
                `  - ${dup.name}: ${dup.paths.map((p) => `"${p}"`).join(", ")}`,
            )
            .join("\n");
          const error = new Error(
            `Duplicate skill names detected in selection:\n${lines}\n` +
              "Choose one path per skill name or install with --path.",
          ) as Error & {
            duplicates?: Array<{ name: string; paths: string[] }>;
          };
          error.duplicates = duplicateInstallNames;
          throw error;
        }

        selectedDirs = selectedPaths.map((relPath) => ({
          skillDir: joinPath(scanBaseDir, relPath),
          nameOverride: selectedPaths.length === 1 ? args.flags.name : null,
        }));

        // Adjust step counter: we used the "Selecting skills" step
        currentStep++;
      }
    }

    // Step 7: Inspect selected skills (security scan + NEW/UPDATE status)
    console.info(stepHeader("Inspecting skills"));
    const existingSkills = await scanAllSkills(config, "both");
    const inspections: SkillInspection[] = [];
    const isBatch = selectedDirs.length > 1;

    for (let i = 0; i < selectedDirs.length; i++) {
      const { skillDir, nameOverride } = selectedDirs[i];
      const inspection = await inspectSkillForInstall(
        args,
        source,
        scanBaseDir,
        skillDir,
        nameOverride,
        config,
        provider,
        existingSkills,
        installScope,
      );

      inspections.push(inspection);
      displaySkillInspection(
        inspection,
        sourceStr,
        provider,
        allProviders,
        isBatch,
        isBatch ? { index: i + 1, total: selectedDirs.length } : undefined,
      );
    }

    // Show batch summary header
    if (isBatch) {
      console.info("");
      console.info(`  ${ansi.bold("Install settings:")}`);
      console.info(`    ${ansi.bold("Source:")}      ${sourceStr}`);
      if (allProviders) {
        console.info(
          `    ${ansi.bold("Tool:")}    All (${allProviders.map((p) => p.label).join(", ")})`,
        );
      } else {
        console.info(
          `    ${ansi.bold("Tool:")}    ${provider.label} (${provider.name})`,
        );
      }

      console.info(
        `    ${ansi.bold("Scope:")}      ${installScope === "project" ? "Project" : "Global"}`,
      );

      // Show risk summary
      const highCount = inspections.filter(
        (i) => i.riskLevel === "high",
      ).length;
      const medCount = inspections.filter(
        (i) => i.riskLevel === "medium",
      ).length;
      const safeCount = inspections.filter(
        (i) => i.riskLevel === "safe",
      ).length;
      const riskParts: string[] = [];
      if (safeCount > 0) riskParts.push(ansi.green(`${safeCount} Safe`));
      if (medCount > 0) riskParts.push(ansi.yellow(`${medCount} Medium Risk`));
      if (highCount > 0) riskParts.push(ansi.red(`${highCount} High Risk`));
      console.info(`    ${ansi.bold("Risk:")}        ${riskParts.join(", ")}`);
    }

    // Step 8: Confirm & Install
    console.info(stepHeader("Installing"));

    // Confirmation prompt
    if (!args.flags.yes) {
      const hasHighRisk = inspections.some((i) => i.riskLevel === "high");

      if (!process.stdin.isTTY) {
        error(
          "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
        );
        process.exit(2);
      }

      const countLabel = isBatch
        ? `${inspections.length} skills`
        : `"${inspections[0].metadata.name}"`;
      const promptText = hasHighRisk
        ? `\n  ${ansi.red("[!]")} ${ansi.bold(`Install ${countLabel}? Some have high-risk patterns.`)} [y/N] `
        : `\n  ${ansi.bold(`Install ${countLabel}?`)} [Y/n] `;
      process.stderr.write(promptText);
      const answer = await readLine();
      if (hasHighRisk) {
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      } else {
        if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
          console.error("Aborted.");
          process.exit(0);
        }
      }
    }

    // Get commit hash from cloned repo before installations (temp dir is cleaned up later)
    const commitHash = tempDir ? await getCommitHash(tempDir) : null;

    // Execute installations
    const failures: Array<{ name: string; error: string }> = [];
    for (let i = 0; i < inspections.length; i++) {
      const inspection = inspections[i];
      const progress = isBatch
        ? ansi.dim(`[${i + 1}/${inspections.length}]`) + " "
        : "  ";

      try {
        console.info(
          `${progress}Installing ${ansi.bold(inspection.metadata.name)}...`,
        );
        const result = await executeSkillInstall(inspection.plan, allProviders);
        results.push(result);
        console.info(
          `${progress}${ansi.green("✓")} ${inspection.metadata.name} installed to ${ansi.dim(inspection.plan.targetDir)}`,
        );

        // Write lock entry for tracking
        try {
          const sourceStr = isLocal
            ? `local:${source.localPath}`
            : `github:${source.owner}/${source.repo}`;
          const sourceType = isLocal
            ? ("local" as const)
            : resolutionSource === "registry"
              ? ("registry" as const)
              : ("github" as const);
          await writeLockEntry(result.name, {
            source: sourceStr,
            commitHash: commitHash || "unknown",
            ref: source.ref || "main",
            installedAt: new Date().toISOString(),
            provider: inspection.plan.providerName,
            sourceType,
            ...(resolutionSource === "registry"
              ? { registryName: result.name }
              : {}),
          });
        } catch {
          // Lock write failure is non-fatal
        }
      } catch (installErr: any) {
        failures.push({
          name: inspection.metadata.name,
          error: installErr.message,
        });
        console.error(
          `${progress}${ansi.red("✗")} ${ansi.bold(inspection.metadata.name)} — ${ansi.red(installErr.message)}`,
        );
      }
    }

    // Report summary
    // Remove signal handlers
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    if (failures.length > 0) {
      console.error(
        `\n${ansi.yellow(`${failures.length} skill(s) failed to install:`)}`,
      );
      for (const f of failures) {
        console.error(`  ${ansi.red("✗")} ${f.name}: ${f.error}`);
      }
    }

    if (args.flags.machine) {
      restoreConsole?.();
      const enriched = results.map((r) => ({
        name: r.name,
        path: r.path,
        version: r.version,
        provider: r.provider,
        source: r.source,
        resolution_source: resolutionSource,
      }));
      console.log(
        formatMachineOutput(
          "install",
          enriched.length === 1 ? enriched[0] : enriched,
          startTime,
        ),
      );
    } else if (args.flags.json) {
      const enriched = results.map((r) => ({
        ...r,
        resolutionSource: resolutionSource,
      }));
      console.log(
        JSON.stringify(enriched.length === 1 ? enriched[0] : enriched, null, 2),
      );
    } else if (results.length === 1) {
      console.error(
        ansi.green(
          `\nDone! Installed "${results[0].name}" to ${results[0].path}`,
        ),
      );
    } else if (results.length > 0) {
      console.error(
        `\n${ansi.green(`Done! Installed ${results.length} skill(s) successfully.`)}`,
      );
    }
  } catch (err: any) {
    // Remove signal handlers
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "install",
          ErrorCodes.INSTALL_FAILED,
          err.message,
          startTime,
          err?.duplicates ? { duplicates: err.duplicates } : undefined,
        ),
      );
    } else if (args.flags.json) {
      const payload: Record<string, unknown> = {
        success: false,
        error: err.message,
      };
      if (err?.duplicates) {
        payload.duplicates = err.duplicates;
      }
      console.log(JSON.stringify(payload, null, 2));
    } else {
      error(err.message);
    }
    process.exit(1);
  } finally {
    if (tempDir) {
      await cleanupTemp(tempDir);
    }
    restoreConsole?.();
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────

function printExportHelp() {
  console.log(`${ansi.bold("Usage:")} asm export [options]

Export skill inventory as a portable JSON manifest. Useful for backup,
sharing, or scripting.

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm export                        ${ansi.dim("Export all skills")}
  asm export -s global              ${ansi.dim("Export global skills only")}
  asm export > skills.json          ${ansi.dim("Save to file")}`);
}

async function cmdExport(args: ParsedArgs) {
  if (args.flags.help) {
    printExportHelp();
    return;
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const manifest = buildManifest(allSkills);
  console.log(JSON.stringify(manifest, null, 2));
}

// ─── Import ─────────────────────────────────────────────────────────────────

function printImportHelp() {
  console.log(`${ansi.bold("Usage:")} asm import <file> [options]

Import skills from a previously exported JSON manifest. Recreates skill
installations based on the manifest metadata.

Skills that already exist at the target location are skipped unless --force
is used. Skills whose source files cannot be found locally are reported as
failed — install them first with "asm install".

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  -f, --force        Overwrite existing skills
  -y, --yes          Skip confirmation prompt
  --json             Output results as JSON
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm import skills.json              ${ansi.dim("Import from manifest")}
  asm import skills.json --force      ${ansi.dim("Overwrite existing skills")}
  asm import skills.json -s global    ${ansi.dim("Import only global skills")}
  asm export > backup.json            ${ansi.dim("Export first, then import later")}
  asm import backup.json              ${ansi.dim("Restore from backup")}`);
}

async function cmdImport(args: ParsedArgs) {
  if (args.flags.help) {
    printImportHelp();
    return;
  }

  const filePath = args.subcommand;
  if (!filePath) {
    error("Missing required argument: <file>");
    console.error(`Run "asm import --help" for usage.`);
    process.exit(2);
  }

  // Resolve to absolute path
  const { resolve: resolvePath } = await import("path");
  const absPath = resolvePath(filePath);

  // Read and validate manifest
  let manifest;
  try {
    manifest = await readManifestFile(absPath);
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }

  const skillCount = manifest.skills.length;
  if (skillCount === 0) {
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          { total: 0, installed: 0, skipped: 0, failed: 0, results: [] },
          null,
          2,
        ),
      );
    } else {
      console.log("Manifest contains no skills. Nothing to import.");
    }
    return;
  }

  // Show summary before importing
  const scopeLabel =
    args.flags.scope === "both" ? "all scopes" : args.flags.scope;
  console.error(
    `${ansi.bold("Importing")} ${skillCount} skill${skillCount > 1 ? "s" : ""} from ${ansi.dim(absPath)}`,
  );
  console.error(`  Scope filter: ${scopeLabel}`);
  if (args.flags.force) {
    console.error(
      `  ${ansi.yellow("Force mode: existing skills will be overwritten")}`,
    );
  }

  // Confirm unless --yes
  if (!args.flags.yes && process.stdin.isTTY) {
    process.stderr.write(`\n${ansi.bold("Proceed?")} [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  // Run import
  const summary = await importSkills(manifest, {
    force: args.flags.force,
    dryRun: false,
    scopeFilter: args.flags.scope,
  });

  // Output results
  if (args.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Human-readable output
  if (summary.total === 0) {
    console.error(
      `\nNothing to import after scope filtering (--scope ${args.flags.scope}). All skills in the manifest were excluded.`,
    );
    return;
  }
  console.error("");
  for (const result of summary.results) {
    const icon =
      result.status === "installed"
        ? ansi.green("+++")
        : result.status === "skipped"
          ? ansi.yellow("---")
          : result.status === "dry-run"
            ? ansi.cyan("~~~")
            : ansi.red("!!!");
    const detail = result.reason ? ` ${ansi.dim(result.reason)}` : "";
    const pathInfo = result.path ? ` ${ansi.dim(result.path)}` : "";
    console.error(
      `  ${icon} ${result.skillName} (${result.provider}/${result.scope})${detail}${pathInfo}`,
    );
  }

  console.error("");
  console.error(
    `${ansi.bold("Summary:")} ${summary.total} total, ` +
      `${ansi.green(String(summary.installed))} installed, ` +
      `${ansi.yellow(String(summary.skipped))} skipped, ` +
      `${ansi.red(String(summary.failed))} failed`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────

function printInitHelp() {
  console.log(`${ansi.bold("Usage:")} asm init <name> [options]

Scaffold a new skill directory with a SKILL.md template. Creates a
ready-to-edit skill in the target tool's skill folder.

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents)
  --path <dir>           Scaffold in specified directory instead of provider path
  -f, --force            Overwrite if skill already exists
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm init my-skill                 ${ansi.dim("Scaffold (interactive tool)")}
  asm init my-skill -p claude       ${ansi.dim("Scaffold in Claude Code")}
  asm init my-skill --path ./skills ${ansi.dim("Scaffold in custom directory")}`);
}

async function cmdInit(args: ParsedArgs) {
  if (args.flags.help) {
    printInitHelp();
    return;
  }

  const name = args.subcommand;
  if (!name) {
    error("Missing required argument: <name>");
    console.error(`Run "asm init --help" for usage.`);
    process.exit(2);
  }

  // Validate name
  const safeName = sanitizeName(name);

  let targetDir: string;

  if (args.flags.path) {
    // --path flag: scaffold in specified directory
    const { resolve: resolvePath } = await import("path");
    targetDir = resolvePath(args.flags.path);
  } else {
    // Resolve provider and scaffold in provider's skill directory
    const config = await loadConfig();
    const { provider } = await resolveProvider(
      config,
      args.flags.provider,
      !!process.stdin.isTTY,
    );
    const { join: joinPath } = await import("path");
    const { resolveProviderPath } = await import("./config");
    const providerDir = resolveProviderPath(
      config.providers.find((p) => p.name === provider.name)!.global,
    );
    targetDir = joinPath(providerDir, safeName);
  }

  // Check conflict
  if (await directoryExists(targetDir)) {
    if (!args.flags.force) {
      if (!process.stdin.isTTY) {
        error(
          `Directory already exists: ${targetDir}. Use --force to overwrite.`,
        );
        process.exit(2);
      }
      process.stderr.write(
        `${ansi.yellow(`Directory already exists: ${targetDir}`)}\n${ansi.bold("Overwrite?")} [y/N] `,
      );
      const answer = await readLine();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.error("Aborted.");
        process.exit(0);
      }
    }
  }

  await scaffoldSkill(safeName, targetDir);
  console.error(
    ansi.green(`Done! Created skill "${safeName}" at ${targetDir}`),
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function printStatsHelp() {
  console.log(`${ansi.bold("Usage:")} asm stats [options]

Show aggregate skill metrics with provider distribution charts,
scope breakdown, disk usage, and duplicate summary.

${ansi.bold("Options:")}
  --json             Output as JSON
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm stats                         ${ansi.dim("Show full dashboard")}
  asm stats -s global               ${ansi.dim("Global skills only")}
  asm stats --json                  ${ansi.dim("Output raw data as JSON")}`);
}

async function cmdStats(args: ParsedArgs) {
  if (args.flags.help) {
    printStatsHelp();
    return;
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  if (allSkills.length === 0) {
    console.log("No skills found.");
    return;
  }

  const duplicates = detectDuplicates(allSkills);
  const report = await computeStats(allSkills, duplicates);

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

// ─── Doctor ─────────────────────────────────────────────────────────────────

function printDoctorHelp() {
  console.log(`${ansi.bold("Usage:")} asm doctor [options]

Run environment health checks and diagnostics. Validates all
prerequisites for using asm — git, GitHub CLI, Node.js, config,
lock file, registry, installed skills, and disk space.

${ansi.bold("Options:")}
  --json               Output as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm doctor                        ${ansi.dim("Run all health checks")}
  asm doctor --json                 ${ansi.dim("Output as JSON")}
  asm doctor --machine              ${ansi.dim("Machine-readable v1 envelope output")}`);
}

async function cmdDoctor(args: ParsedArgs) {
  if (args.flags.help) {
    printDoctorHelp();
    return;
  }

  const startTime = performance.now();
  const report = await runAllChecks();

  if (args.flags.machine) {
    const data = {
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
      passed: report.passed,
      warnings: report.warnings,
      failures: report.failures,
    };
    console.log(formatMachineOutput("doctor", data, startTime));
  } else if (args.flags.json) {
    console.log(formatDoctorJSON(report));
  } else {
    console.log(formatDoctorReport(report));
  }

  if (report.failures > 0) {
    process.exit(1);
  }
}

// ─── Eval ───────────────────────────────────────────────────────────────────

function printEvalHelp() {
  console.log(`${ansi.bold("Usage:")} asm eval <skill-path> [options]

Evaluate a skill's SKILL.md against best practices and produce a scored quality
report. Categories: structure, description quality, prompt engineering, context
efficiency, safety, testability, and naming conventions.

The evaluation runs through the ${ansi.bold("eval provider framework")}; ${ansi.bold("asm eval")} uses the
${ansi.bold("quality")} provider by default, or the ${ansi.bold("skillgrade")} runtime provider with
${ansi.bold("--runtime")}. Use ${ansi.bold("asm eval-providers list")} to see available providers.

${ansi.bold("Arguments:")}
  skill-path           Path to a skill directory (must contain SKILL.md)

${ansi.bold("Options:")}
  --fix                Apply deterministic auto-fixes to SKILL.md (creates .bak)
  --dry-run            With --fix, preview the diff without writing
  --runtime            Run the skillgrade runtime provider (LLM-judge evals)
  --runtime init       Scaffold eval.yaml via \`skillgrade init\`
  --preset <name>      Skillgrade preset: smoke | reliable | regression
  --threshold <n>      Pass threshold (0..1 fraction or 0..100 integer)
  --provider <name>    Skillgrade exec provider: docker | local
  --compare <specs>    Diff two provider versions on the same skill
                       (format: id@v1,id@v2 — see Examples below)
  --json               Output report as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm eval ./my-skill                     ${ansi.dim("Static quality score")}
  asm eval ./my-skill --json              ${ansi.dim("Output report as JSON")}
  asm eval ./my-skill --fix               ${ansi.dim("Auto-fix deterministic frontmatter issues")}
  asm eval ./my-skill --fix --dry-run     ${ansi.dim("Preview fixes as diff")}
  asm eval ./my-skill --machine           ${ansi.dim("Machine-readable v1 envelope output")}
  asm eval ./my-skill --runtime           ${ansi.dim("Run skillgrade runtime evals")}
  asm eval ./my-skill --runtime init      ${ansi.dim("Scaffold eval.yaml via skillgrade init")}
  asm eval ./my-skill --runtime --preset reliable --threshold 0.9
  asm eval ./my-skill --compare quality@1.0.0,quality@1.0.0
                                          ${ansi.dim("Diff two provider versions (upgrade safety)")}
  asm eval-providers list                 ${ansi.dim("List registered eval providers")}`);
}

// Idempotency guard: `register()` throws on duplicate (id, version) so we only
// call `registerBuiltins()` once per process lifetime. cmdEval and
// cmdEvalProviders both call `ensureEvalBuiltins()` at entry; tests that reset
// the registry directly are responsible for their own registration.
let _evalBuiltinsRegistered = false;
function ensureEvalBuiltins(): void {
  if (_evalBuiltinsRegistered) return;
  registerBuiltins();
  _evalBuiltinsRegistered = true;
}

/**
 * If a `runProvider()` result carries an error-shaped finding (the runner's
 * error-wrap path), re-throw so the existing catch block in `cmdEval` keeps
 * producing the same SKILL_NOT_FOUND machine envelope + exit 1 it did before
 * the framework was wired in.
 *
 * The runner emits `code: "provider-threw" | "timeout" | "aborted"` — any of
 * those is treated as a thrown error for output parity.
 */
function unwrapRunnerErrorOrThrow(result: {
  findings: { severity: string; message: string; code?: string }[];
}): void {
  const err = result.findings.find(
    (f) =>
      f.severity === "error" &&
      (f.code === "provider-threw" ||
        f.code === "timeout" ||
        f.code === "aborted"),
  );
  if (err) throw new Error(err.message);
}

async function cmdEval(args: ParsedArgs) {
  if (args.flags.help) {
    printEvalHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;
  const startTime = performance.now();

  // Path is the first positional (carried as `subcommand` by parseArgs).
  const skillPath = args.subcommand;
  if (!skillPath) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "eval",
          ErrorCodes.INVALID_ARGUMENT,
          "Missing required argument: <skill-path>",
          startTime,
        ),
      );
      process.exit(2);
    }
    error("Missing required argument: <skill-path>");
    console.error(`Run "asm eval --help" for usage.`);
    process.exit(2);
  }

  try {
    // --compare: run two explicitly-pinned providers against the same
    // skill and render a diff. Provider-agnostic on purpose — the CLI
    // doesn't inject `--runtime` semantics here; the user pins the
    // exact (id, version) pairs they want to compare.
    if (args.flags.compare !== null) {
      const [beforeSpec, afterSpec] = parseCompareArg(args.flags.compare);
      ensureEvalBuiltins();
      const { resolve: resolvePath } = await import("path");
      const absSkillPath = resolvePath(skillPath);
      const ctx = {
        skillPath: absSkillPath,
        skillMdPath: resolvePath(absSkillPath, "SKILL.md"),
      };

      // Exact-match resolution via the registry's "X.Y.Z" range shape —
      // lets the aspirational `skillgrade@2.0.0-next` spec produce a
      // clean "no version satisfies …" error instead of silently
      // matching a nearby range.
      const beforeProvider = resolveEvalProvider(
        beforeSpec.id,
        beforeSpec.version,
      );
      const afterProvider = resolveEvalProvider(
        afterSpec.id,
        afterSpec.version,
      );

      // Merge opts from the same channels as the single-provider path so
      // `--compare` respects --preset/--provider/--threshold and the
      // ~/.asm/config.yml defaults for the provider being compared.
      // Kept intentionally simple: we pass the same opts to both sides.
      const compareOpts: Record<string, unknown> = {};
      try {
        const evalConfig = await loadEvalConfig();
        const defaultTimeout = evalConfig.defaults.timeoutMs;
        if (typeof defaultTimeout === "number" && defaultTimeout > 0) {
          compareOpts.timeoutMs = defaultTimeout;
        }
      } catch (err: any) {
        throw new Error(
          `failed to load ~/.asm/config.yml: ${err?.message ?? String(err)}`,
        );
      }
      if (args.flags.preset) compareOpts.preset = args.flags.preset;
      if (args.flags.provider) compareOpts.provider = args.flags.provider;
      if (args.flags.threshold !== null) {
        compareOpts.threshold = args.flags.threshold;
      }

      // Run sequentially — some providers (skillgrade) aren't safe to
      // run in parallel against the same skill dir (shared eval.yaml
      // state, Docker port contention). Two serial runs is the simpler
      // safe default; providers can opt into parallelism later.
      const beforeResult = await runProvider(beforeProvider, ctx, compareOpts);
      const afterResult = await runProvider(afterProvider, ctx, compareOpts);

      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineOutput(
            "eval",
            {
              before: {
                provider_id: beforeResult.providerId,
                provider_version: beforeResult.providerVersion,
                schema_version: beforeResult.schemaVersion,
                score: beforeResult.score,
                passed: beforeResult.passed,
                categories: beforeResult.categories,
                findings: beforeResult.findings,
              },
              after: {
                provider_id: afterResult.providerId,
                provider_version: afterResult.providerVersion,
                schema_version: afterResult.schemaVersion,
                score: afterResult.score,
                passed: afterResult.passed,
                categories: afterResult.categories,
                findings: afterResult.findings,
              },
            },
            startTime,
          ),
        );
        // Exit code reflects the newer version's pass state — matches
        // the single-provider path's semantics.
        process.exit(afterResult.passed ? 0 : 1);
      }

      if (args.flags.json) {
        console.log(
          JSON.stringify({ before: beforeResult, after: afterResult }, null, 2),
        );
        process.exit(afterResult.passed ? 0 : 1);
      }

      const diff = compareResults(beforeResult, afterResult, {
        useColor: !args.flags.noColor,
      });
      console.log(diff);
      process.exit(afterResult.passed ? 0 : 1);
    }

    if (args.flags.fix) {
      // --fix stays on applyFix() directly. Auto-fix is quality-provider
      // specific — we do not expose it via provider capability yet; wait
      // until a second provider needs the same surface.
      const gitAuthor = await detectGitAuthor();
      const fix = await applyFix(skillPath, {
        dryRun: args.flags.dryRun,
        gitAuthor,
      });

      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineOutput(
            "eval",
            buildEvalMachineData(fix.report, fix),
            startTime,
          ),
        );
        return;
      }

      if (args.flags.json) {
        console.log(
          JSON.stringify(
            {
              report: fix.report,
              fix: {
                dryRun: fix.dryRun,
                applied: fix.applied,
                skipped: fix.skipped,
                backupPath: fix.backupPath,
                diff: fix.diff,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(formatReport(fix.report));
      console.log("");
      console.log(formatFixPreview(fix));
      return;
    }

    // --runtime branch: skillgrade provider. A second positional arg `init`
    // means scaffold-instead-of-run (no subcommand nesting; positional is
    // the cheapest surface). `--provider` in this branch is validated to
    // `docker|local` — other commands reuse the flag for install/audit
    // providers so we can't validate globally in the parser.
    if (args.flags.runtime) {
      const { resolve: resolvePath } = await import("path");
      const absSkillPath = resolvePath(skillPath);

      // Positional "init" → scaffold eval.yaml then exit.
      if (args.positional[0] === "init") {
        const scaffoldRes = await scaffoldEvalYaml({
          skillPath: absSkillPath,
        });
        if (args.flags.machine) {
          restoreConsole?.();
          console.log(
            formatMachineOutput(
              "eval",
              {
                action: "scaffold",
                ok: scaffoldRes.ok,
                exit_code: scaffoldRes.exitCode,
                message: scaffoldRes.message,
              },
              startTime,
            ),
          );
          process.exit(scaffoldRes.ok ? 0 : 1);
        }
        if (args.flags.json) {
          console.log(JSON.stringify(scaffoldRes, null, 2));
          process.exit(scaffoldRes.ok ? 0 : 1);
        }
        if (scaffoldRes.ok) {
          console.log(scaffoldRes.message);
        } else {
          error(scaffoldRes.message);
        }
        process.exit(scaffoldRes.ok ? 0 : 1);
      }

      // Validate --provider in runtime context (shared flag, different
      // domain than install/audit providers).
      if (
        args.flags.provider !== null &&
        args.flags.provider !== "docker" &&
        args.flags.provider !== "local"
      ) {
        error(
          `Invalid --provider for --runtime: "${args.flags.provider}". Must be docker or local.`,
        );
        process.exit(2);
      }
      // Validate --preset.
      if (
        args.flags.preset !== null &&
        args.flags.preset !== "smoke" &&
        args.flags.preset !== "reliable" &&
        args.flags.preset !== "regression"
      ) {
        error(
          `Invalid --preset: "${args.flags.preset}". Must be smoke, reliable, or regression.`,
        );
        process.exit(2);
      }

      ensureEvalBuiltins();
      const runtimeProvider = resolveEvalProvider("skillgrade", "^1.0.0");
      const ctx = {
        skillPath: absSkillPath,
        skillMdPath: resolvePath(absSkillPath, "SKILL.md"),
      };

      // Merge config → CLI flags (CLI wins). Keeps `~/.asm/config.yml
      // eval.providers.skillgrade.{preset, threshold, provider}` live
      // without forcing the user to repeat themselves on every invocation.
      // Missing file / missing section → defaults (no-op).
      const runtimeOpts: Record<string, unknown> = {};
      try {
        const evalConfig = await loadEvalConfig();
        const sgConfig = evalConfig.providers.skillgrade;
        if (sgConfig) {
          if (typeof sgConfig.preset === "string") {
            runtimeOpts.preset = sgConfig.preset;
          }
          if (typeof sgConfig.threshold === "number") {
            runtimeOpts.threshold = sgConfig.threshold;
          }
          if (sgConfig.provider === "docker" || sgConfig.provider === "local") {
            runtimeOpts.provider = sgConfig.provider;
          }
        }
        const defaultTimeout = evalConfig.defaults.timeoutMs;
        if (typeof defaultTimeout === "number" && defaultTimeout > 0) {
          runtimeOpts.timeoutMs = defaultTimeout;
        }
      } catch (err: any) {
        // Malformed YAML should be loud — don't swallow silently. Re-throw
        // so the outer catch surfaces it as a normal eval error.
        throw new Error(
          `failed to load ~/.asm/config.yml: ${err?.message ?? String(err)}`,
        );
      }
      // CLI flags take precedence over config values.
      if (args.flags.preset) runtimeOpts.preset = args.flags.preset;
      if (args.flags.provider) runtimeOpts.provider = args.flags.provider;
      if (args.flags.threshold !== null) {
        runtimeOpts.threshold = args.flags.threshold;
      }

      // Surface applicable() reasons verbatim — binary missing, version
      // out of range, eval.yaml missing each have a distinct hint.
      const ok = await runtimeProvider.applicable(ctx, runtimeOpts);
      if (!ok.ok) {
        if (args.flags.machine) {
          restoreConsole?.();
          console.log(
            formatMachineError(
              "eval",
              ErrorCodes.INVALID_ARGUMENT,
              ok.reason ?? "skillgrade provider not applicable",
              startTime,
            ),
          );
          process.exit(1);
        }
        error(ok.reason ?? "skillgrade provider not applicable");
        process.exit(1);
      }

      const runtimeResult = await runProvider(
        runtimeProvider,
        ctx,
        runtimeOpts,
      );

      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineOutput(
            "eval",
            {
              provider_id: runtimeResult.providerId,
              provider_version: runtimeResult.providerVersion,
              schema_version: runtimeResult.schemaVersion,
              score: runtimeResult.score,
              passed: runtimeResult.passed,
              categories: runtimeResult.categories,
              findings: runtimeResult.findings,
            },
            startTime,
          ),
        );
        process.exit(runtimeResult.passed ? 0 : 1);
      }

      if (args.flags.json) {
        console.log(JSON.stringify(runtimeResult, null, 2));
        process.exit(runtimeResult.passed ? 0 : 1);
      }

      // Default rendering — concise runtime summary. The quality provider's
      // rich report formatter is specific to the static linter; runtime
      // output is simpler.
      const status = runtimeResult.passed
        ? ansi.green("PASS")
        : ansi.red("FAIL");
      console.log(
        `${ansi.bold("Skillgrade runtime:")} ${status} score=${runtimeResult.score}/100`,
      );
      if (runtimeResult.categories.length > 0) {
        console.log("");
        console.log(ansi.bold("Tasks:"));
        for (const c of runtimeResult.categories) {
          console.log(`  ${c.name}: ${c.score}/${c.max} (${c.id})`);
        }
      }
      if (runtimeResult.findings.length > 0) {
        console.log("");
        console.log(ansi.bold("Findings:"));
        for (const f of runtimeResult.findings) {
          const sev =
            f.severity === "error"
              ? ansi.red(f.severity)
              : f.severity === "warning"
                ? ansi.yellow(f.severity)
                : ansi.dim(f.severity);
          console.log(`  [${sev}] ${f.message}`);
        }
      }
      process.exit(runtimeResult.passed ? 0 : 1);
    }

    // Non-fix path: run through the eval framework.
    ensureEvalBuiltins();
    const provider = resolveEvalProvider("quality", "^1.0.0");
    const { resolve: resolvePath } = await import("path");
    const absSkillPath = resolvePath(skillPath);
    const result = await runProvider(provider, {
      skillPath: absSkillPath,
      skillMdPath: resolvePath(absSkillPath, "SKILL.md"),
    });

    // Preserve pre-existing behavior on failure paths: runner wraps thrown
    // errors into an error-shaped EvalResult; re-throw so the catch block
    // below emits the same SKILL_NOT_FOUND envelope + exit 1 as before.
    unwrapRunnerErrorOrThrow(result);

    // `raw` holds the original EvaluationReport — the adapter stores it
    // verbatim (src/eval/providers/quality/v1/index.ts). Byte-identical
    // rendering requires passing this through to the existing formatters.
    const report = result.raw as EvaluationReport;

    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineOutput(
          "eval",
          buildEvalMachineData(report, null),
          startTime,
        ),
      );
      return;
    }

    if (args.flags.json) {
      console.log(formatReportJSON(report));
      return;
    }

    console.log(formatReport(report));
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "eval",
          ErrorCodes.SKILL_NOT_FOUND,
          err?.message ?? String(err),
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err?.message ?? String(err));
    process.exit(1);
  }
}

// ─── Eval providers ─────────────────────────────────────────────────────────

function printEvalProvidersHelp() {
  console.log(`${ansi.bold("Usage:")} asm eval-providers <subcommand> [options]

Manage evaluation providers registered with the ${ansi.bold("asm eval")} framework.
Providers implement the ${ansi.bold("EvalProvider")} contract (see src/eval/types.ts) and
are resolved by id and semver range.

${ansi.bold("Subcommands:")}
  list                 List every registered (id, version) provider

${ansi.bold("Options:")}
  --json               Output as JSON (list)
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm eval-providers list              ${ansi.dim("Show registered providers")}
  asm eval-providers list --json       ${ansi.dim("Machine-readable listing")}`);
}

async function cmdEvalProviders(args: ParsedArgs) {
  if (args.flags.help) {
    printEvalProvidersHelp();
    return;
  }

  const subcommand = args.subcommand;
  if (!subcommand) {
    error("Missing subcommand. Use: list");
    console.error(`Run "asm eval-providers --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "list": {
      ensureEvalBuiltins();
      const providers = listEvalProviders();

      if (args.flags.json) {
        console.log(
          formatJSON(
            providers.map((p) => ({
              id: p.id,
              version: p.version,
              schemaVersion: p.schemaVersion,
              description: p.description,
              requires: p.requires ?? [],
            })),
          ),
        );
        return;
      }

      if (providers.length === 0) {
        console.log("No eval providers registered.");
        return;
      }

      // Build a plain-text table. Widths are computed from the data so the
      // columns align whether we print one provider or ten.
      const headers = [
        "id",
        "version",
        "schemaVersion",
        "description",
        "requires",
      ];
      const rows = providers.map((p) => [
        p.id,
        p.version,
        String(p.schemaVersion),
        p.description,
        p.requires && p.requires.length > 0 ? p.requires.join(",") : "-",
      ]);
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => r[i]!.length)),
      );
      const renderRow = (cells: string[]) =>
        cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
      console.log(ansi.bold(renderRow(headers)));
      console.log(widths.map((w) => "-".repeat(w)).join("  "));
      for (const row of rows) {
        console.log(renderRow(row));
      }
      return;
    }
    default:
      error(`Unknown eval-providers subcommand: "${subcommand}". Use: list`);
      console.error(`Run "asm eval-providers --help" for usage.`);
      process.exit(2);
  }
}

// ─── Link ───────────────────────────────────────────────────────────────────

function printLinkHelp() {
  console.log(`${ansi.bold("Usage:")} asm link <path> [<path2> ...] [options]

Symlink a local skill directory into an agent's skill folder. Useful
for local development — changes to the source are reflected immediately.

If <path> contains a SKILL.md at its root, it is linked as a single skill.
If <path> has no root SKILL.md but contains subdirectories with SKILL.md
files, all discovered skills are linked in a single invocation.

Multiple paths can be provided to link several skills at once.

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents)
  --name <name>          Override symlink name (single skill only)
  -f, --force            Overwrite if target already exists
  --json                 Output as JSON
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm link ./my-skill                          ${ansi.dim("Link (interactive tool)")}
  asm link ./my-skill -p claude                ${ansi.dim("Link to Claude Code")}
  asm link ./my-skill --name alias             ${ansi.dim("Link with custom name")}
  asm link ./my-skills-folder                  ${ansi.dim("Link all skills in folder")}
  asm link ./skill1 ./skill2 ./skill3 -p claude ${ansi.dim("Link multiple skills at once")}`);
}

/**
 * Prompt the user to confirm overwrite if the target already exists.
 * Returns the effective force flag (true if user confirmed or force was already set).
 * Throws if the user declines or stdin is not a TTY.
 */
/**
 * Checks whether the target already exists and, if so, asks the user to
 * confirm the overwrite (in TTY mode) or throws (in non-TTY mode).
 *
 * Returns `shouldForce`: `true` when the caller must pass `force=true`
 * to `createLink` (i.e. target exists and user confirmed, or `force`
 * was already set), `false` when the target does not exist and no
 * force is needed.
 */
async function confirmOverwriteIfNeeded(
  targetPath: string,
  force: boolean,
): Promise<boolean> {
  if (force) return true;

  const { access: fsAccess } = await import("fs/promises");
  let exists = false;
  try {
    await fsAccess(targetPath);
    exists = true;
  } catch {
    // doesn't exist
  }

  if (!exists) return false;

  if (!process.stdin.isTTY) {
    throw new Error(
      `Target already exists: ${targetPath}. Use --force to overwrite.`,
    );
  }

  process.stderr.write(
    `${ansi.yellow(`Target already exists: ${targetPath}`)}\n${ansi.bold("Overwrite?")} [y/N] `,
  );
  const answer = await readLine();
  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    console.error("Aborted.");
    process.exit(0);
  }
  return true;
}

/** Link a single skill source to the provider directory. */
async function linkSingleSkill(
  absSourcePath: string,
  providerDir: string,
  linkName: string,
  force: boolean,
): Promise<{ name: string; symlinkPath: string; targetPath: string }> {
  const { join: joinPath } = await import("path");
  const targetPath = joinPath(providerDir, linkName);

  const shouldForce = await confirmOverwriteIfNeeded(targetPath, force);
  await createLink(absSourcePath, providerDir, linkName, shouldForce);

  return { name: linkName, symlinkPath: targetPath, targetPath: absSourcePath };
}

async function cmdLink(args: ParsedArgs) {
  if (args.flags.help) {
    printLinkHelp();
    return;
  }

  // Collect all source paths: subcommand + remaining positional args
  const sourcePaths: string[] = [];
  if (args.subcommand) sourcePaths.push(args.subcommand);
  sourcePaths.push(...args.positional);

  if (sourcePaths.length === 0) {
    error("Missing required argument: <path>");
    console.error(`Run "asm link --help" for usage.`);
    process.exit(2);
  }

  // When multiple explicit paths are provided, run each as a separate link operation
  if (sourcePaths.length > 1) {
    // --name is not supported with multiple explicit paths
    if (args.flags.name) {
      error(
        `--name cannot be used when linking multiple paths. ` +
          `Link each skill individually to use --name.`,
      );
      process.exit(2);
    }

    // Resolve provider once for all paths
    const config = await loadConfig();
    const { provider } = await resolveProvider(
      config,
      args.flags.provider,
      !!process.stdin.isTTY,
    );

    const { resolveProviderPath } = await import("./config");
    const providerDir = resolveProviderPath(
      config.providers.find((p) => p.name === provider.name)!.global,
    );

    const { resolve: resolvePath, basename } = await import("path");

    const allResults: Array<{
      name: string;
      symlinkPath: string;
      targetPath: string;
    }> = [];
    const allFailures: Array<{ name: string; error: string }> = [];

    for (const sourcePath of sourcePaths) {
      const absSourcePath = resolvePath(sourcePath);

      // Determine single-skill vs multi-skill mode
      let isSingleSkill = false;
      try {
        await validateLinkSource(absSourcePath);
        isSingleSkill = true;
      } catch {
        // Not a single-skill directory — try multi-skill
      }

      if (isSingleSkill) {
        const linkName = basename(absSourcePath);
        try {
          const result = await linkSingleSkill(
            absSourcePath,
            providerDir,
            linkName,
            !!args.flags.force,
          );
          allResults.push(result);
          if (!args.flags.json) {
            console.error(
              ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          allFailures.push({ name: linkName, error: msg });
          if (!args.flags.json) {
            console.error(ansi.red(`  Failed to link "${linkName}": ${msg}`));
          }
        }
      } else {
        // Discover skills in the directory
        let discovered: Awaited<ReturnType<typeof discoverLinkableSkills>> = [];
        try {
          discovered = await discoverLinkableSkills(absSourcePath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          allFailures.push({ name: sourcePath, error: msg });
          if (!args.flags.json) {
            console.error(
              ansi.red(`  Failed to process "${sourcePath}": ${msg}`),
            );
          }
          continue;
        }

        if (discovered.length === 0) {
          const msg = `No SKILL.md found in ${absSourcePath} or its immediate subdirectories.`;
          allFailures.push({ name: sourcePath, error: msg });
          if (!args.flags.json) {
            console.error(ansi.red(`  ${msg}`));
          }
          continue;
        }

        for (const skill of discovered) {
          try {
            const result = await linkSingleSkill(
              skill.absPath,
              providerDir,
              skill.dirName,
              !!args.flags.force,
            );
            allResults.push(result);
            if (!args.flags.json) {
              console.error(
                ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            allFailures.push({ name: skill.name, error: msg });
            if (!args.flags.json) {
              console.error(
                ansi.red(`  Failed to link "${skill.name}": ${msg}`),
              );
            }
          }
        }
      }
    }

    if (args.flags.json) {
      console.log(
        formatJSON({
          success: allFailures.length === 0,
          linked: allResults,
          failures: allFailures,
        }),
      );
    } else {
      if (allFailures.length > 0) {
        console.error(
          ansi.yellow(
            `\n${allResults.length} linked, ${allFailures.length} failed.`,
          ),
        );
      } else {
        console.error(
          ansi.green(
            `\nDone! Linked ${allResults.length} skill(s) successfully.`,
          ),
        );
      }
    }

    if (allFailures.length > 0) {
      process.exit(1);
    }
    return;
  }

  // ── Single path provided (original behavior) ──

  const sourcePath = sourcePaths[0];
  const { resolve: resolvePath, basename } = await import("path");
  const absSourcePath = resolvePath(sourcePath);

  // Determine single-skill vs multi-skill mode before resolving the provider
  let isSingleSkill = false;
  try {
    await validateLinkSource(absSourcePath);
    isSingleSkill = true;
  } catch {
    // Not a single-skill directory — check for multi-skill below
  }

  // Multi-skill: discover and validate early (before provider resolution)
  let discovered: Awaited<ReturnType<typeof discoverLinkableSkills>> = [];
  if (!isSingleSkill) {
    discovered = await discoverLinkableSkills(absSourcePath);

    if (discovered.length === 0) {
      error(
        `No SKILL.md found in ${absSourcePath} or its immediate subdirectories.`,
      );
      process.exit(1);
    }

    // --name is not allowed when multiple skills are discovered
    if (args.flags.name && discovered.length > 1) {
      error(
        `--name cannot be used when linking multiple skills (found ${discovered.length} skills). ` +
          `Link each skill individually to use --name.`,
      );
      process.exit(2);
    }
  }

  // Resolve provider (shared for single and multi)
  const config = await loadConfig();
  const { provider } = await resolveProvider(
    config,
    args.flags.provider,
    !!process.stdin.isTTY,
  );

  const { resolveProviderPath } = await import("./config");
  const providerDir = resolveProviderPath(
    config.providers.find((p) => p.name === provider.name)!.global,
  );

  if (isSingleSkill) {
    // ── Single-skill mode (existing behavior) ──
    const linkName = args.flags.name
      ? sanitizeName(args.flags.name)
      : basename(absSourcePath);

    let result: Awaited<ReturnType<typeof linkSingleSkill>>;
    try {
      result = await linkSingleSkill(
        absSourcePath,
        providerDir,
        linkName,
        !!args.flags.force,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.flags.json) {
        console.log(formatJSON({ success: false, error: msg }));
      } else {
        error(msg);
      }
      process.exit(2);
    }

    if (args.flags.json) {
      console.log(formatJSON({ success: true, ...result }));
    } else {
      console.error(
        ansi.green(`Done! Linked "${result.name}" -> ${result.targetPath}`),
      );
      console.error(`  Symlink: ${result.symlinkPath}`);
      console.error(
        ansi.dim(
          `  If you move or delete the source, run "asm uninstall ${result.name}" to clean up.`,
        ),
      );
    }
    return;
  }

  // ── Multi-skill mode ──

  // Display discovered skills
  console.error(
    `Found ${ansi.bold(String(discovered.length))} skill(s) in ${absSourcePath}:`,
  );
  for (const skill of discovered) {
    console.error(
      `  ${ansi.bold(skill.name)} ${ansi.dim(`v${skill.version}`)} ${ansi.dim(`(${skill.dirName}/)`)}`,
    );
  }

  // Confirmation prompt in interactive mode
  if (process.stdin.isTTY && !args.flags.force) {
    process.stderr.write(
      `\n${ansi.bold(`Link ${discovered.length} skill(s)?`)} [Y/n] `,
    );
    const answer = await readLine();
    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  // Link each skill
  const results: Array<{
    name: string;
    symlinkPath: string;
    targetPath: string;
  }> = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const skill of discovered) {
    const linkName =
      args.flags.name && discovered.length === 1
        ? sanitizeName(args.flags.name)
        : skill.dirName;

    try {
      const result = await linkSingleSkill(
        skill.absPath,
        providerDir,
        linkName,
        !!args.flags.force,
      );
      results.push(result);
      if (!args.flags.json) {
        console.error(
          ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ name: skill.name, error: msg });
      if (!args.flags.json) {
        console.error(ansi.red(`  Failed to link "${skill.name}": ${msg}`));
      }
    }
  }

  if (args.flags.json) {
    console.log(
      formatJSON({
        success: failures.length === 0,
        linked: results,
        failures,
      }),
    );
  } else {
    if (failures.length > 0) {
      console.error(
        ansi.yellow(`\n${results.length} linked, ${failures.length} failed.`),
      );
    } else {
      console.error(
        ansi.green(`\nDone! Linked ${results.length} skill(s) successfully.`),
      );
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

function printIndexHelp() {
  console.log(`${ansi.bold("Usage:")} asm index <subcommand> [options]

Manage the skill index for searching available skills from indexed repos.

${ansi.bold("Subcommands:")}
  ingest <repo>     Ingest a skill repository into the index
  search <query>   Search indexed skills by name or description
  list             List all indexed repositories
  remove <owner/repo>  Remove a repo from the index

${ansi.bold("Options:")}
  --json           Output as JSON
  --has <field>    Only show skills that have <field> (license, creator, version)
  --missing <field> Only show skills missing <field> (license, creator, version)
  -y, --yes        Skip confirmation prompts
  --no-color       Disable ANSI colors
  -V, --verbose    Show debug output

${ansi.bold("Examples:")}
  asm index ingest github:obra/superpowers          ${ansi.dim("Index superpowers repo")}
  asm index search code review                       ${ansi.dim("Search for skills")}
  asm index search marketing --has license           ${ansi.dim("Only with license")}
  asm index search "" --missing creator              ${ansi.dim("Skills missing creator")}
  asm index list                                    ${ansi.dim("List indexed repos")}
  asm index remove obra/superpowers                 ${ansi.dim("Remove from index")}`);
}

async function cmdIndex(args: ParsedArgs) {
  if (args.flags.help) {
    printIndexHelp();
    return;
  }

  const subcommand = args.subcommand;

  if (!subcommand) {
    error("Missing subcommand. Use: ingest, search, list, or remove");
    console.error(`Run "asm index --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "ingest": {
      const repo = args.positional[0];
      if (!repo) {
        error("Missing required argument: <repo>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      console.error(ansi.blueBold(`Ingesting ${repo}...`));
      const result = await ingestRepo(repo);

      if (!result.success) {
        error(`Failed to ingest: ${result.error}`);
        process.exit(1);
      }

      if (result.repoIndex) {
        if (args.flags.json) {
          console.log(
            formatJSON({
              success: true,
              owner: result.repoIndex.owner,
              repo: result.repoIndex.repo,
              skillCount: result.repoIndex.skillCount,
              updatedAt: result.repoIndex.updatedAt,
            }),
          );
        } else {
          console.error(
            ansi.green(
              `Successfully indexed ${result.repoIndex.owner}/${result.repoIndex.repo}`,
            ),
          );
          console.error(`  Skills found: ${result.repoIndex.skillCount}`);
        }
      }
      break;
    }

    case "search": {
      const query = args.positional.join(" ");
      if (
        !query &&
        args.flags.has.length === 0 &&
        args.flags.missing.length === 0
      ) {
        error("Missing required argument: <query>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      const filters: SearchFilters = {};
      if (args.flags.has.length > 0) {
        filters.has = args.flags.has;
      }
      if (args.flags.missing.length > 0) {
        filters.missing = args.flags.missing;
      }

      const hasFilters = filters.has || filters.missing;
      const results = hasFilters
        ? await searchIndexSkills(query || "", 20, filters)
        : await searchIndexSkills(query);

      if (results.length === 0) {
        if (args.flags.json) {
          console.log(formatJSON([]));
        } else {
          console.info("No skills found matching your query.");
          console.error(
            ansi.dim("Try ingesting more repos with: asm index ingest <repo>"),
          );
        }
        return;
      }

      if (args.flags.json) {
        console.log(
          formatJSON(
            results.map((r) => ({
              name: r.skill.name,
              description: r.skill.description,
              version: r.skill.version,
              license: r.skill.license || "",
              creator: r.skill.creator || "",
              compatibility: r.skill.compatibility || "",
              allowedTools: r.skill.allowedTools || [],
              verified: r.skill.verified === true,
              installUrl: r.skill.installUrl,
              installCommand: `asm install ${r.skill.installUrl}`,
              repo: `${r.repo.owner}/${r.repo.repo}`,
            })),
          ),
        );
      } else {
        console.error(ansi.bold(`Found ${results.length} skills:\n`));
        for (const result of results) {
          const verifiedTag = result.skill.verified
            ? ansi.blue(" [verified]")
            : "";
          console.error(
            `${ansi.cyan(result.skill.name)} ${ansi.dim(`v${result.skill.version}`)}${verifiedTag} ${ansi.dim(`[${result.repo.owner}/${result.repo.repo}]`)}`,
          );
          for (const dl of wordWrap(result.skill.description, 80)) {
            console.error(`  ${dl}`);
          }
          const missingFields = getMissingMetadataFields(result.skill);
          if (missingFields.length > 0) {
            console.error(
              `  ${ansi.yellow(`⚠ Missing: ${missingFields.join(", ")}`)}`,
            );
          }
          console.error(
            `  ${ansi.green(`asm install ${result.skill.installUrl}`)}\n`,
          );
        }
      }
      break;
    }

    case "list": {
      const repos = await listIndexedRepos();

      if (repos.length === 0) {
        if (args.flags.json) {
          console.log(formatJSON([]));
        } else {
          console.info("No repositories indexed.");
          console.error(ansi.dim("Add repos with: asm index ingest <repo>"));
        }
        return;
      }

      const totalSkills = await getTotalSkillCount();

      if (args.flags.json) {
        console.log(formatJSON(repos));
      } else {
        console.error(
          ansi.bold(`Indexed Repositories (${totalSkills} total skills):\n`),
        );
        for (const repo of repos) {
          console.error(
            `${ansi.cyan(`${repo.owner}/${repo.repo}`)} - ${repo.skillCount} skills ${ansi.dim(`(${new Date(repo.updatedAt).toLocaleDateString()})`)}`,
          );
        }
      }
      break;
    }

    case "remove": {
      const ownerRepo = args.positional[0];
      if (!ownerRepo) {
        error("Missing required argument: <owner/repo>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      const [owner, repo] = ownerRepo.split("/");
      if (!owner || !repo) {
        error("Invalid format. Use: <owner/repo>");
        process.exit(2);
      }

      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `${ansi.bold("Remove")} ${ansi.cyan(`${owner}/${repo}`)} ${ansi.bold("from index?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      const removed = await removeRepoIndex(owner, repo);

      if (removed) {
        console.error(ansi.green(`Removed ${owner}/${repo} from index`));
      } else {
        error(`Repository not found in index: ${owner}/${repo}`);
        process.exit(1);
      }
      break;
    }

    default:
      error(`Unknown subcommand: "${subcommand}"`);
      console.error(`Run "asm index --help" for usage.`);
      process.exit(2);
  }
}

// ─── Bundle ────────────────────────────────────────────────────────────────

function printBundleHelp() {
  console.log(`${ansi.bold("Usage:")} asm bundle <subcommand> [options]

Create, install, and manage curated skill bundles. A bundle is a reusable
recipe of skills for a particular workflow, domain, or project setup.

${ansi.bold("Subcommands:")}
  create <name>          Create a new bundle from installed skills
  install <name|file>    Install all skills from a bundle
  list                   List all saved bundles
  show <name|file>       Show bundle details
  remove <name>          Remove a saved bundle

${ansi.bold("Options:")}
  -s, --scope <s>      Filter: global, project, or both (default: both)
  -y, --yes            Skip confirmation prompts
  --json               Output as JSON
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm bundle create my-workflow                ${ansi.dim("Create from installed skills")}
  asm bundle install my-workflow               ${ansi.dim("Install a saved bundle")}
  asm bundle install ./bundle.json             ${ansi.dim("Install from file")}
  asm bundle list                              ${ansi.dim("Show all saved bundles")}
  asm bundle list --json                       ${ansi.dim("List bundles as JSON")}
  asm bundle show my-workflow                  ${ansi.dim("Show bundle details")}
  asm bundle remove my-workflow                ${ansi.dim("Remove a saved bundle")}`);
}

async function cmdBundle(args: ParsedArgs) {
  if (args.flags.help) {
    printBundleHelp();
    return;
  }

  const subcommand = args.subcommand;

  if (!subcommand) {
    error("Missing subcommand. Use: create, install, list, show, or remove");
    console.error(`Run "asm bundle --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "create": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(`Usage: asm bundle create <name>`);
        process.exit(2);
      }

      // Scan installed skills
      const config = await loadConfig();
      const allSkills = await scanAllSkills(config, args.flags.scope);

      if (allSkills.length === 0) {
        error("No skills found to include in the bundle.");
        process.exit(1);
      }

      // Deduplicate by name (keep first occurrence)
      const seen = new Set<string>();
      const uniqueSkills = allSkills.filter((s) => {
        const key = s.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let selectedSkills = uniqueSkills;

      // Interactive selection if TTY and not --yes
      if (process.stdin.isTTY && !args.flags.yes) {
        const items = uniqueSkills.map((s) => ({
          label: `${s.name} v${s.version}`,
          hint: s.description
            ? s.description.slice(0, 60) +
              (s.description.length > 60 ? "..." : "")
            : `(${s.provider}/${s.scope})`,
          checked: true,
        }));

        console.error(ansi.bold(`Select skills for bundle "${bundleName}":\n`));
        const indices = await checkboxPicker({ items });

        if (indices.length === 0) {
          error("No skills selected. Bundle not created.");
          process.exit(1);
        }

        selectedSkills = indices.map((i) => uniqueSkills[i]);
      }

      // Build skill refs (read lock once and pass to all calls)
      const { readLock } = await import("./utils/lock");
      const lockData = await readLock();
      const skillRefs: BundleSkillRef[] = await Promise.all(
        selectedSkills.map((s) => skillInfoToRef(s, lockData)),
      );

      // Prompt for description (or use default)
      let description = `Bundle of ${skillRefs.length} skills`;
      let author = "unknown";
      try {
        const { execSync } = await import("child_process");
        const gitUser = execSync("git config user.name", {
          encoding: "utf-8",
        }).trim();
        if (gitUser) author = gitUser;
      } catch {
        // git not available or user.name not set; keep "unknown"
      }

      if (process.stdin.isTTY && !args.flags.yes) {
        process.stderr.write(
          `\n${ansi.bold("Description")} (optional, press Enter to skip): `,
        );
        const descAnswer = await readLine();
        if (descAnswer.trim()) {
          description = descAnswer.trim();
        }

        process.stderr.write(
          `${ansi.bold("Author")} (optional, press Enter to skip): `,
        );
        const authorAnswer = await readLine();
        if (authorAnswer.trim()) {
          author = authorAnswer.trim();
        }
      }

      const bundle = buildBundle(bundleName, description, author, skillRefs);

      const savedPath = await saveBundle(bundle);

      if (args.flags.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.error(
          ansi.green(
            `Bundle "${bundleName}" created with ${skillRefs.length} skill(s).`,
          ),
        );
        console.error(`  Saved to: ${ansi.dim(savedPath)}`);
      }
      break;
    }

    case "install": {
      const nameOrPath = args.positional[0];
      if (!nameOrPath) {
        error("Missing required argument: <name|file>");
        console.error(`Usage: asm bundle install <name|file>`);
        process.exit(2);
      }

      let bundle;
      try {
        bundle = await loadBundle(nameOrPath);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      console.error(
        `${ansi.bold("Bundle:")} ${bundle.name} (${bundle.skills.length} skills)`,
      );
      if (bundle.description) {
        console.error(`  ${ansi.dim(bundle.description)}`);
      }
      console.error("");

      // Show skills to install
      for (const skill of bundle.skills) {
        const versionTag = skill.version ? ` v${skill.version}` : "";
        console.error(
          `  ${ansi.cyan(skill.name)}${ansi.dim(versionTag)} ${ansi.dim(`-> ${skill.installUrl}`)}`,
        );
      }

      // Confirm
      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `\n${ansi.bold("Install all skills from this bundle?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      // Install each skill
      const results: Array<{
        name: string;
        status: "installed" | "skipped" | "failed";
        reason?: string;
      }> = [];

      const config = await loadConfig();
      const { provider } = await resolveProvider(
        config,
        args.flags.provider,
        false, // non-interactive for batch
      );

      const installScope: "global" | "project" =
        args.flags.scope === "global" || args.flags.scope === "project"
          ? args.flags.scope
          : "global";

      for (const skill of bundle.skills) {
        console.error(`\n  Installing ${ansi.bold(skill.name)}...`);
        try {
          // Check if git is available for remote installs
          const isRemote =
            skill.installUrl.startsWith("github:") ||
            skill.installUrl.startsWith("https://github.com/");

          if (isRemote) {
            await checkGitAvailable();
          }

          const source = parseSource(skill.installUrl);
          const isLocal = !!source.isLocal;
          let tempDir: string | null = null;

          try {
            let rootDir: string;
            let skillDir: string;

            if (!isLocal) {
              tempDir = await cloneToTemp(source, args.flags.transport);
              rootDir = tempDir;
              skillDir = source.subpath
                ? joinPath(tempDir, source.subpath)
                : tempDir;
            } else {
              rootDir = source.localPath!;
              skillDir = source.localPath!;
            }

            const metadata = await validateSkill(skillDir);
            const skillName = sanitizeName(
              skill.name || metadata.name || source.repo,
            );

            const plan = buildInstallPlan(
              source,
              rootDir,
              skillDir,
              skillName,
              provider,
              args.flags.force,
              installScope,
            );

            // Check if skill already exists; skip unless --force
            try {
              await checkConflict(plan.targetDir, plan.force);
            } catch (conflictErr: any) {
              if (conflictErr.message?.includes("--force")) {
                results.push({
                  name: skill.name,
                  status: "skipped",
                  reason: "Already installed. Use --force to overwrite.",
                });
                console.error(
                  `    ${ansi.dim("---")} ${skill.name} skipped (already installed)`,
                );
                continue;
              }
              throw conflictErr;
            }

            await executeInstall(plan);
            results.push({ name: skill.name, status: "installed" });
            console.error(`    ${ansi.green("+++")} ${skill.name} installed`);
          } finally {
            if (tempDir) {
              await cleanupTemp(tempDir);
            }
          }
        } catch (err: any) {
          results.push({
            name: skill.name,
            status: "failed",
            reason: err.message,
          });
          console.error(`    ${ansi.red("!!!")} ${skill.name}: ${err.message}`);
        }
      }

      // Summary
      const installed = results.filter((r) => r.status === "installed").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed").length;

      if (args.flags.json) {
        console.log(
          JSON.stringify(
            {
              bundleName: bundle.name,
              total: results.length,
              installed,
              skipped,
              failed,
              results,
            },
            null,
            2,
          ),
        );
      } else {
        console.error("");
        console.error(
          `${ansi.bold("Summary:")} ${results.length} total, ` +
            `${ansi.green(String(installed))} installed, ` +
            (skipped > 0 ? `${ansi.dim(String(skipped))} skipped, ` : "") +
            `${ansi.red(String(failed))} failed`,
        );
      }

      if (failed > 0) {
        process.exitCode = 1;
      }
      break;
    }

    case "list": {
      const bundles = await listBundles();

      if (bundles.length === 0) {
        if (args.flags.json) {
          console.log("[]");
        } else {
          console.log("No bundles found.");
          console.error(ansi.dim("Create one with: asm bundle create <name>"));
        }
        return;
      }

      if (args.flags.json) {
        console.log(JSON.stringify(bundles, null, 2));
      } else {
        console.error(ansi.bold(`Saved Bundles (${bundles.length}):\n`));
        for (const bundle of bundles) {
          const tagsStr =
            bundle.tags && bundle.tags.length > 0
              ? ` ${ansi.dim(`[${bundle.tags.join(", ")}]`)}`
              : "";
          console.error(
            `  ${ansi.cyan(bundle.name)} ${ansi.dim(`(${bundle.skills.length} skills)`)}${tagsStr}`,
          );
          if (bundle.description) {
            console.error(`    ${ansi.dim(bundle.description)}`);
          }
          if (bundle.author) {
            console.error(`    ${ansi.dim(`by ${bundle.author}`)}`);
          }
        }
      }
      break;
    }

    case "show": {
      const nameOrPath = args.positional[0];
      if (!nameOrPath) {
        error("Missing required argument: <name|file>");
        console.error(`Usage: asm bundle show <name|file>`);
        process.exit(2);
      }

      let bundle;
      try {
        bundle = await loadBundle(nameOrPath);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      if (args.flags.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.error(ansi.bold(`Bundle: ${bundle.name}`));
        if (bundle.description) {
          console.error(`  ${bundle.description}`);
        }
        if (bundle.author) {
          console.error(`  ${ansi.dim(`Author: ${bundle.author}`)}`);
        }
        console.error(
          `  ${ansi.dim(`Created: ${new Date(bundle.createdAt).toLocaleString()}`)}`,
        );
        if (bundle.tags && bundle.tags.length > 0) {
          console.error(`  ${ansi.dim(`Tags: ${bundle.tags.join(", ")}`)}`);
        }
        console.error(`\n  ${ansi.bold(`Skills (${bundle.skills.length})`)}:`);
        for (const skill of bundle.skills) {
          const versionTag = skill.version ? ` v${skill.version}` : "";
          console.error(`    ${ansi.cyan(skill.name)}${ansi.dim(versionTag)}`);
          if (skill.description) {
            console.error(`      ${ansi.dim(skill.description)}`);
          }
          console.error(`      ${ansi.dim(`install: ${skill.installUrl}`)}`);
        }
      }
      break;
    }

    case "remove": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(`Usage: asm bundle remove <name>`);
        process.exit(2);
      }

      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `${ansi.bold("Remove bundle")} ${ansi.cyan(bundleName)}${ansi.bold("?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      let removed: boolean;
      try {
        removed = await removeBundle(bundleName);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      if (removed) {
        console.error(ansi.green(`Bundle "${bundleName}" removed.`));
      } else {
        error(`Bundle "${bundleName}" not found.`);
        process.exit(1);
      }
      break;
    }

    default:
      error(
        `Unknown subcommand: "${subcommand}". Use: create, install, list, show, or remove`,
      );
      console.error(`Run "asm bundle --help" for usage.`);
      process.exit(2);
  }
}

// ─── Publish ────────────────────────────────────────────────────────────────

async function cmdPublish(args: ParsedArgs) {
  if (args.flags.help) {
    printPublishHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  const skillPath = args.subcommand || ".";

  try {
    const result = await publishSkill({
      path: skillPath,
      dryRun: args.flags.dryRun,
      force: args.flags.force,
      yes: args.flags.yes,
    });

    // Machine-readable output
    if (args.flags.machine) {
      restoreConsole?.();
      if (!result.success) {
        console.log(
          formatMachineError(
            "publish",
            ErrorCodes.PUBLISH_FAILED,
            result.error || "Publish failed",
            startTime,
            {
              manifest: result.manifest,
              security_verdict: result.securityVerdict,
              fallback: result.fallback ?? false,
            },
          ),
        );
        process.exit(1);
      }
      console.log(
        formatMachineOutput(
          "publish",
          {
            manifest: result.manifest,
            pr_url: result.prUrl,
            status: result.securityVerdict,
          },
          startTime,
        ),
      );
      return;
    }

    // JSON output
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            success: result.success,
            manifest: result.manifest,
            pr_url: result.prUrl,
            error: result.error,
            security_verdict: result.securityVerdict,
          },
          null,
          2,
        ),
      );
      if (!result.success) process.exit(1);
      return;
    }

    // Human-readable output
    if (!result.success) {
      error(result.error || "Publish failed.");
      process.exit(1);
    }

    // Fallback path: no gh CLI
    if (result.fallback) {
      console.log(ansi.yellow("Manifest generated (gh CLI unavailable):"));
      console.log(formatFallbackInstructions(result));
      return;
    }

    // Dry run
    if (args.flags.dryRun) {
      console.error(ansi.dim("Dry run — no PR created.\n"));
      console.log(JSON.stringify(result.manifest, null, 2));
      return;
    }

    // Success with PR
    if (result.prUrl) {
      console.error(ansi.green("Published successfully!"));
      console.error("");
      console.error(`  PR: ${result.prUrl}`);
      console.error(
        `  Manifest: manifests/${result.manifest?.author}/${result.manifest?.name}.json`,
      );
      console.error(`  Security: ${result.securityVerdict}`);
      console.error("");
      console.error(
        ansi.dim("The registry maintainers will review your submission."),
      );
    }
  } catch (err: any) {
    const errorResult: import("./utils/types").PublishResult = {
      success: false,
      manifest: null,
      prUrl: null,
      error: err.message,
      securityVerdict: "pass",
      securityReport: {
        scannedAt: new Date().toISOString(),
        skillName: "",
        skillPath: "",
        source: null,
        codeScans: [],
        permissions: [],
        totalFiles: 0,
        totalLines: 0,
        verdict: "safe",
        verdictReason: "",
      },
    };
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "publish",
          ErrorCodes.PUBLISH_FAILED,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            manifest: null,
            pr_url: null,
            error: err.message,
            security_verdict: null,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

// ─── Outdated & Update Commands ────────────────────────────────────────────

async function cmdOutdated(args: ParsedArgs) {
  if (args.flags.help) {
    printOutdatedHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  try {
    const summary = await checkOutdated();

    if (args.flags.machine) {
      restoreConsole?.();
      const data = summary.entries.map((e) => ({
        name: e.name,
        installed_commit: e.installedCommit,
        latest_commit: e.latestCommit,
        source: e.sourceType,
        status: e.status,
      }));
      console.log(formatMachineOutput("outdated", data, startTime));
      return;
    }

    if (args.flags.json) {
      console.log(formatOutdatedJSON(summary));
      return;
    }

    // Human-readable table
    const useColor = !args.flags.noColor && process.stdout.isTTY !== false;
    console.log(formatOutdatedTable(summary, useColor));

    if (summary.outdatedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "outdated",
          ErrorCodes.UNKNOWN_ERROR,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

async function cmdUpdate(args: ParsedArgs) {
  if (args.flags.help) {
    printUpdateHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  // Collect skill names from subcommand and positional args
  const names: string[] = [];
  if (args.subcommand) names.push(args.subcommand);
  names.push(...args.positional);

  try {
    const summary = await updateSkills(
      names.length > 0 ? names : null,
      args.flags.yes,
    );

    if (args.flags.machine) {
      restoreConsole?.();
      const data = summary.results.map((r) => ({
        name: r.name,
        status: r.status,
        reason: r.reason || null,
        old_commit: r.oldCommit || null,
        new_commit: r.newCommit || null,
        security_verdict: r.securityVerdict || null,
      }));
      console.log(formatMachineOutput("update", data, startTime));
      return;
    }

    if (args.flags.json) {
      console.log(formatUpdateJSON(summary));
      return;
    }

    // Human-readable output

    // Warn that scope detection is not yet supported
    if (summary.results.length > 0) {
      console.error(
        ansi.yellow(
          "Note: project-scoped skill detection is not yet supported. All updates target the global skill path.",
        ),
      );
    }

    // Warn about skills not found in the lock file
    if (summary.warnings && summary.warnings.length > 0) {
      for (const w of summary.warnings) {
        console.error(
          ansi.yellow(`Warning: skill "${w}" not found in lock file — skipped`),
        );
      }
    }

    if (summary.results.length === 0) {
      console.log("All skills are up to date.");
      return;
    }

    for (const result of summary.results) {
      switch (result.status) {
        case "updated":
          console.log(
            `${ansi.green("✓")} ${result.name} ${ansi.dim(result.oldCommit || "")} → ${result.newCommit || ""}`,
          );
          if (result.securityVerdict === "warning") {
            console.error(
              ansi.yellow(
                `  ⚠ Security audit returned warning for ${result.name} — updated because --yes was supplied`,
              ),
            );
          }
          break;
        case "skipped":
          console.log(
            `${ansi.yellow("○")} ${result.name} ${ansi.dim(result.reason || "skipped")}`,
          );
          break;
        case "failed":
          console.log(
            `${ansi.red("✗")} ${result.name} ${ansi.dim(result.reason || "failed")}`,
          );
          break;
      }
    }

    console.log("");
    const parts: string[] = [];
    if (summary.updatedCount > 0)
      parts.push(ansi.green(`${summary.updatedCount} updated`));
    if (summary.skippedCount > 0)
      parts.push(ansi.yellow(`${summary.skippedCount} skipped`));
    if (summary.failedCount > 0)
      parts.push(ansi.red(`${summary.failedCount} failed`));
    console.log(parts.join(", "));

    if (summary.failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "update",
          ErrorCodes.UNKNOWN_ERROR,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

// ─── Main CLI dispatcher ────────────────────────────────────────────────────

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
    (globalThis as any).__CLI_NO_COLOR = true;
  }

  // Apply --verbose
  if (args.flags.verbose) {
    setVerbose(true);
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
    case "audit":
      await cmdAudit(args);
      break;
    case "install":
      await cmdInstall(args);
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
    "uninstall",
    "audit",
    "config",
    "install",
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
