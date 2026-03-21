import { execFile } from "child_process";
import { promisify } from "util";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  rename,
  cp,
  access,
  stat,
  lstat,
  symlink,
  mkdir,
} from "fs/promises";
import { join, resolve, relative, basename } from "path";
import { homedir } from "os";
import { tmpdir } from "os";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import { readFilesRecursive } from "./utils/fs";
import { checkboxPicker } from "./utils/checkbox-picker";
import type {
  ParsedSource,
  InstallPlan,
  InstallResult,
  ProviderConfig,
  AppConfig,
  DiscoveredSkill,
  TransportMode,
} from "./utils/types";

const execFileAsync = promisify(execFile);

// ─── Source Parsing ────────────────────────────────────────────────────────

const OWNER_RE = /^[a-zA-Z0-9_-]+$/;
const REPO_RE = /^[a-zA-Z0-9._-]+$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_NAME_LENGTH = 128;
const GITHUB_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/(.+))?\/?$/;

export function isLocalPath(input: string): boolean {
  return (
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    input.startsWith("~/") ||
    input === "~" ||
    input === "." ||
    input === ".."
  );
}

export function parseLocalSource(input: string): ParsedSource {
  let absPath: string;
  if (input === "~") {
    absPath = homedir();
  } else if (input.startsWith("~/")) {
    absPath = resolve(homedir(), input.slice(2));
  } else {
    absPath = resolve(input);
  }

  const dirName = basename(absPath);
  debug(`install: parsed local source -> path=${absPath}`);

  return {
    owner: "local",
    repo: dirName,
    ref: null,
    subpath: null,
    cloneUrl: "",
    sshCloneUrl: "",
    isLocal: true,
    localPath: absPath,
  };
}

export function parseSource(input: string): ParsedSource {
  // Check for local path first
  if (isLocalPath(input)) {
    return parseLocalSource(input);
  }

  // Normalize HTTPS GitHub URLs to github:owner/repo[#ref] format
  const urlMatch = GITHUB_URL_RE.exec(input);
  if (urlMatch) {
    const [, urlOwner, urlRepo, urlRef] = urlMatch;
    const cleanRepo = urlRepo.endsWith(".git") ? urlRepo.slice(0, -4) : urlRepo;
    input = `github:${urlOwner}/${cleanRepo}${urlRef ? `#${urlRef}` : ""}`;
  }

  if (!input.startsWith("github:")) {
    throw new Error(
      `Invalid source format. Got: "${input}"\nSupported formats:\n  github:owner/repo[#ref]\n  github:owner/repo#ref:path\n  https://github.com/owner/repo\n  https://github.com/owner/repo/tree/branch/path/to/skill\n  /path/to/local/skill\n  ./relative/path/to/skill`,
    );
  }

  const rest = input.slice("github:".length);
  const hashIdx = rest.indexOf("#");

  let ownerRepo: string;
  let ref: string | null = null;
  let subpath: string | null = null;

  if (hashIdx !== -1) {
    ownerRepo = rest.slice(0, hashIdx);
    const refAndPath = rest.slice(hashIdx + 1);
    if (!refAndPath) {
      throw new Error("Invalid source: ref cannot be empty after #");
    }
    // Support github:owner/repo#ref:subpath syntax
    // Colon is not valid in git ref names, so this is unambiguous
    const colonIdx = refAndPath.indexOf(":");
    if (colonIdx !== -1) {
      ref = refAndPath.slice(0, colonIdx);
      if (!ref) {
        throw new Error("Invalid source: ref cannot be empty before :");
      }
      subpath = refAndPath.slice(colonIdx + 1) || null;
    } else {
      ref = refAndPath;
    }
  } else {
    // Support github:owner/repo:subpath syntax (no ref)
    const colonIdx = rest.indexOf(":");
    if (colonIdx !== -1) {
      ownerRepo = rest.slice(0, colonIdx);
      subpath = rest.slice(colonIdx + 1) || null;
    } else {
      ownerRepo = rest;
    }
  }

  const slashIdx = ownerRepo.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(
      `Invalid source: format must be github:owner/repo. Got: "${input}"`,
    );
  }

  const owner = ownerRepo.slice(0, slashIdx);
  const repo = ownerRepo.slice(slashIdx + 1);

  if (!owner) {
    throw new Error("Invalid source: owner cannot be empty");
  }
  if (!repo) {
    throw new Error("Invalid source: repo cannot be empty");
  }
  if (!OWNER_RE.test(owner)) {
    throw new Error(
      `Invalid source: owner contains invalid characters: "${owner}". Allowed: [a-zA-Z0-9_-]`,
    );
  }
  if (!REPO_RE.test(repo)) {
    throw new Error(
      `Invalid source: repo contains invalid characters: "${repo}". Allowed: [a-zA-Z0-9._-]`,
    );
  }

  const result = {
    owner,
    repo,
    ref,
    subpath,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    sshCloneUrl: `git@github.com:${owner}/${repo}.git`,
  };
  debug(
    `install: parsed source -> owner=${owner} repo=${repo} ref=${ref} subpath=${subpath}`,
  );
  return result;
}

