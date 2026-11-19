/**
 * Library uninstall — exact removal of one library original plus its
 * `library-lock.json` entry, guarded by a best-effort reference check over the
 * checked scope (issue #799).
 *
 * Boundaries enforced here rather than in the command layer:
 *
 *  - Only the managed library directory is ever removed. The local source
 *    directory recorded by a `local:` entry is never touched, and a path that
 *    escapes `getLibrarySkillsDir()` is refused.
 *  - The lock entry is authoritative. A library directory without a lock entry
 *    is never guessed at and never deleted.
 *  - Reference checks cover the global and current-project skill folders of
 *    every configured provider, including disabled ones, and match on symlink
 *    *targets* (resolved paths) rather than activation names. Renamed
 *    activations are therefore still found.
 *  - That scope is not the whole world. asm keeps no project or activation
 *    registry, so a clean scan is never proof that the skill is unused
 *    elsewhere — callers must say so (see `buildSideEffectNotice`).
 */
import { lstat, readdir, readlink, realpath, rm, stat } from "fs/promises";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";
import {
  isContainedPath,
  librarySourceRoot,
  persistLibraryLock,
  readLibraryLockFile,
} from "./library-core";
import type { LibrarySkillInfo } from "./library-core";
import { withFileMutationLock } from "./utils/atomic-file";
import type { LibrarySkillEntry, ProviderConfig } from "./utils/types";

/** One directory the reference check attempted to scan. */
export interface LibraryCheckLocation {
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  path: string;
  /** Configured providers are checked even when disabled. */
  enabled: boolean;
  /**
   * `checked` — directory exists and was scanned.
   * `missing`  — directory does not exist (or is not a directory): nothing to
   *              scan, and not a failure.
   * `unreadable` — the directory could not be scanned. This is a hard failure:
   *              an unreadable location must never be reported as "no
   *              references".
   */
  status: "checked" | "missing" | "unreadable";
  error?: string;
}

/** An activation link found in the checked scope. */
export interface LibraryReference {
  /** Absolute path of the symlink itself. */
  linkPath: string;
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  /** Absolute target the link points at (lexical resolution). */
  target: string;
  /**
   * The link target does not exist on disk. Still a reference: it is exactly
   * the breakage a library removal would leave behind.
   */
  dangling: boolean;
}

export interface LibraryReferenceScan {
  libraryPath: string;
  locations: LibraryCheckLocation[];
  references: LibraryReference[];
  unreadableLocations: LibraryCheckLocation[];
}

export interface LibraryReferenceScanInput {
  libraryPath: string;
  providers: ProviderConfig[];
  /**
   * Directory relative provider templates resolve against. Defaults to
   * `process.cwd()` — the "current project" the check can see.
   */
  cwd?: string;
}

/**
 * Resolve a provider path template the same way {@link resolveProviderPath}
 * does, but against an explicit cwd so the checked scope is testable.
 */
export function resolveProviderLocationPath(
  template: string,
  cwd: string,
): string {
  if (template.startsWith("~/")) {
    return join(homedir(), template.slice(2));
  }
  if (template.startsWith("/")) {
    return template;
  }
  return resolve(cwd, template);
}

