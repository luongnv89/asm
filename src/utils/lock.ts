import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { dirname } from "path";
import { getLockPath } from "../config";
import { debug } from "../logger";
import type { LockFile, LockEntry } from "./types";

const execFileAsync = promisify(execFile);

function createEmptyLock(): LockFile {
  return { version: 1, skills: {} };
}

export async function readLock(): Promise<LockFile> {
  const lockPath = getLockPath();
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
    // Corrupted lock file — back up and rebuild
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

export async function writeLockEntry(
  name: string,
  entry: LockEntry,
): Promise<void> {
  const lock = await readLock();
  lock.skills[name] = entry;
  await writeLock(lock);
  debug(`lock: wrote entry for "${name}"`);
}

export async function removeLockEntry(name: string): Promise<void> {
  const lock = await readLock();
  if (!(name in lock.skills)) {
    debug(`lock: no entry for "${name}", nothing to remove`);
    return;
  }
  delete lock.skills[name];
  await writeLock(lock);
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
  const lock = await readLock();
  const entry = lock.skills[name];
  if (!entry) {
    debug(`lock: no entry for "${name}", cannot update provider`);
    return;
  }
  if (entry.provider === provider) {
    debug(`lock: entry for "${name}" already points at "${provider}"`);
    return;
  }
  lock.skills[name] = { ...entry, provider };
  await writeLock(lock);
  debug(`lock: updated provider for "${name}" -> "${provider}"`);
}

async function writeLock(lock: LockFile): Promise<void> {
  const lockPath = getLockPath();
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
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
