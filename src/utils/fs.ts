import { constants as fsConstants, type Stats } from "fs";
import {
  cp,
  lstat,
  open,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  unlink,
} from "fs/promises";
import type { ExternalSymlink } from "./types";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";

/**
 * Create a directory symlink that works on every platform.
 *
 * POSIX: a standard directory symlink, preserving the caller's target — which
 * is often relative, so the link stays valid if the home directory moves.
 *
 * Windows: a directory *junction* instead of a real symlink. Real directory
 * symlinks require elevation (Admin / Developer Mode) and otherwise fail with
 * `EPERM`, whereas junctions need no special privileges. Node still reports a
 * junction as a symlink via `lstat().isSymbolicLink()` and resolves it through
 * `readlink()`/`realpath()`, so asm's symlink detection, dedup, and uninstall
 * logic keep working unchanged. Junction targets must be absolute, so the
 * (possibly relative) target is resolved against the link's parent directory —
 * the same base against which a symlink target is interpreted.
 */
export async function createDirSymlink(
  target: string,
  linkPath: string,
): Promise<void> {
  if (process.platform === "win32") {
    await symlink(resolve(dirname(linkPath), target), linkPath, "junction");
  } else {
    await symlink(target, linkPath, "dir");
  }
}

/**
 * Normalize a *relative* path for storage in on-disk metadata.
 *
 * `path.relative()` returns backslashes on Windows, so persisting its result
 * verbatim (library manifest `skillPath`, lock entries) writes machine-specific
 * separators into files that are meant to be portable — a manifest written on
 * Windows then fails to resolve on POSIX, where `\` is a legal filename char
 * rather than a separator. Storing POSIX separators is safe in both directions:
 * `path.join()` on Windows accepts `/` transparently.
 *
 * Only for relative paths; absolute Windows paths keep their drive prefix and
 * are not portable anyway.
 */
export function toPortableRelativePath(relPath: string): string {
  return relPath.split("\\").join("/");
}

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".bmp",
  ".webp",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
]);

export const MAX_FILE_SIZE = 512 * 1024; // 512KB

export interface FileContent {
  relPath: string;
  content: string;
  lineCount: number;
}

/** True when `child` is `parent` itself or sits below it. */
export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

/**
 * Copy a skill folder the way `fs.cp` does, but keep its internal relative
 * symlinks relative (#819).
 *
 * `fs.cp` without `verbatimSymlinks` rewrites every relative link into an
 * absolute path into `src` — a temp clone that is deleted after install or
 * update, so the link dangles. This restores the link text for a relative
 * link whose target stays inside `src`, both by its text (no `..` above the
 * folder, no part that is itself a link) and by its real path. Every other link — absolute, leaving the
 * folder, dangling or looping — keeps the `fs.cp` result unchanged, so the
 * outside-folder symlink policy does not change.
 */
export async function copySkillTree(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
  if (!(await lstat(dest)).isDirectory()) return;
  const srcReal = await realpath(src);
  const destReal = await realpath(dest);
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(dest, rel), { withFileTypes: true });
    for (const entry of entries) {
      const childRel = join(rel, entry.name);
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isSymbolicLink()) {
        const text = await readlink(join(src, childRel));
        if (await isInternalLink(src, srcReal, childRel, text)) {
          const linkPath = join(dest, childRel);
          const cpText = await readlink(linkPath);
          await unlink(linkPath);
          await symlink(text, linkPath);
          // The restored link must reach the copy of what it reached in
          // `src`; anything else resolves differently once copied, so put
          // back the `fs.cp` text.
          const expected = join(
            destReal,
            relative(srcReal, await realpath(join(src, childRel))),
          );
          const actual = await realpath(linkPath).catch(() => null);
          if (actual !== expected) {
            await unlink(linkPath);
            await symlink(cpText, linkPath);
          }
        }
      }
    }
  };
  await walk("");
}

/**
 * True when the relative link at `rel` under `root` never leaves it. Every
 * part its text walks through must be a real file or folder inside `root`:
 * a part that is itself a link resolves differently once copied — a `..`
 * after `r -> .` climbs from the link's own folder, and a link `fs.cp`
 * rewrote to an absolute path leads out of the copy (#819).
 */
