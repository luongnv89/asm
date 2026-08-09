import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fspMocks = vi.hoisted(() => ({
  events: [] as string[],
  tempSyncError: null as Error | null,
  tempCloseError: null as Error | null,
  directoryOpenError: null as Error | null,
  directorySyncError: null as Error | null,
  directoryCloseError: null as Error | null,
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (args[1] === "wx") {
        fspMocks.events.push("temp-open");
        return {
          writeFile: async () => {
            fspMocks.events.push("temp-write");
          },
          sync: async () => {
            fspMocks.events.push("temp-sync");
            if (fspMocks.tempSyncError) throw fspMocks.tempSyncError;
          },
          close: async () => {
            fspMocks.events.push("temp-close");
            if (fspMocks.tempCloseError) throw fspMocks.tempCloseError;
          },
        } as unknown as Awaited<ReturnType<typeof actual.open>>;
      }

      fspMocks.events.push("directory-open");
      if (fspMocks.directoryOpenError) throw fspMocks.directoryOpenError;
      return {
        sync: async () => {
          fspMocks.events.push("directory-sync");
          if (fspMocks.directorySyncError) throw fspMocks.directorySyncError;
        },
        close: async () => {
          fspMocks.events.push("directory-close");
          if (fspMocks.directoryCloseError) {
            throw fspMocks.directoryCloseError;
          }
        },
      } as unknown as Awaited<ReturnType<typeof actual.open>>;
    },
    rename: async () => {
      fspMocks.events.push("rename");
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      fspMocks.events.push("temp-remove");
      await actual.rm(...args);
    },
  };
});

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  AtomicWritePostRenameError,
  writeTextFileAtomically,
} from "./atomic-file";

function fsError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

let tempDir: string;
let destinationPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "atomic-file-test-"));
  destinationPath = join(tempDir, "lock.json");
  fspMocks.events = [];
  fspMocks.tempSyncError = null;
  fspMocks.tempCloseError = null;
  fspMocks.directoryOpenError = null;
  fspMocks.directorySyncError = null;
  fspMocks.directoryCloseError = null;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("writeTextFileAtomically", () => {
  test("syncs the temporary file before rename and the directory afterward", async () => {
    await writeTextFileAtomically(destinationPath, "contents");

    expect(fspMocks.events).toEqual([
      "temp-open",
      "temp-write",
      "temp-sync",
      "temp-close",
      "rename",
      "directory-open",
      "directory-sync",
      "directory-close",
    ]);
  });

  test("preserves a temporary sync failure while closing and cleaning up", async () => {
    const syncError = fsError("EIO", "temp sync failed");
    fspMocks.tempSyncError = syncError;
    fspMocks.tempCloseError = fsError("EIO", "cleanup close failed");

    await expect(
      writeTextFileAtomically(destinationPath, "contents"),
    ).rejects.toBe(syncError);
    expect(fspMocks.events).toEqual([
      "temp-open",
      "temp-write",
      "temp-sync",
      "temp-close",
      "temp-remove",
    ]);
  });

  test("does not rename when closing the temporary file fails", async () => {
    const closeError = fsError("EIO", "temp close failed");
    fspMocks.tempCloseError = closeError;

    await expect(
      writeTextFileAtomically(destinationPath, "contents"),
    ).rejects.toBe(closeError);
    expect(fspMocks.events).toEqual([
      "temp-open",
      "temp-write",
      "temp-sync",
      "temp-close",
      "temp-close",
      "temp-remove",
    ]);
  });

  test.each([
    ["open", "directoryOpenError"],
    ["sync", "directorySyncError"],
    ["close", "directoryCloseError"],
  ] as const)(
    "classifies a directory %s failure as post-rename",
    async (phase, errorField) => {
      const cause = fsError("EIO", `directory ${phase} failed`);
      fspMocks[errorField] = cause;

      const failure = await writeTextFileAtomically(
        destinationPath,
        "contents",
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(AtomicWritePostRenameError);
      expect(failure).toMatchObject({
        committed: true,
        path: destinationPath,
        cause,
      });
      expect(fspMocks.events.indexOf("rename")).toBeGreaterThanOrEqual(0);
      expect(fspMocks.events.indexOf(`directory-${phase}`)).toBeGreaterThan(
        fspMocks.events.indexOf("rename"),
      );
      expect(fspMocks.events).not.toContain("temp-remove");
    },
  );

  test("preserves the directory sync failure when closing also fails", async () => {
    const syncError = fsError("EIO", "directory sync failed");
    fspMocks.directorySyncError = syncError;
    fspMocks.directoryCloseError = fsError("EIO", "directory close failed");

    const failure = await writeTextFileAtomically(
      destinationPath,
      "contents",
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AtomicWritePostRenameError);
    expect(failure).toMatchObject({ cause: syncError });
    expect(fspMocks.events).toEqual([
      "temp-open",
      "temp-write",
      "temp-sync",
      "temp-close",
      "rename",
      "directory-open",
      "directory-sync",
      "directory-close",
    ]);
  });

  test("tolerates filesystems that do not support directory sync", async () => {
    fspMocks.directorySyncError = fsError("ENOTSUP");

    await expect(
      writeTextFileAtomically(destinationPath, "contents"),
    ).resolves.toBeUndefined();
    expect(fspMocks.events.at(-1)).toBe("directory-close");
  });

  test("tolerates unsupported directory opens on Windows", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    fspMocks.directoryOpenError = fsError("EISDIR");

    await expect(
      writeTextFileAtomically(destinationPath, "contents"),
    ).resolves.toBeUndefined();
    expect(fspMocks.events.slice(-2)).toEqual(["rename", "directory-open"]);
  });
});
