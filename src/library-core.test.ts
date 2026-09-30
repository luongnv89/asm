/**
 * Direct-import tests for the internal staging/validation helpers that
 * `src/library-core.ts` exports for `src/library-update.ts` but that the
 * `src/library.ts` facade deliberately does not re-export, so
 * `src/library.test.ts` cannot reach them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { AtomicWritePostRenameError } from "./utils/atomic-file";
import type { LibrarySkillEntry } from "./utils/types";
import {
  cloneRemoteLibrarySource,
  emptyLibraryLock,
  hashDirectoryContents,
  isContainedPath,
  libraryEntryChangedDuringUpdate,
  libraryEntryMatchesUpdateSource,
  libraryPathRealpathIsContained,
  librarySourceRoot,
  libraryUpdateFailure,
  nextInstalledAt,
  persistLibraryLock,
  readLibraryLockFile,
  replaceDirectoryAtomically,
  resolveContainedPath,
  stageLibraryDirectory,
  validateSourceSkillFrontmatter,
} from "./library-core";

function makeEntry(
  overrides: Partial<LibrarySkillEntry> = {},
): LibrarySkillEntry {
  return {
    name: "brainstorming",
    version: "1.0.0",
    source: "github:obra/superpowers",
    sourceType: "github",
    commitHash: "abc123",
    ref: "main",
    skillPath: "skills/brainstorming",
    libraryPath: "/library/skills/brainstorming",
    installedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("libraryUpdateFailure", () => {
  it("builds a failed result carrying the reason", () => {
    expect(libraryUpdateFailure("brainstorming", "Clone failed")).toEqual({
      name: "brainstorming",
      status: "failed",
      reason: "Clone failed",
    });
  });
});

describe("libraryEntryChangedDuringUpdate", () => {
  it("builds a failed result telling the user to re-run the update", () => {
    const result = libraryEntryChangedDuringUpdate("brainstorming");
    expect(result.name).toBe("brainstorming");
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("changed while update was in progress");
    expect(result.reason).toContain("asm library update brainstorming");
  });
});

describe("nextInstalledAt", () => {
  it("returns the current time when there is no previous timestamp", () => {
    const before = Date.now();
    const value = Date.parse(nextInstalledAt());
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  it("treats an unparseable previous timestamp as absent", () => {
    const before = Date.now();
    const value = Date.parse(nextInstalledAt("not-a-date"));
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  it("stays strictly monotonic when the previous timestamp is in the future", () => {
    const previous = new Date(Date.now() + 60_000).toISOString();
    expect(nextInstalledAt(previous)).toBe(
      new Date(Date.parse(previous) + 1).toISOString(),
    );
  });

  it("uses the current time when the previous timestamp is in the past", () => {
    const previous = new Date(Date.now() - 60_000).toISOString();
    const value = Date.parse(nextInstalledAt(previous));
    expect(value).toBeGreaterThan(Date.parse(previous));
  });
});

describe("librarySourceRoot", () => {
  it("returns null for non-local sources", () => {
    expect(librarySourceRoot(makeEntry({ source: "github:a/b" }))).toBeNull();
    expect(librarySourceRoot(makeEntry({ source: "registry:foo" }))).toBeNull();
  });

  it("returns null when the local source has an empty path", () => {
    expect(librarySourceRoot(makeEntry({ source: "local:" }))).toBeNull();
  });

  it("resolves a relative local source to an absolute path", () => {
    expect(librarySourceRoot(makeEntry({ source: "local:./some/dir" }))).toBe(
      resolve("./some/dir"),
    );
  });

  it("keeps an already absolute local source", () => {
    expect(librarySourceRoot(makeEntry({ source: "local:/srv/skills" }))).toBe(
      resolve("/srv/skills"),
    );
  });
});

describe("validateSourceSkillFrontmatter", () => {
  it("rejects frontmatter with a missing or blank name", () => {
    expect(validateSourceSkillFrontmatter({})).toEqual({
      reason: "Invalid source SKILL.md: missing name",
    });
    expect(
      validateSourceSkillFrontmatter({ name: "   ", version: "1.0.0" }),
    ).toEqual({ reason: "Invalid source SKILL.md: missing name" });
  });

  it("rejects frontmatter with no version at all", () => {
    expect(validateSourceSkillFrontmatter({ name: "demo" })).toEqual({
      reason: "Invalid source SKILL.md: missing version",
    });
  });

  it("rejects a version that is not semver", () => {
    for (const version of ["1.0", "v1.0.0", "latest", "1.0.0.0"]) {
      expect(validateSourceSkillFrontmatter({ name: "demo", version })).toEqual(
        {
          reason: "Invalid source SKILL.md: invalid version",
        },
      );
    }
  });

  it("accepts prerelease and build metadata", () => {
    expect(
      validateSourceSkillFrontmatter({
        name: "demo",
        version: "1.2.3-beta.1+build.5",
      }),
    ).toEqual({ name: "demo", version: "1.2.3-beta.1+build.5" });
  });

  it("prefers metadata.version over version and trims both fields", () => {
    expect(
      validateSourceSkillFrontmatter({
        name: "  demo  ",
        "metadata.version": " 2.0.0 ",
        version: "1.0.0",
      }),
    ).toEqual({ name: "demo", version: "2.0.0" });
  });

  it("falls back to version when metadata.version is empty", () => {
    expect(
      validateSourceSkillFrontmatter({
        name: "demo",
        "metadata.version": "",
        version: "1.0.0",
      }),
    ).toEqual({ name: "demo", version: "1.0.0" });
  });
});

describe("isContainedPath", () => {
  it("accepts a child nested under the parent", () => {
    expect(isContainedPath("/a/b", "/a/b/c/d")).toBe(true);
  });

  it("accepts the parent itself", () => {
    expect(isContainedPath("/a/b", "/a/b")).toBe(true);
  });

  it("accepts traversal that stays inside the parent", () => {
    expect(isContainedPath("/a/b", "/a/b/c/../d")).toBe(true);
  });

  it("rejects traversal that escapes the parent", () => {
    expect(isContainedPath("/a/b", "/a/b/../../etc/passwd")).toBe(false);
    expect(isContainedPath("/a/b", "/a/b/../c")).toBe(false);
  });

  it("rejects an unrelated absolute path", () => {
    expect(isContainedPath("/a/b", "/etc/passwd")).toBe(false);
  });

  it("rejects a sibling that merely shares a name prefix", () => {
    expect(isContainedPath("/a/b", "/a/bc")).toBe(false);
    expect(isContainedPath("/a/b", "/a/b-other/file")).toBe(false);
  });

  it("resolves relative inputs against the cwd before comparing", () => {
    expect(isContainedPath(".", "./nested/file")).toBe(true);
    expect(isContainedPath("./nested", "..")).toBe(false);
  });
});

describe("resolveContainedPath", () => {
  it("returns the resolved child when it is contained", () => {
    expect(resolveContainedPath("/a/b", "/a/b/c/../d")).toBe("/a/b/d");
  });

  it("returns the resolved parent when child equals parent", () => {
    expect(resolveContainedPath("/a/b", "/a/b")).toBe(resolve("/a/b"));
  });

  it("returns null when the child escapes the parent", () => {
    expect(resolveContainedPath("/a/b", "/a/b/../../escape")).toBeNull();
    expect(resolveContainedPath("/a/b", "/etc/passwd")).toBeNull();
  });
});

describe("libraryPathRealpathIsContained", () => {
  let tempDir: string;
  let skillsDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-contain-"));
    skillsDir = join(tempDir, "skills");
    outsideDir = join(tempDir, "outside");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("accepts an existing directory inside the skills dir", async () => {
    const libraryPath = join(skillsDir, "demo");
    await mkdir(libraryPath);
    await expect(
      libraryPathRealpathIsContained(skillsDir, libraryPath),
    ).resolves.toBe(true);
  });

  it("accepts a not-yet-created path whose existing ancestor is contained", async () => {
    await expect(
      libraryPathRealpathIsContained(skillsDir, join(skillsDir, "not-yet")),
    ).resolves.toBe(true);
  });

  it("accepts the skills dir itself", async () => {
    await expect(
      libraryPathRealpathIsContained(skillsDir, skillsDir),
    ).resolves.toBe(true);
  });

  it("rejects a lexical traversal out of the skills dir", async () => {
    await expect(
      libraryPathRealpathIsContained(
        skillsDir,
        join(skillsDir, "..", "outside", "demo"),
      ),
    ).resolves.toBe(false);
  });

  it("rejects an absolute path outside the skills dir", async () => {
    await expect(
      libraryPathRealpathIsContained(skillsDir, outsideDir),
    ).resolves.toBe(false);
  });

  it("rejects a path that escapes through a symlinked directory", async () => {
    await symlink(outsideDir, join(skillsDir, "escape"), "dir");
    await expect(
      libraryPathRealpathIsContained(skillsDir, join(skillsDir, "escape")),
    ).resolves.toBe(false);
    await expect(
      libraryPathRealpathIsContained(
        skillsDir,
        join(skillsDir, "escape", "demo"),
      ),
    ).resolves.toBe(false);
  });

  it("returns false when the skills dir does not exist", async () => {
    await expect(
      libraryPathRealpathIsContained(
        join(tempDir, "missing"),
        join(tempDir, "missing", "demo"),
      ),
    ).resolves.toBe(false);
  });
});

describe("libraryEntryMatchesUpdateSource", () => {
  let tempDir: string;
  let sourceRoot: string;

  beforeEach(async () => {
    tempDir = await realpath(
      await mkdtemp(join(tmpdir(), "asm-library-core-match-")),
    );
    sourceRoot = join(tempDir, "source");
    await mkdir(join(sourceRoot, "skills", "demo"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns false when the source type differs", async () => {
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ sourceType: "github" }),
        makeEntry({ sourceType: "registry" }),
        null,
      ),
    ).resolves.toBe(false);
  });

  it("returns false when the library path differs", async () => {
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ libraryPath: "/library/skills/a" }),
        makeEntry({ libraryPath: "/library/skills/b" }),
        null,
      ),
    ).resolves.toBe(false);
  });

  it("treats library paths that resolve to the same location as equal", async () => {
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ libraryPath: "/library/skills/./demo" }),
        makeEntry({ libraryPath: "/library/skills/other/../demo" }),
        null,
      ),
    ).resolves.toBe(true);
  });

  it("returns false when a remote source, ref, or skillPath changed", async () => {
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ source: "github:a/b" }),
        makeEntry({ source: "github:a/c" }),
        null,
      ),
    ).resolves.toBe(false);
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ ref: "main" }),
        makeEntry({ ref: "v2" }),
        null,
      ),
    ).resolves.toBe(false);
    await expect(
      libraryEntryMatchesUpdateSource(
        makeEntry({ skillPath: "skills/a" }),
        makeEntry({ skillPath: "skills/b" }),
        null,
      ),
    ).resolves.toBe(false);
  });

  it("returns true for an unchanged remote entry", async () => {
    await expect(
      libraryEntryMatchesUpdateSource(makeEntry(), makeEntry(), null),
    ).resolves.toBe(true);
  });

  it("returns false for a local entry when no expected identity is supplied", async () => {
    const entry = makeEntry({
      sourceType: "local",
      source: `local:${sourceRoot}`,
      skillPath: join("skills", "demo"),
    });
    await expect(
      libraryEntryMatchesUpdateSource(entry, entry, null),
    ).resolves.toBe(false);
  });

  it("compares the realpath of a local source against the expected identity", async () => {
    const entry = makeEntry({
      sourceType: "local",
      source: `local:${sourceRoot}`,
      skillPath: join("skills", "demo"),
    });
    const identity = join(sourceRoot, "skills", "demo");

    await expect(
      libraryEntryMatchesUpdateSource(entry, entry, identity),
    ).resolves.toBe(true);
    await expect(
      libraryEntryMatchesUpdateSource(
        entry,
        entry,
        join(sourceRoot, "skills", "other"),
      ),
    ).resolves.toBe(false);
  });

  it("throws when a local entry has a non-local source", async () => {
    const entry = makeEntry({
      sourceType: "local",
      source: "github:a/b",
    });
    await expect(
      libraryEntryMatchesUpdateSource(entry, entry, "identity"),
    ).rejects.toThrow("Unsupported library source for update");
  });

  it("throws when the local skillPath lexically escapes the source root", async () => {
    const entry = makeEntry({
      sourceType: "local",
      source: `local:${sourceRoot}`,
      skillPath: join("..", "outside"),
    });
    await expect(
      libraryEntryMatchesUpdateSource(entry, entry, "identity"),
    ).rejects.toThrow("skillPath escapes source root");
  });

  it("throws when the local skillPath escapes through a symlink", async () => {
    const outsideDir = join(tempDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, join(sourceRoot, "escape"), "dir");

    const entry = makeEntry({
      sourceType: "local",
      source: `local:${sourceRoot}`,
      skillPath: "escape",
    });
    await expect(
      libraryEntryMatchesUpdateSource(entry, entry, "identity"),
    ).rejects.toThrow("skillPath escapes source root");
  });
});

describe("readLibraryLockFile", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-lock-"));
    lockPath = join(tempDir, "library-lock.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("backs up and resets an unparseable lock file", async () => {
    await writeFile(lockPath, "{ not json", "utf-8");
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(
      emptyLibraryLock(),
    );
    await expect(readFile(lockPath + ".bak", "utf-8")).resolves.toBe(
      "{ not json",
    );
  });

  it("rejects an unsupported lock version", async () => {
    const raw = JSON.stringify({ version: 2, skills: {} });
    await writeFile(lockPath, raw, "utf-8");
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(
      emptyLibraryLock(),
    );
    await expect(readFile(lockPath + ".bak", "utf-8")).resolves.toBe(raw);
  });

  it("rejects a null skills map", async () => {
    await writeFile(
      lockPath,
      JSON.stringify({ version: 1, skills: null }),
      "utf-8",
    );
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(
      emptyLibraryLock(),
    );
  });

  it("rejects a top-level array", async () => {
    await writeFile(lockPath, JSON.stringify([]), "utf-8");
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(
      emptyLibraryLock(),
    );
  });

  it("returns a well-formed lock unchanged", async () => {
    const lock = emptyLibraryLock();
    lock.skills.demo = makeEntry({ name: "demo" });
    await writeFile(lockPath, JSON.stringify(lock), "utf-8");
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(lock);
  });
});

describe("persistLibraryLock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-persist-"));
    lockPath = join(tempDir, "library-lock.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes pretty-printed JSON with a trailing newline", async () => {
    const lock = emptyLibraryLock();
    lock.skills.demo = makeEntry({ name: "demo" });

    await persistLibraryLock(lock, lockPath);

    await expect(readFile(lockPath, "utf-8")).resolves.toBe(
      JSON.stringify(lock, null, 2) + "\n",
    );
    await expect(readdir(tempDir)).resolves.toEqual(["library-lock.json"]);
  });

  it("overwrites an existing lock file", async () => {
    await writeFile(lockPath, "stale", "utf-8");
    await persistLibraryLock(emptyLibraryLock(), lockPath);
    await expect(readLibraryLockFile(lockPath)).resolves.toEqual(
      emptyLibraryLock(),
    );
  });
});

describe("hashDirectoryContents", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-hash-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function makeTree(name: string): Promise<string> {
    const dir = join(tempDir, name);
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "# demo\n", "utf-8");
    await writeFile(join(dir, "nested", "a.txt"), "alpha", "utf-8");
    return dir;
  }

  it("is stable across identical trees", async () => {
    const a = await makeTree("a");
    const b = await makeTree("b");
    expect(await hashDirectoryContents(a)).toBe(await hashDirectoryContents(b));
  });

  it("changes when file contents change", async () => {
    const dir = await makeTree("a");
    const before = await hashDirectoryContents(dir);
    await writeFile(join(dir, "nested", "a.txt"), "beta", "utf-8");
    expect(await hashDirectoryContents(dir)).not.toBe(before);
  });

  it("changes when a file is renamed but its content is unchanged", async () => {
    const a = await makeTree("a");
    const b = await makeTree("b");
    await rm(join(b, "nested", "a.txt"));
    await writeFile(join(b, "nested", "z.txt"), "alpha", "utf-8");
    expect(await hashDirectoryContents(b)).not.toBe(
      await hashDirectoryContents(a),
    );
  });

  it("changes when an empty directory is added", async () => {
    const dir = await makeTree("a");
    const before = await hashDirectoryContents(dir);
    await mkdir(join(dir, "empty"));
    expect(await hashDirectoryContents(dir)).not.toBe(before);
  });

  it("ignores the .git directory", async () => {
    const a = await makeTree("a");
    const b = await makeTree("b");
    await mkdir(join(b, ".git", "objects"), { recursive: true });
    await writeFile(join(b, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    expect(await hashDirectoryContents(b)).toBe(await hashDirectoryContents(a));
  });

  it("rejects when the directory does not exist", async () => {
    await expect(
      hashDirectoryContents(join(tempDir, "missing")),
    ).rejects.toThrow();
  });
});

describe("stageLibraryDirectory", () => {
  let tempDir: string;
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-stage-"));
    sourceDir = join(tempDir, "source");
    targetDir = join(tempDir, "library", "demo");
    await mkdir(join(tempDir, "library"), { recursive: true });
    await mkdir(join(sourceDir, "nested"), { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "# demo\n", "utf-8");
    await writeFile(join(sourceDir, "nested", "a.txt"), "alpha", "utf-8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies the source into a sibling staging dir of the target", async () => {
    const stagedDir = await stageLibraryDirectory(sourceDir, targetDir);

    expect(
      stagedDir.startsWith(join(tempDir, "library", ".library-update-")),
    ).toBe(true);
    await expect(readFile(join(stagedDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# demo\n",
    );
    await expect(
      readFile(join(stagedDir, "nested", "a.txt"), "utf-8"),
    ).resolves.toBe("alpha");
  });

  it("strips the .git directory from the staged copy", async () => {
    await mkdir(join(sourceDir, ".git"), { recursive: true });
    await writeFile(join(sourceDir, ".git", "HEAD"), "ref\n", "utf-8");

    const stagedDir = await stageLibraryDirectory(sourceDir, targetDir);

    await expect(readdir(stagedDir)).resolves.not.toContain(".git");
    await expect(readdir(sourceDir)).resolves.toContain(".git");
  });

  it("removes the staging dir and rethrows when the source is missing", async () => {
    await expect(
      stageLibraryDirectory(join(tempDir, "missing"), targetDir),
    ).rejects.toThrow();

    await expect(readdir(join(tempDir, "library"))).resolves.toEqual([]);
  });
});

describe("replaceDirectoryAtomically", () => {
  let tempDir: string;
  let parentDir: string;
  let targetDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-replace-"));
    parentDir = join(tempDir, "library");
    targetDir = join(parentDir, "demo");
    sourceDir = join(tempDir, "source");
    await mkdir(parentDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "new\n", "utf-8");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function stage(): Promise<string> {
    return stageLibraryDirectory(sourceDir, targetDir);
  }

  it("publishes the staged dir when the target does not exist yet", async () => {
    const writes: string[] = [];
    const result = await replaceDirectoryAtomically({
      stagedDir: await stage(),
      targetDir,
      writeLock: async () => {
        writes.push("lock");
      },
    });

    expect(result).toBeNull();
    expect(writes).toEqual(["lock"]);
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "new\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["demo"]);
  });

  it("replaces an existing target and leaves no backup behind", async () => {
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "old\n", "utf-8");

    const result = await replaceDirectoryAtomically({
      stagedDir: await stage(),
      targetDir,
      writeLock: async () => {},
    });

    expect(result).toBeNull();
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "new\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["demo"]);
  });

  it("rolls back to the previous target when writeLock fails", async () => {
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "old\n", "utf-8");

    const result = await replaceDirectoryAtomically({
      stagedDir: await stage(),
      targetDir,
      writeLock: async () => {
        throw new Error("lock boom");
      },
    });

    expect(result).toMatchObject({ name: "", status: "failed" });
    expect(result?.reason).toContain("failed to write lock file");
    expect(result?.reason).toContain("lock boom");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "old\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["demo"]);
  });

  it("reports a lock write failure when there was no previous target", async () => {
    const result = await replaceDirectoryAtomically({
      stagedDir: await stage(),
      targetDir,
      writeLock: async () => {
        throw new Error("lock boom");
      },
    });

    expect(result).toMatchObject({ name: "", status: "failed" });
    expect(result?.reason).toContain("failed to write lock file");
    await expect(readdir(parentDir)).resolves.toEqual([]);
  });

  it("keeps the new generation when only the durability fsync could not be confirmed", async () => {
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "old\n", "utf-8");

    const result = await replaceDirectoryAtomically({
      stagedDir: await stage(),
      targetDir,
      writeLock: async () => {
        throw new AtomicWritePostRenameError(
          join(parentDir, "library-lock.json"),
          new Error("fsync boom"),
        );
      },
    });

    expect(result).toMatchObject({ name: "", status: "failed" });
    expect(result?.reason).toContain("published as the new generation");
    expect(result?.reason).toContain("fsync boom");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "new\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["demo"]);
  });

  it("restores the previous target when the staged dir is missing", async () => {
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "old\n", "utf-8");
    let lockWritten = false;

    const result = await replaceDirectoryAtomically({
      stagedDir: join(parentDir, ".library-update-missing"),
      targetDir,
      writeLock: async () => {
        lockWritten = true;
      },
    });

    expect(result).toMatchObject({ name: "", status: "failed" });
    expect(result?.reason).toContain("Failed to refresh library skill");
    expect(lockWritten).toBe(false);
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "old\n",
    );
    await expect(readdir(parentDir)).resolves.toEqual(["demo"]);
  });
});

describe("cloneRemoteLibrarySource", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-library-core-clone-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("refuses a source that has no remote clone URL without touching the disk", async () => {
    const lockPath = join(tempDir, "library-lock.json");
    const result = await cloneRemoteLibrarySource(
      makeEntry({ source: "local:/srv/skills", sourceType: "local" }),
      "demo",
      lockPath,
    );

    expect(result).toEqual({ reason: "Cannot determine remote URL" });
    await expect(readdir(tempDir)).resolves.toEqual([]);
  });
});
