import { describe, test, expect, beforeEach, afterEach } from "vitest";
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
} from "fs/promises";
import { tmpdir } from "os";
import { join, relative, resolve } from "path";
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
    await symlink(existingPath, symlinkPath, "dir");

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
    await symlink(existingPath, symlinkPath, "dir");

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

  test("rethrows non-ENOENT lstat errors on the activation target", async () => {
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
  });

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
    await symlink(libraryPath, symlinkPath, "dir");
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
    await symlink(relativeTarget, symlinkPath, "dir");
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
    await symlink(relativeTarget, symlinkPath, "dir");
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
    await symlink(libraryPath, symlinkPath, "dir");
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
    await symlink(relativeTarget, symlinkPath, "dir");
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
    await expect(readlink(symlinkPath)).resolves.toBe(relativeTarget);
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
    await symlink(externalDir, symlinkPath, "dir");

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
    await symlink(join(tempDir, "external"), join(sourceRoot, "skills"), "dir");

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
    await symlink(externalDir, linkPath, "dir");

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
