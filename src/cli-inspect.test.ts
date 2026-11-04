import { afterEach, beforeEach, describe, test, expect, vi } from "vitest";
import { mkdir, rm, symlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";
import * as librarySkills from "./library-skills";
import type { LibraryLockFile } from "./utils/types";
import { runCLI } from "./cli-test-harness";

// `asm inspect` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: inspect", () => {
  const skillName = "asm-inspect-fixture";
  const libraryDir = join(getLibrarySkillsDir(), skillName);
  const claudeDir = join(homedir(), ".claude", "skills", skillName);
  const codexDir = join(homedir(), ".codex", "skills", skillName);
  const aliasDir = join(homedir(), ".claude", "skills", `${skillName}-alias`);
  const libraryRoot = dirname(getLibrarySkillsDir());
  const tagStatePath = join(process.env.ASM_CONFIG_DIR!, "skill-tags.json");
  const content = `---\nname: Inspect display name\ndescription: Inspect acceptance fixture\nversion: 1.0.0\ntags: [library, docs]\n---\nUse this fixture to test inspect.\n`;

  async function writeSkill(path: string) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), content);
  }

  async function writeLibrary() {
    await writeSkill(libraryDir);
    const lock: LibraryLockFile = {
      version: 1,
      skills: {
        [skillName]: {
          name: skillName,
          version: "1.0.0",
          source: "local",
          sourceType: "local",
          commitHash: "abc123",
          ref: null,
          skillPath: libraryDir,
          libraryPath: libraryDir,
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await writeFile(getLibraryLockPath(), JSON.stringify(lock));
  }

  async function activate(path: string) {
    await mkdir(dirname(path), { recursive: true });
    await symlink(libraryDir, path, "dir");
  }

  async function cleanup() {
    // All paths belong to this file's vitest HOME/ASM_CONFIG_DIR sandbox.
    for (const path of [
      claudeDir,
      codexDir,
      aliasDir,
      libraryRoot,
      tagStatePath,
    ]) {
      await rm(path, { recursive: true, force: true });
    }
  }

  beforeEach(cleanup);
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  test("missing skill name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("inspect");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("not-found hint includes the library only for the default pool", async () => {
    const result = await runCLI("inspect", skillName);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Skill "${skillName}" not found.`);
    expect(result.stderr).toContain("asm library list");
    const scoped = await runCLI("inspect", skillName, "-s", "both");
    expect(scoped.exitCode).toBe(1);
    expect(scoped.stderr).not.toContain("asm library list");
  });

  test("help explains default library coverage and scoped installations", async () => {
    const result = await runCLI("inspect", "--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Without --scope, includes library-only skills",
    );
    expect(result.stdout).toContain("Search provider installations only");
  });

  test("library-only JSON is one enriched object with effective tags", async () => {
    await writeLibrary();
    const added = await runCLI("tag", "add", skillName, "testing", "--json");
    expect(added.exitCode).toBe(0);
    const result = await runCLI("inspect", skillName, "--json");
    expect(result.exitCode).toBe(0);
    const skill = JSON.parse(result.stdout);
    expect(Array.isArray(skill)).toBe(false);
    expect(skill).toMatchObject({
      dirName: skillName,
      provider: "library",
      providerLabel: "Library",
      location: "library",
      scope: "global",
      path: libraryDir,
      tags: ["library", "docs", "testing"],
    });
    expect(Array.isArray(skill.warnings)).toBe(true);
    const listed = await runCLI("library", "list", "--json");
    expect(listed.exitCode).toBe(0);
    expect(
      JSON.parse(listed.stdout).find(
        (s: { dirName: string }) => s.dirName === skillName,
      ).tags,
    ).toEqual(skill.tags);
  });

  test("library-only text uses the inspect layout with zero installations", async () => {
    await writeLibrary();
    const result = await runCLI("inspect", skillName);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Tags: library, docs");
    expect(result.stdout).toMatch(/Installed in:[ \t]*\n/);
    expect(result.stdout).toContain("Installations (0)");
    expect(result.stdout).toMatch(/Library\s*\n\s*Path:/);
    expect(result.stdout).toContain(libraryDir.replace(homedir(), "~"));
    expect(result.stdout).not.toMatch(/^\s*(Tool|Scope|Location):/m);
  });

  test.each(["global", "project", "both"])(
    "explicit scope %s never loads library skills",
    async (scope) => {
      await writeLibrary();
      const loader = vi.spyOn(librarySkills, "loadLibrarySkills");
      const result = await runCLI("inspect", skillName, "-s", scope, "--json");
      expect(result.exitCode).toBe(1);
      expect(loader).not.toHaveBeenCalled();
    },
  );

  test("an unactivated library twin adds text context without changing scanned JSON", async () => {
    await writeSkill(claudeDir);
    const before = await runCLI("inspect", skillName, "--json");
    expect(before.exitCode).toBe(0);
    await writeLibrary();
    const after = await runCLI("inspect", skillName, "--json");
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toBe(before.stdout);
    const text = await runCLI("inspect", skillName);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("Installations (1)");
    expect(text.stdout).toMatch(/Installed in:.*Claude/);
    expect(text.stdout).toMatch(/Library\s*\n\s*Path:/);
    expect(text.stdout).toContain(libraryDir.replace(homedir(), "~"));
    const scoped = await runCLI("inspect", skillName, "--scope", "both");
    expect(scoped.exitCode).toBe(0);
    expect(scoped.stdout).not.toMatch(/^\s*Library\s*$/m);
    expect(scoped.stdout).toContain("Tool:");
  });

  test.each([1, 2])(
    "activated library skill preserves %i scanned JSON rows",
    async (count) => {
      await writeLibrary();
      await activate(claudeDir);
      if (count === 2) await activate(codexDir);
      const scoped = await runCLI("inspect", skillName, "-s", "both", "--json");
      const result = await runCLI("inspect", skillName, "--json");
      expect(scoped.exitCode).toBe(0);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(scoped.stdout);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(count === 2);
      expect(Array.isArray(data) ? data : [data]).toHaveLength(count);
      const text = await runCLI("inspect", skillName);
      expect(text.exitCode).toBe(0);
      expect(text.stdout).toContain(`Installations (${count})`);
      expect(text.stdout).toMatch(/Installed in:.*Claude/);
      expect(text.stdout).not.toMatch(/Installed in:.*Library/);
      expect(text.stdout).toMatch(/Library\s*\n\s*Path:/);
    },
  );

  test("matching remains exact dirName and ignores the tool filter", async () => {
    await writeLibrary();
    expect((await runCLI("inspect", "Inspect display name")).exitCode).toBe(1);
    expect((await runCLI("inspect", "asm-inspect")).exitCode).toBe(1);
    const result = await runCLI("inspect", skillName, "-p", "claude", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).provider).toBe("library");
  });

  test("a library entry scanned under an alias is not a library-only fallback", async () => {
    await writeLibrary();
    await activate(aliasDir);
    const result = await runCLI("inspect", skillName, "--json");
    expect(result.exitCode).toBe(1);
  });

  test("a missing library directory is not inspectable", async () => {
    await writeLibrary();
    await rm(libraryDir, { recursive: true, force: true });
    expect((await runCLI("inspect", skillName)).exitCode).toBe(1);
  });
});
