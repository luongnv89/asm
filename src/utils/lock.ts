import { readFile, copyFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { getLockPath } from "../config";
import { debug } from "../logger";
import { withFileMutationLock, writeTextFileAtomically } from "./atomic-file";
import type { LockFile, LockEntry } from "./types";

const execFileAsync = promisify(execFile);

function createEmptyLock(): LockFile {
  return { version: 1, skills: {} };
}

export async function readLock(): Promise<LockFile> {
  return readLockFile(getLockPath());
}

export async function writeLockEntry(
  name: string,
  entry: LockEntry,
): Promise<void> {
  await mutateLock((lock) => {
    lock.skills[name] = entry;
    return { changed: true };
  });
  debug(`lock: wrote entry for "${name}"`);
}

export async function removeLockEntry(name: string): Promise<void> {
  const removed = await mutateLock((lock) => {
    if (!(name in lock.skills)) {
      return { changed: false, result: false };
    }
    delete lock.skills[name];
    return { changed: true, result: true };
  });

  if (!removed) {
    debug(`lock: no entry for "${name}", nothing to remove`);
    return;
  }

  debug(`lock: removed entry for "${name}"`);
}

/**
 * Rewrite an existing entry's provider field while preserving every other
 * field (source, commitHash, ref, installedAt, sourceType, registryName).
 * No-op when the entry doesn't exist. Used by partial-uninstall (`-t`) when
 * a real-folder relocation moves the canonical home from one provider to
 * another and source-tracking metadata must follow the surviving instance.
 */
export async function setLockEntryProvider(
  name: string,
  provider: string,
): Promise<void> {
  const outcome = await mutateLock((lock) => {
    const entry = lock.skills[name];
    if (!entry) {
      return { changed: false, result: "missing" as const };
    }
    if (entry.provider === provider) {
      return { changed: false, result: "unchanged" as const };
    }
    lock.skills[name] = { ...entry, provider };
    return { changed: true, result: "updated" as const };
  });

  if (outcome === "missing") {
    debug(`lock: no entry for "${name}", cannot update provider`);
    return;
  }
  if (outcome === "unchanged") {
    debug(`lock: entry for "${name}" already points at "${provider}"`);
    return;
  }

  debug(`lock: updated provider for "${name}" -> "${provider}"`);
}

async function readLockFile(lockPath: string): Promise<LockFile> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      debug("lock: file not found, returning empty lock");
      return createEmptyLock();
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed.version !== 1 ||
      typeof parsed.skills !== "object" ||
      parsed.skills === null
    ) {
      throw new Error("invalid schema");
    }
    debug(`lock: loaded ${Object.keys(parsed.skills).length} entries`);
    return parsed as LockFile;
  } catch {
    const backupPath = lockPath + ".bak";
    debug(`lock: parse error, backing up to ${backupPath}`);
    try {
      await copyFile(lockPath, backupPath);
    } catch {
      // best effort backup
    }
    console.error(
      `Warning: .skill-lock.json was corrupted. Backup saved to ${backupPath}. Starting fresh.`,
    );
    return createEmptyLock();
  }
}

async function mutateLock<T>(
  mutate: (
    lock: LockFile,
  ) =>
    | Promise<{ changed: boolean; result?: T }>
    | { changed: boolean; result?: T },
): Promise<T | undefined> {
  const lockPath = getLockPath();
  return withFileMutationLock(lockPath, async () => {
    const lock = await readLockFile(lockPath);
    const { changed, result } = await mutate(lock);
    if (changed) {
      await writeLock(lock, lockPath);
    }
    return result;
  });
}

async function writeLock(lock: LockFile, lockPath: string): Promise<void> {
  await writeTextFileAtomically(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

export async function getCommitHash(repoDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    debug("lock: could not read commit hash from cloned repo");
    return null;
  }
}