/**
 * Resolve ref/subpath ambiguity for URLs like /tree/main/skills/agent-config.
 * Uses git ls-remote to discover valid refs and split the path accordingly.
 */
export async function resolveSubpath(
  source: ParsedSource,
): Promise<ParsedSource> {
  // Already resolved (from github: shorthand with :subpath) or nothing to resolve
  if (source.subpath !== null || !source.ref || !source.ref.includes("/")) {
    return source;
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", "--heads", "--tags", source.cloneUrl],
      { timeout: 15_000 },
    );

    const refs = new Set<string>();
    for (const line of stdout.split("\n")) {
      const match = line.match(/\trefs\/(?:heads|tags)\/(.+)$/);
      if (match) refs.add(match[1]);
    }

    // Try progressively shorter prefixes as the ref (shortest first = most common case)
    const segments = source.ref.split("/");
    for (let i = 1; i < segments.length; i++) {
      const candidateRef = segments.slice(0, i).join("/");
      if (refs.has(candidateRef)) {
        const subpath = segments.slice(i).join("/");
        debug(`install: resolved ref="${candidateRef}" subpath="${subpath}"`);
        return {
          ...source,
          ref: candidateRef,
          subpath: subpath || null,
        };
      }
    }
  } catch (err) {
    debug(`install: ls-remote failed, treating entire ref as branch: ${err}`);
  }

  // Fallback: treat entire ref as the branch (backward compatible)
  return source;
}

