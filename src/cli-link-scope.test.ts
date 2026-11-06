import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  lstat,
  readlink,
  readFile,
  realpath,
  symlink,
} from "fs/promises";
import { tmpdir, homedir } from "os";
import { runCliInProcess } from "./cli-test-harness";
import { createDirSymlink } from "./utils/fs";

// `asm link` scope behaviour — issue #800 / beads asm-10c.
//
// `asm link` is "activate without a library": it takes a local path and
// links it into a provider directory. These tests cover the scope routing
// (global / project / local / both), the activate-compatible overwrite
// contract, and the JSON payload shapes.

const GLOBAL_DIR = join(homedir(), ".claude", "skills");

describe("CLI integration: link scope", () => {
  let tempDir: string;
  let projectDir: string;
  let sourceDir: string;
  let created: string[];

  beforeEach(async () => {
    // realpath() mirrors what the command sees: process.cwd() returns the
    // canonical path (macOS /var is a symlink to /private/var).
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "asm-link-scope-")));
    projectDir = join(tempDir, "project");
    sourceDir = join(tempDir, "source-skill");
    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      `---\nname: source-skill\nversion: 1.0.0\n---\n# Source Skill\n`,
    );
    created = [];
  });

  afterEach(async () => {
    for (const path of created) {
      await rm(path, { force: true, recursive: true }).catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const globalLink = (name: string) => join(GLOBAL_DIR, name);
  const projectLink = (name: string) =>
    join(projectDir, ".claude", "skills", name);

  async function exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch {
      return false;
    }
  }

  test("omitted scope keeps the historical global destination", async () => {
    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.scope).toBe("global");
    expect(result.path).toBe(globalLink("source-skill"));
    expect(await exists(globalLink("source-skill"))).toBe(true);
    expect(await exists(projectLink("source-skill"))).toBe(false);
    created.push(globalLink("source-skill"));
  });

  test("-s project links into the current directory and leaves global untouched", async () => {
    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "-s", "project", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.scope).toBe("project");
    expect(result.path).toBe(projectLink("source-skill"));
    expect(await exists(projectLink("source-skill"))).toBe(true);
    expect(await exists(globalLink("source-skill"))).toBe(false);
    created.push(projectLink("source-skill"));
  });

  test("-s local is an alias for project", async () => {
    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "-s", "local", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.scope).toBe("project");
    expect(await exists(projectLink("source-skill"))).toBe(true);
    expect(await exists(globalLink("source-skill"))).toBe(false);
    created.push(projectLink("source-skill"));
  });

  test("-s global is explicit and links globally only", async () => {
    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "-s", "global", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.scope).toBe("global");
    expect(await exists(globalLink("source-skill"))).toBe(true);
    expect(await exists(projectLink("source-skill"))).toBe(false);
    created.push(globalLink("source-skill"));
  });

  test("-s both creates a global and a project link", async () => {
    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "-s", "both", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    // Explicit both is a bulk result even for a single skill.
    expect(result.success).toBe(true);
    expect(result.linked.length).toBe(2);
    expect(result.linked.map((l: { scope: string }) => l.scope).sort()).toEqual(
      ["global", "project"],
    );
    for (const entry of result.linked) {
      expect(entry.provider).toBe("claude");
      expect(entry.name).toBe("source-skill");
      expect(entry.skill).toBe("source-skill");
      expect(entry.target).toBe(sourceDir);
    }
    expect(await exists(globalLink("source-skill"))).toBe(true);
    expect(await exists(projectLink("source-skill"))).toBe(true);
    created.push(globalLink("source-skill"), projectLink("source-skill"));
  });

  test("an existing target is not replaced without --force", async () => {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await mkdir(globalLink("source-skill"), { recursive: true });
    created.push(globalLink("source-skill"));

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(1);
    // In JSON mode the failure is reported in the payload.
    expect(JSON.parse(res.stdout).error).toContain("already exists");
    // The real directory is untouched.
    expect((await lstat(globalLink("source-skill"))).isDirectory()).toBe(true);
  });

  test("--force replaces an existing symlink", async () => {
    const otherSource = join(tempDir, "other-skill");
    await mkdir(otherSource, { recursive: true });
    await writeFile(
      join(otherSource, "SKILL.md"),
      `---\nname: other-skill\nversion: 1.0.0\n---\n# Other\n`,
    );
    await mkdir(GLOBAL_DIR, { recursive: true });
    await createDirSymlink(otherSource, globalLink("source-skill"));
    created.push(globalLink("source-skill"));

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--force", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    expect(await readlink(globalLink("source-skill"))).toBe(sourceDir);
  });

  test("--force never overwrites a real directory and keeps its contents", async () => {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await mkdir(globalLink("source-skill"), { recursive: true });
    await writeFile(join(globalLink("source-skill"), "keep.txt"), "precious");
    created.push(globalLink("source-skill"));

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--force", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout).error).toContain(
      "Refusing to overwrite non-symlink target",
    );
    expect((await lstat(globalLink("source-skill"))).isDirectory()).toBe(true);
    expect(
      await readFile(join(globalLink("source-skill"), "keep.txt"), "utf-8"),
    ).toBe("precious");
  });

  test.skipIf(process.platform === "win32")(
    "a dangling symlink is an existing target and --force replaces it",
    async () => {
      await mkdir(GLOBAL_DIR, { recursive: true });
      const dangling = join(tempDir, "gone");
      await symlink(dangling, globalLink("source-skill"));
      created.push(globalLink("source-skill"));

      const withoutForce = await runCliInProcess(
        ["link", sourceDir, "-p", "claude", "--json"],
        { cwd: projectDir },
      );
      expect(withoutForce.exitCode).toBe(1);
      expect(JSON.parse(withoutForce.stdout).error).toContain("already exists");

      const withForce = await runCliInProcess(
        ["link", sourceDir, "-p", "claude", "--force", "--json"],
        { cwd: projectDir },
      );
      expect(withForce.exitCode).toBe(0);
      expect(await readlink(globalLink("source-skill"))).toBe(sourceDir);
    },
  );

  test("linking the same source twice needs --force", async () => {
    const first = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(first.exitCode).toBe(0);
    created.push(globalLink("source-skill"));

    const second = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(second.exitCode).toBe(1);
    expect(JSON.parse(second.stdout).error).toContain("already exists");

    const forced = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--force", "--json"],
      { cwd: projectDir },
    );
    expect(forced.exitCode).toBe(0);
    expect(await readlink(globalLink("source-skill"))).toBe(sourceDir);
  });

  test("both scopes execute independently: one conflict still links the other", async () => {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await mkdir(globalLink("source-skill"), { recursive: true });
    created.push(globalLink("source-skill"));

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "-s", "both", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(1);

    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(false);
    // The project link succeeded even though the global target conflicted.
    expect(result.linked.length).toBe(1);
    expect(result.linked[0].scope).toBe("project");
    expect(result.linked[0].path).toBe(projectLink("source-skill"));
    expect(result.failures.length).toBe(1);
    expect(result.failures[0].scope).toBe("global");
    expect(result.failures[0].path).toBe(globalLink("source-skill"));
    expect(result.failures[0].error).toContain("already exists");
    expect(await exists(projectLink("source-skill"))).toBe(true);
    created.push(projectLink("source-skill"));
  });

  test("a single failed link reports {success:false,error}", async () => {
    await mkdir(GLOBAL_DIR, { recursive: true });
    await mkdir(globalLink("source-skill"), { recursive: true });
    created.push(globalLink("source-skill"));

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(1);
    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("project scope applies to a folder of skills as well", async () => {
    const folder = join(tempDir, "skills-folder");
    await mkdir(join(folder, "skill-a"), { recursive: true });
    await mkdir(join(folder, "skill-b"), { recursive: true });
    await writeFile(
      join(folder, "skill-a", "SKILL.md"),
      `---\nname: skill-a\nversion: 1.0.0\n---\n# A\n`,
    );
    await writeFile(
      join(folder, "skill-b", "SKILL.md"),
      `---\nname: skill-b\nversion: 1.0.0\n---\n# B\n`,
    );

    const res = await runCliInProcess(
      ["link", folder, "-p", "claude", "-s", "project", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(true);
    expect(result.linked.length).toBe(2);
    for (const entry of result.linked) {
      expect(entry.scope).toBe("project");
    }
    expect(await exists(projectLink("skill-a"))).toBe(true);
    expect(await exists(projectLink("skill-b"))).toBe(true);
    expect(await exists(globalLink("skill-a"))).toBe(false);
    created.push(projectLink("skill-a"), projectLink("skill-b"));
  });

  test("multiple explicit paths honour the requested scope", async () => {
    const second = join(tempDir, "second-skill");
    await mkdir(second, { recursive: true });
    await writeFile(
      join(second, "SKILL.md"),
      `---\nname: second-skill\nversion: 1.0.0\n---\n# Second\n`,
    );

    const res = await runCliInProcess(
      ["link", sourceDir, second, "-p", "claude", "-s", "project", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(true);
    expect(result.linked.length).toBe(2);
    expect(result.failures.length).toBe(0);
    for (const entry of result.linked) {
      expect(entry.scope).toBe("project");
    }
    created.push(projectLink("source-skill"), projectLink("second-skill"));
  });

  test("a single missing path reports {success:false,error} in JSON mode", async () => {
    const res = await runCliInProcess(
      ["link", join(tempDir, "missing-skill"), "-p", "claude", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(1);
    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No such skill or path");
    // The user gets a polished error, not a Node stack trace.
    expect(res.stderr).not.toMatch(/at discoverLinkableSkills/);
  });

  test("an unsafe --name is a usage error (exit 2) without a stack trace", async () => {
    for (const json of [false, true]) {
      const argv = ["link", sourceDir, "-p", "claude", "--name", ".."];
      if (json) argv.push("--json");
      const res = await runCliInProcess(argv, { cwd: projectDir });
      expect(res.exitCode).toBe(2);
      expect(res.stderr).not.toMatch(/Fatal error/);
      expect(res.stderr).toContain("Invalid skill name");
      if (json) {
        expect(JSON.parse(res.stdout).success).toBe(false);
      }
    }
  });

  test("-s both links every discovered skill in both scopes", async () => {
    const folder = join(tempDir, "both-folder");
    await mkdir(join(folder, "skill-a"), { recursive: true });
    await mkdir(join(folder, "skill-b"), { recursive: true });
    await writeFile(
      join(folder, "skill-a", "SKILL.md"),
      `---\nname: skill-a\nversion: 1.0.0\n---\n# A\n`,
    );
    await writeFile(
      join(folder, "skill-b", "SKILL.md"),
      `---\nname: skill-b\nversion: 1.0.0\n---\n# B\n`,
    );

    const res = await runCliInProcess(
      ["link", folder, "-p", "claude", "-s", "both", "--json"],
      { cwd: projectDir },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.success).toBe(true);
    expect(result.linked.length).toBe(4);
    expect(result.linked.map((l: { scope: string }) => l.scope).sort()).toEqual(
      ["global", "global", "project", "project"],
    );
    created.push(
      globalLink("skill-a"),
      globalLink("skill-b"),
      projectLink("skill-a"),
      projectLink("skill-b"),
    );
  });

  test("global scope still works when a provider has no project path", async () => {
    // A hand-written config may omit `project`; the historical global
    // behaviour must not start crashing because scope handling now exists.
    const configDir = join(tempDir, "config");
    const customGlobal = join(tempDir, "custom-global");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        providers: [
          {
            name: "minimal",
            label: "Minimal",
            global: customGlobal,
            enabled: true,
          },
        ],
      }),
    );

    const res = await runCliInProcess(
      ["link", sourceDir, "-p", "minimal", "--json"],
      { cwd: projectDir, env: { ASM_CONFIG_DIR: configDir } },
    );
    expect(res.exitCode).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.scope).toBe("global");
    expect(result.path).toBe(join(customGlobal, "source-skill"));
    created.push(join(customGlobal, "source-skill"));
  });
});
