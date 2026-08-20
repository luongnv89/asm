/**
 * Update execution: updateSkill, updateSkills, and formatters.
 * Split from updater.ts (issue #455).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { loadConfig } from "./config";
import { resolveProviderPath } from "./config";
import { writeLockEntry } from "./utils/lock";
import type { LockEntry, SecurityVerdict } from "./utils/types";
import type { UpdateResult } from "./updater-core";
import {
  resolveSourceType,
  shortHash,
  extractOwnerRepo,
  sourceToCloneUrl,
  createPinnedGitEnv,
  getUpdateSourceDir,
  resolvedLatestCommits,
  normalizedTargetIdentity,
  checkOutdated,
  poolAll,
} from "./updater-core";
import { readLock } from "./utils/lock";
import { auditSkillSecurity } from "./security-auditor";
import type {
  _CheckOutdatedTestOverrides,
  OutdatedSummary,
  UpdateSummary,
} from "./updater-core";
import { join } from "path";
import { homedir } from "os";
import { mkdir, rm, rename, cp, access } from "fs/promises";
import { debug } from "./logger";
import { ansi } from "./formatter";

const execFileAsync = promisify(execFile);

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
  knownLatestCommit?: string,
): Promise<UpdateResult> {
  const sourceType = resolveSourceType(entry);

  // Cannot update local skills
  if (sourceType === "local") {
    return { name, status: "skipped", reason: "Local skill (not updatable)" };
  }

  let pinnedCommit: string | undefined;
  if (knownLatestCommit !== undefined) {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(knownLatestCommit)) {
      return { name, status: "failed", reason: "Invalid known commit OID" };
    }
    pinnedCommit = knownLatestCommit.toLowerCase();
    if (pinnedCommit === entry.commitHash.toLowerCase()) {
      return { name, status: "skipped", reason: "Already up to date" };
    }
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

    // Step 1: Fetch the exact commit already resolved by checkOutdated. Direct
    // callers without one retain the existing ref-based shallow clone path.
    debug(`updater: fetching latest ${name} to ${tempDir}`);
    if (pinnedCommit) {
      try {
        const objectFormat = pinnedCommit.length === 40 ? "sha1" : "sha256";
        const gitEnv = createPinnedGitEnv(objectFormat);
        await execFileAsync("git", ["init", tempDir], {
          timeout: 10_000,
          env: gitEnv,
        });
        await execFileAsync(
          "git",
          ["fetch", "--depth", "1", cloneUrl, pinnedCommit],
          { cwd: tempDir, timeout: 60_000, env: gitEnv },
        );
        await execFileAsync("git", ["checkout", "--detach", pinnedCommit], {
          cwd: tempDir,
          timeout: 10_000,
          env: gitEnv,
        });
      } catch {
        return {
          name,
          status: "failed",
          reason: "Resolved commit is unavailable in the shallow fetch",
        };
      }
    } else {
      const cloneArgs = ["clone", "--depth", "1"];
      if (entry.ref && entry.ref !== "HEAD") {
        cloneArgs.push("--branch", entry.ref);
      }
      cloneArgs.push(cloneUrl, tempDir);

      try {
        await execFileAsync("git", cloneArgs, { timeout: 60_000 });
      } catch (cloneErr: unknown) {
        const execErr = cloneErr as { stderr?: string; message?: string };
        return {
          name,
          status: "failed",
          reason: `Clone failed: ${execErr.stderr || execErr.message || String(cloneErr)}`,
        };
      }
    }

    // A successful detached checkout is the pinning gate; only direct callers
    // need to discover the commit selected by their ref-based clone.
    let newCommit: string;
    if (pinnedCommit) {
      newCommit = pinnedCommit;
    } else {
      try {
        const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: tempDir,
          timeout: 5_000,
        });
        newCommit = stdout.trim().toLowerCase();
      } catch {
        return { name, status: "failed", reason: "Could not read new commit" };
      }
    }

    // Check if already up to date
    if (newCommit === entry.commitHash) {
      return { name, status: "skipped", reason: "Already up to date" };
    }

    const updateSourceDir = getUpdateSourceDir(tempDir, entry);

    // Step 2: Security audit on the new version
    debug(`updater: running security audit on ${name}`);
    let securityVerdict: SecurityVerdict = "safe";
    try {
      const auditFn = _overrides?.auditFn ?? auditSkillSecurity;
      const ownerRepo = extractOwnerRepo(entry.source);
      const auditReport = await auditFn(
        updateSourceDir,
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
    } catch (auditErr: unknown) {
      const msg =
        auditErr instanceof Error ? auditErr.message : String(auditErr);
      debug(`updater: security audit failed for ${name}: ${msg}`);
      return {
        name,
        status: "failed",
        reason: `Security audit failed — skipping update: ${msg}`,
      };
    }

    // Step 3: Atomic swap
    // Determine the installed path from the provider config.
    const loadConfigFn = _overrides?.loadConfigFn ?? loadConfig;
    const resolvePathFn =
      _overrides?.resolveProviderPathFn ?? resolveProviderPath;
    const config = await loadConfigFn();
    const providerConfig = config.providers.find(
      (p) => p.name === entry.provider,
    );
    const scope = entry.scope ?? "global";
    const configuredPath = providerConfig
      ? scope === "project"
        ? providerConfig.project
        : providerConfig.global
      : `~/.${entry.provider}/skills`;
    const installedPath = resolvePathFn(configuredPath);
    const targetDir = join(installedPath, name);

    // Remove .git from cloned repo
    const gitDir = join(tempDir, ".git");
    try {
      await rm(gitDir, { recursive: true, force: true });
    } catch {
      // .git might not exist
    }

    let targetExists = true;
    try {
      await access(targetDir);
    } catch (err: unknown) {
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        err.code !== "ENOENT"
      ) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          name,
          status: "failed",
          reason: `Cannot access installed skill: ${msg}`,
        };
      }
      targetExists = false;
    }

    const writeLockFn = _overrides?.writeLockEntryFn ?? writeLockEntry;
    const updatedEntry = {
      ...entry,
      commitHash: newCommit,
      installedAt: new Date().toISOString(),
    };

    if (!targetExists) {
      try {
        await mkdir(installedPath, { recursive: true });
        await cp(updateSourceDir, targetDir, { recursive: true });
      } catch (copyErr: unknown) {
        await rm(targetDir, { recursive: true, force: true });
        const msg =
          copyErr instanceof Error ? copyErr.message : String(copyErr);
        return {
          name,
          status: "failed",
          reason: `Atomic swap failed: ${msg}`,
        };
      }

      try {
        await writeLockFn(name, updatedEntry);
      } catch (lockErr: unknown) {
        try {
          await rm(targetDir, { recursive: true, force: true });
        } catch (rollbackErr: unknown) {
          const lockMsg =
            lockErr instanceof Error ? lockErr.message : String(lockErr);
          const rbMsg =
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr);
          return {
            name,
            status: "failed",
            reason: `Lock file update failed: ${lockMsg}. Removal of the new installation also failed: ${rbMsg}`,
          };
        }
        const lockMsg =
          lockErr instanceof Error ? lockErr.message : String(lockErr);
        return {
          name,
          status: "failed",
          reason: `Lock file update failed: ${lockMsg}`,
        };
      }

      return {
        name,
        status: "updated",
        oldCommit: shortHash(entry.commitHash),
        newCommit: shortHash(newCommit),
        securityVerdict,
      };
    }

    // Keep the old installation until the corresponding lock entry is durable.
    const backupDir = `${targetDir}.bak-${Date.now()}`;
    let backupCreated = false;
    try {
      await rename(targetDir, backupDir);
      backupCreated = true;
      await cp(updateSourceDir, targetDir, { recursive: true });
    } catch (swapErr: unknown) {
      if (backupCreated) {
        try {
          await rm(targetDir, { recursive: true, force: true });
          await rename(backupDir, targetDir);
          backupCreated = false;
        } catch (rollbackErr: unknown) {
          const swapMsg =
            swapErr instanceof Error ? swapErr.message : String(swapErr);
          const rbMsg =
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr);
          return {
            name,
            status: "failed",
            reason: `Atomic swap failed: ${swapMsg}. Restore also failed; backup preserved at ${backupDir}: ${rbMsg}`,
          };
        }
      }
      return {
        name,
        status: "failed",
        reason: `Atomic swap failed: ${swapErr instanceof Error ? swapErr.message : String(swapErr)}`,
      };
    }

    // Step 4: Update the lock before discarding the previous installation.
    try {
      await writeLockFn(name, updatedEntry);
    } catch (lockErr: unknown) {
      try {
        await rm(targetDir, { recursive: true, force: true });
        await rename(backupDir, targetDir);
        backupCreated = false;
      } catch (rollbackErr: unknown) {
        const lockMsg =
          lockErr instanceof Error ? lockErr.message : String(lockErr);
        const rbMsg =
          rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
        return {
          name,
          status: "failed",
          reason: `Lock file update failed: ${lockMsg}. Restore also failed; backup preserved at ${backupDir}: ${rbMsg}`,
        };
      }
      const lockMsg =
        lockErr instanceof Error ? lockErr.message : String(lockErr);
      return {
        name,
        status: "failed",
        reason: `Lock file update failed: ${lockMsg}`,
      };
    }

    // The target and lock now agree. Backup cleanup is best effort and must not
    // roll back a successfully persisted update.
    if (backupCreated) {
      try {
        await rm(backupDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        debug(`updater: failed to remove backup ${backupDir}: ${cleanupErr}`);
      }
    }

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
  writeLockEntryFn?: typeof writeLockEntry;
}

/**
 * Update multiple skills with bounded concurrency.
 * Lock-file writes are serialized within this invocation to protect each
 * writeLockEntry read-modify-write cycle from other workers in the same run.
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

  const updateEntries = toUpdate.flatMap((entry) => {
    const lockEntry = lock.skills[entry.name];
    return lockEntry
      ? [
          {
            name: entry.name,
            lockEntry,
            knownLatestCommit: resolvedLatestCommits.get(entry),
          },
        ]
      : [];
  });

  const writeLockFn = _overrides?.writeLockEntryFn ?? writeLockEntry;
  let lockWriteTail: Promise<void> = Promise.resolve();
  const serializedWriteLockEntry: typeof writeLockEntry = (name, entry) => {
    const write = lockWriteTail.then(() => writeLockFn(name, entry));
    lockWriteTail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  };

  const updateGroups = new Map<
    string,
    Array<(typeof updateEntries)[number] & { index: number }>
  >();
  updateEntries.forEach((entry, index) => {
    const identity = normalizedTargetIdentity(entry.name);
    const group = updateGroups.get(identity) ?? [];
    group.push({ ...entry, index });
    updateGroups.set(identity, group);
  });

  const results: UpdateResult[] = new Array(updateEntries.length);
  await poolAll([...updateGroups.values()], 4, async (group) => {
    for (const entry of group) {
      try {
        results[entry.index] = await updateSkillFn(
          entry.name,
          entry.lockEntry,
          skipConfirm,
          { writeLockEntryFn: serializedWriteLockEntry },
          entry.knownLatestCommit,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[entry.index] = {
          name: entry.name,
          status: "failed",
          reason: `Unexpected update failure: ${message}`,
        };
      }
    }
  });

  return {
    results,
    updatedCount: results.filter((r) => r.status === "updated").length,
    skippedCount: results.filter((r) => r.status === "skipped").length,
    failedCount: results.filter((r) => r.status === "failed").length,
    ...(notFoundWarnings.length > 0 ? { warnings: notFoundWarnings } : {}),
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

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
