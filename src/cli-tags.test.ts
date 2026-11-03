import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { rm, writeFile, mkdir, readFile, realpath, symlink } from "fs/promises";
import { homedir } from "os";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";
import type { LibraryLockFile, LibrarySkillEntry } from "./utils/types";
import { runCLI } from "./cli-test-harness";

// `asm tags` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: local skill tags (#584) ───────────────────────────────

describe("CLI integration: local skill tags", () => {
  const skillName = "issue-584-tag-fixture";
  const skillDir = join(homedir(), ".claude", "skills", skillName);

  beforeEach(async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Tag CLI fixture\ntags: [cli, testing]\n---\nBody\n`,
    );
    await rm(join(process.env.ASM_CONFIG_DIR!, "skill-tags.json"), {
      force: true,
    });
  });

  afterEach(async () => {
    await rm(skillDir, { recursive: true, force: true });
    await rm(join(process.env.ASM_CONFIG_DIR!, "skill-tags.json"), {
      force: true,
    });
  });

  test("adds and removes persisted tags without changing SKILL.md", async () => {
    const before = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    const added = await runCLI(
      "tag",
      "add",
      skillName,
      "automation,CLI",
      "--json",
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout)[0].tags).toEqual([
      "cli",
      "testing",
      "automation",
    ]);
    expect(JSON.parse(added.stdout)[0].applied).toEqual(["automation"]);

    const removed = await runCLI(
      "tag",
      "remove",
      skillName,
      "testing",
      "--json",
    );
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout)[0].tags).toEqual(["cli", "automation"]);
    expect(JSON.parse(removed.stdout)[0].applied).toEqual(["testing"]);
    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(before);
  });

  test("inspect --json reflects local tag edits", async () => {
    const added = await runCLI("tag", "add", skillName, "automation", "--json");
    expect(added.exitCode).toBe(0);

    const inspected = await runCLI("inspect", skillName, "--json");
    expect(inspected.exitCode).toBe(0);
    const data = JSON.parse(inspected.stdout);
    const skill = Array.isArray(data) ? data[0] : data;
    expect(skill.tags).toEqual(["cli", "testing", "automation"]);

    const inspectedText = await runCLI("inspect", skillName);
    expect(inspectedText.exitCode).toBe(0);
    expect(inspectedText.stdout).toContain("Tags:");
    expect(inspectedText.stdout).toContain("automation");
  });

  test("list and search accept repeatable AND tag filters", async () => {
    await runCLI("tag", "add", skillName, "automation", "--json");

    const listed = await runCLI(
      "list",
      "--tag",
      "cli,automation",
      "--tag",
      "testing",
      "--json",
    );
    expect(listed.exitCode).toBe(0);
    expect(
      JSON.parse(listed.stdout).map((skill: { name: string }) => skill.name),
    ).toContain(skillName);

    const searched = await runCLI(
      "search",
      skillName,
      "--installed",
      "--tag",
      "cli,automation",
      "--json",
    );
    expect(searched.exitCode).toBe(0);
    expect(JSON.parse(searched.stdout)).toMatchObject([
      { name: skillName, tags: ["cli", "testing", "automation"] },
    ]);

    const noMatch = await runCLI("list", "--tag", "cli,missing-tag", "--json");
    expect(noMatch.exitCode).toBe(0);
    expect(JSON.parse(noMatch.stdout)).toEqual([]);
  });

  test("rejects invalid and missing tag arguments", async () => {
    const invalid = await runCLI("tag", "add", skillName, "bad tag");
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("Invalid tag value");

    const missing = await runCLI("list", "--tag");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Missing value");
  });
});

// ─── Library skill coverage (asm-fwk.3) ──────────────────────────────────────
//
// `scanAllSkills` only walks provider directories, so `tag add/remove` grows
// its default match pool (scope=both, no -p) with library skills that no
// provider activation covers. `asm activate` links a library skill into a
// provider (src/library-core.ts), so an activated library skill and its
// library copy share one canonical realPath — one result row, one tag record.

describe("CLI integration: library skill tags", () => {
  const activatedName = "asm-fwk3-activated";
  const activatedDir = join(homedir(), ".claude", "skills", activatedName);
  const statePath = () => join(process.env.ASM_CONFIG_DIR!, "skill-tags.json");

  async function writeLibrarySkill(
    dirName: string,
    frontmatter: string,
  ): Promise<string> {
    const dir = join(getLibrarySkillsDir(), dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nBody\n`);
    return dir;
  }

  function lockEntry(name: string, libraryPath: string): LibrarySkillEntry {
    return {
      name,
      version: "1.0.0",
      source: "local",
      sourceType: "local",
      commitHash: "abc123",
      ref: null,
      skillPath: libraryPath,
      libraryPath,
      installedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  async function writeLock(
    entries: Record<string, LibrarySkillEntry>,
  ): Promise<void> {
    const lock: LibraryLockFile = { version: 1, skills: entries };
    await mkdir(join(process.env.ASM_CONFIG_DIR!, "library"), {
      recursive: true,
    });
    await writeFile(getLibraryLockPath(), `${JSON.stringify(lock, null, 2)}\n`);
  }

  async function readState(): Promise<{
    skills: Record<string, { added: string[]; removed: string[] }>;
  }> {
    return JSON.parse(await readFile(statePath(), "utf-8"));
  }

  beforeEach(async () => {
    await rm(join(process.env.ASM_CONFIG_DIR!, "library"), {
      recursive: true,
      force: true,
    });
    await rm(statePath(), { force: true });
    await rm(activatedDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(join(process.env.ASM_CONFIG_DIR!, "library"), {
      recursive: true,
      force: true,
    });
    await rm(statePath(), { force: true });
    await rm(activatedDir, { recursive: true, force: true });
  });

  test("adds a tag to a library-only skill, keyed by its canonical path", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-lib-only",
      "name: asm-fwk3-lib-only\ndescription: Library fixture\ntags: [library, docs]",
    );
    await writeLock({
      "asm-fwk3-lib-only": lockEntry("asm-fwk3-lib-only", dir),
    });
    const canonical = await realpath(dir);

    const added = await runCLI(
      "tag",
      "add",
      "asm-fwk3-lib-only",
      "testing",
      "--json",
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout)).toEqual([
      {
        name: "asm-fwk3-lib-only",
        path: canonical,
        tags: ["library", "docs", "testing"],
        applied: ["testing"],
        changed: true,
      },
    ]);
    expect((await readState()).skills[canonical]).toEqual({
      added: ["testing"],
      removed: [],
    });
  });

  test("removes a tag from a library-only skill", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-lib-remove",
      "name: asm-fwk3-lib-remove\ntags: [library, docs]",
    );
    await writeLock({
      "asm-fwk3-lib-remove": lockEntry("asm-fwk3-lib-remove", dir),
    });
    const canonical = await realpath(dir);

    const removed = await runCLI(
      "tag",
      "remove",
      "asm-fwk3-lib-remove",
      "docs",
      "--json",
    );
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout)).toEqual([
      {
        name: "asm-fwk3-lib-remove",
        path: canonical,
        tags: ["library"],
        applied: ["docs"],
        changed: true,
      },
    ]);
    expect((await readState()).skills[canonical]).toEqual({
      added: [],
      removed: ["docs"],
    });
  });

  test("an activated library skill produces exactly one result row", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-activated",
      "name: asm-fwk3-activated\ntags: [library]",
    );
    await writeLock({
      "asm-fwk3-activated": lockEntry("asm-fwk3-activated", dir),
    });
    const canonical = await realpath(dir);

    // Activation is a symlink into the provider directory, so the scanned
    // instance's realPath is the library path too.
    await mkdir(join(homedir(), ".claude", "skills"), { recursive: true });
    await symlink(dir, activatedDir, "dir");

    const added = await runCLI(
      "tag",
      "add",
      "asm-fwk3-activated",
      "testing",
      "--json",
    );
    expect(added.exitCode).toBe(0);
    const rows = JSON.parse(added.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "asm-fwk3-activated",
      path: canonical,
      applied: ["testing"],
    });
    // One overlay record for the shared canonical path — no library duplicate.
    expect(Object.keys((await readState()).skills)).toEqual([canonical]);
  });

  test("a provider filter excludes library-only skills", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-lib-filtered",
      "name: asm-fwk3-lib-filtered\ntags: [library]",
    );
    await writeLock({
      "asm-fwk3-lib-filtered": lockEntry("asm-fwk3-lib-filtered", dir),
    });

    const missing = await runCLI(
      "tag",
      "add",
      "asm-fwk3-lib-filtered",
      "testing",
      "-p",
      "claude",
      "--json",
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(
      'Skill not found: "asm-fwk3-lib-filtered"',
    );
    await expect(readFile(statePath(), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("a non-both scope excludes library-only skills", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-lib-project",
      "name: asm-fwk3-lib-project\ntags: [library]",
    );
    await writeLock({
      "asm-fwk3-lib-project": lockEntry("asm-fwk3-lib-project", dir),
    });

    const missing = await runCLI(
      "tag",
      "add",
      "asm-fwk3-lib-project",
      "testing",
      "-s",
      "project",
      "--json",
    );
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('Skill not found: "asm-fwk3-lib-project"');
  });

  test("adding a tag already in library frontmatter does not duplicate it", async () => {
    const dir = await writeLibrarySkill(
      "asm-fwk3-lib-existing",
      "name: asm-fwk3-lib-existing\ntags: [library, docs]",
    );
    await writeLock({
      "asm-fwk3-lib-existing": lockEntry("asm-fwk3-lib-existing", dir),
    });
    const canonical = await realpath(dir);

    const added = await runCLI(
      "tag",
      "add",
      "asm-fwk3-lib-existing",
      "docs",
      "--json",
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout)).toEqual([
      {
        name: "asm-fwk3-lib-existing",
        path: canonical,
        tags: ["library", "docs"],
        applied: [],
        changed: false,
      },
    ]);
    // No-op add leaves no overlay entry behind.
    expect((await readState()).skills).toEqual({});
  });
});
