import { mkdir, open, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";
import { basename, dirname, join, resolve } from "path";

const fileMutationQueues = new Map<string, Promise<void>>();

const unsupportedDirectorySyncCodes = new Set([
  "EINVAL",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

function isUnsupportedDirectorySyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return (
    (typeof code === "string" && unsupportedDirectorySyncCodes.has(code)) ||
    (process.platform === "win32" && (code === "EISDIR" || code === "EPERM"))
  );
}

export class AtomicWritePostRenameError extends Error {
  readonly committed = true as const;

  constructor(
    readonly path: string,
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Atomic write to ${path} was renamed into place, but parent-directory durability could not be confirmed: ${detail}`,
    );
    this.name = "AtomicWritePostRenameError";
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (isUnsupportedDirectorySyncError(error)) return;
    throw error;
  }

  let syncFailed = false;
  let syncError: unknown;
  try {
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySyncError(error)) {
      syncFailed = true;
      syncError = error;
    }
  }

  try {
    await handle.close();
  } catch (error) {
    if (!syncFailed) throw error;
  }

  if (syncFailed) throw syncError;
}

export async function withFileMutationLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolve(path);
  const tail = fileMutationQueues.get(key) ?? Promise.resolve();
  const run = tail.then(operation, operation);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );

  fileMutationQueues.set(key, settled);

  try {
    return await run;
  } finally {
    if (fileMutationQueues.get(key) === settled) {
      fileMutationQueues.delete(key);
    }
  }
}

export async function writeTextFileAtomically(
  path: string,
  content: string,
): Promise<void> {
  const destinationPath = resolve(path);
  const destinationDir = dirname(destinationPath);
  const tempPath = join(
    destinationDir,
    `.${basename(destinationPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await mkdir(destinationDir, { recursive: true });

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, destinationPath);
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // best effort close before cleanup
      }
    }

    try {
      await rm(tempPath, { force: true });
    } catch {
      // best effort cleanup of owned temp artifact only
    }

    throw err;
  }

  // Renaming publishes the file contents but does not necessarily make the
  // directory entry crash-durable. Failures after this commit point must remain
  // distinguishable from failures that definitely left the destination intact.
  try {
    await syncDirectory(destinationDir);
  } catch (cause) {
    throw new AtomicWritePostRenameError(destinationPath, cause);
  }
}
