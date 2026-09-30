import { randomUUID } from "crypto";
import { readdir, realpath } from "fs/promises";
import { join } from "path";
import { getGetBorrowsDir } from "./config";
import {
  acquireDependency,
  releaseDependencyByPath,
  releaseDependencySession,
} from "./dependency-leases";
import type {
  GetBorrowCleanupResult,
  GetPathResult,
  GetResult,
} from "./utils/types";

async function listBorrowFiles(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || /^\.asm-owner-.*\.json$/.test(entry.name))
      continue;
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(
        ...(await listBorrowFiles(join(dir, entry.name), `${relativePath}/`)),
      );
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Borrow contains an unsupported entry: ${relativePath}`);
    }
  }
  return files.sort();
}

/** Every source tier is copied; a caller must never release the original. */
export async function borrowGetSkill(
  request: string,
  sourceDir: string,
  result: GetResult,
): Promise<GetPathResult> {
  const sessionId = randomUUID();
  const paths = { rootDir: getGetBorrowsDir() };
  const acquired = await acquireDependency(
    {
      sessionId,
      request,
      name: result.name,
      // Installed roots may legitimately be provider/library symlinks. Only the
      // root is canonicalized; the lease copy policy still rejects nested links.
      sourceDir: await realpath(sourceDir),
      tier: result.tier,
      source: result.source,
      commit: result.commit,
      temporary: true,
    },
    paths,
  );

  try {
    return {
      name: result.name,
      description: result.description,
      dependencies: result.dependencies,
      tier: result.tier,
      source: result.source,
      commit: result.commit,
      tokenCount: result.tokenCount,
      security: result.security,
      path: acquired.path,
      files: await listBorrowFiles(acquired.path),
      cleanup: { command: "asm", args: ["cleanup", acquired.path] },
    };
  } catch (err) {
    // Roll back a failed materialization only. Successful borrows have no
    // process-exit handler and remain until explicit `asm cleanup <path>`.
    const released = await releaseDependencySession(sessionId, paths);
    if (released.errors.length) {
      throw new Error(
        `Borrow failed; ownership-safe cleanup refused: ${released.errors.join("; ")}`,
        { cause: err },
      );
    }
    throw err;
  }
}

export async function cleanupGetBorrow(
  path: string,
): Promise<GetBorrowCleanupResult> {
  try {
    const released = await releaseDependencyByPath(path, {
      rootDir: getGetBorrowsDir(),
    });
    return {
      path,
      status: !released
        ? "not-found"
        : released.errors.length
          ? "refused"
          : released.removed.length
            ? "removed"
            : "missing",
      errors: released?.errors ?? [],
    };
  } catch (err) {
    return {
      path,
      status: "refused",
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
