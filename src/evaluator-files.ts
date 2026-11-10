/**
 * Confined file access for `asm eval` (#825).
 *
 * `asm eval` follows the symlink rule every other skill scan follows
 * (docs/security/symlink-rule.md): nothing outside the skill folder's real
 * path is opened, read, walked, linted or printed. A link that leaves the
 * folder, dangles or loops is reported once and never followed; a link that
 * stays inside keeps working as before. The walk itself is `walkFiles` in
 * `utils/fs.ts`, the one implementation of the rule.
 */

import { lstat, readlink, realpath, stat } from "fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "path";
import {
  externalLink,
  isPathInside,
  MAX_FILE_SIZE,
  outsideLinkKind,
  readBoundedTextFile,
  walkFiles,
} from "./utils/fs";
import { stripControlBytes } from "./security-auditor-scan";
import type { ExternalSymlink } from "./utils/types";

/** A regular file inside the skill folder. */
export interface SkillFile {
  fullPath: string;
  /** Path relative to the skill folder, `/`-separated. */
  relPath: string;
  name: string;
  /** Size seen by the walk; bounds the later read. */
  size: number;
}

/** What eval may read in a skill folder, and the links it did not follow. */
export interface SkillFiles {
  files: SkillFile[];
  externalSymlinks: ExternalSymlink[];
}

/**
 * How many link paths may lead into one real folder. Eval has always walked
 * a folder again for each in-folder link to it, and scores each path; the
 * cap keeps that while bounding folders that link to each other.
 */
export const EVAL_MAX_FOLDER_VISITS = 8;

/**
 * One confined walk of a skill folder, shared by the PII and script-lint
 * scorers so each link is reported once. The folder itself may be a link
 * (an `asm link` install) and is followed; its real path is the boundary.
 * Hidden folders and `node_modules` are skipped, as eval always did.
 */
export async function listSkillFiles(skillPath: string): Promise<SkillFiles> {
  const dir = isAbsolute(skillPath) ? skillPath : resolve(skillPath);
  const files: SkillFile[] = [];
  const externalSymlinks: ExternalSymlink[] = [];
  await walkFiles(
    dir,
    ({ fullPath, relPath, name, stats }) => {
      files.push({ fullPath, relPath, name, size: stats.size });
    },
    {
      onExternalSymlink: (link) => externalSymlinks.push(link),
      skip: (name, isDirectory) =>
        isDirectory && (name.startsWith(".") || name === "node_modules"),
      maxFolderVisits: EVAL_MAX_FOLDER_VISITS,
    },
  );
  return { files, externalSymlinks };
}

/**
 * Read a file `listSkillFiles` found. The read is bounded by the size the
 * walk saw (at least 512 KiB), so a stable file is read in full as before,
 * while a file swapped for a FIFO or device is refused.
 */
export function readSkillFile(file: SkillFile): Promise<string | null> {
  return readBoundedTextFile(file.fullPath, Math.max(MAX_FILE_SIZE, file.size));
}

/** `path -> target (kind, NOT read)`, as `asm audit security` prints it. */
export function formatUnreadLink(link: ExternalSymlink): string {
  const note =
    link.kind === "dangling" || link.kind === "loop"
      ? `${link.kind}, not followed`
      : `${link.kind}, NOT read`;
  const target = link.target ? stripControlBytes(link.target) : "(unreadable)";
  return `${stripControlBytes(link.path)} -> ${target} (${note})`;
}

/** The eval finding for a link it did not read or follow. */
export function unreadLinkFinding(link: ExternalSymlink): string {
  return `Symlink not read: ${formatUnreadLink(link)}`;
}

/**
 * Read a skill's SKILL.md only when it resolves inside its folder (the
 * parent's real path). Returns null when it does not exist. Throws, without
 * opening it, when it is a link that leaves the folder, and when it is not a
 * regular file.
 */
export async function readSkillMd(skillMdPath: string): Promise<string | null> {
  const abs = resolve(skillMdPath);
  let folderReal: string;
  let mdReal: string;
  try {
    folderReal = await realpath(dirname(abs));
    mdReal = await realpath(abs);
  } catch {
    return null;
  }
  if (!isPathInside(folderReal, mdReal)) {
    const link = externalLink(
      basename(abs),
      mdReal,
      await outsideLinkKind(abs),
    );
    throw new Error(
      `${unreadLinkFinding(link)}. asm eval reads nothing outside the skill folder.`,
    );
  }
  let size: number;
  try {
    size = (await stat(mdReal)).size;
  } catch {
    return null;
  }
  const content = await readBoundedTextFile(
    mdReal,
    Math.max(MAX_FILE_SIZE, size),
  );
  if (content === null) {
    throw new Error(`${abs} is not a regular file or could not be read.`);
  }
  return content;
}

/**
 * The link a skill folder is when it resolves outside `boundary` (the
 * collection or clone it came from), else null. Nothing in it is read.
 */
export async function skillDirOutside(
  skillDir: string,
  boundary: string,
): Promise<ExternalSymlink | null> {
  let boundaryReal: string;
  let real: string;
  try {
    boundaryReal = await realpath(boundary);
    real = await realpath(skillDir);
  } catch {
    return null;
  }
  if (isPathInside(boundaryReal, real)) return null;
  const label = relative(resolve(boundary), resolve(skillDir)) || ".";
  return externalLink(label, real, "directory");
}

/**
 * Refuse to write `path` (the `--fix` backup) through a symlink that leaves
 * its folder or dangles: `copyFile` would follow it and write outside.
 */
export async function assertNoLinkOut(path: string): Promise<void> {
  let isLink: boolean;
  try {
    isLink = (await lstat(path)).isSymbolicLink();
  } catch {
    return; // does not exist yet: written as a new file
  }
  if (!isLink) return;
  const folderReal = await realpath(dirname(resolve(path)));
  let real: string | null;
  try {
    real = await realpath(path);
  } catch {
    real = null;
  }
  if (real !== null && isPathInside(folderReal, real)) return;
  const raw = await readlink(path).catch(() => "");
  const link = externalLink(
    basename(path),
    real ?? (raw ? resolve(dirname(resolve(path)), raw) : ""),
    real === null ? "dangling" : await outsideLinkKind(path),
  );
  throw new Error(
    `Refusing to write through ${formatUnreadLink(link)}: it leaves the skill folder. Remove the link and run --fix again.`,
  );
}
