/**
 * Library core — lock file IO, listing, activation/deactivation, install, and
 * the staging/clone primitives shared with the update pipeline.
 * Split from library.ts (issue #455).
 */
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
} from "fs/promises";
import { execFile } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";
import { debug } from "./logger";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { createDirSymlink } from "./utils/fs";
import {
  AtomicWritePostRenameError,
  withFileMutationLock,
  writeTextFileAtomically,
} from "./utils/atomic-file";
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
  return readLibraryLockFile(path);
}

export async function writeLibraryLock(
  lock: LibraryLockFile,
  path: string = getLibraryLockPath(),
): Promise<void> {
  await withFileMutationLock(path, async () => {
    await persistLibraryLock(lock, path);
  });
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

export function libraryUpdateFailure(
  name: string,
  reason: string,
): LibraryUpdateResult {
  return { name, status: "failed", reason };
}

export async function libraryEntryMatchesUpdateSource(
  currentEntry: LibrarySkillEntry,
  expectedEntry: LibrarySkillEntry,
  expectedLocalSourceIdentity: string | null,
): Promise<boolean> {
  if (currentEntry.sourceType !== expectedEntry.sourceType) {
    return false;
  }
  if (
    resolve(currentEntry.libraryPath) !== resolve(expectedEntry.libraryPath)
  ) {
    return false;
  }
  if (currentEntry.sourceType === "local") {
    if (!expectedLocalSourceIdentity) {
      return false;
    }
    return (
      (await resolveLocalSourceIdentity(currentEntry)) ===
      expectedLocalSourceIdentity
    );
  }
  return (
    currentEntry.source === expectedEntry.source &&
    currentEntry.ref === expectedEntry.ref &&
    currentEntry.skillPath === expectedEntry.skillPath
  );
}

export function libraryEntryChangedDuringUpdate(
  name: string,
): LibraryUpdateResult {
  return libraryUpdateFailure(
    name,
    `Library skill "${name}" changed while update was in progress. Run "asm library update ${name}" again.`,
  );
}

export function nextInstalledAt(previousInstalledAt?: string): string {
  const previousTime = Date.parse(previousInstalledAt ?? "");
  const installedAt = Number.isFinite(previousTime)
    ? Math.max(Date.now(), previousTime + 1)
    : Date.now();
  return new Date(installedAt).toISOString();
}

export function librarySourceRoot(entry: LibrarySkillEntry): string | null {
  if (!entry.source.startsWith("local:")) {
    return null;
  }
  const basePath = entry.source.slice("local:".length);
  if (!basePath) {
    return null;
  }
  return resolve(basePath);
}

async function resolveLocalSourceIdentity(
  entry: LibrarySkillEntry,
): Promise<string> {
  const sourceRoot = librarySourceRoot(entry);
  if (!sourceRoot) {
    throw new Error("Unsupported library source for update");
  }

  const sourceDir = resolveContainedPath(
    sourceRoot,
    join(sourceRoot, entry.skillPath),
  );
  if (!sourceDir) {
    throw new Error("Invalid update metadata: skillPath escapes source root");
  }

  const [realSourceRoot, realSourceDir] = await Promise.all([
    realpath(sourceRoot),
    realpath(sourceDir),
  ]);
  if (!isContainedPath(realSourceRoot, realSourceDir)) {
    throw new Error("Invalid update metadata: skillPath escapes source root");
  }

  return realSourceDir;
}

export async function readLibraryLockFile(
  path: string,
): Promise<LibraryLockFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
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

export async function persistLibraryLock(
  lock: LibraryLockFile,
  path: string,
): Promise<void> {
  await writeTextFileAtomically(path, JSON.stringify(lock, null, 2) + "\n");
}

export function validateSourceSkillFrontmatter(
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

export function isContainedPath(parent: string, child: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  const rel = relative(resolvedParent, resolvedChild);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveContainedPath(
  parent: string,
  child: string,
): string | null {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return isContainedPath(resolvedParent, resolvedChild) ? resolvedChild : null;
}

async function realpathDeepestExistingAncestor(path: string): Promise<string> {
  let current = resolve(path);
  while (true) {
    try {
      return await realpath(current);
    } catch (err: unknown) {
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
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

export async function libraryPathRealpathIsContained(
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

export async function hashDirectoryContents(dir: string): Promise<string> {
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

export async function cloneRemoteLibrarySource(
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
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; message?: string };
    return {
      tempDir,
      reason: `Clone failed: ${execErr.stderr || execErr.message || String(err)}`,
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
      } catch (err: unknown) {
        const execErr = err as { stderr?: string; message?: string };
        return {
          tempDir,
          reason: `Checkout failed for ref ${ref}: ${execErr.stderr || execErr.message || String(err)}`,
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

export async function stageLibraryDirectory(
  sourceDir: string,
  targetDir: string,
): Promise<string> {
  const stagedDir = await mkdtemp(join(dirname(targetDir), ".library-update-"));

  try {
    await cp(sourceDir, stagedDir, { recursive: true });
    await rm(join(stagedDir, ".git"), { recursive: true, force: true });
    return stagedDir;
  } catch (err) {
    await rm(stagedDir, { recursive: true, force: true });
    throw err;
  }
}

export async function replaceDirectoryAtomically(input: {
  stagedDir: string;
  targetDir: string;
  writeLock: () => Promise<void>;
}): Promise<LibraryUpdateResult | null> {
  const parentDir = dirname(input.targetDir);
  let backupDir: string | null = null;
  let preserveBackup = false;

  try {
    try {
      if (await pathExists(input.targetDir)) {
        backupDir = join(parentDir, `.library-update-backup-${Date.now()}`);
        await rename(input.targetDir, backupDir);
      }

      await rename(input.stagedDir, input.targetDir);

      try {
        await input.writeLock();
        return null;
      } catch (err: unknown) {
        if (err instanceof AtomicWritePostRenameError) {
          return {
            name: "",
            status: "failed",
            reason: `Lock metadata and library files were published as the new generation, but parent-directory durability could not be confirmed: ${
              err.cause instanceof Error ? err.cause.message : String(err.cause)
            }`,
          };
        }

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
                err instanceof Error
                  ? (err.message ?? String(err))
                  : String(err)
              }. Restore of previous library copy also failed; backup preserved at ${backupDir}.`,
            };
          }
        }
        return {
          name: "",
          status: "failed",
          reason: `Updated library copy, but failed to write lock file: ${
            err instanceof Error ? (err.message ?? String(err)) : String(err)
          }`,
        };
      }
    } catch (err: unknown) {
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
        reason: `Failed to refresh library skill: ${err instanceof Error ? (err.message ?? String(err)) : String(err)}`,
      };
    }
  } finally {
    await rm(input.stagedDir, { recursive: true, force: true });
    if (backupDir && !preserveBackup) {
      await rm(backupDir, { recursive: true, force: true });
    }
  }
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
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
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
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        `Skill "${activationName}" is not active for ${input.provider}/${input.scope}.`,
        { cause: err },
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
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      // Target does not exist; proceed to create symlink.
    } else {
      throw err;
    }
  }

  await mkdir(input.targetDir, { recursive: true });
  await createDirSymlink(input.libraryPath, symlinkPath);
  return { symlinkPath, targetPath: input.libraryPath };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT")
      return false;
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

  await mkdir(skillsDir, { recursive: true });
  const stagedDir = await stageLibraryDirectory(plan.sourceDir, libraryPath);

  try {
    const skillMarkdown = await readFile(join(stagedDir, "SKILL.md"), "utf-8");
    const fm = parseFrontmatter(skillMarkdown);
    const name = fm.name || libraryName;
    const version = resolveVersion(fm);

    await withFileMutationLock(lockPath, async () => {
      const currentLock = await readLibraryLockFile(lockPath);
      if ((await pathExists(libraryPath)) && !plan.force) {
        throw new Error(
          `Library skill already exists: ${libraryPath}. Use --force to overwrite.`,
        );
      }

      const updatedLock = {
        ...currentLock,
        skills: {
          ...currentLock.skills,
          [libraryName]: {
            name,
            version,
            source: plan.source,
            sourceType: plan.sourceType,
            commitHash: plan.commitHash,
            ref: plan.ref,
            skillPath: plan.skillPath,
            libraryPath,
            installedAt: nextInstalledAt(
              currentLock.skills[libraryName]?.installedAt,
            ),
          },
        },
      };

      const swapResult = await replaceDirectoryAtomically({
        stagedDir,
        targetDir: libraryPath,
        writeLock: () => persistLibraryLock(updatedLock, lockPath),
      });
      if (swapResult) {
        throw new Error(swapResult.reason ?? "Failed to install library skill");
      }
    });

    return { name, version, libraryPath };
  } finally {
    await rm(stagedDir, { recursive: true, force: true });
  }
}
