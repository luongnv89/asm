/**
 * Provider selection, npx skills add support, and cross-tool linking.
 * Split from installer.ts (issue #455).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, access } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";

import { parseFrontmatter } from "./utils/frontmatter";

import { resolveProviderPath } from "./config";
import { debug } from "./logger";

import { checkboxPicker } from "./utils/checkbox-picker";
import { createLink } from "./linker";
import type {
  ParsedSource,
  InstallPlan,
  ProviderConfig,
  AppConfig,
} from "./utils/types";
import type { ExecError } from "./installer-core";

const execFileAsync = promisify(execFile);

// ─── Vercel npx skills add Support ──────────────────────────────────────────

/**
 * Resolve npm's bundled `npx-cli.js` so npx can be launched via the current
 * Node binary (`process.execPath`) instead of the platform `npx` shim.
 *
 * On Windows the shim is `npx.cmd`, which `child_process.execFile`/`spawn`
 * cannot launch without `shell: true`: a bare `npx` throws ENOENT (Node does
 * not consult PATHEXT for the command name) and `npx.cmd` throws EINVAL under
 * Node's CVE-2024-27980 hardening, which refuses to spawn `.cmd`/`.bat` files
 * without a shell. Invoking `node <npx-cli.js> …` sidesteps the shim entirely
 * and passes arguments as a verbatim argv, so paths with spaces and shell
 * metacharacters stay safe (no shell interpolation, unlike `shell: true`).
 *
 * Returns the absolute path to `npx-cli.js`, or null when it cannot be located
 * (exotic runtimes) — callers then fall back to the `npx` shim on PATH.
 *
 * `nodeDir` is injectable for testing; production always resolves it from the
 * running Node binary.
 */
