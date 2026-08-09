import { createDirSymlink } from "./utils/fs";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

const fspMocks = vi.hoisted(() => ({
  openOverride: null as
    | null
    | ((
        realOpen: typeof import("fs/promises").open,
        ...args: Parameters<typeof import("fs/promises").open>
      ) => ReturnType<typeof import("fs/promises").open>),
  renameOverride: null as
    | null
    | ((
        realRename: typeof import("fs/promises").rename,
        ...args: Parameters<typeof import("fs/promises").rename>
      ) => Promise<void>),
  readFileOverride: null as
    | null
    | ((
        realReadFile: typeof import("fs/promises").readFile,
        ...args: Parameters<typeof import("fs/promises").readFile>
      ) => ReturnType<typeof import("fs/promises").readFile>),
  cpOverride: null as
    | null
    | ((
        realCp: typeof import("fs/promises").cp,
        ...args: Parameters<typeof import("fs/promises").cp>
      ) => ReturnType<typeof import("fs/promises").cp>),
}));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) =>
      fspMocks.openOverride
        ? fspMocks.openOverride(actual.open, ...args)
        : actual.open(...args),
    rename: (...args: Parameters<typeof actual.rename>) =>
      fspMocks.renameOverride
        ? fspMocks.renameOverride(actual.rename, ...args)
        : actual.rename(...args),
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      fspMocks.readFileOverride
        ? fspMocks.readFileOverride(actual.readFile, ...args)
        : actual.readFile(...args),
    cp: (...args: Parameters<typeof actual.cp>) =>
      fspMocks.cpOverride
        ? fspMocks.cpOverride(actual.cp, ...args)
        : actual.cp(...args),
  };
});

import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  readdir,
} from "fs/promises";
import { tmpdir } from "os";
import { dirname, join, relative, resolve } from "path";
import {
  emptyLibraryLock,
  activateLibrarySkill,
  deactivateLibrarySkill,
  installLibrarySkill,
  readLibraryLock,
  updateLibrarySkill,
  updateLibrarySkills,
  writeLibraryLock,
} from "./library";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function failDirectoryDurability(
  directoryPath: string,
  phase: "open" | "sync" | "close",
  error: Error,
): void {
  fspMocks.openOverride = async (realOpen, ...args) => {
    if (
      args[1] !== "r" ||
      resolve(String(args[0])) !== resolve(directoryPath)
    ) {
      return realOpen(...args);
    }
    if (phase === "open") throw error;

    const handle = await realOpen(...args);
    return {
      sync: async () => {
        if (phase === "sync") throw error;
        await handle.sync();
      },
      close: async () => {
        await handle.close();
        if (phase === "close") throw error;
      },
    } as Awaited<ReturnType<typeof realOpen>>;
  };
}

beforeEach(() => {
  fspMocks.openOverride = null;
  fspMocks.renameOverride = null;
  fspMocks.readFileOverride = null;
  fspMocks.cpOverride = null;
});

afterEach(() => {
  fspMocks.openOverride = null;
  fspMocks.renameOverride = null;
  fspMocks.readFileOverride = null;
  fspMocks.cpOverride = null;
});

