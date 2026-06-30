import {
  access,
  copyFile,
  cp,
  mkdtemp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";
import { debug } from "./logger";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { sourceToCloneUrl } from "./updater";
import type { LibraryLockFile, LibrarySkillEntry } from "./utils/types";

const execFileAsync = promisify(execFile);

const LIBRARY_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_LIBRARY_NAME_LENGTH = 128;
const SOURCE_VERSION_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface InstallLibrarySkillPlan {
  sourceDir: string;
  libraryName: string;
  source: string;
  sourceType: "registry" | "github" | "local";
  commitHash: string;
  ref: string | null;
  skillPath: string;
  force: boolean;
}

export interface LibraryPaths {
  skillsDir?: string;
  lockPath?: string;
}

export interface LibrarySkillInfo {
  dirName: string;
  name: string;
  version: string;
  source: string;
  sourceType?: "registry" | "github" | "local";
  commitHash: string;
  ref: string | null;
  skillPath: string;
  libraryPath: string;
  installedAt: string;
  missing: boolean;
}

export interface LibraryUpdateResult {
  name: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  oldVersion?: string;
  newVersion?: string;
  oldCommit?: string;
  newCommit?: string;
}

export interface LibraryUpdateSummary {
  results: LibraryUpdateResult[];
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
}

export function emptyLibraryLock(): LibraryLockFile {
  return { version: 1, skills: {} };
}

export async function readLibraryLock(
  path: string = getLibraryLockPath(),
): Promise<LibraryLockFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      debug("library: lock file not found, returning empty lock");
      return emptyLibraryLock();
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.skills !== "object" ||
      parsed.skills === null ||
      Array.isArray(parsed.skills)
    ) {
      throw new Error("invalid schema");
    }
    return parsed as LibraryLockFile;
  } catch {
    const backupPath = path + ".bak";
    try {
      await copyFile(path, backupPath);
    } catch {
      // best effort backup
    }
    console.error(
      `Warning: library-lock.json was corrupted. Backup saved to ${backupPath}. Starting fresh.`,
    );
    return emptyLibraryLock();
  }
}

export async function writeLibraryLock(
  lock: LibraryLockFile,
  path: string = getLibraryLockPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(lock, null, 2) + "\n", "utf-8");
}

