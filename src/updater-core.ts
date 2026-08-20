/**
 * Skill lifecycle management: outdated detection and atomic updates.
 *
 * Provides `checkOutdated()` to compare installed skill commits against
 * remote HEAD, and `updateSkills()` to upgrade skills atomically with
 * security re-audit.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import { join } from "path";

import { debug } from "./logger";
import { readLock } from "./utils/lock";
import { fetchRegistryIndex } from "./registry";
import type { RegistryIndex } from "./registry";
import type { LockEntry } from "./utils/types";

import type { SecurityVerdict } from "./utils/types";

const execFileAsync = promisify(execFile);

// Repository-local Git variables can redirect commands away from their cwd.
// Keep transport/auth variables intact, but never inherit repository routing.
const REPOSITORY_LOCAL_GIT_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
] as const;

export function createPinnedGitEnv(
  objectFormat: "sha1" | "sha256",
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const variable of REPOSITORY_LOCAL_GIT_ENV_VARS) {
    delete env[variable];
  }
  for (const variable of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(variable)) {
      delete env[variable];
    }
  }
  env.GIT_DEFAULT_HASH = objectFormat;
  return env;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type OutdatedStatus = "outdated" | "up-to-date" | "untracked" | "error";

export interface OutdatedEntry {
  name: string;
  installedCommit: string;
  latestCommit: string;
  source: string;
  sourceType: "registry" | "github" | "local";
  status: OutdatedStatus;
  error?: string;
}

export interface OutdatedSummary {
  entries: OutdatedEntry[];
  outdatedCount: number;
  upToDateCount: number;
  untrackedCount: number;
  errorCount: number;
}

export interface UpdateResult {
  name: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  oldCommit?: string;
  newCommit?: string;
  securityVerdict?: SecurityVerdict;
}

export interface UpdateSummary {
  results: UpdateResult[];
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  /** Warnings for skills requested by name but not found in the lock file. */
  warnings?: string[];
}

// Keep resolved OIDs internal so public entries and formatter output retain their
// existing shape. updateSkills consumes the same entry objects returned below.
export const resolvedLatestCommits = new WeakMap<OutdatedEntry, string>();

function recordResolvedLatestCommit<T extends OutdatedEntry>(
  entry: T,
  commit: string,
): T {
  resolvedLatestCommits.set(entry, commit);
  return entry;
}

// ─── Concurrency Pool ───────────────────────────────────────────────────────

export function normalizedTargetIdentity(name: string): string {
  // toLowerCase uses Unicode's locale-independent default case mapping.
  return name.normalize("NFC").toLowerCase().normalize("NFC");
}

export async function poolAll<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ─── Remote Commit Resolution ───────────────────────────────────────────────

/**
 * Get the latest commit hash from a remote git repository.
 * Times out after 10 seconds.
 */
export async function getLatestRemoteCommit(
  repoUrl: string,
  ref: string | null,
): Promise<string | null> {
  try {
    const args = ["ls-remote", repoUrl];
    if (ref) {
      // Ask for the peeled form too so annotated tags resolve to commits.
      args.push(ref, `${ref}^{}`);
    } else {
      args.push("HEAD");
    }

    const { stdout } = await execFileAsync("git", args, { timeout: 10_000 });
    const advertised = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      const [hash, advertisedRef] = line.trim().split(/\s+/);
      if (
        advertisedRef &&
        hash &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)
      ) {
        advertised.set(advertisedRef, hash);
      }
    }

    if (!ref || ref === "HEAD") return advertised.get("HEAD") ?? null;
    if (ref.startsWith("refs/")) {
      return advertised.get(`${ref}^{}`) ?? advertised.get(ref) ?? null;
    }
    return (
      advertised.get(`refs/heads/${ref}`) ??
      advertised.get(`refs/tags/${ref}^{}`) ??
      advertised.get(`refs/tags/${ref}`) ??
      null
    );
  } catch (err) {
    debug(`updater: git ls-remote failed for ${repoUrl}: ${err}`);
    return null;
  }
}

/**
 * Resolve the source type for a lock entry.
 * Backward compatible: entries without sourceType are inferred from the source string.
 */
export function resolveSourceType(
  entry: LockEntry,
): "registry" | "github" | "local" {
  if (entry.sourceType) return entry.sourceType;
  if (entry.source.startsWith("local:")) return "local";
  return "github";
}

/**
 * Extract the clone URL from a lock entry source string.
 * Handles formats: "github:owner/repo" -> "https://github.com/owner/repo.git"
 */
export function sourceToCloneUrl(source: string): string | null {
  if (source.startsWith("github:")) {
    let ownerRepo = source.slice("github:".length);
    // Strip #ref or #ref:subpath fragments (lock entries may contain them)
    const hashIdx = ownerRepo.indexOf("#");
    if (hashIdx !== -1) {
      ownerRepo = ownerRepo.slice(0, hashIdx);
    }
    return `https://github.com/${ownerRepo}.git`;
  }
  // Support file:// URLs for testing and local bare-repo sources
  if (source.startsWith("file://")) {
    return source;
  }
  return null;
}

/**
 * Extract owner and repo from a source string like "github:owner/repo"
 * or "github:owner/repo#ref". Returns null if the source is not a GitHub source.
 */
