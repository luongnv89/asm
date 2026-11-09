import { constants as fsConstants } from "fs";
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

/**
 * Compiled-Python names. Skipped only when the bytes really are bytecode
 * (`hasPythonBytecodeHeader`): `python3 x.pyo` and `runpy.run_path("x.pyc")`
 * run a source-text file under these names as source, so it is scanned (#809).
 */
const PYTHON_BYTECODE_EXTENSIONS = new Set([".pyc", ".pyo"]);

/**
 * True when `bytes` start like CPython bytecode: a 2-byte magic number, then
 * `\r\n`, then a header (flags, mtime, size — or, in Python 2, the code
 * object) holding at least one NUL byte. Python 3.12+ refuses to run source
 * containing a NUL byte, so a file a `python3` can run as source never
 * passes; a 4-byte look-alike such as `#a\r\n` does not either (#809).
 */
export function hasPythonBytecodeHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 16 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0x0a &&
    bytes.subarray(4, 16).includes(0)
  );
}

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
  const bytes = await readBoundedBytes(path, maxBytes);
  return bytes === null ? null : bytes.toString("utf-8");
}

/** `readBoundedTextFile`, but the raw bytes. */
async function readBoundedBytes(
  path: string,
  maxBytes: number,
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
    return buf.subarray(0, total);
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
  const report = options.onExternalSymlink;
  let rootReal = dir;
  let dirReal = dir;
  if (report) {
    try {
      dirReal = await realpath(dir);
      rootReal = options.root ? await realpath(options.root) : dirReal;
    } catch {
      return results;
    }
    if (!isPathInside(rootReal, dirReal)) {
      report(externalLink(basename(dir) || dir, dirReal, "directory"));
      return results;
    }
  }

  async function walk(
    currentDir: string,
    prefix: string,
    ancestors: ReadonlySet<string>,
  ) {
    let entries: string[];
    try {
      entries = await readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip-listed names are never scanned. In confined mode the symlink
      // check below runs first, so a `.git` or `node_modules` link that
      // leaves the folder is still reported.
      const skipListed = entry === ".git" || entry === "node_modules";
      if (skipListed && !report) continue;

      const fullPath = join(currentDir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;

      try {
        let linkTarget: string | null = null;
        if (report && (await lstat(fullPath)).isSymbolicLink()) {
          try {
            linkTarget = await realpath(fullPath);
          } catch (err) {
            const raw = await readlink(fullPath).catch(() => "");
            report(
              externalLink(
                relPath,
                raw ? resolve(dirname(fullPath), raw) : "",
                (err as NodeJS.ErrnoException).code === "ELOOP"
                  ? "loop"
                  : "dangling",
              ),
            );
            continue;
          }
          if (!isPathInside(rootReal, linkTarget)) {
            // Metadata only: the target is never opened, read or walked.
            let kind: ExternalSymlink["kind"] = "special";
            try {
              const t = await stat(fullPath);
              if (t.isDirectory()) kind = "directory";
              else if (t.isFile()) kind = "file";
            } catch {
              kind = "dangling";
            }
            report(externalLink(relPath, linkTarget, kind));
            continue;
          }
        }
        if (skipListed) continue;
        const s = await stat(fullPath);
        if (linkTarget !== null && report) {
          if (s.isDirectory() && ancestors.has(linkTarget)) {
            report(externalLink(relPath, linkTarget, "loop"));
            continue;
          }
        }
        if (s.isDirectory()) {
          if (report) {
            const real = linkTarget ?? (await realpath(fullPath));
            // Each real folder is read once (#791): sibling folders linking
            // to each other would otherwise make the walk explode.
            if (walked.has(real)) continue;
            walked.add(real);
            await walk(fullPath, relPath, new Set([...ancestors, real]));
          } else {
            await walk(fullPath, relPath, ancestors);
          }
        } else if (s.isFile()) {
          const ext = entry.includes(".")
            ? `.${entry.split(".").pop()!.toLowerCase()}`
            : "";
          if (BINARY_EXTENSIONS.has(ext)) continue;
          if (s.size > MAX_FILE_SIZE) continue;
          if (report && s.nlink > 1) options.onHardLink?.(relPath, s.nlink);

          const bytes = await readBoundedBytes(fullPath, MAX_FILE_SIZE);
          if (bytes === null) continue;
          // Real bytecode is not text; anything else under a .pyc/.pyo name
          // is scanned, since Python can run it as source (#809).
          if (
            PYTHON_BYTECODE_EXTENSIONS.has(ext) &&
            hasPythonBytecodeHeader(bytes)
          )
            continue;
          const content = bytes.toString("utf-8");
          results.push({
            relPath,
            content,
            lineCount: content.split("\n").length,
          });
        }
      } catch {
        continue;
      }
    }
  }

  const walked = new Set<string>([dirReal]);
  await walk(dir, "", new Set([dirReal]));
  return results;
}