export async function listLibrarySkills(
  path: string = getLibraryLockPath(),
): Promise<LibrarySkillInfo[]> {
  const lock = await readLibraryLock(path);
  const rows: LibrarySkillInfo[] = [];

  for (const [dirName, entry] of Object.entries(lock.skills)) {
    let missing = false;
    try {
      await access(join(entry.libraryPath, "SKILL.md"));
    } catch {
      missing = true;
    }
    rows.push({ dirName, ...entry, missing });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function findLibrarySkill(
  rows: LibrarySkillInfo[],
  name: string,
): LibrarySkillInfo | null {
  const exactDir = rows.find((r) => r.dirName === name);
  if (exactDir) return exactDir;
  const exactName = rows.find((r) => r.name === name);
  return exactName ?? null;
}

function libraryUpdateFailure(
  name: string,
  reason: string,
): LibraryUpdateResult {
  return { name, status: "failed", reason };
}

function librarySourceRoot(entry: LibrarySkillEntry): string | null {
  if (!entry.source.startsWith("local:")) {
    return null;
  }
  const basePath = entry.source.slice("local:".length);
  if (!basePath) {
    return null;
  }
  return resolve(basePath);
}

function validateSourceSkillFrontmatter(
  frontmatter: Record<string, string>,
): { name: string; version: string } | { reason: string } {
  const name = frontmatter.name?.trim();
  if (!name) {
    return { reason: "Invalid source SKILL.md: missing name" };
  }

  const version = (
    frontmatter["metadata.version"] || frontmatter.version
  )?.trim();
  if (!version) {
    return { reason: "Invalid source SKILL.md: missing version" };
  }
  if (!SOURCE_VERSION_RE.test(version)) {
    return { reason: "Invalid source SKILL.md: invalid version" };
  }

  return { name, version };
}

function isContainedPath(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const rel = relative(resolvedParent, resolvedChild);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function resolveContainedPath(parent: string, child: string): string | null {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return isContainedPath(resolvedParent, resolvedChild) ? resolvedChild : null;
}

async function realpathDeepestExistingAncestor(path: string): Promise<string> {
  let current = resolve(path);
  while (true) {
    try {
      return await realpath(current);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw err;
      }
      current = parent;
    }
  }
}

async function libraryPathRealpathIsContained(
  skillsDir: string,
  libraryPath: string,
): Promise<boolean> {
  try {
    const [realSkillsDir, realLibraryAncestor] = await Promise.all([
      realpath(skillsDir),
      realpathDeepestExistingAncestor(libraryPath),
    ]);
    return isContainedPath(realSkillsDir, realLibraryAncestor);
  } catch {
    return false;
  }
}

async function hashDirectoryContents(dir: string): Promise<string> {
  const hash = createHash("sha256");

  async function walk(currentDir: string, relativeDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const entryRelativePath = relativeDir
        ? join(relativeDir, entry.name)
        : entry.name;
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${entryRelativePath}\n`);
        await walk(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        hash.update(`file:${entryRelativePath}\n`);
        hash.update(await readFile(entryPath));
        hash.update("\n");
      }
    }
  }

  await walk(dir, "");
  return hash.digest("hex");
}

async function cloneRemoteLibrarySource(
  entry: LibrarySkillEntry,
  dirName: string,
  lockPath: string,
): Promise<
  { tempDir: string; commitHash: string } | { reason: string; tempDir?: string }
> {
  const cloneUrl = sourceToCloneUrl(entry.source);
  if (!cloneUrl) {
    return { reason: "Cannot determine remote URL" };
  }

  const tempParent = join(dirname(lockPath), ".tmp");
  await mkdir(tempParent, { recursive: true });
  const tempDir = await mkdtemp(join(tempParent, `${dirName}-`));
  const ref = entry.ref && entry.ref !== "HEAD" ? entry.ref : null;
  const isCommitSha = !!ref && /^[0-9a-f]{40}$/i.test(ref);
  const cloneArgs = ["clone", "--depth", "1"];
  if (ref && !isCommitSha) {
    cloneArgs.push("--branch", ref);
  }
  cloneArgs.push(cloneUrl, tempDir);

  try {
    await execFileAsync("git", cloneArgs, { timeout: 60_000 });
  } catch (err: any) {
    return {
      tempDir,
      reason: `Clone failed: ${err?.stderr || err?.message || String(err)}`,
    };
  }

  if (ref && isCommitSha) {
    try {
      await execFileAsync("git", ["checkout", ref], {
        cwd: tempDir,
        timeout: 30_000,
      });
    } catch {
      try {
        await execFileAsync("git", ["fetch", "--depth", "1", "origin", ref], {
          cwd: tempDir,
          timeout: 60_000,
        });
        await execFileAsync("git", ["checkout", "FETCH_HEAD"], {
          cwd: tempDir,
          timeout: 30_000,
        });
      } catch (err: any) {
        return {
          tempDir,
          reason: `Checkout failed for ref ${ref}: ${
            err?.stderr || err?.message || String(err)
          }`,
        };
      }
    }
  }

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      timeout: 5_000,
    });
    const commitHash = stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commitHash)) {
      return { tempDir, reason: "Could not read new commit" };
    }
    return { tempDir, commitHash };
  } catch {
    return { tempDir, reason: "Could not read new commit" };
  }
}

async function replaceDirectoryAtomically(input: {
  sourceDir: string;
  targetDir: string;
  writeLock: () => Promise<void>;
}): Promise<LibraryUpdateResult | null> {
  const parentDir = dirname(input.targetDir);
  const stagedDir = await mkdtemp(join(parentDir, ".library-update-"));
  let backupDir: string | null = null;
  let preserveBackup = false;

  try {
    try {
      await cp(input.sourceDir, stagedDir, { recursive: true });
      await rm(join(stagedDir, ".git"), { recursive: true, force: true });

      if (await pathExists(input.targetDir)) {
        backupDir = join(parentDir, `.library-update-backup-${Date.now()}`);
        await rename(input.targetDir, backupDir);
      }

      await rename(stagedDir, input.targetDir);

      try {
        await input.writeLock();
        return null;
      } catch (err: any) {
        await rm(input.targetDir, { recursive: true, force: true });
        if (backupDir) {
          try {
            await rename(backupDir, input.targetDir);
            backupDir = null;
          } catch {
            preserveBackup = true;
            return {
              name: "",
              status: "failed",
              reason: `Updated library copy, but failed to write lock file: ${
                err?.message ?? String(err)
              }. Restore of previous library copy also failed; backup preserved at ${backupDir}.`,
            };
          }
        }
        return {
          name: "",
          status: "failed",
          reason: `Updated library copy, but failed to write lock file: ${
            err?.message ?? String(err)
          }`,
        };
      }
    } catch (err: any) {
      if (backupDir) {
        try {
          await rename(backupDir, input.targetDir);
          backupDir = null;
        } catch {
          preserveBackup = true;
        }
      }
      return {
        name: "",
        status: "failed",
        reason: `Failed to refresh library skill: ${err?.message ?? String(err)}`,
      };
    }
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
    if (backupDir && !preserveBackup) {
      await rm(backupDir, { recursive: true, force: true });
    }
  }
}

export async function updateLibrarySkill(
  name: string,
  paths: LibraryPaths = {},
  _overrides?: {
    writeLibraryLockFn?: typeof writeLibraryLock;
  },
): Promise<LibraryUpdateResult> {
  const lockPath = paths.lockPath ?? getLibraryLockPath();
  const skillsDir = paths.skillsDir ?? getLibrarySkillsDir();
  const writeLibraryLockFn = _overrides?.writeLibraryLockFn ?? writeLibraryLock;
  const lock = await readLibraryLock(lockPath);
  const directEntry = lock.skills[name] ?? null;
  const nameMatch =
    (Object.entries(lock.skills) as Array<[string, LibrarySkillEntry]>).find(
      ([, entry]) => entry.name === name,
    ) ?? null;
  const selected: [string, LibrarySkillEntry] | null = directEntry
    ? [name, directEntry]
    : nameMatch;

  if (!selected) {
    return libraryUpdateFailure(
      name,
      `Library skill "${name}" not found. Run "asm library list".`,
    );
  }

  const [dirName, entry] = selected;

  if (!entry.source || !entry.source.trim()) {
    return libraryUpdateFailure(dirName, "Missing update metadata: source");
  }
  if (!entry.sourceType || !entry.sourceType.trim()) {
    return libraryUpdateFailure(dirName, "Missing update metadata: sourceType");
  }
  if (entry.skillPath === undefined || entry.skillPath === null) {
    return libraryUpdateFailure(dirName, "Missing update metadata: skillPath");
  }
  if (!entry.libraryPath || !entry.libraryPath.trim()) {
    return libraryUpdateFailure(
      dirName,
      "Missing update metadata: libraryPath",
    );
  }

  let cleanupSourceRoot: string | null = null;
  try {
    let sourceRoot: string;
    let nextCommitHash: string | null = null;

    if (entry.sourceType === "local") {
      const localSourceRoot = librarySourceRoot(entry);
      if (!localSourceRoot) {
        return libraryUpdateFailure(
          dirName,
          `Unsupported library source for update: ${entry.source}`,
        );
      }
      sourceRoot = localSourceRoot;
    } else if (
      entry.sourceType === "github" ||
      entry.sourceType === "registry"
    ) {
      const cloneResult = await cloneRemoteLibrarySource(
        entry,
        dirName,
        lockPath,
      );
      if ("reason" in cloneResult) {
        if (cloneResult.tempDir) {
          cleanupSourceRoot = cloneResult.tempDir;
        }
        return libraryUpdateFailure(dirName, cloneResult.reason);
      }
      sourceRoot = cloneResult.tempDir;
      cleanupSourceRoot = cloneResult.tempDir;
      nextCommitHash = cloneResult.commitHash;
    } else {
      return libraryUpdateFailure(
        dirName,
        `Unsupported library source type for update: ${entry.sourceType}`,
      );
    }

    const sourceDir = resolveContainedPath(
      sourceRoot,
      join(sourceRoot, entry.skillPath),
    );
    if (!sourceDir) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: skillPath escapes source root",
      );
    }

    const sourceSkillPath = join(sourceDir, "SKILL.md");
    let realSourceRoot: string;
    let realSourceDir: string;
    try {
      [realSourceRoot, realSourceDir] = await Promise.all([
        realpath(sourceRoot),
        realpath(sourceDir),
      ]);
    } catch (err: any) {
      return libraryUpdateFailure(
        dirName,
        `Unable to read source SKILL.md at ${sourceSkillPath}: ${
          err?.message ?? String(err)
        }`,
      );
    }
    if (!isContainedPath(realSourceRoot, realSourceDir)) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: skillPath escapes source root",
      );
    }

    const libraryPath = resolveContainedPath(skillsDir, entry.libraryPath);
    if (!libraryPath) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: libraryPath escapes library skills directory",
      );
    }
    if (!(await libraryPathRealpathIsContained(skillsDir, libraryPath))) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: libraryPath escapes library skills directory",
      );
    }

    let sourceMarkdown: string;
    try {
      sourceMarkdown = await readFile(sourceSkillPath, "utf-8");
    } catch (err: any) {
      return libraryUpdateFailure(
        dirName,
        `Unable to read source SKILL.md at ${sourceSkillPath}: ${
          err?.message ?? String(err)
        }`,
      );
    }

    const frontmatter = parseFrontmatter(sourceMarkdown);
    const sourceMetadata = validateSourceSkillFrontmatter(frontmatter);
    if ("reason" in sourceMetadata) {
      return libraryUpdateFailure(dirName, sourceMetadata.reason);
    }

    const nameFromSource = sourceMetadata.name;
    const versionFromSource = sourceMetadata.version;
    if (entry.sourceType === "local") {
      nextCommitHash = await hashDirectoryContents(sourceDir);
    }
    if (!nextCommitHash) {
      return libraryUpdateFailure(dirName, "Could not read new commit");
    }
    if (entry.commitHash === nextCommitHash) {
      return {
        name: nameFromSource,
        status: "skipped",
        oldVersion: entry.version,
        newVersion: versionFromSource,
        oldCommit: entry.commitHash,
        newCommit: nextCommitHash,
      };
    }
    const updatedLock = {
      ...lock,
      skills: {
        ...lock.skills,
        [dirName]: {
          ...entry,
          name: nameFromSource,
          version: versionFromSource,
          commitHash: nextCommitHash,
          installedAt: new Date().toISOString(),
        },
      },
    };

    const swapResult = await replaceDirectoryAtomically({
      sourceDir,
      targetDir: libraryPath,
      writeLock: () => writeLibraryLockFn(updatedLock, lockPath),
    });
    if (swapResult) {
      return libraryUpdateFailure(
        dirName,
        swapResult.reason ?? "Failed to update library skill",
      );
    }

    return {
      name: nameFromSource,
      status: "updated",
      oldVersion: entry.version,
      newVersion: versionFromSource,
      oldCommit: entry.commitHash,
      newCommit: nextCommitHash,
    };
  } finally {
    if (cleanupSourceRoot) {
      await rm(cleanupSourceRoot, { recursive: true, force: true });
    }
  }
}

export async function updateLibrarySkills(
  names: string[] | null,
  paths: LibraryPaths = {},
): Promise<LibraryUpdateSummary> {
  const lockPath = paths.lockPath ?? getLibraryLockPath();
  const lock = await readLibraryLock(lockPath);
  const selectedNames = names === null ? Object.keys(lock.skills) : names;
  const warnings: string[] = [];
  const results: LibraryUpdateResult[] = [];

  for (const selectedName of selectedNames) {
    const result = await updateLibrarySkill(selectedName, paths);
    if (
      result.status === "failed" &&
      result.reason?.includes('Run "asm library list"')
    ) {
      warnings.push(result.reason);
    }
    results.push(result);
  }

  return {
    results,
    updatedCount: results.filter((result) => result.status === "updated")
      .length,
    skippedCount: results.filter((result) => result.status === "skipped")
      .length,
    failedCount: results.filter((result) => result.status === "failed").length,
    warnings,
  };
}

export interface DeactivateLibrarySkillInput {
  targetDir: string;
  activationName: string;
  provider: string;
  scope: "global" | "project";
  librarySkillsDir?: string;
}

export interface DeactivateLibrarySkillResult {
  name: string;
  provider: string;
  scope: "global" | "project";
  path: string;
  target: string;
}

function isInsideDirectory(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function realpathIfExists(path: string): Promise<{
  path: string;
  exists: boolean;
}> {
  try {
    return { path: await realpath(path), exists: true };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { path: resolve(path), exists: false };
    }
    throw err;
  }
}

export async function deactivateLibrarySkill(
  input: DeactivateLibrarySkillInput,
): Promise<DeactivateLibrarySkillResult> {
  const activationName = validateSkillDirectoryName(input.activationName);
  const symlinkPath = join(input.targetDir, activationName);

  let stat;
  try {
    stat = await lstat(symlinkPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        `Skill "${activationName}" is not active for ${input.provider}/${input.scope}.`,
      );
    }
    throw err;
  }

  if (!stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to deactivate non-symlink target: ${symlinkPath}.`,
    );
  }

  const rawTarget = await readlink(symlinkPath);
  const absoluteTarget = isAbsolute(rawTarget)
    ? rawTarget
    : resolve(dirname(symlinkPath), rawTarget);
  const librarySkillsDir = input.librarySkillsDir ?? getLibrarySkillsDir();
  const resolvedTarget = await realpathIfExists(absoluteTarget);
  const resolvedLibrarySkillsDir = await realpathIfExists(librarySkillsDir);
  const useRealPaths = resolvedTarget.exists && resolvedLibrarySkillsDir.exists;
  const targetPathForContainment = useRealPaths
    ? resolvedTarget.path
    : resolve(absoluteTarget);
  const libraryPathForContainment = useRealPaths
    ? resolvedLibrarySkillsDir.path
    : resolve(librarySkillsDir);

  if (!isInsideDirectory(libraryPathForContainment, targetPathForContainment)) {
    throw new Error(
      `Refusing to deactivate symlink outside the ASM library: ${symlinkPath}.`,
    );
  }

  await rm(symlinkPath);

  return {
    name: activationName,
    provider: input.provider,
    scope: input.scope,
    path: symlinkPath,
    target: targetPathForContainment,
  };
}

export async function activateLibrarySkill(input: {
  libraryPath: string;
  targetDir: string;
  activationName: string;
  force: boolean;
}): Promise<{ symlinkPath: string; targetPath: string }> {
  const activationName = validateSkillDirectoryName(input.activationName);
  const symlinkPath = join(input.targetDir, activationName);
  try {
    const stat = await lstat(symlinkPath);
    if (!input.force) {
      throw new Error(
        `Target already exists: ${symlinkPath}. Use --force to overwrite.`,
      );
    }
    if (!stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to overwrite non-symlink target: ${symlinkPath}.`,
      );
    }
    await rm(symlinkPath, { force: true });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // Target does not exist; proceed to create symlink.
    } else {
      throw err;
    }
  }

  await mkdir(input.targetDir, { recursive: true });
  await symlink(input.libraryPath, symlinkPath, "dir");
  return { symlinkPath, targetPath: input.libraryPath };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

function validateSkillDirectoryName(name: string): string {
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
  if (name.length > MAX_LIBRARY_NAME_LENGTH) {
    throw new Error(
      `Invalid skill name: exceeds maximum length of ${MAX_LIBRARY_NAME_LENGTH} characters`,
    );
  }
  if (!LIBRARY_NAME_RE.test(name)) {
    throw new Error(
      `Invalid skill name: "${name}" does not match allowed pattern [a-zA-Z0-9][a-zA-Z0-9._-]*`,
    );
  }
  return name;
}

export async function installLibrarySkill(
  plan: InstallLibrarySkillPlan,
  paths: LibraryPaths = {},
): Promise<{ name: string; version: string; libraryPath: string }> {
  const skillsDir = paths.skillsDir ?? getLibrarySkillsDir();
  const lockPath = paths.lockPath ?? getLibraryLockPath();
  const libraryName = validateSkillDirectoryName(plan.libraryName);
  const libraryPath = join(skillsDir, libraryName);

  if (await pathExists(libraryPath)) {
    if (!plan.force) {
      throw new Error(
        `Library skill already exists: ${libraryPath}. Use --force to overwrite.`,
      );
    }
    await rm(libraryPath, { recursive: true, force: true });
  }

  await mkdir(skillsDir, { recursive: true });
  await cp(plan.sourceDir, libraryPath, { recursive: true });
  await rm(join(libraryPath, ".git"), { recursive: true, force: true });

  const skillMarkdown = await readFile(join(libraryPath, "SKILL.md"), "utf-8");
  const fm = parseFrontmatter(skillMarkdown);
  const name = fm.name || libraryName;
  const version = resolveVersion(fm);

  const lock = await readLibraryLock(lockPath);
  lock.skills[libraryName] = {
    name,
    version,
    source: plan.source,
    sourceType: plan.sourceType,
    commitHash: plan.commitHash,
    ref: plan.ref,
    skillPath: plan.skillPath,
    libraryPath,
    installedAt: new Date().toISOString(),
  };
  await writeLibraryLock(lock, lockPath);

  return { name, version, libraryPath };
}
