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

// ─── Tag inventory (asm-fwk.6) ───────────────────────────────────────────────
//
// `asm tag list` reports tagged skill DIRECTORIES split into ACTIVATED
// (visible to `asm list`, disabled included), LIBRARY_ONLY (in the library but
// not activated) and MISSING (skill-tags.json records whose directory is
// gone). ALL is ACTIVATED + LIBRARY_ONLY; MISSING is never counted into ALL.

describe("CLI integration: tag list", () => {
  const skillsRoot = join(homedir(), ".claude", "skills");
  const statePath = () => join(process.env.ASM_CONFIG_DIR!, "skill-tags.json");
  const libraryRoot = () => getLibrarySkillsDir();

  async function writeSkill(name: string, tags: string): Promise<string> {
    const dir = join(skillsRoot, name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Tag list fixture\ntags: ${tags}\n---\nBody\n`,
    );
    return dir;
  }

  async function writeLibrarySkill(
    dirName: string,
    tags: string,
  ): Promise<string> {
    const dir = join(libraryRoot(), dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${dirName}\ndescription: Tag list library fixture\ntags: ${tags}\n---\nBody\n`,
    );
    const lock: LibraryLockFile = {
      version: 1,
      skills: {
        [dirName]: {
          name: dirName,
          version: "1.0.0",
          source: "local",
          sourceType: "local",
          commitHash: "abc123",
          ref: null,
          skillPath: dir,
          libraryPath: dir,
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await mkdir(join(process.env.ASM_CONFIG_DIR!, "library"), {
      recursive: true,
    });
    await writeFile(getLibraryLockPath(), `${JSON.stringify(lock, null, 2)}\n`);
    return dir;
  }

  function tagRow(
    data: { tags: Array<Record<string, number | string>> },
    tag: string,
  ): Record<string, number | string> | undefined {
    return data.tags.find((row) => row.tag === tag);
  }

  beforeEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true });
    await rm(libraryRoot(), { recursive: true, force: true });
    await rm(getLibraryLockPath(), { force: true });
    await rm(statePath(), { force: true });
  });

  afterEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true });
    await rm(libraryRoot(), { recursive: true, force: true });
    await rm(getLibraryLockPath(), { force: true });
    await rm(statePath(), { force: true });
  });

  test("counts activated skills by frontmatter and overlay tags", async () => {
    await writeSkill("asm-fwk6-basic", "[alpha, beta]");
    await runCLI("tag", "add", "asm-fwk6-basic", "gamma", "--json");

    const listed = await runCLI("tag", "list", "--json");
    expect(listed.exitCode).toBe(0);
    const data = JSON.parse(listed.stdout);

    expect(data.tags).toHaveLength(3);
    for (const tag of ["alpha", "beta", "gamma"]) {
      expect(tagRow(data, tag)).toEqual({
        tag,
        all: 1,
        activated: 1,
        libraryOnly: 0,
        missing: 0,
      });
    }
    expect(data.tagCount).toBe(3);
    expect(data.tagSkillPairCount).toBe(3);
    expect(data.taggedSkillCount).toEqual({
      all: 1,
      activated: 1,
      libraryOnly: 0,
    });
    expect(data.untaggedSkillCount.all).toBe(0);
    expect(data.missingRecordCount).toBe(0);
  });

  test("human output shows the summary line and one row per tag", async () => {
    await writeSkill("asm-fwk6-human", "[alpha]");
    await runCLI("tag", "add", "asm-fwk6-human", "gamma", "--json");

    const listed = await runCLI("tag", "list");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("2 tags");
    expect(listed.stdout).toContain("2 tag-skill pairs");
    expect(listed.stdout).toContain("TAG");
    expect(listed.stdout).toContain("ALL");
    expect(listed.stdout).toContain("ACTIVATED");
    expect(listed.stdout).toContain("LIBRARY_ONLY");
    expect(listed.stdout).toContain("MISSING");
    expect(listed.stdout).toMatch(/^alpha\s+1\s+1\s+0\s+0$/m);
    // The MISSING footnote only appears when missing records exist.
    expect(listed.stdout).not.toContain("MISSING counts tag records");
  });

  test("library-only skills count toward LIBRARY_ONLY, not ACTIVATED", async () => {
    await writeLibrarySkill("asm-fwk6-lib", "[libonly]");

    const all = JSON.parse((await runCLI("tag", "list", "--json")).stdout);
    expect(tagRow(all, "libonly")).toEqual({
      tag: "libonly",
      all: 1,
      activated: 0,
      libraryOnly: 1,
      missing: 0,
    });

    const activated = await runCLI("tag", "list", "--activated", "--json");
    expect(activated.exitCode).toBe(0);
    const narrowed = JSON.parse(activated.stdout);
    expect(narrowed.activatedOnly).toBe(true);
    expect(tagRow(narrowed, "libonly")).toBeUndefined();
    expect(narrowed.tagCount).toBe(0);
  });

  test("missing records are reported but excluded from ALL", async () => {
    // A tag record whose skill directory no longer exists.
    await mkdir(join(process.env.ASM_CONFIG_DIR!, "library"), {
      recursive: true,
    });
    await writeFile(
      statePath(),
      JSON.stringify({
        version: 1,
        skills: {
          [join(homedir(), ".claude", "skills", "asm-fwk6-gone")]: {
            added: ["ghost"],
            removed: [],
          },
        },
      }),
    );

    const listed = JSON.parse((await runCLI("tag", "list", "--json")).stdout);
    expect(listed.missingRecordCount).toBe(1);
    expect(tagRow(listed, "ghost")).toEqual({
      tag: "ghost",
      all: 0,
      activated: 0,
      libraryOnly: 0,
      missing: 1,
    });
    expect(listed.tagCount).toBe(1);
    expect(listed.tagSkillPairCount).toBe(0);
    expect(listed.taggedSkillCount.all).toBe(0);

    const human = await runCLI("tag", "list");
    expect(human.stdout).toContain("MISSING counts tag records");
  });

  test("machine envelope wraps the same inventory data", async () => {
    await writeSkill("asm-fwk6-machine", "[alpha]");

    const res = await runCLI("tag", "list", "--machine");
    expect(res.exitCode).toBe(0);
    const envelope = JSON.parse(res.stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("tag list");
    expect(envelope.status).toBe("ok");
    expect(Array.isArray(envelope.data.tags)).toBe(true);
    expect(tagRow(envelope.data, "alpha")?.activated).toBe(1);
  });

  test("an explicit scope narrows the report to activated skills", async () => {
    await writeLibrarySkill("asm-fwk6-lib-scope", "[libscope]");
    await writeSkill("asm-fwk6-global", "[globalscope]");

    const listed = JSON.parse(
      (await runCLI("tag", "list", "-s", "global", "--json")).stdout,
    );
    expect(listed.activatedOnly).toBe(true);
    expect(tagRow(listed, "globalscope")?.activated).toBe(1);
    expect(tagRow(listed, "libscope")).toBeUndefined();
  });

  test("rejects positional arguments", async () => {
    const res = await runCLI("tag", "list", "bogus");
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Usage: asm tag list");
  });

  test("prints an actionable message when nothing is tagged", async () => {
    const res = await runCLI("tag", "list");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("No tags yet.");
    expect(res.stdout).toContain("asm tag add <skill> <tag>");

    // Structured output keeps the full shape even when empty.
    const json = JSON.parse((await runCLI("tag", "list", "--json")).stdout);
    expect(json).toMatchObject({
      tagCount: 0,
      tagSkillPairCount: 0,
      tags: [],
    });
  });

  test("--activated counts match `asm list --tag` deduped by realPath", async () => {
    await writeSkill("asm-fwk6-invariant-a", "[inv]");
    await writeSkill("asm-fwk6-invariant-b", "[inv]");
    // A disabled skill is still visible to `asm list` and must be counted.
    await runCLI("disable", "asm-fwk6-invariant-b", "--json");

    const listed = JSON.parse(
      (await runCLI("tag", "list", "--activated", "--json")).stdout,
    );
    const listedActivated = tagRow(listed, "inv")?.activated;

    const asmList = JSON.parse(
      (await runCLI("list", "--tag", "inv", "--json")).stdout,
    );
    const dedupedByRealPath = new Set(
      asmList.map((skill: { realPath: string }) => skill.realPath),
    ).size;

    expect(listedActivated).toBe(dedupedByRealPath);
    expect(listedActivated).toBe(2);
  });
});
