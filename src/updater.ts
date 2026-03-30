/**
 * Skill lifecycle management: outdated detection and atomic updates.
 *
 * Provides `checkOutdated()` to compare installed skill commits against
 * remote HEAD, and `updateSkills()` to upgrade skills atomically with
 * security re-audit.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { rm, rename, cp, access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { debug } from "./logger";
import { readLock, writeLockEntry } from "./utils/lock";
import { fetchRegistryIndex } from "./registry";
import type { RegistryManifest, RegistryIndex } from "./registry";
import type { LockEntry } from "./utils/types";
import { auditSkillSecurity } from "./security-auditor";
import type { SecurityVerdict } from "./utils/types";
import { resolveProviderPath, loadConfig } from "./config";
import { ansi } from "./formatter";

const execFileAsync = promisify(execFile);

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

// ─── Concurrency Pool ───────────────────────────────────────────────────────

async function poolAll<T, R>(
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
      args.push(ref);
    } else {
      args.push("HEAD");
    }

    const { stdout } = await execFileAsync("git", args, { timeout: 10_000 });
    const firstLine = stdout.split("\n")[0];
    if (!firstLine) return null;
    const hash = firstLine.split(/\s+/)[0];
    return hash && /^[0-9a-f]{40}$/.test(hash) ? hash : null;
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
        return {
          name,
          installedCommit: shortHash(entry.commitHash),
          latestCommit: shortHash(manifest.commit),
          source: entry.source,
          sourceType,
          status: isOutdated
            ? ("outdated" as OutdatedStatus)
            : ("up-to-date" as OutdatedStatus),
        };
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
    return {
      name,
      installedCommit: shortHash(entry.commitHash),
      latestCommit: shortHash(latestCommit),
      source: entry.source,
      sourceType,
      status: isOutdated
        ? ("outdated" as OutdatedStatus)
        : ("up-to-date" as OutdatedStatus),
    };
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
export interface _UpdateTestOverrides {
  auditFn?: (
    skillPath: string,
    skillName: string,
    sourceOwner?: string,
    sourceRepo?: string,
  ) => Promise<{ verdict: SecurityVerdict }>;
  loadConfigFn?: typeof loadConfig;
  resolveProviderPathFn?: typeof resolveProviderPath;
  writeLockEntryFn?: typeof writeLockEntry;
}

export async function updateSkill(
  name: string,
  entry: LockEntry,
  skipConfirm: boolean,
  _overrides?: _UpdateTestOverrides,
): Promise<UpdateResult> {
  const sourceType = resolveSourceType(entry);

  // Cannot update local skills
  if (sourceType === "local") {
    return { name, status: "skipped", reason: "Local skill (not updatable)" };
  }

  // Need a clone URL
  const cloneUrl = sourceToCloneUrl(entry.source);
  if (!cloneUrl) {
    return { name, status: "failed", reason: "Cannot determine remote URL" };
  }

  const tempDir = join(
    homedir(),
    ".config",
    "agent-skill-manager",
    ".tmp",
    `${name}-${Date.now()}`,
  );

  try {
    // Ensure the parent temp directory exists
    const tempParent = join(
      homedir(),
      ".config",
      "agent-skill-manager",
      ".tmp",
    );
    await mkdir(tempParent, { recursive: true });

    // Step 1: Clone latest version
    debug(`updater: cloning latest ${name} to ${tempDir}`);
    const cloneArgs = ["clone", "--depth", "1"];
    if (entry.ref && entry.ref !== "HEAD") {
      cloneArgs.push("--branch", entry.ref);
    }
    cloneArgs.push(cloneUrl, tempDir);

    try {
      await execFileAsync("git", cloneArgs, { timeout: 60_000 });
    } catch (cloneErr: any) {
      return {
        name,
        status: "failed",
        reason: `Clone failed: ${cloneErr.stderr || cloneErr.message}`,
      };
    }

    // Get the new commit hash
    let newCommit: string | null = null;
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: tempDir,
        timeout: 5_000,
      });
      newCommit = stdout.trim();
    } catch {
      return { name, status: "failed", reason: "Could not read new commit" };
    }

    // Check if already up to date
    if (newCommit === entry.commitHash) {
      return { name, status: "skipped", reason: "Already up to date" };
    }

    // Step 2: Security audit on the new version
    debug(`updater: running security audit on ${name}`);
    let securityVerdict: SecurityVerdict = "safe";
    try {
      const auditFn = _overrides?.auditFn ?? auditSkillSecurity;
      const ownerRepo = extractOwnerRepo(entry.source);
      const auditReport = await auditFn(
        tempDir,
        name,
        ownerRepo?.owner,
        ownerRepo?.repo,
      );
      securityVerdict = auditReport.verdict;

      if (securityVerdict === "dangerous") {
        return {
          name,
          status: "skipped",
          reason: "Security audit: dangerous — update blocked",
          securityVerdict,
        };
      }

      if (securityVerdict === "warning" || securityVerdict === "caution") {
        if (!skipConfirm) {
          // Without --yes, skip warned/cautioned skills and tell the user how to override
          return {
            name,
            status: "skipped",
            reason: `Security audit: ${securityVerdict} — use --yes to override`,
            securityVerdict,
          };
        }
        // With --yes, warn but proceed with the update
        debug(
          `updater: security audit ${securityVerdict} for ${name} — proceeding (--yes)`,
        );
      }
    } catch (auditErr: any) {
      debug(`updater: security audit failed for ${name}: ${auditErr.message}`);
      return {
        name,
        status: "failed",
        reason: `Security audit failed — skipping update: ${auditErr.message}`,
      };
    }

    // Step 3: Atomic swap
    // Determine the installed path from the provider config.
    // NOTE: The lock entry does not currently record scope (global vs project).
    // updateSkill always assumes global path. Scope tracking would be a
    // separate issue — for now we look up the provider's configured global path
    // from AppConfig rather than hard-coding it.
    const loadConfigFn = _overrides?.loadConfigFn ?? loadConfig;
    const resolvePathFn =
      _overrides?.resolveProviderPathFn ?? resolveProviderPath;
    const config = await loadConfigFn();
    const providerConfig = config.providers.find(
      (p) => p.name === entry.provider,
    );
    const globalPath = providerConfig
      ? providerConfig.global
      : `~/.${entry.provider}/skills`;
    const installedPath = resolvePathFn(globalPath);
    const targetDir = join(installedPath, name);

    // Remove .git from cloned repo
    const gitDir = join(tempDir, ".git");
    try {
      await rm(gitDir, { recursive: true, force: true });
    } catch {
      // .git might not exist
    }

    // Verify target exists before swapping
    try {
      await access(targetDir);
    } catch {
      // Target doesn't exist — just copy
      const writeLockFn = _overrides?.writeLockEntryFn ?? writeLockEntry;
      await cp(tempDir, targetDir, { recursive: true });
      await writeLockFn(name, {
        ...entry,
        commitHash: newCommit,
        installedAt: new Date().toISOString(),
      });
      return {
        name,
        status: "updated",
        oldCommit: shortHash(entry.commitHash),
        newCommit: shortHash(newCommit),
        securityVerdict,
      };
    }

    // Atomic swap: rename old -> backup, move new -> target, remove backup
    const backupDir = `${targetDir}.bak-${Date.now()}`;
    try {
      await rename(targetDir, backupDir);
      await cp(tempDir, targetDir, { recursive: true });
      await rm(backupDir, { recursive: true, force: true });
    } catch (swapErr: any) {
      // Rollback: try to restore backup
      try {
        await rm(targetDir, { recursive: true, force: true });
        await rename(backupDir, targetDir);
      } catch {
        // Best effort rollback
      }
      return {
        name,
        status: "failed",
        reason: `Atomic swap failed: ${swapErr.message}`,
      };
    }

    // Step 4: Update lock file
    const writeLockFn = _overrides?.writeLockEntryFn ?? writeLockEntry;
    await writeLockFn(name, {
      ...entry,
      commitHash: newCommit,
      installedAt: new Date().toISOString(),
    });

    return {
      name,
      status: "updated",
      oldCommit: shortHash(entry.commitHash),
      newCommit: shortHash(newCommit),
      securityVerdict,
    };
  } finally {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

/** @internal — injectable overrides for testing updateSkills. */
export interface _UpdateSkillsTestOverrides {
  readLockFn?: typeof readLock;
  checkOutdatedFn?: (
    overrides?: _CheckOutdatedTestOverrides,
  ) => Promise<OutdatedSummary>;
  updateSkillFn?: typeof updateSkill;
}