async function isInternalLink(
  root: string,
  rootReal: string,
  rel: string,
  text: string,
): Promise<boolean> {
  // Only the platform's own separators split a path: on POSIX `\\` is an
  // ordinary filename character, so `a\\b` is one part that must be checked.
  const seps = process.platform === "win32" ? /[\\/]/ : /\//;
  if (isAbsolute(text) || seps.test(text.charAt(0))) return false;
  let current = dirname(rel);
  for (const part of text.split(seps)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (current === ".") return false;
      current = dirname(current);
      continue;
    }
    current = join(current, part);
    try {
      if ((await lstat(join(root, current))).isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  try {
    return isPathInside(rootReal, await realpath(join(root, rel)));
  } catch {
    return false;
  }
}

/**
 * Read a text file without ever blocking or reading without bound: open it
 * non-blocking, `fstat` the descriptor (so a file swapped for a FIFO or device
 * after an earlier `stat` is still caught), skip anything that is not a
 * regular file, and read at most `maxBytes + 1` bytes. Returns null when the
 * file is not regular, unreadable, or larger than `maxBytes` — including
 * procfs/sysfs files that report a size of 0 but stream far more.
 *
 * With `root` (a real path), the file opened must be the one `path` names
 * inside `root` once it is open (#831): its real path is inside `root` and
 * is the same file as the descriptor. A folder on the way swapped for a
 * link after it was checked fails that test, and nothing is read.
 */
export async function readBoundedTextFile(
  path: string,
  maxBytes: number = MAX_FILE_SIZE,
  root?: string,
): Promise<string | null> {
  const buf = await readBoundedFile(path, maxBytes, root);
  return buf === null ? null : buf.toString("utf-8");
}

/** `readBoundedTextFile`, returning the bytes. */
export async function readBoundedFile(
  path: string,
  maxBytes: number = MAX_FILE_SIZE,
  root?: string,
): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0),
    );
  } catch {
    return null;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return null;
    if (root !== undefined && !(await isOpenedInside(opened, path, root))) {
      return null;
    }
    const buf = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(
        buf,
        total,
        buf.length - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) return null;
    return buf.subarray(0, total);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * True when `path` resolves inside `root` now and names the file whose
 * descriptor `stat` gave `opened`: the open did not follow a swapped link.
 */
async function isOpenedInside(
  opened: Stats,
  path: string,
  root: string,
): Promise<boolean> {
  try {
    const real = await realpath(path);
    if (!isPathInside(root, real)) return false;
    const now = await stat(real);
    return now.dev === opened.dev && now.ino === opened.ino;
  } catch {
    return false;
  }
}

const UNREAD_NOTE: Record<ExternalSymlink["kind"], string> = {
  file: "Points outside the skill folder; the target was NOT read. Review it by hand.",
  directory:
    "Points outside the skill folder; the target was NOT read. Review it by hand.",
  special:
    "Points outside the skill folder to a FIFO, device or other special file; it was NOT read. Review it by hand.",
  dangling: "The target does not exist; the link was not followed.",
  loop: "The link loops; it was not followed.",
};

/** A critical finding for a link the audit did not read or follow (#779). */
export function externalLink(
  path: string,
  target: string,
  kind: ExternalSymlink["kind"],
): ExternalSymlink {
  return { path, target, kind, severity: "critical", note: UNREAD_NOTE[kind] };
}

/**
 * The kind of a link that leaves the folder, from metadata only: `stat`
 * follows the link but never opens the target.
 */
export async function outsideLinkKind(
  linkPath: string,
): Promise<ExternalSymlink["kind"]> {
  try {
    const t = await stat(linkPath);
    if (t.isDirectory()) return "directory";
    if (t.isFile()) return "file";
    return "special";
  } catch {
    return "dangling";
  }
}

/**
 * List `real`, a real path checked earlier, only while it still resolves to
 * itself before and after the listing (#831). Returns null when it no
 * longer does (it was swapped for a link) or cannot be read.
 */
export async function readdirInPlace(real: string): Promise<string[] | null> {
  const where = () => realpath(real).catch(() => "");
  if ((await where()) !== real) return null;
  let entries: string[];
  try {
    entries = await readdir(real);
  } catch {
    return null;
  }
  return (await where()) === real ? entries : null;
}

/** A regular file found by `walkFiles`. */
export interface WalkedFile {
  fullPath: string;
  /** Path relative to the walked folder, `/`-separated. */
  relPath: string;
  /** The entry's own name. */
  name: string;
  /** `stat` of the entry (links followed). */
  stats: Stats;
  /**
   * Confined mode: the real folder the walk may not leave. Pass it to
   * `readBoundedTextFile` so the read stays where the walk was (#831).
   */
  root?: string;
}

export interface WalkFilesOptions {
  /** Confine the walk; see `ReadFilesRecursiveOptions.onExternalSymlink`. */
  onExternalSymlink?: (link: ExternalSymlink) => void;
  /** See `ReadFilesRecursiveOptions.root`. */
  root?: string;
  /**
   * Entries never scanned. Default: anything named `.git` or `node_modules`.
   * In confined mode the symlink check runs first, so a skipped name that
   * leaves the folder is still reported.
   */
  skip?: (name: string, isDirectory: boolean) => boolean;
  /**
   * Confined mode only: how many different paths may lead into one real
   * folder. Default 1: each real folder is walked once (#791). A higher
   * value re-walks a folder reached through an in-folder link, as `asm eval`
   * has always done, and still bounds the walk when folders link to each
   * other. A link back to a folder being walked is reported as a loop.
   */
  maxFolderVisits?: number;
  /**
   * Confined mode only: `dir` is a real path the caller checked earlier
   * (#831). It is walked as given, never resolved again, so a folder
   * swapped for a link since the check is reported, not walked.
   */
  anchored?: boolean;
  /**
   * The path the user sees for `dir`, when `dir` is a real path resolved
   * from it (#831). A dangling link's target is reported against it, as
   * when the walk went through that path.
   */
  shownAs?: string;
  /**
   * Called for an entry that is neither a regular file nor a folder (a
   * FIFO, socket or device): never opened, only named (#886).
   */
  onOtherEntry?: (relPath: string) => void;
}

const DEFAULT_SKIP = (name: string) =>
  name === ".git" || name === "node_modules";

/**
 * Walk `dir` depth-first in `readdir` order and call `visit` for each
 * regular file. With `onExternalSymlink` set the walk is confined (#779):
 * a symlink that resolves outside the boundary, dangles or loops is reported
 * once, by its real location, and is never opened, read or descended into.
 * A confined walk lists each folder by its real path, and only while that
 * path still resolves to itself: a folder swapped for a link during the
 * walk is reported by where it now leads and is not listed (#831).
 * An error on one entry, including one thrown by `visit`, skips that entry.
 */
export async function walkFiles(
  dir: string,
  visit: (file: WalkedFile) => void | Promise<void>,
  options: WalkFilesOptions = {},
): Promise<void> {
  const report = options.onExternalSymlink;
  const skip = options.skip ?? DEFAULT_SKIP;
  const maxVisits = options.maxFolderVisits ?? 1;
  let rootReal = dir;
  let dirReal = dir;
  if (report) {
    try {
      dirReal = options.anchored ? dir : await realpath(dir);
      rootReal = options.root ? await realpath(options.root) : dirReal;
    } catch {
      return;
    }
    if (!isPathInside(rootReal, dirReal)) {
      const shown = options.shownAs ?? dir;
      report(externalLink(basename(shown) || shown, dirReal, "directory"));
      return;
    }
  }

  // A link inside a folder walked through several paths is reported once.
  const reported = new Set<string>();
  const reportOnce = (link: ExternalSymlink, at: string) => {
    if (reported.has(at)) return;
    reported.add(at);
    report!(link);
  };

  async function walk(
    currentDir: string,
    prefix: string,
    ancestors: ReadonlySet<string>,
    currentReal: string,
  ) {
    // Confined: is `currentReal` still the folder it was? A folder swapped
    // for a link mid-walk is reported by where it now leads and the rest of
    // it is not read (#831).
    const where = () => realpath(currentReal).catch(() => "");
    const moved = async (): Promise<boolean> => {
      const now = await where();
      if (now === currentReal) return false;
      reportOnce(
        externalLink(
          prefix || ".",
          now,
          now === "" ? "dangling" : await outsideLinkKind(currentReal),
        ),
        currentReal,
      );
      return true;
    };

    let entries: string[];
    try {
      if (report) {
        // List the real folder, and only while it is still that folder.
        if (await moved()) return;
        entries = await readdir(currentReal);
        if (await moved()) return;
      } else {
        entries = await readdir(currentDir);
      }
    } catch {
      return;
    }

    // A confined walk reads entries under the real path it just listed;
    // `currentDir` is the path shown, as before (#831).
    const listed = report ? currentReal : currentDir;
    for (const entry of entries) {
      const fullPath = join(listed, entry);
      const shownPath = join(currentDir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      // Where the entry really is, whichever path led here.
      const at = join(currentReal, entry);

      try {
        let linkTarget: string | null = null;
        if (report && (await lstat(fullPath)).isSymbolicLink()) {
          try {
            linkTarget = await realpath(fullPath);
          } catch (err) {
            const raw = await readlink(fullPath).catch(() => "");
            if (await moved()) return;
            reportOnce(
              externalLink(
                relPath,
                raw ? resolve(dirname(shownPath), raw) : "",
                (err as NodeJS.ErrnoException).code === "ELOOP"
                  ? "loop"
                  : "dangling",
              ),
              at,
            );
            continue;
          }
          if (!isPathInside(rootReal, linkTarget)) {
            const kind = await outsideLinkKind(fullPath);
            if (await moved()) return;
            // Metadata only: the target is never opened, read or walked.
            reportOnce(externalLink(relPath, linkTarget, kind), at);
            continue;
          }
        }
        const s = await stat(fullPath);
        if (skip(entry, s.isDirectory())) continue;
        if (linkTarget !== null && report) {
          if (s.isDirectory() && ancestors.has(linkTarget)) {
            if (await moved()) return;
            reportOnce(externalLink(relPath, linkTarget, "loop"), at);
            continue;
          }
        }
        if (s.isDirectory()) {
          if (report) {
            const real = linkTarget ?? (await realpath(fullPath));
            if (await moved()) return;
            if (!isPathInside(rootReal, real)) {
              // A folder on the way was swapped for a link (#831).
              reportOnce(externalLink(relPath, real, "directory"), at);
              continue;
            }
            // Each real folder is read a bounded number of times (#791):
            // sibling folders linking to each other would otherwise make
            // the walk explode.
            const visits = walked.get(real) ?? 0;
            if (visits >= maxVisits) continue;
            walked.set(real, visits + 1);
            await walk(shownPath, relPath, new Set([...ancestors, real]), real);
          } else {
            await walk(fullPath, relPath, ancestors, currentReal);
          }
        } else if (s.isFile()) {
          if (report && (await moved())) return;
          await visit({
            fullPath,
            relPath,
            name: entry,
            stats: s,
            ...(report ? { root: rootReal } : {}),
          });
        } else {
          options.onOtherEntry?.(relPath);
        }
      } catch {
        // The entry may have failed because its folder was swapped (it is
        // missing from the swapped-in one): report the swap (#831).
        if (report && (await moved())) return;
        continue;
      }
    }
    // A swap after the last entry, or one no remaining entry noticed.
    if (report) await moved();
  }

  const walked = new Map<string, number>([[dirReal, 1]]);
  await walk(options.shownAs ?? dir, "", new Set([dirReal]), dirReal);
}

export interface ReadFilesRecursiveOptions {
  /**
   * Confine the walk to `dir` (#779). When set, a symlink that resolves
   * outside `dir` is reported and never opened, read or descended into;
   * dangling links and links that loop back into a directory being walked are
   * reported and never followed. Without it the walk keeps its historical
   * follow-everything behaviour.
   */
  onExternalSymlink?: (link: ExternalSymlink) => void;
  /**
   * Confined mode only: called for each regular file inside `dir` that has
   * more than one hard link (`st_nlink > 1`). The file is still read; its
   * content may be shared with a file outside the folder.
   */
  onHardLink?: (relPath: string, links: number) => void;
  /**
   * Confined mode only: the folder the walk must not leave, when it is wider
   * than `dir` (#791) — e.g. a `github:` audit of a subfolder is confined to
   * the whole temp checkout. Defaults to `dir`. When `dir` itself resolves
   * outside `root`, nothing is read and `dir` is reported as a directory link.
   */
  root?: string;
  /** See `WalkFilesOptions.anchored`. */
  anchored?: boolean;
  /**
   * Called for each non-binary file the walk found but did not read: over
   * `MAX_FILE_SIZE`, not readable as a bounded regular file, or not a
   * regular file at all (a FIFO, socket or device, never opened) (#886).
   */
  onUnreadFile?: (relPath: string) => void;
}

export async function readFilesRecursive(
  dir: string,
  options: ReadFilesRecursiveOptions = {},
): Promise<FileContent[]> {
  const results: FileContent[] = [];
  const confined = options.onExternalSymlink !== undefined;
  await walkFiles(
    dir,
    async ({ fullPath, relPath, name, stats, root }) => {
      const ext = name.includes(".")
        ? `.${name.split(".").pop()!.toLowerCase()}`
        : "";
      if (BINARY_EXTENSIONS.has(ext)) return;
      if (stats.size > MAX_FILE_SIZE) {
        options.onUnreadFile?.(relPath);
        return;
      }
      if (confined && stats.nlink > 1) {
        options.onHardLink?.(relPath, stats.nlink);
      }

      const content = await readBoundedTextFile(fullPath, MAX_FILE_SIZE, root);
      if (content === null) {
        options.onUnreadFile?.(relPath);
        return;
      }
      results.push({
        relPath,
        content,
        lineCount: content.split("\n").length,
      });
    },
    {
      onExternalSymlink: options.onExternalSymlink,
      root: options.root,
      anchored: options.anchored,
      onOtherEntry: options.onUnreadFile,
    },
  );
  return results;
}
