import {
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  stat,
  symlink,
} from "fs/promises";
import type { ExternalSymlink } from "./types";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

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

export interface ReadFilesRecursiveOptions {
  /**
   * Track symlinks against `dir` (#779). When set, every symlink that resolves
   * outside `dir` is reported and then followed read-only, so its content is
   * still scanned; dangling links and links that loop back into a directory
   * being walked are reported and never followed. Without it the walk keeps
   * its historical follow-everything behaviour.
   */
  onExternalSymlink?: (link: ExternalSymlink) => void;
}

export async function readFilesRecursive(
  dir: string,
  options: ReadFilesRecursiveOptions = {},
): Promise<FileContent[]> {
  const results: FileContent[] = [];
  const report = options.onExternalSymlink;
  let rootReal = dir;
  if (report) {
    try {
      rootReal = await realpath(dir);
    } catch {
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
      if (entry === ".git" || entry === "node_modules") continue;

      const fullPath = join(currentDir, entry);
      const relPath = prefix ? `${prefix}/${entry}` : entry;

      try {
        let linkTarget: string | null = null;
        if (report && (await lstat(fullPath)).isSymbolicLink()) {
          try {
            linkTarget = await realpath(fullPath);
          } catch (err) {
            const raw = await readlink(fullPath).catch(() => "");
            report({
              path: relPath,
              target: raw ? resolve(dirname(fullPath), raw) : "",
              kind:
                (err as NodeJS.ErrnoException).code === "ELOOP"
                  ? "loop"
                  : "dangling",
            });
            continue;
          }
        }
        const s = await stat(fullPath);
        if (linkTarget !== null && report) {
          if (s.isDirectory() && ancestors.has(linkTarget)) {
            report({ path: relPath, target: linkTarget, kind: "loop" });
            continue;
          }
          if (!isPathInside(rootReal, linkTarget)) {
            report({
              path: relPath,
              target: linkTarget,
              kind: s.isDirectory() ? "directory" : "file",
            });
          }
        }
        if (s.isDirectory()) {
          if (report) {
            const real = linkTarget ?? (await realpath(fullPath));
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

          try {
            const content = await readFile(fullPath, "utf-8");
            results.push({
              relPath,
              content,
              lineCount: content.split("\n").length,
            });
          } catch {
            // skip unreadable
          }
        }
      } catch {
        continue;
      }
    }
  }

  await walk(dir, "", new Set([rootReal]));
  return results;
}