export function resolveNpxCli(
  nodeDir: string = dirname(process.execPath),
): string | null {
  const candidates = [
    // Windows installers, nvm-windows, fnm, Volta, Chocolatey, Scoop: npm sits
    // beside node under node_modules/.
    join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
    // Standard POSIX (system packages, nvm, CI toolcache, Homebrew node@NN):
    // node in bin/, npm in ../lib/node_modules/.
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    // Homebrew's *unversioned* `node` formula is keg-only and installs npm
    // under libexec (bin/npx is only a symlink into it), so relative to the
    // real node binary npm lives in ../libexec/lib/node_modules/.
    join(
      nodeDir,
      "..",
      "libexec",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Cross-platform runner for the `npx` CLI. Prefers launching npm's bundled
 * `npx-cli.js` through the current Node binary — this behaves identically on
 * every OS and avoids the Windows `.cmd` shim problem (see `resolveNpxCli`).
 * Falls back to the `npx` shim on PATH when the CLI script cannot be found.
 */
function runNpx(
  args: string[],
  opts: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  // Only Windows needs the node + npx-cli.js indirection: there `npx` is a
  // `.cmd` shim that execFile cannot launch (see resolveNpxCli). On POSIX the
  // bare `npx` on PATH resolves correctly, so leave that path byte-for-byte
  // unchanged to keep the blast radius of this fix on Windows alone.
  if (process.platform === "win32") {
    const npxCli = resolveNpxCli();
    if (npxCli) {
      return execFileAsync(process.execPath, [npxCli, ...args], opts);
    }
  }
  return execFileAsync("npx", args, opts);
}

export async function checkNpxAvailable(): Promise<void> {
  try {
    await runNpx(["--version"]);
    debug("install: npx available");
  } catch {
    throw new Error(
      "npx is required for Vercel method installation. Install Node.js from https://nodejs.org",
    );
  }
}

/**
 * Execute `npx skills add <url> --skill <name>` to install a skill via the
 * Vercel skills CLI. Returns the stdout/stderr output for display.
 */
export async function executeNpxSkillsAdd(
  repoUrl: string,
  skillName: string | null,
): Promise<{ stdout: string; stderr: string }> {
  const args = ["--yes", "skills", "add", repoUrl];
  if (skillName) {
    args.push("--skill", skillName);
  }
  debug(`install: running npx ${args.join(" ")}`);

  try {
    const result = await runNpx(args, { timeout: 120_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err: unknown) {
    const execErr = err as ExecError;
    const stderr = execErr.stderr || execErr.message || "";
    throw new Error(`npx skills add failed: ${stderr}`, { cause: err });
  }
}

/**
 * Build a GitHub HTTPS URL from a ParsedSource for passing to npx skills add.
 */
export function buildRepoUrl(source: ParsedSource): string {
  if (source.isLocal) {
    return source.localPath!;
  }
  const base = `https://github.com/${source.owner}/${source.repo}`;
  if (source.ref) {
    return `${base}/tree/${source.ref}${source.subpath ? `/${source.subpath}` : ""}`;
  }
  return base;
}

// ─── Provider Selection & Conflict Detection ───────────────────────────────

export async function resolveProvider(
  config: AppConfig,
  providerName: string | null,
  isTTY: boolean,
): Promise<{
  provider: ProviderConfig;
  allProviders: ProviderConfig[] | null;
}> {
  const enabled = config.providers.filter((p) => p.enabled);

  // Handle "all" provider selection
  if (providerName === "all") {
    if (enabled.length === 0) {
      throw new Error(
        "No providers are enabled. Enable a provider in your config.",
      );
    }
    // Use "agents" as primary provider, or first enabled if "agents" not available
    const primary = enabled.find((p) => p.name === "agents") || enabled[0];
    return { provider: primary, allProviders: enabled };
  }

  if (providerName) {
    const provider = config.providers.find((p) => p.name === providerName);
    if (!provider) {
      const validNames = config.providers.map((p) => p.name).join(", ");
      throw new Error(
        `Unknown provider: "${providerName}". Valid providers: ${validNames}, all`,
      );
    }
    if (!provider.enabled) {
      throw new Error(
        `Provider "${providerName}" is disabled. Enable it in your config or choose another provider.`,
      );
    }
    return { provider, allProviders: null };
  }

  // Auto-select if only one enabled
  if (enabled.length === 1) {
    return { provider: enabled[0], allProviders: null };
  }

  if (!isTTY) {
    if (enabled.length === 0) {
      throw new Error(
        "No providers are enabled. Enable a provider in your config.",
      );
    }
    const names = enabled.map((p) => p.name).join(", ");
    throw new Error(
      `--tool (or --provider) is required in non-interactive mode. Available: ${names}, all`,
    );
  }

  // Interactive picker — show ALL providers, pre-check saved selections or "agents"
  const savedTools = config.preferences.selectedTools;
  const hasSavedTools = savedTools && savedTools.length > 0;
  const savedSet = hasSavedTools ? new Set(savedTools) : null;

  const pickerItems = config.providers.map((p) => ({
    label: `${p.label} (${p.name})`,
    hint: p.global,
    checked: savedSet ? savedSet.has(p.name) : p.name === "agents",
  }));

  const selectedIndices = await checkboxPicker({ items: pickerItems });

  if (selectedIndices.length === 0) {
    throw new Error("No tools selected. Aborting.");
  }

  const selectedProviders = selectedIndices.map((i) => config.providers[i]);

  // Persist selected tool names for next time
  const selectedNames = selectedProviders.map((p) => p.name);
  const { saveSelectedTools } = await import("./config");
  await saveSelectedTools(selectedNames);

  if (selectedProviders.length === 1) {
    return { provider: selectedProviders[0], allProviders: null };
  }

  // Multiple providers — use "agents" as primary if selected, else first
  const primary =
    selectedProviders.find((p) => p.name === "agents") || selectedProviders[0];
  return { provider: primary, allProviders: selectedProviders };
}

// ─── Scope Selection ─────────────────────────────────────────────────────────

/**
 * Shared scope decision for the install preamble (issue #612).
 *
 * An explicit `--scope global|project` flag always wins. Otherwise
 * non-interactive runs (`!isTTY`) and `--yes` default to `"global"`, and
 * TTY runs offer an interactive single-select picker. Callers own the
 * step-header/logging output; this helper only decides and prompts.
 *
 * Throws when the interactive picker is dismissed with nothing selected.
 */
export async function resolveInstallScope(opts: {
  scopeFlag: string | null;
  provider: ProviderConfig;
  isTTY: boolean;
  yes: boolean;
}): Promise<"global" | "project"> {
  const { scopeFlag, provider, isTTY, yes } = opts;

  if (scopeFlag === "global" || scopeFlag === "project") {
    return scopeFlag;
  }

  if (!isTTY || yes) {
    return "global";
  }

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
  const scopeIndices = await checkboxPicker({ items: scopeItems });
  if (scopeIndices.length === 0) {
    throw new Error("No scope selected. Aborting.");
  }
  // Single-select behavior: the first checked entry wins.
  return scopeIndices[0] === 0 ? "global" : "project";
}

export function buildInstallPlan(
  source: ParsedSource,
  tempDir: string,
  sourceDir: string,
  skillName: string,
  provider: ProviderConfig,
  force: boolean,
  scope: "global" | "project" = "global",
): InstallPlan {
  const basePath = scope === "project" ? provider.project : provider.global;
  const baseDir = resolveProviderPath(basePath);
  const targetDir = join(baseDir, skillName);

  return {
    source,
    tempDir,
    sourceDir,
    targetDir,
    skillName,
    force,
    providerName: provider.name,
    providerLabel: provider.label,
    scope,
  };
}

export async function checkConflict(
  targetDir: string,
  force: boolean,
): Promise<void> {
  try {
    await access(targetDir);
    // Directory exists
    debug(
      `install: target ${targetDir} — conflict (exists)${force ? ", force overwrite" : ""}`,
    );
    if (!force) {
      throw new Error(
        `Skill already exists at: ${targetDir}\nUse --force to overwrite.`,
      );
    }
  } catch (err: unknown) {
    // If our own error, re-throw
    if (err instanceof Error && err.message?.includes("--force")) throw err;
    // Otherwise, directory doesn't exist — no conflict
    debug(`install: target ${targetDir} — no conflict`);
  }
}

// ─── Cross-Tool Link Detection ─────────────────────────────────────────────

/**
 * Result of checking whether a skill already exists in another tool's
 * installation directory. Used by the install flow to offer the user a
 * "Link" option instead of a full reinstall (issue #322).
 */
export interface CrossToolLinkInfo {
  /** The provider where the skill already lives */
  existingProvider: string;
  /** Human-readable label (e.g. "Claude Code") */
  existingProviderLabel: string;
  /** Absolute path to the existing skill directory */
  existingPath: string;
  /** Whether the existing install came from a local source */
  isLocalSource: boolean;
}

/**
 * Scan all enabled provider directories for an existing installation of
 * `skillName`. Returns info about the first match found, or null if the
 * skill is not installed anywhere.
 *
 * This is used by the install flow to detect cross-tool installs: if the
 * skill exists in a provider different from the target, the user can
 * choose to link instead of reinstalling (issue #322).
 */
export async function checkCrossToolLink(
  skillName: string,
  targetProviderName: string,
  config: AppConfig,
): Promise<CrossToolLinkInfo | null> {
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    if (provider.name === targetProviderName) continue; // skip target

    const globalDir = resolveProviderPath(provider.global);
    const candidatePath = join(globalDir, skillName);

    try {
      await access(candidatePath);
      // Check it has a SKILL.md (valid skill)
      const skillMd = join(candidatePath, "SKILL.md");
      await access(skillMd);

      // Verify it's the right skill (frontmatter name matches)
      const content = await readFile(skillMd, "utf-8");
      const fm = parseFrontmatter(content);
      const existingName = fm.name || candidatePath.split(/[/\\]/).pop() || "";

      if (existingName === skillName) {
        debug(
          `install: cross-tool link found — "${skillName}" already installed in ${provider.label} at ${candidatePath}`,
        );
        return {
          existingProvider: provider.name,
          existingProviderLabel: provider.label,
          existingPath: candidatePath,
          isLocalSource: false,
        };
      }
    } catch {
      // Not found or not a valid skill — try next provider
      continue;
    }
  }

  return null;
}

/**
 * Link an existing skill installation from one tool to another by creating
 * a symlink. The source directory is the canonical install; the target is
 * a symlink in the new tool's skill directory.
 *
 * Returns the path of the created symlink.
 */
export async function linkExistingSkill(
  skillName: string,
  sourcePath: string,
  targetProviderName: string,
  targetScope: "global" | "project",
  config: AppConfig,
  force: boolean = false,
): Promise<string> {
  const provider = config.providers.find((p) => p.name === targetProviderName);
  if (!provider) {
    throw new Error(
      `Target provider "${targetProviderName}" not found in config.`,
    );
  }

  const basePath =
    targetScope === "project" ? provider.project : provider.global;
  const providerDir = resolveProviderPath(basePath);
  const targetPath = join(providerDir, skillName);

  // Use the linker's createLink which handles force, mkdir, and symlink
  await createLink(sourcePath, providerDir, skillName, force);

  debug(`install: linked "${skillName}" from ${sourcePath} -> ${targetPath}`);
  return targetPath;
}