export function extractOwnerRepo(
  source: string,
): { owner: string; repo: string } | null {
  if (!source.startsWith("github:")) return null;
  let ownerRepo = source.slice("github:".length);
  // Strip #ref or #ref:subpath fragments
  const hashIdx = ownerRepo.indexOf("#");
  if (hashIdx !== -1) {
    ownerRepo = ownerRepo.slice(0, hashIdx);
  }
  const parts = ownerRepo.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function getUpdateSourceDir(tempDir: string, entry: LockEntry): string {
  return entry.skillPath ? join(tempDir, entry.skillPath) : tempDir;
}

// ─── Outdated Check ─────────────────────────────────────────────────────────

/**
 * Check all installed skills for newer versions.
 * Registry skills are compared against index.json.
 * Non-registry skills use git ls-remote.
 * Runs with a concurrency limit of 5.
 */

/** @internal — injectable overrides for testing checkOutdated. */
export interface _CheckOutdatedTestOverrides {
  readLockFn?: typeof readLock;
  fetchRegistryIndexFn?: typeof fetchRegistryIndex;
  /** Pre-read lock file — avoids a redundant readLock() call when the caller already has it. */
  lock?: import("./utils/types").LockFile;
}

export async function checkOutdated(
  _overrides?: _CheckOutdatedTestOverrides,
): Promise<OutdatedSummary> {
  const readLockFn = _overrides?.readLockFn ?? readLock;
  const fetchRegistryFn =
    _overrides?.fetchRegistryIndexFn ?? fetchRegistryIndex;
  const lock = _overrides?.lock ?? (await readLockFn());
  const entries = Object.entries(lock.skills);

  if (entries.length === 0) {
    return {
      entries: [],
      outdatedCount: 0,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 0,
    };
  }

  // Fetch registry index once for all registry skills
  let registryIndex: RegistryIndex | null = null;
  const hasRegistrySkills = entries.some(
    ([, e]) => resolveSourceType(e) === "registry" || e.registryName,
  );
  if (hasRegistrySkills) {
    registryIndex = await fetchRegistryFn();
  }

  const results = await poolAll(entries, 5, async ([name, entry]) => {
    const sourceType = resolveSourceType(entry);

    // Untracked: no commit hash recorded (pre-registry installs)
    if (!entry.commitHash || entry.commitHash === "unknown") {
      return {
        name,
        installedCommit: entry.commitHash || "unknown",
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "untracked" as OutdatedStatus,
      };
    }

    // Local skills: cannot check for updates remotely
    if (sourceType === "local") {
      return {
        name,
        installedCommit: entry.commitHash,
        latestCommit: entry.commitHash,
        source: entry.source,
        sourceType,
        status: "up-to-date" as OutdatedStatus,
      };
    }

    // Registry skills: check against index.json manifest
    if (sourceType === "registry" && registryIndex) {
      const registryName = entry.registryName || name;
      const manifest = registryIndex.manifests.find(
        (m) => m.name.toLowerCase() === registryName.toLowerCase(),
      );
      if (manifest) {
        const isOutdated = manifest.commit !== entry.commitHash;
        return recordResolvedLatestCommit(
          {
            name,
            installedCommit: shortHash(entry.commitHash),
            latestCommit: shortHash(manifest.commit),
            source: entry.source,
            sourceType,
            status: isOutdated
              ? ("outdated" as OutdatedStatus)
              : ("up-to-date" as OutdatedStatus),
          },
          manifest.commit,
        );
      }
      // Registry skill not found in index — fall through to git ls-remote
    }

    // GitHub skills: use git ls-remote
    const cloneUrl = sourceToCloneUrl(entry.source);
    if (!cloneUrl) {
      return {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "error" as OutdatedStatus,
        error: "Cannot determine remote URL",
      };
    }

    const latestCommit = await getLatestRemoteCommit(cloneUrl, entry.ref);
    if (!latestCommit) {
      return {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "error" as OutdatedStatus,
        error: "Failed to fetch remote commit",
      };
    }

    const isOutdated = latestCommit !== entry.commitHash;
    return recordResolvedLatestCommit(
      {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: shortHash(latestCommit),
        source: entry.source,
        sourceType,
        status: isOutdated
          ? ("outdated" as OutdatedStatus)
          : ("up-to-date" as OutdatedStatus),
      },
      latestCommit,
    );
  });

  return {
    entries: results,
    outdatedCount: results.filter((r) => r.status === "outdated").length,
    upToDateCount: results.filter((r) => r.status === "up-to-date").length,
    untrackedCount: results.filter((r) => r.status === "untracked").length,
    errorCount: results.filter((r) => r.status === "error").length,
  };
}

// ─── Update Skills ──────────────────────────────────────────────────────────

/**
 * Update one or more skills to the latest version.
 * For each skill:
 *   1. Clone latest version to temp directory
 *   2. Run SecurityAuditor on the new version
 *   3. If audit fails (dangerous): skip
 *   4. Atomic swap: remove old -> move new into place
 *   5. Update .skill-lock.json with new commit SHA
 */
/** @internal — injectable overrides for testing (avoids mock.module leaks). */

export function shortHash(hash: string): string {
  if (!hash || hash === "unknown") return "unknown";
  return hash.slice(0, 7);
}