export function sanitizeName(name: string): string {
  if (!name) {
    throw new Error("Invalid skill name: name cannot be empty");
  }
  if (name.includes("\0")) {
    throw new Error(
      "Invalid skill name: contains unsafe characters (null byte)",
    );
  }
  if (name.includes("..")) {
    throw new Error("Invalid skill name: contains unsafe characters (..)");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(
      "Invalid skill name: contains unsafe characters (path separator)",
    );
  }
  if (name.startsWith(".")) {
    throw new Error("Invalid skill name: must not start with a dot");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid skill name: exceeds maximum length of ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid skill name: "${name}" does not match allowed pattern [a-zA-Z0-9][a-zA-Z0-9._-]*`,
    );
  }
  return name;
}

export function getInstallNameFromPath(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  const rawName = parts.length > 0 ? parts[parts.length - 1] : relPath;
  return sanitizeName(rawName);
}

export function findDuplicateInstallNames(
  relPaths: string[],
): Array<{ name: string; paths: string[] }> {
  const seen = new Map<string, string[]>();
  for (const relPath of relPaths) {
    const name = getInstallNameFromPath(relPath);
    const paths = seen.get(name);
    if (paths) {
      paths.push(relPath);
    } else {
      seen.set(name, [relPath]);
    }
  }

  return [...seen.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

// ─── Install Pipeline Core ─────────────────────────────────────────────────

export async function checkGitAvailable(): Promise<void> {
  try {
    await execFileAsync("git", ["--version"]);
    debug("install: git available");
  } catch {
    throw new Error(
      "git is required for installing skills. Install git from https://git-scm.com",
    );
  }
}

export function isAuthError(err: any): boolean {
  if (err.killed) return false;
  const stderr = (err.stderr || err.message || "").toLowerCase();
  return (
    stderr.includes("authentication failed") ||
    stderr.includes("could not read username") ||
    stderr.includes("repository not found") ||
    stderr.includes("returned error: 403") ||
    stderr.includes("returned error: 401") ||
    stderr.includes("terminal prompts disabled") ||
    stderr.includes("permission denied")
  );
}

function formatCloneError(err: any): string {
  return err.killed
    ? "Clone timed out after 60 seconds"
    : `Clone failed: ${err.stderr || err.message}`;
}

async function cloneWithUrl(
  url: string,
  ref: string | null,
  tempDir: string,
): Promise<string> {
  const args = ["clone", "--depth", "1"];
  if (ref) {
    args.push("--branch", ref);
  }
  args.push(url, tempDir);

  await execFileAsync("git", args, { timeout: 60_000 });
  return tempDir;
}

export async function cloneToTemp(
  source: ParsedSource,
  transport: TransportMode = "auto",
): Promise<string> {
  debug(
    `install: cloning ${source.owner}/${source.repo}${source.ref ? ` (ref: ${source.ref})` : ""} (transport: ${transport})`,
  );

  const tempDir = await mkdtemp(join(tmpdir(), "asm-install-"));

  if (transport === "ssh" || transport === "https") {
    const url = transport === "ssh" ? source.sshCloneUrl : source.cloneUrl;
    try {
      return await cloneWithUrl(url, source.ref, tempDir);
    } catch (err: any) {
      await cleanupTemp(tempDir);
      throw new Error(formatCloneError(err));
    }
  }

  // Auto mode: try HTTPS first, fallback to SSH on auth errors
  try {
    return await cloneWithUrl(source.cloneUrl, source.ref, tempDir);
  } catch (httpsErr: any) {
    if (!isAuthError(httpsErr)) {
      await cleanupTemp(tempDir);
      throw new Error(formatCloneError(httpsErr));
    }

    debug("install: HTTPS clone failed with auth error, retrying with SSH...");
    await cleanupTemp(tempDir);

    const sshTempDir = await mkdtemp(join(tmpdir(), "asm-install-"));
    try {
      return await cloneWithUrl(source.sshCloneUrl, source.ref, sshTempDir);
    } catch (sshErr: any) {
      await cleanupTemp(sshTempDir);
      throw new Error(
        `Clone failed with both transports:\n` +
          `  HTTPS: ${formatCloneError(httpsErr)}\n` +
          `  SSH:   ${formatCloneError(sshErr)}`,
      );
    }
  }
}

export async function validateSkill(
  tempDir: string,
): Promise<{ name: string; version: string; description: string }> {
  const skillMdPath = join(tempDir, "SKILL.md");

  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error("Not a valid skill: SKILL.md not found in repository root");
  }

  const fm = parseFrontmatter(content);
  const dirName = tempDir.split("/").pop() || "unknown";

  const name = fm.name || dirName;
  const version = resolveVersion(fm);
  debug(`install: validated skill "${name}" v${version}`);
  return {
    name,
    version,
    description: (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
  };
}

export async function discoverSkills(
  tempDir: string,
  maxDepth: number = 3,
): Promise<DiscoveredSkill[]> {
  const skills: DiscoveredSkill[] = [];

  async function walk(dir: string, relPrefix: string, depth: number) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;

      const fullPath = join(dir, entry);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const relPath = relPrefix ? `${relPrefix}/${entry}` : entry;
      const childDepth = depth + 1;

      const skillMdPath = join(fullPath, "SKILL.md");
      try {
        const content = await readFile(skillMdPath, "utf-8");
        const fm = parseFrontmatter(content);
        skills.push({
          relPath,
          name: fm.name || entry,
          version: resolveVersion(fm),
          description: (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
        });
        // Don't recurse into directories that have SKILL.md
      } catch {
        // No SKILL.md here — recurse deeper if within depth limit
        if (childDepth < maxDepth) {
          await walk(fullPath, relPath, childDepth);
        }
      }
    }
  }

  await walk(tempDir, "", 0);
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export interface SecurityWarning {
  category: string;
  file: string;
  line: number;
  match: string;
}

const WARNING_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "Shell commands", pattern: /\b(bash|sh\s+-c)\b/ },
  { category: "Shell commands", pattern: /\bexec\(/ },
  { category: "Shell commands", pattern: /\bchild_process\b/ },
  { category: "Shell commands", pattern: /\bBun\.spawn\b/ },
  { category: "Code execution", pattern: /\beval\(/ },
  { category: "Code execution", pattern: /\bFunction\(/ },
  { category: "Code execution", pattern: /\bnew\s+Function\b/ },
  {
    category: "Credentials",
    pattern: /\b(API_KEY|SECRET|TOKEN|PASSWORD)\s*[=:]/,
  },
  { category: "External URLs", pattern: /https?:\/\// },
];

export async function scanForWarnings(
  tempDir: string,
): Promise<SecurityWarning[]> {
  const warnings: SecurityWarning[] = [];
  const files = await readFilesRecursive(tempDir);

  for (const { relPath, content } of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { category, pattern } of WARNING_PATTERNS) {
        if (pattern.test(lines[i])) {
          const match = lines[i].trim();
          warnings.push({
            category,
            file: relPath,
            line: i + 1,
            match: match.length > 100 ? match.slice(0, 100) + "…" : match,
          });
        }
      }
    }
  }

  return warnings;
}

export async function executeInstall(
  plan: InstallPlan,
): Promise<InstallResult> {
  const sourceStr = plan.source.isLocal
    ? `local:${plan.source.localPath}`
    : `github:${plan.source.owner}/${plan.source.repo}${plan.source.ref ? `#${plan.source.ref}` : ""}${plan.source.subpath ? `:${plan.source.subpath}` : ""}`;

  // Handle force removal of existing
  if (plan.force) {
    try {
      await access(plan.targetDir);
      await rm(plan.targetDir, { recursive: true, force: true });
    } catch {
      // doesn't exist, fine
    }
  }

  // Use sourceDir (may be a subdirectory of tempDir for multi-skill repos)
  const installSource = plan.sourceDir;

  // Copy source to target (always copy since sourceDir may be a subdirectory)
  try {
    await cp(installSource, plan.targetDir, { recursive: true });
  } catch (cpErr: any) {
    throw new Error(`Failed to install: ${cpErr.message}`);
  }

  // Remove .git directory from installed skill (in case it was the root)
  const gitDir = join(plan.targetDir, ".git");
  try {
    await rm(gitDir, { recursive: true, force: true });
  } catch {
    // .git might not exist, that's fine
  }

  debug(`install: copied files to ${plan.targetDir}`);

  // Verify SKILL.md at target
  const skillMd = join(plan.targetDir, "SKILL.md");
  try {
    await access(skillMd);
  } catch {
    throw new Error(
      "Installation verification failed: SKILL.md not found at target",
    );
  }

  // Read metadata for result
  const content = await readFile(skillMd, "utf-8");
  const fm = parseFrontmatter(content);

  return {
    success: true,
    path: plan.targetDir,
    name: fm.name || plan.skillName,
    version: resolveVersion(fm),
    provider: plan.providerLabel,
    source: sourceStr,
  };
}

export async function executeInstallAllProviders(
  plan: InstallPlan,
  allProviders: ProviderConfig[],
): Promise<InstallResult> {
  // Step 1: Install to the "agents" provider as primary (the canonical location)
  const primaryResult = await executeInstall(plan);

  // Step 2: Create symlinks in all other enabled providers
  for (const provider of allProviders) {
    if (provider.name === plan.providerName) continue; // skip primary

    const providerDir = resolveProviderPath(provider.global);
    const targetPath = join(providerDir, plan.skillName);

    // Ensure parent directory exists
    await mkdir(providerDir, { recursive: true });

    // Remove existing symlink, or warn and skip if it's a real directory
    try {
      const stats = await lstat(targetPath);
      if (stats.isSymbolicLink()) {
        await rm(targetPath);
      } else {
        debug(
          `install: skipping ${targetPath} — existing non-symlink directory`,
        );
        continue;
      }
    } catch {
      // doesn't exist — fine
    }

    // Create relative symlink pointing to the primary install location
    const relTarget = relative(providerDir, plan.targetDir);
    await symlink(relTarget, targetPath, "dir");
    debug(`install: symlinked ${targetPath} -> ${relTarget}`);
  }

  // Update result to indicate all-providers install
  primaryResult.provider = `All (${allProviders.map((p) => p.label).join(", ")})`;
  return primaryResult;
}

export async function cleanupTemp(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

// ─── Vercel npx skills add Support ──────────────────────────────────────────

export async function checkNpxAvailable(): Promise<void> {
  try {
    await execFileAsync("npx", ["--version"]);
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
    const result = await execFileAsync("npx", args, { timeout: 120_000 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err: any) {
    const stderr = err.stderr || err.message || "";
    throw new Error(`npx skills add failed: ${stderr}`);
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

  // Interactive picker — show ALL providers, pre-check enabled ones
  const pickerItems = config.providers.map((p) => ({
    label: `${p.label} (${p.name})`,
    hint: p.global,
    checked: p.enabled,
  }));

  const selectedIndices = await checkboxPicker({ items: pickerItems });

  if (selectedIndices.length === 0) {
    throw new Error("No tools selected. Aborting.");
  }

  const selectedProviders = selectedIndices.map((i) => config.providers[i]);

  if (selectedProviders.length === 1) {
    return { provider: selectedProviders[0], allProviders: null };
  }

  // Multiple providers — use "agents" as primary if selected, else first
  const primary =
    selectedProviders.find((p) => p.name === "agents") || selectedProviders[0];
  return { provider: primary, allProviders: selectedProviders };
}

export function buildInstallPlan(
  source: ParsedSource,
  tempDir: string,
  sourceDir: string,
  skillName: string,
  provider: ProviderConfig,
  force: boolean,
): InstallPlan {
  const globalDir = resolveProviderPath(provider.global);
  const targetDir = join(globalDir, skillName);

  return {
    source,
    tempDir,
    sourceDir,
    targetDir,
    skillName,
    force,
    providerName: provider.name,
    providerLabel: provider.label,
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
  } catch (err: any) {
    // If our own error, re-throw
    if (err.message?.includes("--force")) throw err;
    // Otherwise, directory doesn't exist — no conflict
    debug(`install: target ${targetDir} — no conflict`);
  }
}
