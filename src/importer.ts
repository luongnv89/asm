import {
  readFile,
  readdir,
  access,
  mkdir,
  cp,
  rm,
  rename,
  realpath,
  stat,
} from "fs/promises";
import { join, basename, resolve } from "path";
import { resolveProviderPath, loadConfig } from "./config";
import { scanAllSkills } from "./scanner";
import { unifiedDiff } from "./evaluator";
import { BINARY_EXTENSIONS, MAX_FILE_SIZE, createDirSymlink } from "./utils/fs";
import { debug } from "./logger";
import type {
  ExportManifest,
  ExportedSkill,
  ImportConflict,
  ImportConflictChoice,
  ImportResult,
  ImportSummary,
  AppConfig,
  SkillInfo,
} from "./utils/types";

// ─── Manifest Validation ────────────────────────────────────────────────────

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
}

export function validateManifest(data: unknown): ManifestValidation {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: ["Manifest must be a JSON object."] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push(
      `Unsupported manifest version: ${JSON.stringify(obj.version)}. Expected 1.`,
    );
  }

  if (typeof obj.exportedAt !== "string") {
    errors.push("Missing or invalid 'exportedAt' field.");
  }

  if (!Array.isArray(obj.skills)) {
    errors.push("Missing or invalid 'skills' array.");
    return { valid: false, errors };
  }

  for (let i = 0; i < obj.skills.length; i++) {
    const skill = obj.skills[i];
    if (typeof skill !== "object" || skill === null) {
      errors.push(`skills[${i}]: must be an object.`);
      continue;
    }
    const s = skill as Record<string, unknown>;
    if (typeof s.name !== "string" || !s.name) {
      errors.push(`skills[${i}]: missing or empty 'name'.`);
    }
    if (typeof s.dirName !== "string" || !s.dirName) {
      errors.push(`skills[${i}]: missing or empty 'dirName'.`);
    }
    if (typeof s.provider !== "string" || !s.provider) {
      errors.push(`skills[${i}]: missing or empty 'provider'.`);
    }
    if (s.scope !== "global" && s.scope !== "project") {
      errors.push(
        `skills[${i}]: invalid 'scope' "${String(s.scope)}". Must be "global" or "project".`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Manifest Reading ───────────────────────────────────────────────────────

export async function readManifestFile(
  filePath: string,
): Promise<ExportManifest> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Manifest file not found: ${filePath}`, { cause: err });
    }
    throw new Error(`Failed to read manifest file: ${err.message}`, {
      cause: err,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Manifest file is not valid JSON.");
  }

  const validation = validateManifest(data);
  if (!validation.valid) {
    throw new Error(`Invalid manifest:\n  ${validation.errors.join("\n  ")}`);
  }

  return data as ExportManifest;
}

// ─── Import Logic ───────────────────────────────────────────────────────────

/**
 * Check whether a skill already exists at the target directory.
 */
async function skillExists(targetDir: string): Promise<boolean> {
  try {
    await access(targetDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when two on-disk paths refer to the same directory. Compares realpaths
 * so symlinked locations match, and compares case-insensitively on Windows.
 * Used to guard self-imports: a manifest exported on this machine resolves its
 * "source" to the very install it is about to overwrite, and removing the
 * target first would destroy the only copy.
 */
async function isSameDir(a: string, b: string): Promise<boolean> {
  let ra: string;
  let rb: string;
  try {
    [ra, rb] = await Promise.all([realpath(a), realpath(b)]);
  } catch {
    ra = resolve(a);
    rb = resolve(b);
  }
  if (process.platform === "win32") {
    return ra.toLowerCase() === rb.toLowerCase();
  }
  return ra === rb;
}

/**
 * Map of relative path (posix separators) -> absolute path for every file in
 * the tree, skipping `.git`. Directory symlinks are followed; broken entries
 * are recorded so a missing counterpart still registers as a difference.
 */
async function collectFiles(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const activeDirs = new Set<string>();

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const resolvedDir = await realpath(currentDir);
    const visitKey =
      process.platform === "win32" ? resolvedDir.toLowerCase() : resolvedDir;
    if (activeDirs.has(visitKey)) return;
    activeDirs.add(visitKey);

    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        files.set(rel, full);
      } else {
        // Symlink or other: classify via stat (follows links).
        try {
          const s = await stat(full);
          if (s.isDirectory()) {
            await walk(full, rel);
          } else {
            files.set(rel, full);
          }
        } catch {
          files.set(rel, full);
        }
      }
    }
    activeDirs.delete(visitKey);
  }

  await walk(dir, "");
  return files;
}

/**
 * Compare two skill directories file-by-file. Returns true only when both
 * trees contain the same relative paths with byte-identical contents. Any
 * read error is treated as "different" — the conservative answer, since a
 * difference only surfaces a conflict rather than touching data.
 */
export async function skillDirsIdentical(
  dirA: string,
  dirB: string,
): Promise<boolean> {
  try {
    const [filesA, filesB] = await Promise.all([
      collectFiles(dirA),
      collectFiles(dirB),
    ]);
    if (filesA.size !== filesB.size) return false;
    for (const [rel, fullA] of filesA) {
      const fullB = filesB.get(rel);
      if (!fullB) return false;
      const [bufA, bufB] = await Promise.all([
        readFile(fullA),
        readFile(fullB),
      ]);
      if (!bufA.equals(bufB)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Latest file mtime (ms) in a tree — the timestamp of the most recent edit.
 * Falls back to the directory's own mtime for empty trees, and to 0 when the
 * tree cannot be read at all (callers treat 0 as "no reliable timestamp").
 */
async function latestMtimeMs(dir: string): Promise<number> {
  try {
    const files = await collectFiles(dir);
    let latest = 0;
    for (const full of files.values()) {
      try {
        const s = await stat(full);
        if (s.mtimeMs > latest) latest = s.mtimeMs;
      } catch {
        // unreadable entry — ignore for timestamp purposes
      }
    }
    if (latest === 0) {
      const s = await stat(dir);
      latest = s.mtimeMs;
    }
    return latest;
  } catch {
    return 0;
  }
}

/**
 * Build the conflict record for a skill that exists locally with different
 * content than the imported source. Timestamps within 2s are
 * reported as "same" to absorb filesystem mtime granularity.
 */
export async function buildImportConflict(
  skill: ExportedSkill,
  sourcePath: string,
  targetDir: string,
): Promise<ImportConflict> {
  const [localMs, importedMs] = await Promise.all([
    latestMtimeMs(targetDir),
    latestMtimeMs(sourcePath),
  ]);
  const EPSILON_MS = 2000;
  // A 0 from latestMtimeMs means the tree could not be read — don't claim
  // either side is newer on unreliable data.
  const newer =
    localMs === 0 ||
    importedMs === 0 ||
    Math.abs(localMs - importedMs) <= EPSILON_MS
      ? "same"
      : localMs > importedMs
        ? "local"
        : "imported";
  return {
    skillName: skill.name,
    provider: skill.provider,
    scope: skill.scope,
    targetDir,
    sourcePath,
    localModified: new Date(localMs).toISOString(),
    importedModified: new Date(importedMs).toISOString(),
    newer,
  };
}

/**
 * Render a unified diff between the local and imported versions of a
 * conflicting skill: per-file hunks for changed text files, one-line notes
 * for added/removed/binary/oversized files. Direction is local -> imported,
 * i.e. the change that choosing "use imported" would apply.
 */
export async function renderConflictDiff(
  conflict: ImportConflict,
): Promise<string> {
  const [localFiles, importedFiles] = await Promise.all([
    collectFiles(conflict.targetDir),
    collectFiles(conflict.sourcePath),
  ]);
  const allPaths = Array.from(
    new Set([...localFiles.keys(), ...importedFiles.keys()]),
  ).sort();

  const sections: string[] = [];
  for (const rel of allPaths) {
    const localPath = localFiles.get(rel);
    const importedPath = importedFiles.get(rel);
    if (!importedPath) {
      sections.push(`only in local: ${rel}`);
      continue;
    }
    if (!localPath) {
      sections.push(`only in imported: ${rel}`);
      continue;
    }

    const ext = rel.includes(".")
      ? `.${rel.split(".").pop()!.toLowerCase()}`
      : "";
    try {
      const [bufLocal, bufImported] = await Promise.all([
        readFile(localPath),
        readFile(importedPath),
      ]);
      if (bufLocal.equals(bufImported)) continue;
      if (BINARY_EXTENSIONS.has(ext)) {
        sections.push(`differs (binary): ${rel}`);
        continue;
      }
      if (
        bufLocal.length > MAX_FILE_SIZE ||
        bufImported.length > MAX_FILE_SIZE
      ) {
        sections.push(`differs (too large to diff): ${rel}`);
        continue;
      }
      const diff = unifiedDiff(
        bufLocal.toString("utf-8"),
        bufImported.toString("utf-8"),
        rel,
      );
      if (diff) sections.push(diff);
    } catch {
      sections.push(`differs (unreadable): ${rel}`);
    }
  }
  return sections.join("\n");
}

/**
 * Replace the existing target directory via backup-and-swap: rename the
 * current version aside, run `apply` to produce the replacement, then drop
 * the backup. On any failure the backup is restored, so the previous install
 * survives. This replaces the old remove-then-copy sequence, which deleted
 * the target before knowing the copy could succeed — and destroyed the skill
 * outright when the copy source was the target itself.
 */
async function replaceTarget(
  targetDir: string,
  apply: () => Promise<void>,
): Promise<void> {
  const backupDir = `${targetDir}.import-backup-${Date.now()}`;
  await rename(targetDir, backupDir);
  try {
    await apply();
    await rm(backupDir, { recursive: true, force: true });
  } catch (err) {
    try {
      await rm(targetDir, { recursive: true, force: true });
      await rename(backupDir, targetDir);
    } catch {
      // Rollback failed — surface the original error; the backup dir still
      // holds the previous version for manual recovery.
    }
    throw err;
  }
}

/**
 * Find a provider config by name from the app config.
 */
function findProvider(config: AppConfig, providerName: string) {
  return config.providers.find((p) => p.name === providerName && p.enabled);
}

/**
 * Resolve the target directory for a skill based on provider and scope.
 */
function resolveTargetDir(
  config: AppConfig,
  providerName: string,
  scope: "global" | "project",
  dirName: string,
): string | null {
  const provider = findProvider(config, providerName);
  if (!provider) return null;

  const pathTemplate = scope === "global" ? provider.global : provider.project;
  const baseDir = resolveProviderPath(pathTemplate);

  // Sanitize dirName to prevent path traversal (e.g., "../../.bashrc")
  const safeDirName = basename(dirName);
  if (!safeDirName || safeDirName === "." || safeDirName === "..") {
    return null;
  }
  return join(baseDir, safeDirName);
}

/**
 * Find the source directory for a skill in the currently installed skills.
 */
function findInstalledSkill(
  installedSkills: SkillInfo[],
  exportedSkill: ExportedSkill,
): SkillInfo | null {
  // Match by dirName and provider
  const match = installedSkills.find(
    (s) =>
      s.dirName === exportedSkill.dirName &&
      s.provider === exportedSkill.provider,
  );
  if (match) return match;

  // Match by dirName only (different provider is still a valid source)
  return (
    installedSkills.find((s) => s.dirName === exportedSkill.dirName) || null
  );
}

/**
 * Import skills from a manifest into the local environment.
 *
 * Strategy:
 * - For each skill in the manifest, check if it already exists at the target location.
 * - If it exists with identical content (or the manifest resolves to this very
 *   install), skip — nothing to do.
 * - If it exists with different content, that is a conflict:
 *   ask `onConflict` when provided, otherwise skip and report which side is
 *   newer. `force` overwrites without asking.
 * - Overwrites go through a backup-and-swap so a failed copy never destroys
 *   the existing install.
 * - If a matching skill is found in any installed location, copy it to the target.
 * - If no source is found, report as failed with guidance.
 */
export async function importSkills(
  manifest: ExportManifest,
  options: {
    force: boolean;
    dryRun: boolean;
    scopeFilter: "global" | "project" | "both";
    /**
     * Called for each conflict (existing target with different content).
     * Absent -> conflicts are skipped and reported.
     */
    onConflict?: (conflict: ImportConflict) => Promise<ImportConflictChoice>;
  },
  /** @internal – dependency overrides for testing */
  _deps?: {
    config: AppConfig;
    installedSkills: SkillInfo[];
  },
): Promise<ImportSummary> {
  const config = _deps?.config ?? (await loadConfig());
  const installedSkills =
    _deps?.installedSkills ?? (await scanAllSkills(config, "both"));
  const results: ImportResult[] = [];

  for (const skill of manifest.skills) {
    // Apply scope filter
    if (options.scopeFilter !== "both" && skill.scope !== options.scopeFilter) {
      debug(
        `import: skipping "${skill.name}" — scope "${skill.scope}" filtered out`,
      );
      continue;
    }

    const targetDir = resolveTargetDir(
      config,
      skill.provider,
      skill.scope,
      skill.dirName,
    );

    if (!targetDir) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason: `Provider "${skill.provider}" not found or not enabled.`,
      });
      continue;
    }

    // Check if already installed at target
    const exists = await skillExists(targetDir);

    // Existing target without --force: compare against the resolved source
    // to distinguish "same skill, nothing to do" from a real conflict
    //. Dry-run keeps the legacy skip below unchanged.
    if (exists && !options.force && !options.dryRun) {
      const source = findInstalledSkill(installedSkills, skill);
      // Nothing to compare against (no source), the manifest resolves to
      // this very install (self-import), or contents are identical: the
      // skill is already here — skip as before.
      if (
        !source ||
        (await isSameDir(source.realPath, targetDir)) ||
        (await skillDirsIdentical(source.realPath, targetDir))
      ) {
        results.push({
          skillName: skill.name,
          provider: skill.provider,
          scope: skill.scope,
          status: "skipped",
          reason: "Already installed.",
          path: targetDir,
        });
        continue;
      }

      // Same skill, different content — a conflict.
      const conflict = await buildImportConflict(
        skill,
        source.realPath,
        targetDir,
      );
      const choice: ImportConflictChoice = options.onConflict
        ? await options.onConflict(conflict)
        : "skip";

      if (choice === "use-imported") {
        try {
          await replaceTarget(targetDir, () =>
            cp(source.realPath, targetDir, { recursive: true }),
          );
          debug(
            `import: conflict resolved, copied "${skill.name}" from ${source.realPath} to ${targetDir}`,
          );
          results.push({
            skillName: skill.name,
            provider: skill.provider,
            scope: skill.scope,
            status: "installed",
            reason: "Conflict resolved: used imported version.",
            path: targetDir,
            conflict,
          });
        } catch (err: any) {
          results.push({
            skillName: skill.name,
            provider: skill.provider,
            scope: skill.scope,
            status: "failed",
            reason: `Copy failed: ${err.message}`,
            conflict,
          });
        }
      } else {
        const reason =
          choice === "keep-local"
            ? "Conflict: kept local version."
            : options.onConflict
              ? "Conflict: skipped."
              : conflict.newer === "local"
                ? "Conflict: local version is newer. Use --force to overwrite."
                : conflict.newer === "imported"
                  ? "Conflict: imported version is newer. Use --force to overwrite."
                  : "Conflict: contents differ. Use --force to overwrite.";
        results.push({
          skillName: skill.name,
          provider: skill.provider,
          scope: skill.scope,
          status: "skipped",
          reason,
          path: targetDir,
          conflict,
        });
      }
      continue;
    }

    if (exists && !options.force) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "skipped",
        reason: "Already installed.",
        path: targetDir,
      });
      continue;
    }

    // Dry run: report what would happen
    if (options.dryRun) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "dry-run",
        reason: exists ? "Would overwrite (--force)." : "Would install.",
        path: targetDir,
      });
      continue;
    }

    // Try to find a source to copy from
    const source = findInstalledSkill(installedSkills, skill);
    if (!source) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason:
          "No installed source found. Install the skill first with: asm install <source>",
      });
      continue;
    }

    // Self-import guard: the manifest's source is the target itself.
    // The old remove-then-copy sequence deleted the only copy here.
    if (exists && (await isSameDir(source.realPath, targetDir))) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "skipped",
        reason: "Already installed.",
        path: targetDir,
      });
      continue;
    }

    // Copy skill to target (or recreate symlink)
    try {
      await mkdir(join(targetDir, ".."), { recursive: true });

      const apply = async () => {
        if (skill.isSymlink && skill.symlinkTarget) {
          // Recreate the symlink; fall back to copy if the target doesn't exist
          try {
            await access(skill.symlinkTarget);
            await createDirSymlink(skill.symlinkTarget, targetDir);
            debug(
              `import: symlinked "${skill.name}" -> ${skill.symlinkTarget} at ${targetDir}`,
            );
          } catch {
            // Symlink target unreachable on this machine – fall back to copy
            await cp(source.realPath, targetDir, { recursive: true });
            debug(
              `import: symlink target unreachable, copied "${skill.name}" from ${source.realPath} to ${targetDir}`,
            );
          }
        } else {
          await cp(source.realPath, targetDir, { recursive: true });
          debug(
            `import: copied "${skill.name}" from ${source.realPath} to ${targetDir}`,
          );
        }
      };

      if (exists) {
        // Overwrite via backup-and-swap so a failed copy can't destroy the
        // existing install (the old code removed it first).
        await replaceTarget(targetDir, apply);
      } else {
        await apply();
      }

      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "installed",
        path: targetDir,
      });
    } catch (err: any) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason: `Copy failed: ${err.message}`,
      });
    }
  }

  const installed = results.filter((r) => r.status === "installed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const conflicts = results.filter((r) => r.conflict !== undefined).length;

  return {
    total: results.length,
    installed,
    skipped,
    failed,
    conflicts,
    results,
  };
}
