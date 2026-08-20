/**
 * Library update pipeline — `asm library update`.
 * Split from library.ts (issue #455).
 */

import { readFile, realpath, rm } from "fs/promises";
import { join } from "path";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";

import { parseFrontmatter } from "./utils/frontmatter";
import { withFileMutationLock } from "./utils/atomic-file";
import type { LibrarySkillEntry } from "./utils/types";
import {
  type LibraryPaths,
  type LibraryUpdateResult,
  type LibraryUpdateSummary,
  readLibraryLock,
  writeLibraryLock,
  readLibraryLockFile,
  persistLibraryLock,
  libraryUpdateFailure,
  libraryEntryMatchesUpdateSource,
  libraryEntryChangedDuringUpdate,
  nextInstalledAt,
  librarySourceRoot,
  validateSourceSkillFrontmatter,
  isContainedPath,
  resolveContainedPath,
  libraryPathRealpathIsContained,
  hashDirectoryContents,
  cloneRemoteLibrarySource,
  stageLibraryDirectory,
  replaceDirectoryAtomically,
} from "./library-core";

export async function updateLibrarySkill(
  name: string,
  paths: LibraryPaths = {},
  _overrides?: {
    writeLibraryLockFn?: typeof writeLibraryLock;
  },
): Promise<LibraryUpdateResult> {
  const lockPath = paths.lockPath ?? getLibraryLockPath();
  const skillsDir = paths.skillsDir ?? getLibrarySkillsDir();
  const persistLibraryLockFn =
    _overrides?.writeLibraryLockFn ?? persistLibraryLock;
  const lock = await readLibraryLock(lockPath);
  const directEntry = lock.skills[name] ?? null;
  const nameMatch =
    (Object.entries(lock.skills) as Array<[string, LibrarySkillEntry]>).find(
      ([, entry]) => entry.name === name,
    ) ?? null;
  const selected: [string, LibrarySkillEntry] | null = directEntry
    ? [name, directEntry]
    : nameMatch;

  if (!selected) {
    return libraryUpdateFailure(
      name,
      `Library skill "${name}" not found. Run "asm library list".`,
    );
  }

  const [dirName, entry] = selected;
  const expectedEntry = { ...entry };

  if (!entry.source || !entry.source.trim()) {
    return libraryUpdateFailure(dirName, "Missing update metadata: source");
  }
  if (!entry.sourceType || !entry.sourceType.trim()) {
    return libraryUpdateFailure(dirName, "Missing update metadata: sourceType");
  }
  if (entry.skillPath === undefined || entry.skillPath === null) {
    return libraryUpdateFailure(dirName, "Missing update metadata: skillPath");
  }
  if (!entry.libraryPath || !entry.libraryPath.trim()) {
    return libraryUpdateFailure(
      dirName,
      "Missing update metadata: libraryPath",
    );
  }

  let cleanupSourceRoot: string | null = null;
  let expectedLocalSourceIdentity: string | null = null;
  try {
    let sourceRoot: string;
    let nextCommitHash: string | null = null;

    if (entry.sourceType === "local") {
      const localSourceRoot = librarySourceRoot(entry);
      if (!localSourceRoot) {
        return libraryUpdateFailure(
          dirName,
          `Unsupported library source for update: ${entry.source}`,
        );
      }
      sourceRoot = localSourceRoot;
    } else if (
      entry.sourceType === "github" ||
      entry.sourceType === "registry"
    ) {
      const cloneResult = await cloneRemoteLibrarySource(
        entry,
        dirName,
        lockPath,
      );
      if ("reason" in cloneResult) {
        if (cloneResult.tempDir) {
          cleanupSourceRoot = cloneResult.tempDir;
        }
        return libraryUpdateFailure(dirName, cloneResult.reason);
      }
      sourceRoot = cloneResult.tempDir;
      cleanupSourceRoot = cloneResult.tempDir;
      nextCommitHash = cloneResult.commitHash;
    } else {
      return libraryUpdateFailure(
        dirName,
        `Unsupported library source type for update: ${entry.sourceType}`,
      );
    }

    const sourceDir = resolveContainedPath(
      sourceRoot,
      join(sourceRoot, entry.skillPath),
    );
    if (!sourceDir) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: skillPath escapes source root",
      );
    }

    const sourceSkillPath = join(sourceDir, "SKILL.md");
    let realSourceRoot: string;
    let realSourceDir: string;
    try {
      [realSourceRoot, realSourceDir] = await Promise.all([
        realpath(sourceRoot),
        realpath(sourceDir),
      ]);
    } catch (err: unknown) {
      return libraryUpdateFailure(
        dirName,
        `Unable to read source SKILL.md at ${sourceSkillPath}: ${
          err instanceof Error ? (err.message ?? String(err)) : String(err)
        }`,
      );
    }
    if (!isContainedPath(realSourceRoot, realSourceDir)) {
      return libraryUpdateFailure(
        dirName,
        "Invalid update metadata: skillPath escapes source root",
      );
    }
    if (entry.sourceType === "local") {
      expectedLocalSourceIdentity = realSourceDir;
    }

    let sourceMarkdown: string;
    try {
      sourceMarkdown = await readFile(sourceSkillPath, "utf-8");
    } catch (err: unknown) {
      return libraryUpdateFailure(
        dirName,
        `Unable to read source SKILL.md at ${sourceSkillPath}: ${
          err instanceof Error ? (err.message ?? String(err)) : String(err)
        }`,
      );
    }

    const frontmatter = parseFrontmatter(sourceMarkdown);
    const sourceMetadata = validateSourceSkillFrontmatter(frontmatter);
    if ("reason" in sourceMetadata) {
      return libraryUpdateFailure(dirName, sourceMetadata.reason);
    }

    const nameFromSource = sourceMetadata.name;
    const versionFromSource = sourceMetadata.version;
    if (entry.sourceType === "local") {
      nextCommitHash = await hashDirectoryContents(sourceDir);
    }
    if (!nextCommitHash) {
      return libraryUpdateFailure(dirName, "Could not read new commit");
    }

    const stagedDir = await stageLibraryDirectory(
      sourceDir,
      join(skillsDir, dirName),
    );

    try {
      return await withFileMutationLock(lockPath, async () => {
        const currentLock = await readLibraryLockFile(lockPath);
        const currentEntry = currentLock.skills[dirName];
        if (!currentEntry) {
          return libraryUpdateFailure(
            dirName,
            `Library skill "${dirName}" not found. Run "asm library list".`,
          );
        }

        const currentLibraryPath = resolveContainedPath(
          skillsDir,
          currentEntry.libraryPath,
        );
        if (!currentLibraryPath) {
          return libraryUpdateFailure(
            dirName,
            "Invalid update metadata: libraryPath escapes library skills directory",
          );
        }
        if (
          !(await libraryPathRealpathIsContained(skillsDir, currentLibraryPath))
        ) {
          return libraryUpdateFailure(
            dirName,
            "Invalid update metadata: libraryPath escapes library skills directory",
          );
        }

        let updateSourceStillMatches: boolean;
        try {
          updateSourceStillMatches = await libraryEntryMatchesUpdateSource(
            currentEntry,
            expectedEntry,
            expectedLocalSourceIdentity,
          );
        } catch {
          return libraryEntryChangedDuringUpdate(dirName);
        }
        const installedGenerationStillMatches =
          currentEntry.installedAt === expectedEntry.installedAt;
        if (
          installedGenerationStillMatches &&
          updateSourceStillMatches &&
          currentEntry.commitHash === nextCommitHash
        ) {
          return {
            name: currentEntry.name,
            status: "skipped" as const,
            oldVersion: currentEntry.version,
            newVersion: versionFromSource,
            oldCommit: currentEntry.commitHash,
            newCommit: nextCommitHash,
          };
        }

        if (
          !installedGenerationStillMatches ||
          !updateSourceStillMatches ||
          currentEntry.commitHash !== expectedEntry.commitHash
        ) {
          return libraryEntryChangedDuringUpdate(dirName);
        }

        const updatedLock = {
          ...currentLock,
          skills: {
            ...currentLock.skills,
            [dirName]: {
              ...currentEntry,
              name: nameFromSource,
              version: versionFromSource,
              commitHash: nextCommitHash,
              installedAt: nextInstalledAt(currentEntry.installedAt),
            },
          },
        };

        const swapResult = await replaceDirectoryAtomically({
          stagedDir,
          targetDir: currentLibraryPath,
          writeLock: () => persistLibraryLockFn(updatedLock, lockPath),
        });
        if (swapResult) {
          return libraryUpdateFailure(
            dirName,
            swapResult.reason ?? "Failed to update library skill",
          );
        }

        return {
          name: nameFromSource,
          status: "updated" as const,
          oldVersion: currentEntry.version,
          newVersion: versionFromSource,
          oldCommit: currentEntry.commitHash,
          newCommit: nextCommitHash,
        };
      });
    } finally {
      await rm(stagedDir, { recursive: true, force: true });
    }
  } finally {
    if (cleanupSourceRoot) {
      await rm(cleanupSourceRoot, { recursive: true, force: true });
    }
  }
}

export async function updateLibrarySkills(
  names: string[] | null,
  paths: LibraryPaths = {},
): Promise<LibraryUpdateSummary> {
  const lockPath = paths.lockPath ?? getLibraryLockPath();
  const lock = await readLibraryLock(lockPath);
  const selectedNames = names === null ? Object.keys(lock.skills) : names;
  const warnings: string[] = [];
  const results: LibraryUpdateResult[] = [];

  for (const selectedName of selectedNames) {
    const result = await updateLibrarySkill(selectedName, paths);
    if (
      result.status === "failed" &&
      result.reason?.includes('Run "asm library list"')
    ) {
      warnings.push(result.reason);
    }
    results.push(result);
  }

  return {
    results,
    updatedCount: results.filter((result) => result.status === "updated")
      .length,
    skippedCount: results.filter((result) => result.status === "skipped")
      .length,
    failedCount: results.filter((result) => result.status === "failed").length,
    warnings,
  };
}
