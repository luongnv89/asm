import { constants as fsConstants, type Stats } from "fs";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
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
 * Read a text file without ever blocking or reading without bound: open it
 * non-blocking, `fstat` the descriptor (so a file swapped for a FIFO or device
 * after an earlier `stat` is still caught), skip anything that is not a
 * regular file, and read at most `maxBytes + 1` bytes. Returns null when the
 * file is not regular, unreadable, or larger than `maxBytes` — including
 * procfs/sysfs files that report a size of 0 but stream far more.
 */
export async function readBoundedTextFile(
  path: string,
  maxBytes: number = MAX_FILE_SIZE,
): Promise<string | null> {
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
    if (!(await handle.stat()).isFile()) return null;
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
    return buf.subarray(0, total).toString("utf-8");
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
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

/** A regular file found by `walkFiles`. */
export interface WalkedFile {
  fullPath: string;
  /** Path relative to the walked folder, `/`-separated. */
  relPath: string;
  /** The entry's own name. */
  name: string;
  /** `stat` of the entry (links followed). */
  stats: Stats;
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
}

const DEFAULT_SKIP = (name: string) =>
  name === ".git" || name === "node_modules";

/**
 * Walk `dir` depth-first in `readdir` order and call `visit` for each
 * regular file. With `onExternalSymlink` set the walk is confined (#779):
 * a symlink that resolves outside the boundary, dangles or loops is reported
 * once, by its real location, and is never opened, read or descended into.
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
      dirReal = await realpath(dir);
      rootReal = options.root ? await realpath(options.root) : dirReal;
    } catch {
      return;
    }
    if (!isPathInside(rootReal, dirReal)) {
      report(externalLink(basename(dir) || dir, dirReal, "directory"));
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
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
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
            reportOnce(
              externalLink(
                relPath,
                raw ? resolve(dirname(fullPath), raw) : "",
                (err as NodeJS.ErrnoException).code === "ELOOP"
                  ? "loop"
                  : "dangling",
              ),
              at,
            );
            continue;
          }
          if (!isPathInside(rootReal, linkTarget)) {
            // Metadata only: the target is never opened, read or walked.
            reportOnce(
              externalLink(
                relPath,
                linkTarget,
                await outsideLinkKind(fullPath),
              ),
              at,
            );
            continue;
          }
        }
        const s = await stat(fullPath);
        if (skip(entry, s.isDirectory())) continue;
        if (linkTarget !== null && report) {
          if (s.isDirectory() && ancestors.has(linkTarget)) {
            reportOnce(externalLink(relPath, linkTarget, "loop"), at);
            continue;
          }
        }
        if (s.isDirectory()) {
          if (report) {
            const real = linkTarget ?? (await realpath(fullPath));
            // Each real folder is read a bounded number of times (#791):
            // sibling folders linking to each other would otherwise make
            // the walk explode.
            const visits = walked.get(real) ?? 0;
            if (visits >= maxVisits) continue;
            walked.set(real, visits + 1);
            await walk(fullPath, relPath, new Set([...ancestors, real]), real);
          } else {
            await walk(fullPath, relPath, ancestors, currentReal);
          }
        } else if (s.isFile()) {
          await visit({ fullPath, relPath, name: entry, stats: s });
        }
      } catch {
        continue;
      }
    }
  }

  const walked = new Map<string, number>([[dirReal, 1]]);
  await walk(dir, "", new Set([dirReal]), dirReal);
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
}

export async function readFilesRecursive(
  dir: string,
  options: ReadFilesRecursiveOptions = {},
): Promise<FileContent[]> {
  const results: FileContent[] = [];
  const confined = options.onExternalSymlink !== undefined;
  await walkFiles(
    dir,
    async ({ fullPath, relPath, name, stats }) => {
      const ext = name.includes(".")
        ? `.${name.split(".").pop()!.toLowerCase()}`
        : "";
      if (BINARY_EXTENSIONS.has(ext)) return;
      if (stats.size > MAX_FILE_SIZE) return;
      if (confined && stats.nlink > 1) {
        options.onHardLink?.(relPath, stats.nlink);
      }

      const content = await readBoundedTextFile(fullPath);
      if (content === null) return;
      results.push({
        relPath,
        content,
        lineCount: content.split("\n").length,
      });
    },
    { onExternalSymlink: options.onExternalSymlink, root: options.root },
  );
  return results;
}