async function realpathIfExists(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * `realpath` that also works when the leaf is gone: the deepest existing
 * ancestor is resolved and the missing tail is re-appended. A dangling
 * activation link must still match a library path that was removed through a
 * symlinked ancestor (macOS `/var` → `/private/var`, symlinked config dirs).
 */
async function realpathLenient(path: string): Promise<string | null> {
  const tail: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      const real = await realpath(current);
      return tail.length > 0 ? resolve(real, ...tail.reverse()) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Every absolute spelling of `path` worth comparing: the lexical path, plus
 * its realpath (also when only an ancestor still exists). macOS temp dirs
 * (`/var` → `/private/var`) and symlinked config dirs make a lexical-only
 * comparison miss real references.
 */
async function pathVariants(path: string): Promise<string[]> {
  const variants = new Set<string>([resolve(path)]);
  const resolved = await realpathLenient(path);
  if (resolved) variants.add(resolved);
  return [...variants];
}

async function targetExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan every configured provider's global skill folder and the current
 * project's skill folder (including disabled providers) for symlinks whose
 * target is the library original at `libraryPath`.
 *
 * This is intentionally *not* a whole-disk scan and *not* a project registry:
 * only the current working directory's project folders are visible.
 */
export async function scanLibraryReferences(
  input: LibraryReferenceScanInput,
): Promise<LibraryReferenceScan> {
  const cwd = input.cwd ?? process.cwd();
  const libraryVariants = await pathVariants(input.libraryPath);

  const locations: LibraryCheckLocation[] = [];
  const references: LibraryReference[] = [];
  const unreadableLocations: LibraryCheckLocation[] = [];

  for (const provider of input.providers) {
    for (const scope of ["global", "project"] as const) {
      const template = scope === "global" ? provider.global : provider.project;
      const locationPath = resolveProviderLocationPath(template, cwd);
      const location: LibraryCheckLocation = {
        provider: provider.name,
        providerLabel: provider.label,
        scope,
        path: locationPath,
        enabled: provider.enabled !== false,
        status: "checked",
      };

      let entries;
      try {
        entries = await readdir(locationPath, { withFileTypes: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          location.status = "missing";
          locations.push(location);
          continue;
        }
        location.status = "unreadable";
        location.error = err instanceof Error ? err.message : String(err);
        locations.push(location);
        unreadableLocations.push(location);
        continue;
      }

      locations.push(location);

      for (const entry of entries) {
        const linkPath = join(locationPath, entry.name);

        let isSymlink = entry.isSymbolicLink();
        if (!isSymlink && !entry.isDirectory() && !entry.isFile()) {
          // Filesystem did not report a type (some network mounts); confirm.
          try {
            isSymlink = (await lstat(linkPath)).isSymbolicLink();
          } catch {
            continue;
          }
        }
        if (!isSymlink) continue;

        let rawTarget: string;
        try {
          rawTarget = await readlink(linkPath);
        } catch {
          // Vanished between readdir and readlink — nothing to report.
          continue;
        }

        const absoluteTarget = isAbsolute(rawTarget)
          ? rawTarget
          : resolve(locationPath, rawTarget);

        const targetVariants = await pathVariants(absoluteTarget);
        // A link is a reference when it points at the library original OR at
        // anything inside it (a manually-created link to a file in the skill
        // directory still breaks when the original goes away). Both sides are
        // compared across their lexical and realpath spellings, so a symlinked
        // config dir (or macOS `/var` → `/private/var`) cannot hide a match.
        const matched = targetVariants.some((variant) =>
          libraryVariants.some((libraryVariant) =>
            isContainedPath(libraryVariant, variant),
          ),
        );
        if (!matched) continue;

        references.push({
          linkPath,
          provider: provider.name,
          providerLabel: provider.label,
          scope,
          target: resolve(absoluteTarget),
          dangling: !(await targetExists(absoluteTarget)),
        });
      }
    }
  }

  // readdir order is filesystem-dependent; keep the report deterministic.
  references.sort((a, b) => a.linkPath.localeCompare(b.linkPath));

  return {
    libraryPath: resolve(input.libraryPath),
    locations,
    references,
    unreadableLocations,
  };
}

// ─── Entry resolution ───────────────────────────────────────────────────────

export type LibraryEntryResolution =
  | { ok: true; entry: LibrarySkillInfo }
  | { ok: false; reason: string; ambiguous?: boolean };

/**
 * Resolve exactly one library entry for removal.
 *
 * The directory key (the `library-lock.json` key, i.e. what removal is keyed
 * on) wins. When it does not match, an *exact* frontmatter-name match is
 * accepted only if it is unique — there is no fuzzy, partial, or
 * case-insensitive matching, and an ambiguous name is an error rather than a
 * guess.
 */
export function resolveLibraryEntryForRemoval(
  rows: LibrarySkillInfo[],
  name: string,
): LibraryEntryResolution {
  const byDirName = rows.filter((row) => row.dirName === name);
  if (byDirName.length === 1) {
    return { ok: true, entry: byDirName[0] };
  }

  const byName = rows.filter((row) => row.name === name);
  if (byName.length === 1) {
    return { ok: true, entry: byName[0] };
  }
  if (byName.length > 1) {
    const keys = byName.map((row) => row.dirName).sort();
    return {
      ok: false,
      ambiguous: true,
      reason: `Library entry name "${name}" is ambiguous: it matches ${keys.length} library directories (${keys.join(", ")}). Re-run with the directory key.`,
    };
  }

  return {
    ok: false,
    reason: `Library skill "${name}" not found. Run "asm library list".`,
  };
}

// ─── Removal ────────────────────────────────────────────────────────────────

export interface RemoveLibrarySkillInput {
  /** `library-lock.json` key. */
  dirName: string;
  entry: LibrarySkillEntry;
  skillsDir?: string;
  lockPath?: string;
}

export interface LibraryRemovalOutcome {
  libraryPath: string;
  removedDirectory: boolean;
  removedLockEntry: boolean;
  /** Remaining on-disk state after the attempt, for failure reporting. */
  directoryPresent: boolean;
  lockEntryPresent: boolean;
  errors: string[];
}

/**
 * Refuse any removal target that is not a managed library directory.
 *
 * Throws before touching the filesystem so a corrupted or hostile lock entry
 * can never widen the blast radius beyond `getLibrarySkillsDir()`.
 */
export async function assertManagedLibraryRemovalTarget(input: {
  dirName: string;
  entry: LibrarySkillEntry;
  skillsDir: string;
}): Promise<string> {
  const libraryPath = resolve(input.entry.libraryPath);
  const skillsDir = resolve(input.skillsDir);

  if (libraryPath === skillsDir) {
    throw new Error(
      `Refusing to remove "${input.dirName}": library path resolves to the library skills directory itself (${libraryPath}).`,
    );
  }

  if (!isContainedPath(skillsDir, libraryPath)) {
    throw new Error(
      `Refusing to remove "${input.dirName}": ${libraryPath} is outside the managed library (${skillsDir}).`,
    );
  }

  if (basename(libraryPath) !== input.dirName) {
    throw new Error(
      `Refusing to remove "${input.dirName}": library path ${libraryPath} does not match the lock entry key.`,
    );
  }

  const sourceRoot = librarySourceRoot(input.entry);
  if (sourceRoot && resolve(sourceRoot) === libraryPath) {
    throw new Error(
      `Refusing to remove "${input.dirName}": ${libraryPath} is the local source directory, not a library copy.`,
    );
  }

  // Guard against a symlinked library entry that points outside the library.
  const [realSkillsDir, realLibraryPath] = await Promise.all([
    realpathIfExists(skillsDir),
    realpathIfExists(libraryPath),
  ]);
  if (
    realSkillsDir &&
    realLibraryPath &&
    !isContainedPath(realSkillsDir, realLibraryPath)
  ) {
    throw new Error(
      `Refusing to remove "${input.dirName}": ${libraryPath} resolves outside the managed library (${realLibraryPath}).`,
    );
  }

  return libraryPath;
}

async function pathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Whether a directory (following symlinks) exists at the library path.
 * Distinct from `LibrarySkillInfo.missing`, which only reports a missing
 * `SKILL.md`, and stricter than a bare `lstat`: a regular file or a dangling
 * symlink at the path is not a directory.
 */
export async function libraryDirectoryPresent(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Remove the library directory first, then the lock entry — exactly that order
 * so an interrupted run leaves a stale lock entry (recoverable) rather than an
 * untracked directory. Never throws for filesystem failures: the outcome says
 * what was removed and what remains so the caller can report it and exit
 * non-zero without claiming success.
 */
export async function removeLibrarySkill(
  input: RemoveLibrarySkillInput,
): Promise<LibraryRemovalOutcome> {
  const skillsDir = input.skillsDir ?? getLibrarySkillsDir();
  const lockPath = input.lockPath ?? getLibraryLockPath();
  const libraryPath = await assertManagedLibraryRemovalTarget({
    dirName: input.dirName,
    entry: input.entry,
    skillsDir,
  });

  const outcome: LibraryRemovalOutcome = {
    libraryPath,
    removedDirectory: false,
    removedLockEntry: false,
    directoryPresent: false,
    lockEntryPresent: true,
    errors: [],
  };

  try {
    outcome.directoryPresent = await pathPresent(libraryPath);
  } catch (err) {
    outcome.errors.push(
      `Could not inspect library directory ${libraryPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    outcome.directoryPresent = true;
    return outcome;
  }

  if (outcome.directoryPresent) {
    try {
      await rm(libraryPath, { recursive: true });
      outcome.removedDirectory = true;
      outcome.directoryPresent = false;
    } catch (err) {
      outcome.errors.push(
        `Failed to remove library directory ${libraryPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return outcome;
    }
  }

  try {
    await withFileMutationLock(lockPath, async () => {
      const lock = await readLibraryLockFile(lockPath);
      if (!Object.prototype.hasOwnProperty.call(lock.skills, input.dirName)) {
        outcome.lockEntryPresent = false;
        return;
      }
      const nextSkills = { ...lock.skills };
      delete nextSkills[input.dirName];
      await persistLibraryLock({ ...lock, skills: nextSkills }, lockPath);
      outcome.removedLockEntry = true;
      outcome.lockEntryPresent = false;
    });
  } catch (err) {
    outcome.errors.push(
      `Failed to update library lock ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return outcome;
}

// ─── Mandatory side-effect notice ───────────────────────────────────────────

/**
 * The warning that must be shown before confirmation and deletion, and carry
 * into `--json` output. It is deliberately explicit that a clean scan is not
 * proof of global non-use.
 */
export function buildSideEffectNotice(): string {
  return [
    "Side effects: asm keeps no project or activation registry, so it cannot",
    "know whether other projects use this skill. Only the global skill folders",
    "of configured providers and this project's skill folders are checked.",
    "Other projects are NOT checked.",
    "",
    "Deleting the library original can break activation links in other",
    "projects, which will then be unable to load the skill.",
  ].join("\n");
}

export interface CheckedScopeLike {
  locations: LibraryCheckLocation[];
}

/** Summarise the scope actually scanned, for both human and JSON output. */
export function describeCheckedScope(scan: CheckedScopeLike): {
  providerCount: number;
  locationCount: number;
  existingCount: number;
  missingCount: number;
  unreadableCount: number;
  providers: string[];
} {
  const providers = [...new Set(scan.locations.map((l) => l.provider))];
  return {
    providerCount: providers.length,
    locationCount: scan.locations.length,
    existingCount: scan.locations.filter((l) => l.status === "checked").length,
    missingCount: scan.locations.filter((l) => l.status === "missing").length,
    unreadableCount: scan.locations.filter((l) => l.status === "unreadable")
      .length,
    providers,
  };
}
