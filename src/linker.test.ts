import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  validateLinkSource,
  createLink,
  discoverLinkableSkills,
} from "./linker";
import { mkdtemp, writeFile, mkdir, rm, lstat, readlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

describe("validateLinkSource", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "linker-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns name and version for valid skill directory", async () => {
    const skillDir = join(tempDir, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
version: 1.2.0
---
Body content.
`,
    );
    const result = await validateLinkSource(skillDir);
    expect(result.name).toBe("my-skill");
    expect(result.version).toBe("1.2.0");
  });

  it("throws for non-existent path", async () => {
    const nonExistent = join(tempDir, "nope");
    expect(validateLinkSource(nonExistent)).rejects.toThrow(
      "Path does not exist",
    );
  });

  it("throws for path that is not a directory", async () => {
    const filePath = join(tempDir, "file.txt");
    await writeFile(filePath, "hello");
    expect(validateLinkSource(filePath)).rejects.toThrow(
      "Path is not a directory",
    );
  });

  it("throws when no SKILL.md found", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);
    expect(validateLinkSource(emptyDir)).rejects.toThrow("No SKILL.md found");
  });

  it("throws when SKILL.md has no name in frontmatter", async () => {
    const skillDir = join(tempDir, "bad-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
version: 1.0.0
---
Body content.
`,
    );
    expect(validateLinkSource(skillDir)).rejects.toThrow("missing");
  });

  it("defaults version to 0.0.0 when missing", async () => {
    const skillDir = join(tempDir, "no-version");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: no-version
---
Body content.
`,
    );
    const result = await validateLinkSource(skillDir);
    expect(result.version).toBe("0.0.0");
  });
});

describe("createLink", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "linker-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a symlink at target", async () => {
    const source = join(tempDir, "source");
    const targetDir = join(tempDir, "target");
    await mkdir(source);
    await mkdir(targetDir);

    await createLink(source, targetDir, "my-skill", false);

    const linkPath = join(targetDir, "my-skill");
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
    const target = await readlink(linkPath);
    expect(target).toBe(source);
  });

  it("throws when target exists and force is false", async () => {
    const source = join(tempDir, "source");
    const targetDir = join(tempDir, "target");
    const existing = join(targetDir, "my-skill");
    await mkdir(source);
    await mkdir(targetDir);
    await mkdir(existing);

    expect(createLink(source, targetDir, "my-skill", false)).rejects.toThrow(
      "Target already exists",
    );
  });

  it("overwrites when force is true", async () => {
    const source = join(tempDir, "source");
    const targetDir = join(tempDir, "target");
    const existing = join(targetDir, "my-skill");
    await mkdir(source);
    await mkdir(targetDir);
    await mkdir(existing);

    await createLink(source, targetDir, "my-skill", true);

    const stats = await lstat(join(targetDir, "my-skill"));
    expect(stats.isSymbolicLink()).toBe(true);
  });
});

describe("discoverLinkableSkills", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "linker-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers skills in immediate subdirectories", async () => {
    const skillA = join(tempDir, "skill-a");
    const skillB = join(tempDir, "skill-b");
    await mkdir(skillA);
    await mkdir(skillB);
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: skill-a\nversion: 1.0.0\n---\nSkill A body.\n`,
    );
    await writeFile(
      join(skillB, "SKILL.md"),
      `---\nname: skill-b\nversion: 2.0.0\n---\nSkill B body.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
    expect(skills.find((s) => s.name === "skill-a")?.version).toBe("1.0.0");
    expect(skills.find((s) => s.name === "skill-b")?.version).toBe("2.0.0");
  });

  it("returns empty array when no subdirectories have SKILL.md", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(0);
  });

  it("skips hidden directories", async () => {
    const hidden = join(tempDir, ".hidden-skill");
    await mkdir(hidden);
    await writeFile(
      join(hidden, "SKILL.md"),
      `---\nname: hidden\nversion: 1.0.0\n---\nHidden.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(0);
  });

  it("skips node_modules", async () => {
    const nm = join(tempDir, "node_modules");
    await mkdir(nm);
    await writeFile(
      join(nm, "SKILL.md"),
      `---\nname: nm-skill\nversion: 1.0.0\n---\nBody.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(0);
  });

  it("skips subdirectories without valid name in frontmatter", async () => {
    const bad = join(tempDir, "bad-skill");
    await mkdir(bad);
    await writeFile(
      join(bad, "SKILL.md"),
      `---\nversion: 1.0.0\n---\nNo name.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(0);
  });

  it("skips files (non-directories)", async () => {
    await writeFile(join(tempDir, "not-a-dir.txt"), "hello");
    const valid = join(tempDir, "valid");
    await mkdir(valid);
    await writeFile(
      join(valid, "SKILL.md"),
      `---\nname: valid\nversion: 1.0.0\n---\nValid.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("valid");
  });

  it("throws for non-existent path", async () => {
    const nonExistent = join(tempDir, "nope");
    expect(discoverLinkableSkills(nonExistent)).rejects.toThrow(
      "Path does not exist",
    );
  });

  it("throws for path that is not a directory", async () => {
    const filePath = join(tempDir, "file.txt");
    await writeFile(filePath, "hello");
    expect(discoverLinkableSkills(filePath)).rejects.toThrow(
      "Path is not a directory",
    );
  });

  it("includes dirName in results", async () => {
    const skillDir = join(tempDir, "my-dir-name");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: custom-name\nversion: 1.0.0\n---\nBody.\n`,
    );

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.length).toBe(1);
    expect(skills[0].dirName).toBe("my-dir-name");
    expect(skills[0].name).toBe("custom-name");
  });

  it("returns sorted results by name", async () => {
    const dirs = ["zeta", "alpha", "mid"];
    for (const d of dirs) {
      await mkdir(join(tempDir, d));
      await writeFile(
        join(tempDir, d, "SKILL.md"),
        `---\nname: ${d}\nversion: 1.0.0\n---\n${d} body.\n`,
      );
    }

    const skills = await discoverLinkableSkills(tempDir);
    expect(skills.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
  });
});