describe("library lock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-test-"));
    lockPath = join(tempDir, "library-lock.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("readLibraryLock returns an empty lock when the file is missing", async () => {
    await expect(readLibraryLock(lockPath)).resolves.toEqual({
      version: 1,
      skills: {},
    });
  });

  test("writeLibraryLock persists a versioned lock file", async () => {
    const lock = emptyLibraryLock();
    lock.skills.brainstorming = {
      name: "brainstorming",
      version: "1.0.0",
      source: "github:obra/superpowers",
      sourceType: "github",
      commitHash: "abc123",
      ref: "main",
      skillPath: "skills/brainstorming",
      libraryPath: join(tempDir, "skills", "brainstorming"),
      installedAt: "2026-06-18T00:00:00.000Z",
    };

    await writeLibraryLock(lock, lockPath);

    await expect(readLibraryLock(lockPath)).resolves.toEqual(lock);
  });

  test("readLibraryLock rejects array skills and backs up the invalid lock", async () => {
    const invalidLock = JSON.stringify({ version: 1, skills: [] }, null, 2);
    await writeFile(lockPath, invalidLock, "utf-8");

    await expect(readLibraryLock(lockPath)).resolves.toEqual({
      version: 1,
      skills: {},
    });

    await expect(readFile(lockPath + ".bak", "utf-8")).resolves.toBe(
      invalidLock,
    );
  });

  test("writeLibraryLock preserves the previous lock when atomic rename fails", async () => {
    const original =
      JSON.stringify(
        {
          version: 1,
          skills: {
            brainstorming: {
              name: "brainstorming",
              version: "1.0.0",
              source: "github:obra/superpowers",
              sourceType: "github",
              commitHash: "abc123",
              ref: "main",
              skillPath: "skills/brainstorming",
              libraryPath: join(tempDir, "skills", "brainstorming"),
              installedAt: "2026-06-18T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      ) + "\n";
    await writeFile(lockPath, original, "utf-8");

    fspMocks.renameOverride = async (_realRename, _from, to) => {
      if (to === lockPath) {
        throw new Error("rename boom");
      }
    };

    const updatedLock = emptyLibraryLock();
    updatedLock.skills.brainstorming = {
      name: "brainstorming",
      version: "2.0.0",
      source: "github:obra/superpowers",
      sourceType: "github",
      commitHash: "def456",
      ref: "main",
      skillPath: "skills/brainstorming",
      libraryPath: join(tempDir, "skills", "brainstorming"),
      installedAt: "2026-06-19T00:00:00.000Z",
    };

    await expect(writeLibraryLock(updatedLock, lockPath)).rejects.toThrow(
      "rename boom",
    );
    await expect(readFile(lockPath, "utf-8")).resolves.toBe(original);
    await expect(readdir(tempDir)).resolves.toEqual(["library-lock.json"]);
  });
});

describe("installLibrarySkill", () => {
  let tempDir: string;
  let lockPath: string;
  let skillsDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-install-"));
    lockPath = join(tempDir, "library-lock.json");
    skillsDir = join(tempDir, "skills");
    sourceDir = join(tempDir, "source", "skills", "brainstorming");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Body\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("copies a skill directory and writes source metadata", async () => {
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.2.3\n---\n# Brainstorming\n",
    );

    const result = await installLibrarySkill(
      {
        sourceDir,
        libraryName: "brainstorming",
        source: "github:obra/superpowers",
        sourceType: "github",
        commitHash: "abc123",
        ref: "main",
        skillPath: "skills/brainstorming",
        force: false,
      },
      { skillsDir, lockPath },
    );

    expect(result.name).toBe("brainstorming");
    expect(result.version).toBe("1.2.3");
    expect(
      await readFile(join(result.libraryPath, "SKILL.md"), "utf-8"),
    ).toContain("Brainstorming");

    const lock = await readLibraryLock(lockPath);
    expect(lock.skills.brainstorming).toMatchObject({
      name: "brainstorming",
      version: "1.2.3",
      source: "github:obra/superpowers",
      sourceType: "github",
      commitHash: "abc123",
      ref: "main",
      skillPath: "skills/brainstorming",
      libraryPath: result.libraryPath,
    });
  });

  test.each(["open", "sync", "close"] as const)(
    "keeps fresh-install lock metadata and files aligned after directory %s fails post-rename",
    async (phase) => {
      failDirectoryDurability(
        dirname(lockPath),
        phase,
        new Error(`directory ${phase} boom`),
      );

      await expect(
        installLibrarySkill(
          {
            sourceDir,
            libraryName: "brainstorming",
            source: "github:obra/superpowers",
            sourceType: "github",
            commitHash: "abc123",
            ref: "main",
            skillPath: "skills/brainstorming",
            force: false,
          },
          { skillsDir, lockPath },
        ),
      ).rejects.toThrow(
        "Lock metadata and library files were published as the new generation, but parent-directory durability could not be confirmed",
      );

      const lock = await readLibraryLock(lockPath);
      expect(lock.skills.brainstorming).toMatchObject({
        name: "brainstorming",
        version: "1.0.0",
        commitHash: "abc123",
      });
      await expect(
        readFile(join(skillsDir, "brainstorming", "SKILL.md"), "utf-8"),
      ).resolves.toContain("# Body");
      await expect(readdir(skillsDir)).resolves.toEqual(["brainstorming"]);
    },
  );

  test("refuses to overwrite an existing library skill without force", async () => {
    await installLibrarySkill(
      {
        sourceDir,
        libraryName: "brainstorming",
        source: "local:/tmp/source",
        sourceType: "local",
        commitHash: "unknown",
        ref: null,
        skillPath: "skills/brainstorming",
        force: false,
      },
      { skillsDir, lockPath },
    );

    await expect(
      installLibrarySkill(
        {
          sourceDir,
          libraryName: "brainstorming",
          source: "local:/tmp/source",
          sourceType: "local",
          commitHash: "unknown",
          ref: null,
          skillPath: "skills/brainstorming",
          force: false,
        },
        { skillsDir, lockPath },
      ),
    ).rejects.toThrow(/already exists/);

    await expect(lstat(join(skillsDir, "brainstorming"))).resolves.toBeTruthy();
  });

  test("rejects invalid library names before touching filesystem targets", async () => {
    const outsideDir = join(tempDir, "outside");
    const outsideSentinel = join(outsideDir, "sentinel.txt");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideSentinel, "keep me", "utf-8");

    for (const libraryName of [
      "",
      "../outside",
      "nested/name",
      "nested\\name",
      "bad\0name",
    ]) {
      await expect(
        installLibrarySkill(
          {
            sourceDir,
            libraryName,
            source: "local:/tmp/source",
            sourceType: "local",
            commitHash: "unknown",
            ref: null,
            skillPath: "skills/brainstorming",
            force: true,
          },
          { skillsDir, lockPath },
        ),
      ).rejects.toThrow(/Invalid skill name/);
    }

    await expect(readFile(outsideSentinel, "utf-8")).resolves.toBe("keep me");
    await expect(lstat(join(skillsDir, "nested"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readLibraryLock(lockPath)).resolves.toEqual({
      version: 1,
      skills: {},
    });
  });
});

describe("activateLibrarySkill", () => {
  let tempDir: string;
  let libraryPath: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-activate-"));
    libraryPath = join(tempDir, "library", "skills", "brainstorming");
    targetDir = join(tempDir, "provider", "skills");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(
      join(libraryPath, "SKILL.md"),
      "---\nname: brainstorming\n---\n# Brainstorming\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("creates a symlink from provider target to library skill", async () => {
    const result = await activateLibrarySkill({
      libraryPath,
      targetDir,
      activationName: "brainstorming",
      force: false,
    });

    const symlinkPath = join(targetDir, "brainstorming");
    expect(result).toEqual({ symlinkPath, targetPath: libraryPath });
    await expect(readlink(symlinkPath)).resolves.toBe(libraryPath);
    await expect(lstat(symlinkPath)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
    expect((await lstat(symlinkPath)).isSymbolicLink()).toBe(true);
  });

  test("refuses an existing target without force", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const existingPath = join(tempDir, "existing");
    await mkdir(targetDir, { recursive: true });
    await mkdir(existingPath, { recursive: true });
    await createDirSymlink(existingPath, symlinkPath);

    await expect(
      activateLibrarySkill({
        libraryPath,
        targetDir,
        activationName: "brainstorming",
        force: false,
      }),
    ).rejects.toThrow(
      `Target already exists: ${symlinkPath}. Use --force to overwrite.`,
    );

    await expect(readlink(symlinkPath)).resolves.toBe(existingPath);
  });

  test("overwrites an existing symlink with force", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const existingPath = join(tempDir, "existing");
    await mkdir(targetDir, { recursive: true });
    await mkdir(existingPath, { recursive: true });
    await createDirSymlink(existingPath, symlinkPath);

    const result = await activateLibrarySkill({
      libraryPath,
      targetDir,
      activationName: "brainstorming",
      force: true,
    });

    expect(result).toEqual({ symlinkPath, targetPath: libraryPath });
    await expect(readlink(symlinkPath)).resolves.toBe(libraryPath);
  });

  test("refuses to overwrite a real directory with force", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const sentinel = join(symlinkPath, "keep-me.txt");
    await mkdir(symlinkPath, { recursive: true });
    await writeFile(sentinel, "precious", "utf-8");

    await expect(
      activateLibrarySkill({
        libraryPath,
        targetDir,
        activationName: "brainstorming",
        force: true,
      }),
    ).rejects.toThrow(
      `Refusing to overwrite non-symlink target: ${symlinkPath}.`,
    );

    await expect(readFile(sentinel, "utf-8")).resolves.toBe("precious");
    await expect(lstat(symlinkPath)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    expect((await lstat(symlinkPath)).isDirectory()).toBe(true);
  });

  // POSIX-only: the EACCES is provoked with `chmod 000`, and Windows ignores
  // POSIX mode bits on directories — lstat succeeds there, so there is nothing
  // to rethrow and the call resolves normally.
  test.skipIf(process.platform === "win32")(
    "rethrows non-ENOENT lstat errors on the activation target",
    async () => {
      await mkdir(targetDir, { recursive: true });
      await chmod(targetDir, 0o000);
      try {
        await expect(
          activateLibrarySkill({
            libraryPath,
            targetDir,
            activationName: "brainstorming",
            force: false,
          }),
        ).rejects.toMatchObject({ code: "EACCES" });
      } finally {
        await chmod(targetDir, 0o755);
      }
    },
  );

  test("rejects invalid activation names before touching filesystem targets", async () => {
    const outsideDir = join(tempDir, "provider", "outside");
    const outsideSentinel = join(outsideDir, "sentinel.txt");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideSentinel, "keep me", "utf-8");

    for (const activationName of [
      "",
      "../outside",
      "nested/name",
      "nested\\name",
      "bad\0name",
    ]) {
      await expect(
        activateLibrarySkill({
          libraryPath,
          targetDir,
          activationName,
          force: true,
        }),
      ).rejects.toThrow(/Invalid skill name/);
    }

    await expect(readFile(outsideSentinel, "utf-8")).resolves.toBe("keep me");
    await expect(lstat(join(targetDir, "nested"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("deactivateLibrarySkill", () => {
  let tempDir: string;
  let librarySkillsDir: string;
  let libraryPath: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-deactivate-"));
    librarySkillsDir = join(tempDir, "library", "skills");
    libraryPath = join(librarySkillsDir, "brainstorming");
    targetDir = join(tempDir, "provider", "skills");
    await mkdir(libraryPath, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(libraryPath, "SKILL.md"),
      "---\nname: brainstorming\n---\n# Brainstorming\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("removes a provider symlink pointing into the library", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    await createDirSymlink(libraryPath, symlinkPath);
    const target = await realpath(libraryPath);

    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: "brainstorming",
      librarySkillsDir,
      provider: "codex",
      scope: "project",
    });

    expect(result).toEqual({
      name: "brainstorming",
      provider: "codex",
      scope: "project",
      path: symlinkPath,
      target,
    });
    await expect(lstat(symlinkPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Brainstorming");
  });

  test("removes a provider symlink with a relative target into the library", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const relativeTarget = relative(targetDir, libraryPath);
    await createDirSymlink(relativeTarget, symlinkPath);
    const target = await realpath(libraryPath);

    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: "brainstorming",
      librarySkillsDir,
      provider: "codex",
      scope: "project",
    });

    expect(result).toEqual({
      name: "brainstorming",
      provider: "codex",
      scope: "project",
      path: symlinkPath,
      target,
    });
    await expect(lstat(symlinkPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Brainstorming");
  });

  test("removes a broken relative symlink that lexically points into the library", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const relativeTarget = relative(targetDir, libraryPath);
    const expectedTarget = resolve(targetDir, relativeTarget);
    await createDirSymlink(relativeTarget, symlinkPath);
    await rm(libraryPath, { recursive: true, force: true });

    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: "brainstorming",
      librarySkillsDir,
      provider: "codex",
      scope: "project",
    });

    expect(result).toEqual({
      name: "brainstorming",
      provider: "codex",
      scope: "project",
      path: symlinkPath,
      target: expectedTarget,
    });
    await expect(lstat(symlinkPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("removes a symlink into the library when the library dir was deleted", async () => {
    const symlinkPath = join(targetDir, "brainstorming");
    const expectedTarget = libraryPath;
    await createDirSymlink(libraryPath, symlinkPath);
    await rm(join(tempDir, "library"), { recursive: true, force: true });

    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: "brainstorming",
      librarySkillsDir,
      provider: "codex",
      scope: "project",
    });

    expect(result).toEqual({
      name: "brainstorming",
      provider: "codex",
      scope: "project",
      path: symlinkPath,
      target: expectedTarget,
    });
    await expect(lstat(symlinkPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("refuses a broken symlink that lexically points outside the library", async () => {
    const externalDir = join(tempDir, "external");
    const symlinkPath = join(targetDir, "brainstorming");
    const relativeTarget = relative(targetDir, externalDir);
    await mkdir(externalDir, { recursive: true });
    await createDirSymlink(relativeTarget, symlinkPath);
    await rm(externalDir, { recursive: true, force: true });

    await expect(
      deactivateLibrarySkill({
        targetDir,
        activationName: "brainstorming",
        librarySkillsDir,
        provider: "codex",
        scope: "project",
      }),
    ).rejects.toThrow(
      `Refusing to deactivate symlink outside the ASM library: ${symlinkPath}.`,
    );
    // The link is left untouched. POSIX stores the relative target verbatim;
    // Windows uses a junction, whose target is always absolute (see
    // createDirSymlink), so compare the resolved location there.
    const storedTarget = await readlink(symlinkPath);
    if (process.platform === "win32") {
      expect(resolve(storedTarget)).toBe(resolve(targetDir, relativeTarget));
    } else {
      expect(storedTarget).toBe(relativeTarget);
    }
  });

  test("refuses to deactivate a real directory", async () => {
    const realTarget = join(targetDir, "brainstorming");
    await mkdir(realTarget, { recursive: true });

    await expect(
      deactivateLibrarySkill({
        targetDir,
        activationName: "brainstorming",
        librarySkillsDir,
        provider: "codex",
        scope: "project",
      }),
    ).rejects.toThrow(
      `Refusing to deactivate non-symlink target: ${realTarget}.`,
    );
    await expect(lstat(realTarget)).resolves.toBeTruthy();
  });

  test("refuses to deactivate a symlink outside the library", async () => {
    const externalDir = join(tempDir, "external");
    const symlinkPath = join(targetDir, "brainstorming");
    await mkdir(externalDir, { recursive: true });
    await createDirSymlink(externalDir, symlinkPath);

    await expect(
      deactivateLibrarySkill({
        targetDir,
        activationName: "brainstorming",
        librarySkillsDir,
        provider: "codex",
        scope: "project",
      }),
    ).rejects.toThrow(
      `Refusing to deactivate symlink outside the ASM library: ${symlinkPath}.`,
    );
    await expect(readlink(symlinkPath)).resolves.toBe(externalDir);
  });

  test("reports a missing activation", async () => {
    await expect(
      deactivateLibrarySkill({
        targetDir,
        activationName: "brainstorming",
        librarySkillsDir,
        provider: "codex",
        scope: "project",
      }),
    ).rejects.toThrow('Skill "brainstorming" is not active for codex/project.');
  });

  test("rejects invalid activation names before touching filesystem targets", async () => {
    const outsideDir = join(tempDir, "provider", "outside");
    const outsideSentinel = join(outsideDir, "sentinel.txt");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideSentinel, "keep me", "utf-8");

    await expect(
      deactivateLibrarySkill({
        targetDir,
        activationName: "../outside",
        librarySkillsDir,
        provider: "codex",
        scope: "project",
      }),
    ).rejects.toThrow(/Invalid skill name/);

    await expect(readFile(outsideSentinel, "utf-8")).resolves.toBe("keep me");
  });
});

describe("updateLibrarySkill", () => {
  let tempDir: string;
  let lockPath: string;
  let skillsDir: string;
  let sourceRoot: string;
  let libraryPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-update-"));
    lockPath = join(tempDir, "library-lock.json");
    skillsDir = join(tempDir, "library", "skills");
    sourceRoot = join(tempDir, "source");
    libraryPath = join(skillsDir, "brainstorming");

    await mkdir(join(sourceRoot, "skills", "brainstorming"), {
      recursive: true,
    });
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Old Source\n",
    );

    await installLibrarySkill(
      {
        sourceDir: join(sourceRoot, "skills", "brainstorming"),
        libraryName: "brainstorming",
        source: `local:${sourceRoot}`,
        sourceType: "local",
        commitHash: "local",
        ref: null,
        skillPath: "skills/brainstorming",
        force: false,
      },
      { skillsDir, lockPath },
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("updates a local-source library skill in place", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Source\n",
    );

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toMatchObject({
      name: "brainstorming",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# New Source");
    const lock = await readLibraryLock(lockPath);
    expect(lock.skills.brainstorming.version).toBe("2.0.0");
    expect(lock.skills.brainstorming.skillPath).toBe("skills/brainstorming");
  });

  test("updates a local root-source library skill with blank skillPath", async () => {
    const rootSource = join(tempDir, "root-source");
    const rootLibraryPath = join(skillsDir, "root-skill");
    await mkdir(rootSource, { recursive: true });
    await writeFile(
      join(rootSource, "SKILL.md"),
      "---\nname: root-skill\nversion: 1.0.0\n---\n# Old Root\n",
    );
    await installLibrarySkill(
      {
        sourceDir: rootSource,
        libraryName: "root-skill",
        source: `local:${rootSource}`,
        sourceType: "local",
        commitHash: "local-root",
        ref: null,
        skillPath: "",
        force: false,
      },
      { skillsDir, lockPath },
    );
    const originalLock = await readLibraryLock(lockPath);
    const originalEntry = {
      ...originalLock.skills["root-skill"],
      installedAt: "2026-06-18T00:00:00.000Z",
      ref: "HEAD",
    };
    originalLock.skills["root-skill"] = originalEntry;
    await writeLibraryLock(originalLock, lockPath);

    await writeFile(
      join(rootSource, "SKILL.md"),
      "---\nname: root-skill\nversion: 2.0.0\n---\n# New Root\n",
    );

    const result = await updateLibrarySkill("root-skill", {
      skillsDir,
      lockPath,
    });

    expect(result).toMatchObject({
      name: "root-skill",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });
    await expect(
      readFile(join(rootLibraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# New Root");
    const updatedLock = await readLibraryLock(lockPath);
    const updatedEntry = updatedLock.skills["root-skill"];
    expect(updatedEntry.source).toBe(originalEntry.source);
    expect(updatedEntry.sourceType).toBe("local");
    expect(updatedEntry.ref).toBe("HEAD");
    expect(updatedEntry.skillPath).toBe("");
    expect(updatedEntry.libraryPath).toBe(originalEntry.libraryPath);
    expect(updatedEntry.installedAt).not.toBe(originalEntry.installedAt);
    expect(updatedEntry.commitHash).not.toBe(originalEntry.commitHash);
  });

  test("preserves update metadata while refreshing version, commit, and installedAt", async () => {
    const originalLock = await readLibraryLock(lockPath);
    const originalEntry = {
      ...originalLock.skills.brainstorming,
      installedAt: "2026-06-18T00:00:00.000Z",
      ref: "main",
    };
    originalLock.skills.brainstorming = originalEntry;
    await writeLibraryLock(originalLock, lockPath);

    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Source\n",
    );

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result.status).toBe("updated");
    const updatedLock = await readLibraryLock(lockPath);
    const updatedEntry = updatedLock.skills.brainstorming;
    expect(updatedEntry.installedAt).not.toBe(originalEntry.installedAt);
    expect(updatedEntry.commitHash).not.toBe(originalEntry.commitHash);
    expect(updatedEntry.version).toBe("2.0.0");
    expect(updatedEntry.source).toBe(originalEntry.source);
    expect(updatedEntry.sourceType).toBe(originalEntry.sourceType);
    expect(updatedEntry.ref).toBe(originalEntry.ref);
    expect(updatedEntry.skillPath).toBe(originalEntry.skillPath);
    expect(updatedEntry.libraryPath).toBe(originalEntry.libraryPath);
  });

  test("uses recorded skillPath instead of source root", async () => {
    await writeFile(
      join(sourceRoot, "SKILL.md"),
      "---\nname: wrong-root\nversion: 9.9.9\n---\n# Wrong Root\n",
    );
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.1.0\n---\n# Correct Subpath\n",
    );

    await updateLibrarySkill("brainstorming", { skillsDir, lockPath });

    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Correct Subpath");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.not.toContain("# Wrong Root");
  });

  test("falls back to frontmatter name while keeping original lock directory key", async () => {
    const rawLibraryPath = join(skillsDir, "raw-brainstorming");
    await rename(libraryPath, rawLibraryPath);
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: friendly-brainstorming\nversion: 2.2.0\n---\n# Renamed Source\n",
    );

    const lock = await readLibraryLock(lockPath);
    lock.skills["raw-brainstorming"] = {
      ...lock.skills.brainstorming,
      name: "friendly-brainstorming",
      libraryPath: rawLibraryPath,
    };
    delete lock.skills.brainstorming;
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("friendly-brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toMatchObject({
      name: "friendly-brainstorming",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.2.0",
    });
    await expect(
      readFile(join(rawLibraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Renamed Source");
    const updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock.skills.brainstorming).toBeUndefined();
    expect(updatedLock.skills["raw-brainstorming"]).toMatchObject({
      name: "friendly-brainstorming",
      version: "2.2.0",
      libraryPath: rawLibraryPath,
    });
  });

  test("fails without replacing the existing library copy when source skill is invalid", async () => {
    await rm(join(sourceRoot, "skills", "brainstorming", "SKILL.md"), {
      force: true,
    });

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("SKILL.md");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("rejects refreshed source SKILL.md with missing name before replacing library copy", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nversion: 2.0.0\n---\n# New Source\n",
    );
    const originalLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Invalid source SKILL.md: missing name",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    await expect(readLibraryLock(lockPath)).resolves.toEqual(originalLock);
  });

  test("rejects refreshed source SKILL.md with missing version before replacing library copy", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\n---\n# New Source\n",
    );
    const originalLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Invalid source SKILL.md: missing version",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    await expect(readLibraryLock(lockPath)).resolves.toEqual(originalLock);
  });

  test("rejects refreshed source SKILL.md with invalid version before replacing library copy", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0\n---\n# New Source\n",
    );
    const originalLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Invalid source SKILL.md: invalid version",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    await expect(readLibraryLock(lockPath)).resolves.toEqual(originalLock);
  });

  test("returns missing or blank sourceType metadata without replacing library copy", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Source\n",
    );
    const lock = await readLibraryLock(lockPath);
    delete lock.skills.brainstorming.sourceType;
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: sourceType",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    const updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock.skills.brainstorming.version).toBe("1.0.0");

    updatedLock.skills.brainstorming.sourceType = "" as any;
    await writeLibraryLock(updatedLock, lockPath);

    const blankResult = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(blankResult).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: sourceType",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("returns missing or blank source metadata without replacing library copy", async () => {
    const lock = await readLibraryLock(lockPath);
    const originalEntry = { ...lock.skills.brainstorming };
    delete (lock.skills.brainstorming as any).source;
    await writeLibraryLock(lock, lockPath);
    const missingSourceLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: source",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    let updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock).toEqual(missingSourceLock);

    updatedLock.skills.brainstorming = { ...originalEntry, source: "" };
    await writeLibraryLock(updatedLock, lockPath);
    const blankSourceLock = await readLibraryLock(lockPath);

    const blankResult = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(blankResult).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: source",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock).toEqual(blankSourceLock);
  });

  test("returns missing skillPath metadata without replacing library copy", async () => {
    const lock = await readLibraryLock(lockPath);
    delete (lock.skills.brainstorming as any).skillPath;
    await writeLibraryLock(lock, lockPath);
    const missingSkillPathLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: skillPath",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    const updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock).toEqual(missingSkillPathLock);
  });

  test.each(["github", "registry"] as const)(
    "updates a %s-source library skill from recorded clone metadata",
    async (sourceType) => {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execFile);

      const workDir = join(tempDir, `${sourceType}-work`);
      const bareRepoPath = join(tempDir, `${sourceType}.git`);
      await mkdir(join(workDir, "skills", "brainstorming"), {
        recursive: true,
      });
      await exec("git", ["init", workDir]);
      await exec("git", [
        "-C",
        workDir,
        "config",
        "user.email",
        "test@test.com",
      ]);
      await exec("git", ["-C", workDir, "config", "user.name", "Test"]);
      await writeFile(
        join(workDir, "skills", "brainstorming", "SKILL.md"),
        "---\nname: brainstorming\nversion: 2.0.0\n---\n# Remote Source\n",
      );
      await exec("git", ["-C", workDir, "add", "."]);
      await exec("git", ["-C", workDir, "commit", "-m", "remote update"]);
      const { stdout } = await exec("git", [
        "-C",
        workDir,
        "rev-parse",
        "HEAD",
      ]);
      const newCommit = stdout.trim();
      await exec("git", ["clone", "--bare", workDir, bareRepoPath]);

      const lock = await readLibraryLock(lockPath);
      lock.skills.brainstorming = {
        ...lock.skills.brainstorming,
        source: `file://${bareRepoPath}`,
        sourceType,
        commitHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ref: null,
      };
      await writeLibraryLock(lock, lockPath);

      const result = await updateLibrarySkill("brainstorming", {
        skillsDir,
        lockPath,
      });

      expect(result).toMatchObject({
        name: "brainstorming",
        status: "updated",
        oldCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        newCommit,
        oldVersion: "1.0.0",
        newVersion: "2.0.0",
      });
      await expect(
        readFile(join(libraryPath, "SKILL.md"), "utf-8"),
      ).resolves.toContain("# Remote Source");
      const updatedLock = await readLibraryLock(lockPath);
      expect(updatedLock.skills.brainstorming.commitHash).toBe(newCommit);
      expect(updatedLock.skills.brainstorming.sourceType).toBe(sourceType);
      expect(updatedLock.skills.brainstorming.skillPath).toBe(
        "skills/brainstorming",
      );
    },
  );

  test("library update --all attempts remote entries instead of treating them as unsupported", async () => {
    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming.sourceType = "github";
    lock.skills.brainstorming.source = "not-a-cloneable-source";
    await writeLibraryLock(lock, lockPath);

    const summary = await updateLibrarySkills(null, { skillsDir, lockPath });

    expect(summary.failedCount).toBe(1);
    expect(summary.results[0]).toMatchObject({
      name: "brainstorming",
      status: "failed",
      reason: "Cannot determine remote URL",
    });
  });

  test("returns missing libraryPath metadata before touching filesystem", async () => {
    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming.libraryPath = "" as any;
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Missing update metadata: libraryPath",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("rejects skillPath traversal without replacing library copy", async () => {
    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming.skillPath = "../outside/brainstorming";
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Invalid update metadata: skillPath escapes source root",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("rejects symlink skillPath escape without replacing library copy", async () => {
    const externalSkillDir = join(tempDir, "external", "brainstorming");
    await rm(join(sourceRoot, "skills"), { recursive: true, force: true });
    await mkdir(externalSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# Escaped Source\n",
    );
    await createDirSymlink(
      join(tempDir, "external"),
      join(sourceRoot, "skills"),
    );

    const originalLock = await readLibraryLock(lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Invalid update metadata: skillPath escapes source root",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    await expect(readLibraryLock(lockPath)).resolves.toEqual(originalLock);
  });

  test("rejects libraryPath outside skillsDir without replacing outside target", async () => {
    const outsideDir = join(tempDir, "outside-library");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "sentinel.txt"), "keep me", "utf-8");
    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming.libraryPath = outsideDir;
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        "Invalid update metadata: libraryPath escapes library skills directory",
    });
    await expect(
      readFile(join(outsideDir, "sentinel.txt"), "utf-8"),
    ).resolves.toBe("keep me");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("rejects symlink libraryPath escape without replacing library or external target", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Source\n",
    );
    const externalDir = join(tempDir, "external-library");
    const linkPath = join(skillsDir, "link");
    await mkdir(externalDir, { recursive: true });
    await createDirSymlink(externalDir, linkPath);

    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming.libraryPath = join(linkPath, "brainstorming");
    await writeLibraryLock(lock, lockPath);

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        "Invalid update metadata: libraryPath escapes library skills directory",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    const updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock.skills.brainstorming.version).toBe("1.0.0");
    await expect(
      readFile(join(externalDir, "brainstorming", "SKILL.md"), "utf-8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("skips update when local commit hash is unchanged", async () => {
    const first = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    expect(first.status).toBe("updated");

    const lockBefore = await readLibraryLock(lockPath);
    const installedAtBefore = lockBefore.skills.brainstorming.installedAt;
    const commitBefore = lockBefore.skills.brainstorming.commitHash;

    const result = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });

    expect(result).toMatchObject({
      name: "brainstorming",
      status: "skipped",
      oldCommit: commitBefore,
      newCommit: commitBefore,
    });
    const lockAfter = await readLibraryLock(lockPath);
    expect(lockAfter.skills.brainstorming.installedAt).toBe(installedAtBefore);
    expect(lockAfter.skills.brainstorming.commitHash).toBe(commitBefore);
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
  });

  test("skippedCount reflects unchanged skills in update --all", async () => {
    await updateLibrarySkill("brainstorming", { skillsDir, lockPath });
    const summary = await updateLibrarySkills(null, { skillsDir, lockPath });
    expect(summary.skippedCount).toBe(1);
    expect(summary.updatedCount).toBe(0);
    expect(summary.results[0].status).toBe("skipped");
  });

  test("includes non-SKILL.md files in local commit hash", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "notes.txt"),
      "alpha",
    );
    const firstResult = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    const firstLock = await readLibraryLock(lockPath);
    const firstHash = firstLock.skills.brainstorming.commitHash;

    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "notes.txt"),
      "bravo",
    );
    const secondResult = await updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    const secondLock = await readLibraryLock(lockPath);
    const secondHash = secondLock.skills.brainstorming.commitHash;

    expect(firstResult.status).toBe("updated");
    expect(secondResult.status).toBe("updated");
    expect(firstHash).not.toBe(secondHash);
    await expect(
      readFile(join(libraryPath, "notes.txt"), "utf-8"),
    ).resolves.toBe("bravo");
  });

  test("serializes overlapping updates so later writes keep earlier lock deltas", async () => {
    const outliningSourceDir = join(sourceRoot, "skills", "outlining");
    const outliningLibraryPath = join(skillsDir, "outlining");
    await mkdir(outliningSourceDir, { recursive: true });
    await writeFile(
      join(outliningSourceDir, "SKILL.md"),
      "---\nname: outlining\nversion: 1.0.0\n---\n# Old Outline\n",
    );
    await installLibrarySkill(
      {
        sourceDir: outliningSourceDir,
        libraryName: "outlining",
        source: `local:${sourceRoot}`,
        sourceType: "local",
        commitHash: "local-outline",
        ref: null,
        skillPath: "skills/outlining",
        force: false,
      },
      { skillsDir, lockPath },
    );

    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Brainstorming\n",
    );
    await writeFile(
      join(outliningSourceDir, "SKILL.md"),
      "---\nname: outlining\nversion: 2.0.0\n---\n# New Outline\n",
    );

    const firstLockRenameStarted = deferred<void>();
    const releaseFirstLockRename = deferred<void>();
    let blockedFirstLockRename = false;
    fspMocks.renameOverride = async (realRename, from, to) => {
      if (to === lockPath && !blockedFirstLockRename) {
        blockedFirstLockRename = true;
        firstLockRenameStarted.resolve();
        await releaseFirstLockRename.promise;
      }
      await realRename(from, to);
    };

    const firstUpdate = updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    await firstLockRenameStarted.promise;

    const secondUpdate = updateLibrarySkill("outlining", {
      skillsDir,
      lockPath,
    });

    releaseFirstLockRename.resolve();

    await expect(Promise.all([firstUpdate, secondUpdate])).resolves.toEqual([
      expect.objectContaining({ name: "brainstorming", status: "updated" }),
      expect.objectContaining({ name: "outlining", status: "updated" }),
    ]);

    const updatedLock = await readLibraryLock(lockPath);
    expect(updatedLock.skills.brainstorming.version).toBe("2.0.0");
    expect(updatedLock.skills.outlining.version).toBe("2.0.0");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# New Brainstorming");
    await expect(
      readFile(join(outliningLibraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# New Outline");
  });

  test("rejects a stale staged update after force reinstall publishes a new generation with unchanged metadata", async () => {
    const initialInstalledAt = "2999-01-01T00:00:00.000Z";
    const initialLock = await readLibraryLock(lockPath);
    initialLock.skills.brainstorming.installedAt = initialInstalledAt;
    await writeLibraryLock(initialLock, lockPath);

    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# Updated Source\n",
    );

    const updateStageReady = deferred<void>();
    const releaseUpdateStage = deferred<void>();
    let blockedUpdateStage = false;
    const updateSourceDir = join(sourceRoot, "skills", "brainstorming");

    fspMocks.cpOverride = async (realCp, from, to, ...rest) => {
      const result = await realCp(from, to, ...rest);
      if (!blockedUpdateStage && String(from) === updateSourceDir) {
        blockedUpdateStage = true;
        updateStageReady.resolve();
        await releaseUpdateStage.promise;
      }
      return result;
    };

    const updatePromise = updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    await updateStageReady.promise;

    await writeFile(
      join(updateSourceDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 3.0.0\n---\n# Reinstalled Source\n",
    );

    let reinstallResult: Awaited<ReturnType<typeof installLibrarySkill>>;
    let reinstallEntry: Awaited<
      ReturnType<typeof readLibraryLock>
    >["skills"][string];
    try {
      reinstallResult = await installLibrarySkill(
        {
          sourceDir: updateSourceDir,
          libraryName: "brainstorming",
          source: `local:${sourceRoot}`,
          sourceType: "local",
          commitHash: "local",
          ref: null,
          skillPath: "skills/brainstorming",
          force: true,
        },
        { skillsDir, lockPath },
      );
      reinstallEntry = (await readLibraryLock(lockPath)).skills.brainstorming;
    } finally {
      releaseUpdateStage.resolve();
    }

    const updateResult = await updatePromise;

    expect(reinstallResult).toMatchObject({
      name: "brainstorming",
      version: "3.0.0",
      libraryPath,
    });
    expect(updateResult).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        'Library skill "brainstorming" changed while update was in progress. Run "asm library update brainstorming" again.',
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Reinstalled Source");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.not.toContain("# Updated Source");
    await expect(readLibraryLock(lockPath)).resolves.toEqual({
      version: 1,
      skills: {
        brainstorming: reinstallEntry,
      },
    });
    const finalLock = await readLibraryLock(lockPath);
    expect(finalLock.skills.brainstorming).toEqual(reinstallEntry);
    expect(finalLock.skills.brainstorming.source).toBe(`local:${sourceRoot}`);
    expect(finalLock.skills.brainstorming.skillPath).toBe(
      "skills/brainstorming",
    );
    expect(finalLock.skills.brainstorming.commitHash).toBe("local");
    expect(
      Date.parse(finalLock.skills.brainstorming.installedAt),
    ).toBeGreaterThan(Date.parse(initialInstalledAt));
  });

  test("accepts equivalent local source spellings during stale-update revalidation", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# Updated Source\n",
    );

    const updateStageReady = deferred<void>();
    const releaseUpdateStage = deferred<void>();
    let blockedUpdateStage = false;
    const updateSourceDir = join(sourceRoot, "skills", "brainstorming");

    fspMocks.cpOverride = async (realCp, from, to, ...rest) => {
      const result = await realCp(from, to, ...rest);
      if (!blockedUpdateStage && String(from) === updateSourceDir) {
        blockedUpdateStage = true;
        updateStageReady.resolve();
        await releaseUpdateStage.promise;
      }
      return result;
    };

    const updatePromise = updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    await updateStageReady.promise;

    const lock = await readLibraryLock(lockPath);
    const equivalentSource = sourceRoot.endsWith("/")
      ? `${sourceRoot}.`
      : `${sourceRoot}/.`;
    lock.skills.brainstorming = {
      ...lock.skills.brainstorming,
      source: `local:${equivalentSource}`,
      ref: "HEAD",
      skillPath: "skills/brainstorming/.",
    };
    await writeLibraryLock(lock, lockPath);
    releaseUpdateStage.resolve();

    const result = await updatePromise;

    expect(result).toMatchObject({
      name: "brainstorming",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Updated Source");
    const finalLock = await readLibraryLock(lockPath);
    expect(finalLock.skills.brainstorming.source).toBe(
      `local:${equivalentSource}`,
    );
    expect(finalLock.skills.brainstorming.ref).toBe("HEAD");
    expect(finalLock.skills.brainstorming.skillPath).toBe(
      "skills/brainstorming/.",
    );
  });

  test("rejects changed local sources during stale-update revalidation", async () => {
    const movedSourceRoot = join(tempDir, "moved-source");
    await mkdir(join(movedSourceRoot, "skills", "brainstorming"), {
      recursive: true,
    });
    await writeFile(
      join(movedSourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 9.9.0\n---\n# Moved Source\n",
    );
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# Updated Source\n",
    );

    const updateStageReady = deferred<void>();
    const releaseUpdateStage = deferred<void>();
    let blockedUpdateStage = false;
    const updateSourceDir = join(sourceRoot, "skills", "brainstorming");

    fspMocks.cpOverride = async (realCp, from, to, ...rest) => {
      const result = await realCp(from, to, ...rest);
      if (!blockedUpdateStage && String(from) === updateSourceDir) {
        blockedUpdateStage = true;
        updateStageReady.resolve();
        await releaseUpdateStage.promise;
      }
      return result;
    };

    const updatePromise = updateLibrarySkill("brainstorming", {
      skillsDir,
      lockPath,
    });
    await updateStageReady.promise;

    const lock = await readLibraryLock(lockPath);
    lock.skills.brainstorming = {
      ...lock.skills.brainstorming,
      source: `local:${movedSourceRoot}`,
    };
    await writeLibraryLock(lock, lockPath);
    releaseUpdateStage.resolve();

    const result = await updatePromise;

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        'Library skill "brainstorming" changed while update was in progress. Run "asm library update brainstorming" again.',
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.not.toContain("# Updated Source");
    const finalLock = await readLibraryLock(lockPath);
    expect(finalLock.skills.brainstorming.source).toBe(
      `local:${movedSourceRoot}`,
    );
  });

  test("serializes force reinstall with failing update rollback so disk and lock stay aligned", async () => {
    const reinstallSourceDir = join(tempDir, "reinstall", "brainstorming");
    await mkdir(reinstallSourceDir, { recursive: true });
    await writeFile(
      join(reinstallSourceDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 3.0.0\n---\n# Reinstalled Source\n",
    );
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# Updated Source\n",
    );

    const updateWriteStarted = deferred<void>();
    const releaseUpdateWrite = deferred<void>();
    const installMetadataRead = deferred<void>();
    let watchInstallRead = false;
    let installMetadataCaptured = false;

    fspMocks.readFileOverride = async (realReadFile, path, ...rest) => {
      const result = await realReadFile(path, ...rest);
      if (
        watchInstallRead &&
        !installMetadataCaptured &&
        String(path).endsWith("SKILL.md")
      ) {
        installMetadataCaptured = true;
        installMetadataRead.resolve();
      }
      return result;
    };

    const updatePromise = updateLibrarySkill(
      "brainstorming",
      { skillsDir, lockPath },
      {
        writeLibraryLockFn: async () => {
          updateWriteStarted.resolve();
          await releaseUpdateWrite.promise;
          throw new Error("lock write boom");
        },
      },
    );
    await updateWriteStarted.promise;

    watchInstallRead = true;
    const reinstallPromise = installLibrarySkill(
      {
        sourceDir: reinstallSourceDir,
        libraryName: "brainstorming",
        source: `local:${join(tempDir, "reinstall")}`,
        sourceType: "local",
        commitHash: "reinstall",
        ref: null,
        skillPath: "brainstorming",
        force: true,
      },
      { skillsDir, lockPath },
    );
    await installMetadataRead.promise;
    releaseUpdateWrite.resolve();

    const [updateResult, reinstallResult] = await Promise.all([
      updatePromise,
      reinstallPromise,
    ]);

    expect(updateResult).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        "Updated library copy, but failed to write lock file: lock write boom",
    });
    expect(reinstallResult).toMatchObject({
      name: "brainstorming",
      version: "3.0.0",
      libraryPath,
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Reinstalled Source");
    const lock = await readLibraryLock(lockPath);
    expect(lock.skills.brainstorming.version).toBe("3.0.0");
    expect(lock.skills.brainstorming.commitHash).toBe("reinstall");
  });

  test.each(["open", "sync", "close"] as const)(
    "keeps updated lock metadata and files aligned after directory %s fails post-rename",
    async (phase) => {
      await writeFile(
        join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
        "---\nname: brainstorming\nversion: 2.0.0\n---\n# New Source\n",
      );
      failDirectoryDurability(
        dirname(lockPath),
        phase,
        new Error(`directory ${phase} boom`),
      );

      const result = await updateLibrarySkill("brainstorming", {
        skillsDir,
        lockPath,
      });

      expect(result).toMatchObject({
        name: "brainstorming",
        status: "failed",
        reason: expect.stringContaining(
          "Lock metadata and library files were published as the new generation, but parent-directory durability could not be confirmed",
        ),
      });
      const lock = await readLibraryLock(lockPath);
      expect(lock.skills.brainstorming.version).toBe("2.0.0");
      expect(lock.skills.brainstorming.commitHash).not.toBe("local");
      await expect(
        readFile(join(libraryPath, "SKILL.md"), "utf-8"),
      ).resolves.toContain("# New Source");
      await expect(readdir(skillsDir)).resolves.toEqual(["brainstorming"]);
    },
  );

  test("restores old library copy when lock write fails after swap", async () => {
    await writeFile(
      join(sourceRoot, "skills", "brainstorming", "SKILL.md"),
      "---\nname: brainstorming\nversion: 3.0.0\n---\n# New Source\n",
    );

    const result = await updateLibrarySkill(
      "brainstorming",
      { skillsDir, lockPath },
      {
        writeLibraryLockFn: async () => {
          throw new Error("lock write boom");
        },
      },
    );

    expect(result).toEqual({
      name: "brainstorming",
      status: "failed",
      reason:
        "Updated library copy, but failed to write lock file: lock write boom",
    });
    await expect(
      readFile(join(libraryPath, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Old Source");
    const lock = await readLibraryLock(lockPath);
    expect(lock.skills.brainstorming.version).toBe("1.0.0");
  });
});
