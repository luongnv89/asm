/**
 * Skill lifecycle management: outdated detection and atomic updates.
 *
 * Provides `checkOutdated()` to compare installed skill commits against
 * remote HEAD, and `updateSkills()` to upgrade skills atomically with
 * security re-audit.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm, rename, cp, access, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { debug } from "./logger";
import { readLock, writeLockEntry } from "./utils/lock";
import { fetchRegistryIndex } from "./registry";
import type { RegistryManifest } from "./registry";
import type { LockEntry } from "./utils/types";
import { auditSkillSecurity } from "./security-auditor";
import type { SecurityVerdict } from "./utils/types";
import { resolveProviderPath } from "./config";

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
    const ownerRepo = source.slice("github:".length);
    return `https://github.com/${ownerRepo}.git`;
  }
  return null;
}

// ─── Outdated Check ─────────────────────────────────────────────────────────

/**
 * Check all installed skills for newer versions.
 * Registry skills are compared against index.json.
 * Non-registry skills use git ls-remote.
 * Runs with a concurrency limit of 5.
 */
export async function checkOutdated(): Promise<OutdatedSummary> {
  const lock = await readLock();
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
  let registryIndex: { manifests: RegistryManifest[] } | null = null;
  const hasRegistrySkills = entries.some(
    ([, e]) => resolveSourceType(e) === "registry" || e.registryName,
  );
  if (hasRegistrySkills) {
    registryIndex = await fetchRegistryIndex();
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
export async function updateSkill(
  name: string,
  entry: LockEntry,
  skipConfirm: boolean,
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
    // Step 1: Clone latest version
    debug(`updater: cloning latest ${name} to ${tempDir}`);
    const cloneArgs = ["clone", "--depth", "1"];
    if (entry.ref && entry.ref !== "main" && entry.ref !== "HEAD") {
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
      const auditReport = await auditSkillSecurity(tempDir, name);
      securityVerdict = auditReport.verdict;

      if (securityVerdict === "dangerous") {
        return {
          name,
          status: "skipped",
          reason: "Security audit: dangerous — update blocked",
          securityVerdict,
        };
      }

      if (securityVerdict === "warning" && !skipConfirm) {
        // In non-interactive mode without --yes, skip warned skills
        return {
          name,
          status: "skipped",
          reason: "Security audit: warning — use --yes to override",
          securityVerdict,
        };
      }
    } catch (auditErr: any) {
      debug(`updater: security audit failed for ${name}: ${auditErr.message}`);
      // Continue with update even if audit fails (non-fatal)
    }

    // Step 3: Atomic swap
    // Determine the installed path from the provider config
    const installedPath = resolveProviderPath(
      `~/.${entry.provider === "agents" ? "agents" : entry.provider}/skills`,
    );
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
      await cp(tempDir, targetDir, { recursive: true });
      await writeLockEntry(name, {
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
    await writeLockEntry(name, {
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

/**
 * Update multiple skills sequentially (for safety).
 */
export async function updateSkills(
  names: string[] | null,
  skipConfirm: boolean,
): Promise<UpdateSummary> {
  const lock = await readLock();
  const outdated = await checkOutdated();

  // Filter to outdated skills only
  let toUpdate = outdated.entries.filter((e) => e.status === "outdated");

  // If specific names given, filter further
  if (names && names.length > 0) {
    const nameSet = new Set(names.map((n) => n.toLowerCase()));
    toUpdate = toUpdate.filter((e) => nameSet.has(e.name.toLowerCase()));

    // Check for names that don't exist or aren't outdated
    for (const name of names) {
      if (!toUpdate.find((e) => e.name.toLowerCase() === name.toLowerCase())) {
        const exists = outdated.entries.find(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        );
        if (!exists) {
          debug(`updater: skill "${name}" not found in lock file`);
        } else {
          debug(`updater: skill "${name}" is already up to date`);
        }
      }
    }
  }

  if (toUpdate.length === 0) {
    return { results: [], updatedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  // Update sequentially for safety
  const results: UpdateResult[] = [];
  for (const entry of toUpdate) {
    const lockEntry = lock.skills[entry.name];
    if (!lockEntry) continue;

    const result = await updateSkill(entry.name, lockEntry, skipConfirm);
    results.push(result);
  }

  return {
    results,
    updatedCount: results.filter((r) => r.status === "updated").length,
    skippedCount: results.filter((r) => r.status === "skipped").length,
    failedCount: results.filter((r) => r.status === "failed").length,
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

  const red = useColor
    ? (s: string) => `\x1b[31m${s}\x1b[0m`
    : (s: string) => s;
  const green = useColor
    ? (s: string) => `\x1b[32m${s}\x1b[0m`
    : (s: string) => s;
  const yellow = useColor
    ? (s: string) => `\x1b[33m${s}\x1b[0m`
    : (s: string) => s;
  const dim = useColor ? (s: string) => `\x1b[2m${s}\x1b[0m` : (s: string) => s;

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

export function formatUpdateMachine(summary: UpdateSummary): string {
  return JSON.stringify({
    v: 1,
    type: "update",
    data: {
      results: summary.results.map((r) => ({
        name: r.name,
        status: r.status,
        reason: r.reason || null,
      })),
      updated: summary.updatedCount,
      skipped: summary.skippedCount,
      failed: summary.failedCount,
    },
  });
}
