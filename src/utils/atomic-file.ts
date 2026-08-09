import { mkdir, open, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";
import { basename, dirname, join, resolve } from "path";

const fileMutationQueues = new Map<string, Promise<void>>();

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
}
