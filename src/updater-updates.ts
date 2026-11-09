/**
 * Update execution: updateSkill, updateSkills, and formatters.
 * Split from updater.ts (issue #455).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { loadConfig } from "./config";
import { resolveProviderPath } from "./config";
import { writeLockEntry } from "./utils/lock";
import type {
  LockEntry,
  SecurityAuditReport,
  SecurityVerdict,
} from "./utils/types";
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
  findSkillFoldersByName,
  normalizeSkillPath,
} from "./updater-core";
import { SKILL_MD, skillMdState, type SkillMdState } from "./installer-core";
import { stripControlBytes } from "./security-auditor-scan";
import { readLock } from "./utils/lock";
import {
  auditSkillSecurity,
  describeSecurityHold,
  shellArg,
  type AuditSkillSecurityOptions,
} from "./security-auditor";
import type {
  _CheckOutdatedTestOverrides,
  OutdatedEntry,
  OutdatedSummary,
  UpdateSummary,
} from "./updater-core";
import { join } from "path";
import { homedir } from "os";
import { mkdir, rm, rename, cp, access, lstat, readdir } from "fs/promises";
import { debug } from "./logger";
import { ansi } from "./formatter";

const execFileAsync = promisify(execFile);

export interface _UpdateTestOverrides {
  auditFn?: (
    skillPath: string,
    skillName: string,
    sourceOwner?: string,
    sourceRepo?: string,
    options?: AuditSkillSecurityOptions,
  ) => Promise<
    { verdict: SecurityVerdict } & Partial<
      Pick<
        SecurityAuditReport,
        "verdictReason" | "externalSymlinks" | "codeScans"
      >
    >
  >;
  loadConfigFn?: typeof loadConfig;
  resolveProviderPathFn?: typeof resolveProviderPath;
  writeLockEntryFn?: typeof writeLockEntry;
  skillMdStateFn?: typeof skillMdState;
}

/**
 * The `asm install` source that reinstalls exactly this skill: the registry
 * name, or the lock source with its ref and skill folder (`#ref:path`), which
 * the lock keeps in separate fields (#809). `null` when `asm install` cannot
 * take the lock source (e.g. `file://`): it must be reinstalled by hand.
 */
export function installSourceOf(
  entry: LockEntry,
  sourceType: ReturnType<typeof resolveSourceType>,
): string | null {
  if (sourceType === "registry" && entry.registryName)
    return entry.registryName;
  const { source, ref, skillPath } = entry;
  if (!source.startsWith("github:")) return null;
  const hashIdx = source.indexOf("#");
  if (hashIdx === -1) {
    return `${source}${ref ? `#${ref}` : ""}${skillPath ? `:${skillPath}` : ""}`;
  }
  // Already `#ref` or `#ref:path`: add the folder only when it is missing.
  const hasPath = source.indexOf(":", hashIdx) !== -1;
  return !hasPath && skillPath ? `${source}:${skillPath}` : source;
}

/**
 * The `asm audit security` source for the incoming update itself: the lock's
 * GitHub repo pinned to `commit` (the one just audited), plus the skill
 * folder. A registry name or `#ref` would audit the installed copy or a
 * moving branch instead (#809). `null` when the lock source is not GitHub.
 */
export function updateAuditSourceOf(
  entry: LockEntry,
  commit: string,
): string | null {
  if (!entry.source.startsWith("github:")) return null;
  const rest = entry.source.slice("github:".length);
  const hashIdx = rest.indexOf("#");
  const head = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
  const frag = hashIdx === -1 ? "" : rest.slice(hashIdx + 1);
  // `owner/repo[:path]` before the `#`, or `ref[:path]` after it.
  const headColon = head.indexOf(":");
  const repo = headColon === -1 ? head : head.slice(0, headColon);
  const fragColon = frag.indexOf(":");
  const sourcePath =
    headColon !== -1
      ? head.slice(headColon + 1)
      : fragColon !== -1
        ? frag.slice(fragColon + 1)
        : "";
  const path = entry.skillPath ?? sourcePath;
  // `asm audit security` checks out a 40-hex commit; otherwise use the ref.
  const pin = /^[0-9a-f]{40}$/i.test(commit) ? commit : entry.ref;
  return `github:${repo}${pin ? `#${pin}` : ""}${path ? `:${path}` : ""}`;
}

const SKILL_MD_PROBLEM: Record<Exclude<SkillMdState, "file">, string> = {
  missing: "",
  directory: " (SKILL.md is a directory)",
  symlink: " (SKILL.md is a symlink, which asm does not follow)",
  other: " (SKILL.md is not a regular file)",
};

/**
 * The first component of `skillPath` under `repoDir`, from the checkout root
 * down to the skill folder itself, that is a symlink; `null` when none is.
 * `lstat` on SKILL.md alone would follow a linked folder or parent, and the
 * swap would then install the link itself (#814). A missing component ends
 * the walk (the SKILL.md check reports it); other errors are rethrown.
 */
