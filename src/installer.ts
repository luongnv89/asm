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
import { join, resolve, relative } from "path";
import { tmpdir } from "os";
import { parseFrontmatter } from "./utils/frontmatter";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import type {
  ParsedSource,
  InstallPlan,
  InstallResult,
  ProviderConfig,
  AppConfig,
  DiscoveredSkill,
} from "./utils/types";

const execFileAsync = promisify(execFile);

// ─── Source Parsing ────────────────────────────────────────────────────────

const OWNER_RE = /^[a-zA-Z0-9_-]+$/;
const REPO_RE = /^[a-zA-Z0-9._-]+$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_NAME_LENGTH = 128;
const GITHUB_URL_RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/(.+))?\/?$/;

export function parseSource(input: string): ParsedSource {
  // Normalize HTTPS GitHub URLs to github:owner/repo[#ref] format
  const urlMatch = GITHUB_URL_RE.exec(input);
  if (urlMatch) {
    const [, urlOwner, urlRepo, urlRef] = urlMatch;
    const cleanRepo = urlRepo.endsWith(".git") ? urlRepo.slice(0, -4) : urlRepo;
    input = `github:${urlOwner}/${cleanRepo}${urlRef ? `#${urlRef}` : ""}`;
  }

  if (!input.startsWith("github:")) {
    throw new Error(
      `Invalid source format. Got: "${input}"\nSupported formats:\n  github:owner/repo[#ref]\n  https://github.com/owner/repo`,
    );
  }

  const rest = input.slice("github:".length);
  const hashIdx = rest.indexOf("#");

  let ownerRepo: string;
  let ref: string | null = null;

  if (hashIdx !== -1) {
    ownerRepo = rest.slice(0, hashIdx);
    ref = rest.slice(hashIdx + 1);
    if (!ref) {
      throw new Error("Invalid source: ref cannot be empty after #");
    }
  } else {
    ownerRepo = rest;
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
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
  debug(`install: parsed source -> owner=${owner} repo=${repo} ref=${ref}`);
  return result;
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

export async function cloneToTemp(source: ParsedSource): Promise<string> {
  debug(
    `install: cloning ${source.cloneUrl}${source.ref ? ` (ref: ${source.ref})` : ""}`,
  );
  const tempDir = await mkdtemp(join(tmpdir(), "asm-install-"));

  const args = ["clone", "--depth", "1"];
  if (source.ref) {
    args.push("--branch", source.ref);
  }
  args.push(source.cloneUrl, tempDir);

  try {
    await execFileAsync("git", args, { timeout: 60_000 });
  } catch (err: any) {
    await cleanupTemp(tempDir);
    const msg = err.killed
      ? "Clone timed out after 60 seconds"
      : `Clone failed: ${err.stderr || err.message}`;
    throw new Error(msg);
  }

  return tempDir;
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
  const version = fm.version || "0.0.0";
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
          version: fm.version || "0.0.0",
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

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".bmp",
  ".webp",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
]);

async function readFilesRecursive(
  dir: string,
): Promise<Array<{ relPath: string; content: string }>> {
  const results: Array<{ relPath: string; content: string }> = [];

  async function walk(currentDir: string, prefix: string) {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry === ".git") continue;
      if (entry === "node_modules") continue;

      const fullPath = join(currentDir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;

      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (s.isFile()) {
          const ext = entry.includes(".")
            ? `.${entry.split(".").pop()!.toLowerCase()}`
            : "";
          if (BINARY_EXTENSIONS.has(ext)) continue;
          if (s.size > 512 * 1024) continue; // skip files > 512KB

          try {
            const content = await readFile(fullPath, "utf-8");
            results.push({ relPath, content });
          } catch {
            // skip unreadable files
          }
        }
      } catch {
        continue;
      }
    }
  }

  await walk(dir, "");
  return results;
}

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
  const sourceStr = `github:${plan.source.owner}/${plan.source.repo}${plan.source.ref ? `#${plan.source.ref}` : ""}`;

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
    version: fm.version || "0.0.0",
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

  if (enabled.length === 0) {
    throw new Error(
      "No providers are enabled. Enable a provider in your config.",
    );
  }

  // Handle "all" provider selection
  if (providerName === "all") {
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
    const names = enabled.map((p) => p.name).join(", ");
    throw new Error(
      `--provider is required in non-interactive mode. Available: ${names}, all`,
    );
  }

  // Interactive picker
  console.error("\nSelect a provider:");
  for (let i = 0; i < enabled.length; i++) {
    console.error(`  ${i + 1}) ${enabled[i].label} (${enabled[i].name})`);
  }
  console.error(
    `  ${enabled.length + 1}) All providers (shared .agents/skills/ + symlinks)`,
  );
  process.stderr.write("\nEnter number: ");

  const answer = await new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
      if (data.includes("\n")) {
        process.stdin.removeAllListeners("data");
        process.stdin.pause();
        resolve(data.trim());
      }
    });
    process.stdin.resume();
  });

  const idx = parseInt(answer, 10) - 1;
  if (idx === enabled.length) {
    // "All providers" selected
    const primary = enabled.find((p) => p.name === "agents") || enabled[0];
    return { provider: primary, allProviders: enabled };
  }
  if (isNaN(idx) || idx < 0 || idx >= enabled.length) {
    throw new Error("Invalid selection. Aborting.");
  }

  return { provider: enabled[idx], allProviders: null };
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
