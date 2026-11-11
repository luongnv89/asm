import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runCLI, runCliInProcess } from "./cli-test-harness";

// `asm inspect` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: inspect", () => {
  test("missing skill name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("inspect");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "inspect",
      "zzz-nonexistent-skill-xyz-99999",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("inspect --json returns JSON", async () => {
    // Use a skill likely to exist from list
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return; // skip if no skills

    const { stdout, exitCode } = await runCLI(
      "inspect",
      skills[0].dirName,
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    // Could be object or array depending on number of matches
    if (Array.isArray(data)) {
      expect(data[0]).toHaveProperty("name");
    } else {
      expect(data).toHaveProperty("name");
    }
  });

  test("inspect shows detail fields", async () => {
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return;

    const { stdout, exitCode } = await runCLI("inspect", skills[0].dirName);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(skills[0].dirName);
    expect(stdout).toContain("Version:");
    expect(stdout).toContain("Path:");
  });
});

// `asm inspect <path>`: a skill folder that is not installed (#829).
describe("CLI integration: inspect <path> (#829)", () => {
  const POSIX = process.platform !== "win32";
  let root: string;
  let home: string;
  let work: string;
  let skillDir: string;

  const SKILL_MD = [
    "---",
    "name: local-skill",
    "description: A draft skill",
    "license: MIT",
    "metadata:",
    "  version: 1.2.3",
    "  creator: the-creator",
    "---",
    "",
    "# Local skill",
    "",
    "Body text.",
    "",
  ].join("\n");

  function inspect(args: string[], cwd = work) {
    return runCliInProcess(["inspect", ...args], {
      env: { HOME: home },
      cwd,
    });
  }

  async function installSkill(dirName: string, name: string) {
    const dir = join(home, ".claude", "skills", dirName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Installed copy\nmetadata:\n  version: 9.9.9\n---\n\nBody.\n`,
    );
    return dir;
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "asm-inspect-path-")));
    home = join(root, "home");
    work = join(root, "work");
    skillDir = join(work, "local-skill");
    await mkdir(join(skillDir, "references"), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SKILL_MD);
    await writeFile(join(skillDir, "references", "a.md"), "a");
    await writeFile(join(skillDir, "notes.txt"), "n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("an absolute path prints the installed-skill fields, not installed", async () => {
    const { stdout, stderr, exitCode } = await inspect([skillDir]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Name: local-skill");
    expect(stdout).toContain("Version: 1.2.3");
    expect(stdout).toContain("Creator: the-creator");
    expect(stdout).toContain("License: MIT");
    expect(stdout).toContain("Description: A draft skill");
    expect(stdout).toContain("File Count: 3");
    expect(stdout).toContain("Est. Tokens:");
    expect(stdout).toContain("Tool: not installed");
    expect(stdout).toContain("Scope: not installed");
    expect(stdout).toContain("Location: not installed");
    expect(stdout).toContain("Type: directory");
    expect(stdout).not.toContain("Resolved:");
  });

  test("./relative, ../relative and dir/relative paths resolve against cwd", async () => {
    const dot = await inspect(["./local-skill"]);
    expect(dot.exitCode).toBe(0);
    expect(dot.stdout).toContain("Name: local-skill");

    const up = await inspect(
      ["../../local-skill"],
      join(skillDir, "references"),
    );
    expect(up.exitCode).toBe(0);
    expect(up.stdout).toContain("Name: local-skill");

    const nested = await inspect(["work/local-skill"], root);
    expect(nested.exitCode).toBe(0);
    expect(nested.stdout).toContain("Name: local-skill");

    const here = await inspect(["."], skillDir);
    expect(here.exitCode).toBe(0);
    expect(here.stdout).toContain("Name: local-skill");
  });

  test("--json has the installed-skill shape with installation fields empty", async () => {
    await installSkill("installed-skill", "installed-skill");
    const installed = await inspect(["installed-skill", "--json"]);
    expect(installed.exitCode).toBe(0);
    const installedKeys = Object.keys(JSON.parse(installed.stdout));

    const { stdout, exitCode } = await inspect(["./local-skill", "--json"]);
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Object.keys(data).sort()).toEqual([...installedKeys].sort());
    expect(data).toMatchObject({
      name: "local-skill",
      version: "1.2.3",
      creator: "the-creator",
      license: "MIT",
      dirName: "local-skill",
      path: skillDir,
      originalPath: "./local-skill",
      realPath: skillDir,
      provider: "",
      providerLabel: "",
      location: "",
      scope: null,
      isSymlink: false,
      symlinkTarget: null,
    });
  });

  test("--machine wraps the same data in the v1 envelope", async () => {
    const { stdout, exitCode } = await inspect([skillDir, "--machine"]);
    expect(exitCode).toBe(0);
    const env = JSON.parse(stdout);
    expect(env).toMatchObject({ version: 1, command: "inspect", status: "ok" });
    expect(env.data).toMatchObject({ name: "local-skill", scope: null });
  });

  test("a folder with no SKILL.md is a clear error that does not suggest search", async () => {
    const empty = join(work, "empty");
    await mkdir(empty);
    const { stdout, stderr, exitCode } = await inspect(["./empty"]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(`No SKILL.md in ${empty}`);
    expect(stderr).toContain("needs a skill folder that holds a SKILL.md");
    expect(stderr).not.toContain("asm search");

    const machine = await inspect(["./empty", "--machine"]);
    expect(machine.exitCode).toBe(1);
    expect(JSON.parse(machine.stdout).error.code).toBe("SKILL_NOT_FOUND");
  });

  test("a missing path and a file path are errors that name the path", async () => {
    const missing = await inspect(["./nope"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(`No folder at "./nope"`);
    expect(missing.stderr).not.toContain("asm search");

    const file = await inspect(["./local-skill/notes.txt"]);
    expect(file.exitCode).toBe(1);
    expect(file.stderr).toContain(`"./local-skill/notes.txt" is not a folder`);
  });

  test.skipIf(!POSIX)(
    "a SKILL.md that links outside the folder is refused unread",
    async () => {
      const outside = join(root, "outside.md");
      await writeFile(
        outside,
        "---\nname: OUTSIDE-SECRET-NAME\ndescription: leaked\n---\nBody\n",
      );
      const linked = join(work, "linked-md");
      await mkdir(linked);
      await symlink(outside, join(linked, "SKILL.md"));

      const text = await inspect(["./linked-md"]);
      expect(text.exitCode).toBe(1);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain(
        `Symlink not read: SKILL.md -> ${outside} (file, NOT read)`,
      );
      expect(text.stderr).toContain("asm inspect reads nothing outside");
      expect(text.stderr).not.toContain("OUTSIDE-SECRET-NAME");

      const json = await inspect(["./linked-md", "--json"]);
      expect(json.exitCode).toBe(1);
      expect(json.stdout).toBe("");

      const machine = await inspect(["./linked-md", "--machine"]);
      expect(machine.exitCode).toBe(1);
      const env = JSON.parse(machine.stdout);
      expect(env.status).toBe("error");
      expect(env.error.code).toBe("SKILL_MD_OUTSIDE_LINK");
      expect(machine.stdout).not.toContain("OUTSIDE-SECRET-NAME");
    },
  );

  test.skipIf(!POSIX)(
    "a link inside the folder that leaves it adds 0 to File Count",
    async () => {
      const outsideDir = join(root, "outside-dir");
      await mkdir(outsideDir);
      await writeFile(join(outsideDir, "x.txt"), "x");
      await writeFile(join(outsideDir, "y.txt"), "y");
      await symlink(
        join(root, "outside-dir", "x.txt"),
        join(skillDir, "out-file"),
      );
      await symlink(outsideDir, join(skillDir, "out-dir"));
      // A link that stays inside counts as its target.
      await symlink(join(skillDir, "notes.txt"), join(skillDir, "in-file"));

      const { stdout, exitCode } = await inspect(["./local-skill"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("File Count: 4");
    },
  );

  test.skipIf(!POSIX)(
    "a folder that is itself a link is followed and its real path announced",
    async () => {
      await symlink(skillDir, join(work, "via-link"));
      const { stdout, exitCode } = await inspect(["./via-link"]);
      expect(exitCode).toBe(0);
      expect(stdout.split("\n")[0]).toBe(
        `Resolved: ${skillDir} (target is a symlink; followed)`,
      );
      expect(stdout).toContain("Name: local-skill");
      expect(stdout).toContain("Type: symlink");
      expect(stdout).toContain(`Symlink Target: ${skillDir}`);
      expect(stdout).toContain("File Count: 3");

      const json = JSON.parse((await inspect(["./via-link", "--json"])).stdout);
      expect(json).toMatchObject({
        path: join(work, "via-link"),
        realPath: skillDir,
        isSymlink: true,
        symlinkTarget: skillDir,
      });
    },
  );

  test("a name that is also a folder in cwd resolves as the installed name", async () => {
    await installSkill("local-skill", "installed-twin");
    const byName = await inspect(["local-skill"]);
    expect(byName.exitCode).toBe(0);
    expect(byName.stdout).toContain("installed-twin");
    expect(byName.stdout).toContain("Version: 9.9.9");
    expect(byName.stdout).not.toContain("not installed");

    const byPath = await inspect(["./local-skill"]);
    expect(byPath.exitCode).toBe(0);
    expect(byPath.stdout).toContain("Name: local-skill");
    expect(byPath.stdout).toContain("Tool: not installed");
  });

  test("a bare name with no installation is not found, even if a folder matches", async () => {
    const { stderr, exitCode } = await inspect(["local-skill"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Skill "local-skill" not found.`);
  });
});