async function symlinkInSkillPath(
  repoDir: string,
  skillPath: string,
): Promise<string | null> {
  if (skillPath === "") return null;
  const parts = skillPath.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const rel = parts.slice(0, i).join("/");
    try {
      if ((await lstat(join(repoDir, rel))).isSymbolicLink()) return rel;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw err;
    }
  }
  return null;
}

/** ` (found skill.md; asm needs SKILL.md)` for a SKILL.md in another case. */
async function caseVariantNote(skillDir: string): Promise<string> {
  const entries = await readdir(skillDir).catch(() => [] as string[]);
  const variant = entries.find(
    (e) => e !== SKILL_MD && e.toLowerCase() === SKILL_MD.toLowerCase(),
  );
  return variant ? ` (found ${variant}; asm needs ${SKILL_MD})` : "";
}

/**
 * Refuse an update whose incoming folder is no skill (#814): a component of
 * its path is a symlink, or its SKILL.md is missing, a directory or a
 * symlink, or the check could not run. `null` when the folder is a skill.
 * Runs before the audit and the swap, so a refused skill keeps its installed
 * copy and its lock entry. The next step names the skill's new folder only
 * when this checkout already shows exactly one SKILL.md with the same
 * frontmatter `name` (no extra network call). Commands are printed bare,
 * never inside quotes, so copying them never expands `$(…)`.
 */
