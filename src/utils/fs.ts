import { readdir, readFile, stat, symlink } from "fs/promises";
import { dirname, join, resolve } from "path";

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

export async function readFilesRecursive(dir: string): Promise<FileContent[]> {
  const results: FileContent[] = [];

  async function walk(currentDir: string, prefix: string) {
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
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          await walk(fullPath, relPath);
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

  await walk(dir, "");
  return results;
}
