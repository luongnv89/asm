import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getDefaultConfig } from "./config";
import { DEFAULT_MAX_DEPTH, locateSkills } from "./skill-locator";
import { createDirSymlink } from "./utils/fs";

// Each test gets its own HOME (global dirs) and a separate walk tree.
let base: string;
let home: string;
let tree: string;
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

async function writeSkill(dir: string, name: string, description = "") {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description || `${name} skill`}\n---\n\n# ${name}\n`,
  );
}

/** Install `name` as a project-local Claude Code skill under `projectRoot`. */
async function projectSkill(projectRoot: string, name: string) {
  await writeSkill(join(projectRoot, ".claude", "skills", name), name);
}

const names = (results: Awaited<ReturnType<typeof locateSkills>>) =>
  results.map((r) => r.skill.name).sort();

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "asm-locator-"));
  home = join(base, "home");
  tree = join(base, "tree");
  await mkdir(home, { recursive: true });
  await mkdir(tree, { recursive: true });
  savedHome = process.env.HOME;
  savedUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  process.env.USERPROFILE = savedUserProfile;
  await rm(base, { recursive: true, force: true });
});

describe("locateSkills (issue #735)", () => {
  test("without a root, returns only global installs", async () => {
    await writeSkill(join(home, ".claude", "skills", "g1"), "g1");
    await writeSkill(join(home, ".agents", "skills", "g2"), "g2");
    await projectSkill(join(tree, "projA"), "p1");

    const results = await locateSkills(getDefaultConfig());

    expect(names(results)).toEqual(["g1", "g2"]);
    for (const r of results) {
      expect(r.projectRoot).toBeNull();
      expect(r.skill.scope).toBe("global");
    }
  });

  test("with a root, also finds project-local installs below it", async () => {
    await writeSkill(join(home, ".claude", "skills", "g1"), "g1");
    const projA = join(tree, "a", "b", "projA");
    await projectSkill(projA, "p1");
    const projB = join(tree, "projB");
    await writeSkill(join(projB, ".agents", "skills", "p2"), "p2");

    const results = await locateSkills(getDefaultConfig(), { root: tree });

    expect(names(results)).toEqual(["g1", "p1", "p2"]);
    const p1 = results.find((r) => r.skill.name === "p1")!;
    expect(p1.projectRoot).toBe(projA);
    expect(p1.skill.scope).toBe("project");
    expect(p1.skill.provider).toBe("claude");
    expect(p1.skill.location).toBe("project-claude");
    expect(p1.skill.path).toBe(join(projA, ".claude", "skills", "p1"));
    const p2 = results.find((r) => r.skill.name === "p2")!;
    expect(p2.projectRoot).toBe(projB);
    expect(p2.skill.provider).toBe("agents");
  });

  test("finds a project at the depth limit but not one level deeper", async () => {
    const levels = (n: number, tag: string) =>
      join(tree, ...Array.from({ length: n }, (_, i) => `${tag}${i}`));
    await projectSkill(levels(DEFAULT_MAX_DEPTH, "d"), "at-limit");
    await projectSkill(levels(DEFAULT_MAX_DEPTH + 1, "e"), "too-deep");
    await projectSkill(tree, "at-root");

    const results = await locateSkills(getDefaultConfig(), { root: tree });

    expect(names(results)).toEqual(["at-limit", "at-root"]);
  });

  test("the same skill in two projects yields two results", async () => {
    const projA = join(tree, "projA");
    const projB = join(tree, "projB");
    const projC = join(tree, "projC");
    await projectSkill(projA, "shared");
    await projectSkill(projB, "shared");
    await mkdir(join(projC, ".claude", "skills"), { recursive: true });
    await createDirSymlink(
      join(projA, ".claude", "skills", "shared"),
      join(projC, ".claude", "skills", "shared"),
    );

    const results = await locateSkills(getDefaultConfig(), { root: tree });

    expect(results.map((r) => r.projectRoot).sort()).toEqual([
      projA,
      projB,
      projC,
    ]);
  });

  test("does not descend into node_modules, .git, or symlinked dirs", async () => {
    await projectSkill(join(tree, "node_modules", "pkg"), "in-node-modules");
    await projectSkill(join(tree, ".git", "x"), "in-git");
    const outside = join(base, "outside");
    await projectSkill(join(outside, "proj"), "behind-symlink");
    await createDirSymlink(outside, join(tree, "link"));
    await projectSkill(join(tree, "real"), "real");

    const results = await locateSkills(getDefaultConfig(), { root: tree });

    expect(names(results)).toEqual(["real"]);
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips unreadable directories without throwing",
    async () => {
      const locked = join(tree, "locked");
      await projectSkill(join(locked, "proj"), "hidden");
      await projectSkill(join(tree, "open"), "visible");
      await chmod(locked, 0o000);
      try {
        const results = await locateSkills(getDefaultConfig(), { root: tree });
        expect(names(results)).toEqual(["visible"]);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  test("provider dirs directly under HOME are reported once, as global", async () => {
    await writeSkill(join(home, ".claude", "skills", "g1"), "g1");
    await writeSkill(join(home, ".zed", "rules", "z1"), "z1");
    await projectSkill(join(home, "work", "projA"), "p1");

    const results = await locateSkills(getDefaultConfig(), { root: home });

    expect(names(results)).toEqual(["g1", "p1", "z1"]);
    const g1 = results.filter((r) => r.skill.name === "g1");
    expect(g1).toHaveLength(1);
    expect(g1[0].projectRoot).toBeNull();
    const z1 = results.find((r) => r.skill.name === "z1")!;
    expect(z1.projectRoot).toBeNull();
    expect(z1.skill.scope).toBe("global");
    expect(z1.skill.location).toBe("global-zed");
    const p1 = results.find((r) => r.skill.name === "p1")!;
    expect(p1.projectRoot).toBe(join(home, "work", "projA"));
  });

  test("a root that reaches HOME through a symlink does not duplicate global dirs", async () => {
    await writeSkill(join(home, ".claude", "skills", "g1"), "g1");
    const link = join(base, "home-link");
    await createDirSymlink(home, link);

    const results = await locateSkills(getDefaultConfig(), { root: link });

    expect(names(results)).toEqual(["g1"]);
    expect(results[0].skill.path).toBe(join(home, ".claude", "skills", "g1"));
  });
});
