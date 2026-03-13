import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { validateLinkSource, createLink } from "./linker";
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