async function refuseInvalidSkillFolder(
  name: string,
  entry: LockEntry,
  repoDir: string,
  skillDir: string,
  commit: string,
  stateFn: typeof skillMdState,
): Promise<UpdateResult | null> {
  const at = shortHash(commit);
  const current = normalizeSkillPath(entry.skillPath);
  let problem: string;
  try {
    const link = await symlinkInSkillPath(repoDir, current);
    if (link !== null) {
      problem = ` (${link} is a symlink, which asm does not follow)`;
    } else {
      const state = await stateFn(skillDir);
      if (state === "file") return null;
      problem =
        state === "missing"
          ? await caseVariantNote(skillDir)
          : SKILL_MD_PROBLEM[state];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: "failed",
      reason: stripControlBytes(
        `Could not check SKILL.md at ${at}: ${msg}. The installed copy was kept.`,
      ),
    };
  }

  // A folder named SKILL.md is never offered as the new path.
  const moved = (
    await findSkillFoldersByName(
      repoDir,
      name,
      commit.length === 64 ? "sha256" : "sha1",
    )
  ).filter(
    (dir) =>
      dir !== current &&
      dir.slice(dir.lastIndexOf("/") + 1).toLowerCase() !==
        SKILL_MD.toLowerCase(),
  );
  const uninstall = `asm uninstall ${shellArg(name)}`;
  let next = `Run: ${uninstall} — or reinstall it from its new path`;
  if (moved.length === 1) {
    const repoSource = entry.source.split("#")[0];
    const install = installSourceOf(
      { ...entry, source: repoSource, skillPath: moved[0] },
      "github",
    );
    next =
      install !== null
        ? `${next}: asm install ${shellArg(install)}`
        : `${next} ${shellArg(moved[0] || ".")} in ${shellArg(repoSource)}`;
  }
  return {
    name,
    status: "failed",
    reason: stripControlBytes(
      `SKILL.md missing at ${at}: the skill was removed or moved upstream${problem}. ${next}`,
    ),
  };
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

    // Step 2: The incoming folder must still be a skill, before anything
    // touches the installed copy (#814).
    const refused = await refuseInvalidSkillFolder(
      name,
      entry,
      tempDir,
      updateSourceDir,
      newCommit,
      _overrides?.skillMdStateFn ?? skillMdState,
    );
    if (refused) return refused;

    // Step 3: Security audit on the new version
    debug(`updater: running security audit on ${name}`);
    let securityVerdict: SecurityVerdict = "safe";
    let securityReasons: string[] | undefined;
    try {
      const auditFn = _overrides?.auditFn ?? auditSkillSecurity;
      const ownerRepo = extractOwnerRepo(entry.source);
      // Confined to the clone (#791): a link out of it is a finding (verdict
      // at least warning, so --yes is needed), never read.
      const auditReport = await auditFn(
        updateSourceDir,
        name,
        ownerRepo?.owner,
        ownerRepo?.repo,
        { trackSymlinks: true, boundary: tempDir },
      );
      securityVerdict = auditReport.verdict;
      // Audits the incoming commit, never the installed copy (#809).
      const auditTarget = updateAuditSourceOf(entry, newCommit) ?? undefined;

      if (securityVerdict === "dangerous") {
        // --yes never applies a dangerous update. Name the findings and the
        // deliberate override: a forced install of the same source, which
        // runs the install preview and its own risk gate (#809).
        const source = installSourceOf(entry, sourceType);
        const hold = describeSecurityHold(auditReport, {
          verdict: "dangerous — update blocked",
          prefix: "Security audit",
          auditTarget,
          ...(source !== null
            ? {
                overrideCommand: `asm install ${shellArg(source)} --force --yes`,
                action: "install it anyway",
              }
            : {
                action: `"asm install" cannot take ${shellArg(entry.source)}: review that source and reinstall it by hand to install it anyway`,
              }),
          findings: 5,
        });
        return {
          name,
          status: "skipped",
          reason: hold.message,
          securityVerdict,
          securityReasons: [...hold.reasons, ...hold.findings],
        };
      }

      if (securityVerdict === "warning" || securityVerdict === "caution") {
        // Name why (e.g. the symlinks not read) and the next step (#791).
        const hold = describeSecurityHold(auditReport, {
          verdict: securityVerdict,
          prefix: "Security audit",
          auditTarget,
          overrideFlag: "--yes",
          action: "update anyway",
        });
        securityReasons = hold.reasons;
        if (!skipConfirm) {
          // Without --yes, skip warned/cautioned skills and tell the user how to override
          return {
            name,
            status: "skipped",
            reason: hold.message,
            securityVerdict,
            securityReasons,
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

    // Step 4: Atomic swap
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
        ...(securityReasons ? { securityReasons } : {}),
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

    // Step 5: Update the lock before discarding the previous installation.
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
      ...(securityReasons ? { securityReasons } : {}),
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

  // Outdated skills, plus those removed upstream: updateSkill checks the
  // incoming folder itself and reports why it keeps the installed copy (#814).
  let toUpdate = outdated.entries.filter(
    (e) => e.status === "outdated" || e.status === "removed-upstream",
  );

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

/**
 * `1.6.0 → 1.7.0` for an outdated skill, the single version otherwise, `-`
 * when unknown or for non-GitHub sources (#807).
 */
function formatVersionCell(entry: OutdatedEntry): string {
  if (entry.sourceType !== "github") return "-";
  const installed = entry.installedVersion ?? null;
  const latest = entry.latestVersion ?? null;
  if (installed === null && latest === null) return "-";
  if (entry.status === "outdated" || installed !== latest) {
    return `${installed ?? "?"} → ${latest ?? "?"}`;
  }
  return installed ?? "-";
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

  // Wide enough for the longest name, so it never runs into the next column.
  const nameWidth = Math.max(
    22,
    ...summary.entries.map((e) => e.name.length + 2),
  );
  const header = `${"Skill".padEnd(nameWidth)}${"Installed".padEnd(14)}${"Latest".padEnd(14)}${"Version".padEnd(18)}Source`;
  const separator = "─".repeat(nameWidth + 56);
  const lines: string[] = [header, separator];

  for (const entry of summary.entries) {
    const nameCol = entry.name.padEnd(nameWidth);
    const installedCol = entry.installedCommit.padEnd(14);
    const versionCol = formatVersionCell(entry).padEnd(18);
    let latestCol: string;
    let sourceCol: string;

    switch (entry.status) {
      case "outdated":
        latestCol = red(entry.latestCommit.padEnd(14));
        sourceCol = entry.sourceType;
        break;
      case "removed-upstream":
        latestCol = red(entry.latestCommit.padEnd(14));
        sourceCol = red("(removed upstream: no SKILL.md)");
        break;
      case "up-to-date":
        latestCol = green(entry.latestCommit.padEnd(14));
        // Newer repo commit that leaves this skill's folder untouched.
        sourceCol = dim(
          entry.installedCommit !== entry.latestCommit
            ? "(up to date, skill folder unchanged)"
            : "(up to date)",
        );
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

    lines.push(
      `${nameCol}${installedCol}${latestCol}${versionCol}${sourceCol}`,
    );
  }

  lines.push("");
  const parts: string[] = [];
  if (summary.outdatedCount > 0)
    parts.push(red(`${summary.outdatedCount} outdated`));
  const removedUpstream = summary.removedUpstreamCount ?? 0;
  if (removedUpstream > 0)
    parts.push(red(`${removedUpstream} removed upstream`));
  if (summary.upToDateCount > 0)
    parts.push(green(`${summary.upToDateCount} up to date`));
  if (summary.untrackedCount > 0)
    parts.push(yellow(`${summary.untrackedCount} untracked`));
  if (summary.errorCount > 0) parts.push(dim(`${summary.errorCount} error`));
  lines.push(parts.join(", "));

  // Say when the folder check was incomplete, without needing --verbose.
  const unchecked = summary.entries.filter((e) => e.inspectionError).length;
  if (unchecked > 0) {
    lines.push(
      dim(
        `${unchecked} skill${unchecked === 1 ? "" : "s"} not fully checked against ${unchecked === 1 ? "its" : "their"} folder (see --json inspectionError)`,
      ),
    );
  }

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
        ...(e.sourceType === "github"
          ? {
              installedVersion: e.installedVersion ?? null,
              latestVersion: e.latestVersion ?? null,
            }
          : {}),
        ...(e.error ? { error: e.error } : {}),
        ...(e.inspectionError ? { inspectionError: e.inspectionError } : {}),
      })),
      summary: {
        outdated: summary.outdatedCount,
        removedUpstream: summary.removedUpstreamCount ?? 0,
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
        ...(r.securityReasons ? { securityReasons: r.securityReasons } : {}),
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
        securityReasons: r.securityReasons ?? null,
      })),
      updated: summary.updatedCount,
      skipped: summary.skippedCount,
      failed: summary.failedCount,
    },
  });
}
