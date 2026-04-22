import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateSkillMd, scaffoldSkill, directoryExists } from "./initializer";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

describe("generateSkillMd", () => {
  it("includes name in frontmatter", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain("name: my-skill");
  });

  it("includes default version 0.1.0 in metadata block", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain("metadata:");
    expect(content).toContain("  version: 0.1.0");
  });

  it("includes empty description placeholder", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain('description: ""');
  });

  it("includes license field", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain('license: ""');
  });

  it("includes creator field in metadata block", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain('  creator: ""');
  });

  it("includes body content with heading", () => {
    const content = generateSkillMd("my-skill");
    expect(content).toContain("# my-skill");
    expect(content).toContain("Describe what this skill does");
  });
});

describe("scaffoldSkill", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates directory and writes SKILL.md", async () => {
    const skillDir = join(tempDir, "new-skill");
    await scaffoldSkill("new-skill", skillDir);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: new-skill");
    expect(content).toContain("metadata:");
    expect(content).toContain("  version: 0.1.0");
  });

  it("creates nested directories", async () => {
    const skillDir = join(tempDir, "deep", "nested", "skill");
    await scaffoldSkill("skill", skillDir);
    const exists = await directoryExists(skillDir);
    expect(exists).toBe(true);
  });
});

describe("directoryExists", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns true for existing directory", async () => {
    expect(await directoryExists(tempDir)).toBe(true);
  });

  it("returns false for non-existent path", async () => {
    expect(await directoryExists(join(tempDir, "nope"))).toBe(false);
  });
});