/**
 * Update multiple skills sequentially (for safety).
 */
export async function updateSkills(
  names: string[] | null,
  skipConfirm: boolean,
  _overrides?: _UpdateSkillsTestOverrides,
): Promise<UpdateSummary> {
  const readLockFn = _overrides?.readLockFn ?? readLock;
  const checkOutdatedFn = _overrides?.checkOutdatedFn ?? checkOutdated;
  const updateSkillFn = _overrides?.updateSkillFn ?? updateSkill;

  // Read lock once and share with checkOutdated to avoid redundant reads
  const lock = await readLockFn();
  const outdated = await checkOutdatedFn({ lock });

  // TODO: Optimization opportunity — checkOutdated already queries every remote
  // via git ls-remote to obtain the latest commit hash. updateSkill then queries
  // the same remotes again via git clone. We could pass the already-known latest
  // commit from outdated.entries into updateSkill to skip the redundant network
  // round-trip (e.g. by adding an optional `knownLatestCommit` parameter).

  // Filter to outdated skills only
  let toUpdate = outdated.entries.filter((e) => e.status === "outdated");

  // Track warnings for skills requested by name but not found in lock file
  const notFoundWarnings: string[] = [];

  // If specific names given, filter further
  if (names && names.length > 0) {
    const nameSet = new Set(names.map((n) => n.toLowerCase()));
    toUpdate = toUpdate.filter((e) => nameSet.has(e.name.toLowerCase()));

    // Check for names that don't exist or aren't outdated, and collect
    // not-found warnings so the caller can surface them to the user.
    for (const name of names) {
      if (!toUpdate.find((e) => e.name.toLowerCase() === name.toLowerCase())) {
        const exists = outdated.entries.find(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        );
        if (!exists) {
          debug(`updater: skill "${name}" not found in lock file`);
          notFoundWarnings.push(name);
        } else {
          debug(`updater: skill "${name}" is already up to date`);
        }
      }
    }
  }

  if (toUpdate.length === 0) {
    return {
      results: [],
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      ...(notFoundWarnings.length > 0 ? { warnings: notFoundWarnings } : {}),
    };
  }

  // Update sequentially for safety
  const results: UpdateResult[] = [];
  for (const entry of toUpdate) {
    const lockEntry = lock.skills[entry.name];
    if (!lockEntry) continue;

    const result = await updateSkillFn(entry.name, lockEntry, skipConfirm);
    results.push(result);
  }

  return {
    results,
    updatedCount: results.filter((r) => r.status === "updated").length,
    skippedCount: results.filter((r) => r.status === "skipped").length,
    failedCount: results.filter((r) => r.status === "failed").length,
    ...(notFoundWarnings.length > 0 ? { warnings: notFoundWarnings } : {}),
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function shortHash(hash: string): string {
  if (!hash || hash === "unknown") return "unknown";
  return hash.slice(0, 7);
}

export function formatOutdatedTable(
  summary: OutdatedSummary,
  useColor: boolean,
): string {
  if (summary.entries.length === 0) {
    return "No skills installed.";
  }

  const id = (s: string) => s;
  const red = useColor ? ansi.red : id;
  const green = useColor ? ansi.green : id;
  const yellow = useColor ? ansi.yellow : id;
  const dim = useColor ? ansi.dim : id;

  const header = `${"Skill".padEnd(22)}${"Installed".padEnd(14)}${"Latest".padEnd(14)}Source`;
  const separator = "─".repeat(60);
  const lines: string[] = [header, separator];

  for (const entry of summary.entries) {
    const nameCol = entry.name.padEnd(22);
    const installedCol = entry.installedCommit.padEnd(14);
    let latestCol: string;
    let sourceCol: string;

    switch (entry.status) {
      case "outdated":
        latestCol = red(entry.latestCommit.padEnd(14));
        sourceCol = entry.sourceType;
        break;
      case "up-to-date":
        latestCol = green(entry.latestCommit.padEnd(14));
        sourceCol = dim("(up to date)");
        break;
      case "untracked":
        latestCol = yellow("untracked".padEnd(14));
        sourceCol = yellow("untracked");
        break;
      case "error":
        latestCol = dim("error".padEnd(14));
        sourceCol = dim(entry.error || "error");
        break;
    }

    lines.push(`${nameCol}${installedCol}${latestCol}${sourceCol}`);
  }

  lines.push("");
  const parts: string[] = [];
  if (summary.outdatedCount > 0)
    parts.push(red(`${summary.outdatedCount} outdated`));
  if (summary.upToDateCount > 0)
    parts.push(green(`${summary.upToDateCount} up to date`));
  if (summary.untrackedCount > 0)
    parts.push(yellow(`${summary.untrackedCount} untracked`));
  if (summary.errorCount > 0) parts.push(dim(`${summary.errorCount} error`));
  lines.push(parts.join(", "));

  return lines.join("\n");
}

export function formatOutdatedJSON(summary: OutdatedSummary): string {
  return JSON.stringify(
    {
      skills: summary.entries.map((e) => ({
        name: e.name,
        installed: e.installedCommit,
        latest: e.latestCommit,
        source: e.sourceType,
        status: e.status,
        ...(e.error ? { error: e.error } : {}),
      })),
      summary: {
        outdated: summary.outdatedCount,
        upToDate: summary.upToDateCount,
        untracked: summary.untrackedCount,
        errors: summary.errorCount,
      },
    },
    null,
    2,
  );
}

/**
 * @deprecated Superseded by the centralized machine envelope in utils/machine.ts.
 * Retained for backward compatibility with external consumers. Use formatMachineOutput() instead.
 */
export function formatOutdatedMachine(summary: OutdatedSummary): string {
  return JSON.stringify({
    v: 1,
    type: "outdated",
    data: {
      skills: summary.entries.map((e) => ({
        name: e.name,
        installed: e.installedCommit,
        latest: e.latestCommit,
        source: e.sourceType,
        status: e.status,
      })),
      outdated: summary.outdatedCount,
      upToDate: summary.upToDateCount,
      untracked: summary.untrackedCount,
    },
  });
}

export function formatUpdateJSON(summary: UpdateSummary): string {
  return JSON.stringify(
    {
      results: summary.results.map((r) => ({
        name: r.name,
        status: r.status,
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.oldCommit ? { oldCommit: r.oldCommit } : {}),
        ...(r.newCommit ? { newCommit: r.newCommit } : {}),
        ...(r.securityVerdict ? { securityVerdict: r.securityVerdict } : {}),
      })),
      summary: {
        updated: summary.updatedCount,
        skipped: summary.skippedCount,
        failed: summary.failedCount,
      },
    },
    null,
    2,
  );
}

/**
 * @deprecated Superseded by the centralized machine envelope in utils/machine.ts.
 * Retained for backward compatibility with external consumers. Use formatMachineOutput() instead.
 */
export function formatUpdateMachine(summary: UpdateSummary): string {
  return JSON.stringify({
    v: 1,
    type: "update",
    data: {
      results: summary.results.map((r) => ({
        name: r.name,
        status: r.status,
        reason: r.reason || null,
        oldCommit: r.oldCommit || null,
        newCommit: r.newCommit || null,
        securityVerdict: r.securityVerdict || null,
      })),
      updated: summary.updatedCount,
      skipped: summary.skippedCount,
      failed: summary.failedCount,
    },
  });
}
