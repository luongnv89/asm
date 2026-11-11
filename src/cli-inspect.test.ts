import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "fs/promises";
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

    const missingMachine = await inspect(["./nope", "--machine"]);
    expect(JSON.parse(missingMachine.stdout).error.code).toBe(
      "SKILL_NOT_FOUND",
    );
    const fileMachine = await inspect(["./local-skill/notes.txt", "--machine"]);
    expect(fileMachine.exitCode).toBe(1);
    expect(JSON.parse(fileMachine.stdout).error.code).toBe(
      "SKILL_PATH_NOT_DIR",
    );
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

  test.skipIf(!POSIX)(
    "a folder under a linked parent is announced without calling it a link",
    async () => {
      await symlink(work, join(root, "work-link"));
      const { stdout, exitCode } = await inspect([
        join(root, "work-link", "local-skill"),
      ]);
      expect(exitCode).toBe(0);
      expect(stdout.split("\n")[0]).toBe(
        `Resolved: ${skillDir} (a parent folder is a symlink; followed)`,
      );
      expect(stdout).toContain("Type: directory");
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

  test("a dot-named installed skill resolves by name when no such path exists", async () => {
    await installSkill(".hidden-skill", "hidden");
    const { stdout, stderr, exitCode } = await inspect([".hidden-skill"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Name: hidden");
    expect(stdout).toContain("Version: 9.9.9");
    expect(stdout).toContain("Tool: Claude Code");
    expect(stdout).not.toContain("not installed");

    const json = JSON.parse(
      (await inspect([".hidden-skill", "--json"])).stdout,
    );
    expect(json).toMatchObject({ dirName: ".hidden-skill", name: "hidden" });

    const missing = await inspect([".no-such-skill"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(`Skill ".no-such-skill" not found.`);
  });

  test("a dot-named folder holding a SKILL.md is the folder, even if installed", async () => {
    await installSkill(".hidden-skill", "hidden");
    const folder = join(work, ".hidden-skill");
    await mkdir(folder);
    await writeFile(
      join(folder, "SKILL.md"),
      "---\nname: hidden-folder\ndescription: d\n---\n\nB\n",
    );
    const { stdout, exitCode } = await inspect([".hidden-skill"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Name: hidden-folder");
    expect(stdout).toContain("Tool: not installed");
    expect(stdout).toContain(`Path: ${folder}`);
  });

  // An installed dot-named skill and something in cwd with the same name that
  // is not a skill folder: the name wins, output identical to an empty cwd.
  const collisions: [string, (p: string) => Promise<unknown>, boolean][] = [
    ["a file", (p) => writeFile(p, "x"), true],
    ["an empty folder", (p) => mkdir(p), true],
    [
      "a folder without SKILL.md",
      async (p) => {
        await mkdir(p);
        await writeFile(join(p, "README.md"), "r");
      },
      true,
    ],
    ["a dangling link", (p) => symlink(join(p, "..", "gone"), p), POSIX],
    [
      "a folder whose SKILL.md is a folder",
      (p) => mkdir(join(p, "SKILL.md"), { recursive: true }),
      true,
    ],
    [
      "a folder whose SKILL.md links outside it",
      async (p) => {
        await writeFile(join(root, "outside.md"), SKILL_MD);
        await mkdir(p);
        await symlink(join(root, "outside.md"), join(p, "SKILL.md"));
      },
      POSIX,
    ],
    [
      "a folder whose SKILL.md is unreadable (mode 000)",
      async (p) => {
        await mkdir(p);
        await writeFile(join(p, "SKILL.md"), SKILL_MD);
        await chmod(join(p, "SKILL.md"), 0o000);
      },
      POSIX && process.getuid?.() !== 0,
    ],
  ];
  for (const [kind, make, run] of collisions) {
    test.skipIf(!run)(
      `an installed dot-named skill resolves by name over ${kind} in cwd`,
      async () => {
        await installSkill(".hidden-skill", "hidden");
        const variants = [[], ["--json"], ["--machine"], ["-s", "global"]];
        const before = [];
        for (const v of variants)
          before.push(await inspect([".hidden-skill", ...v]));
        await make(join(work, ".hidden-skill"));
        for (const [i, v] of variants.entries()) {
          const after = await inspect([".hidden-skill", ...v]);
          expect(after.exitCode).toBe(0);
          expect(after.stderr).toBe(before[i].stderr);
          const strip = (out: string) =>
            out.replace(/"(timestamp|duration_ms)":[^,}]*/g, '"$1":X');
          expect(strip(after.stdout)).toBe(strip(before[i].stdout));
        }
        expect(before[0].stdout).toContain("Tool: Claude Code");
      },
    );
  }

  test("a dot name that is not installed shows the path error for what is there", async () => {
    await writeFile(join(work, ".a-file"), "x");
    const file = await inspect([".a-file"]);
    expect(file.exitCode).toBe(1);
    expect(file.stderr).toContain(`".a-file" is not a folder`);

    await mkdir(join(work, ".an-empty"));
    const empty = await inspect([".an-empty"]);
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain(`No SKILL.md in ${join(work, ".an-empty")}`);
    expect(empty.stderr).not.toContain("not found");
    const machine = await inspect([".an-empty", "--machine"]);
    expect(JSON.parse(machine.stdout).error.code).toBe("SKILL_NOT_FOUND");
    expect(machine.stdout).toContain("No SKILL.md in");
    const fileMachine = await inspect([".a-file", "--machine"]);
    expect(JSON.parse(fileMachine.stdout).error.code).toBe(
      "SKILL_PATH_NOT_DIR",
    );

    await mkdir(join(work, ".md-dir", "SKILL.md"), { recursive: true });
    const mdDir = await inspect([".md-dir"]);
    expect(mdDir.exitCode).toBe(1);
    expect(mdDir.stderr).toContain(
      `${join(work, ".md-dir", "SKILL.md")} is not a regular file or could not be read.`,
    );
  });

  test.skipIf(!POSIX)(
    "a dot name that is not installed, with a SKILL.md linking out, is refused unread",
    async () => {
      await writeFile(
        join(root, "outside.md"),
        "---\nname: OUTSIDE-SECRET-NAME\ndescription: leaked\n---\nBody\n",
      );
      await mkdir(join(work, ".md-out"));
      await symlink(
        join(root, "outside.md"),
        join(work, ".md-out", "SKILL.md"),
      );
      const text = await inspect([".md-out"]);
      expect(text.exitCode).toBe(1);
      expect(text.stderr).toContain("Symlink not read: SKILL.md ->");
      expect(text.stderr).not.toContain("OUTSIDE-SECRET-NAME");
      const machine = await inspect([".md-out", "--machine"]);
      expect(JSON.parse(machine.stdout).error.code).toBe(
        "SKILL_MD_OUTSIDE_LINK",
      );
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "a dot name that is not installed, with an unreadable SKILL.md, says it could not be read",
    async () => {
      const md = join(work, ".md-locked", "SKILL.md");
      await mkdir(join(work, ".md-locked"));
      await writeFile(md, SKILL_MD);
      await chmod(md, 0o000);
      const text = await inspect([".md-locked"]);
      expect(text.exitCode).toBe(1);
      expect(text.stderr).toContain(
        `${md} is not a regular file or could not be read.`,
      );
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "a dot name that is not installed and an unreadable folder says permission denied",
    async () => {
      const locked = join(work, ".locked");
      await mkdir(locked);
      await writeFile(join(locked, "SKILL.md"), SKILL_MD);
      await chmod(locked, 0o000);
      try {
        const text = await inspect([".locked"]);
        expect(text.exitCode).toBe(1);
        expect(text.stderr).toContain(
          `Cannot read ${locked} (permission denied).`,
        );
        const machine = await inspect([".locked", "--machine"]);
        expect(JSON.parse(machine.stdout).error.code).toBe(
          "SKILL_DIR_UNREADABLE",
        );
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "a path whose parent cannot be entered says permission denied",
    async () => {
      const parent = join(work, "p");
      await mkdir(join(parent, "s"), { recursive: true });
      await writeFile(join(parent, "s", "SKILL.md"), SKILL_MD);
      await chmod(parent, 0o600);
      try {
        const text = await inspect(["./p/s"]);
        expect(text.exitCode).toBe(1);
        expect(text.stderr).toContain(
          `Cannot read ${join(parent, "s")} (permission denied).`,
        );
        expect(text.stderr).not.toContain("No folder at");
        const machine = await inspect(["./p/s", "--machine"]);
        expect(JSON.parse(machine.stdout).error.code).toBe(
          "SKILL_DIR_UNREADABLE",
        );
      } finally {
        await chmod(parent, 0o755);
      }
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "an unreadable folder says permission denied, not No SKILL.md",
    async () => {
      const locked = join(work, "locked");
      await mkdir(locked);
      await writeFile(join(locked, "SKILL.md"), SKILL_MD);
      await chmod(locked, 0o000);
      try {
        const text = await inspect(["./locked"]);
        expect(text.exitCode).toBe(1);
        expect(text.stdout).toBe("");
        expect(text.stderr).toContain(
          `Cannot read ${locked} (permission denied).`,
        );
        expect(text.stderr).not.toContain("No SKILL.md");

        const machine = await inspect(["./locked", "--machine"]);
        expect(machine.exitCode).toBe(1);
        expect(JSON.parse(machine.stdout).error.code).toBe(
          "SKILL_DIR_UNREADABLE",
        );
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  test.skipIf(!POSIX)(
    "the Resolved: line and path errors carry no raw control bytes",
    async () => {
      // ESC, BEL, C1 CSI (U+009B) and DEL in folder and link-target names.
      const CTL = "\x1b[31mX\x07\u009b31m\x7f";
      // eslint-disable-next-line no-control-regex
      const RAW = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
      const raw = (text: string) => (text.match(RAW) ?? []).length;

      const ctlDir = join(work, `ctl-${CTL}`);
      await mkdir(ctlDir);
      await writeFile(join(ctlDir, "SKILL.md"), SKILL_MD);
      await symlink(ctlDir, join(work, "via-ctl"));
      const linked = await inspect(["./via-ctl"]);
      expect(linked.exitCode).toBe(0);
      const resolvedLine = linked.stdout.split("\n")[0];
      expect(resolvedLine).toMatch(/^Resolved: /);
      expect(raw(resolvedLine)).toBe(0);

      const empty = join(work, `empty-${CTL}`);
      await mkdir(empty);
      await writeFile(join(work, `file-${CTL}`), "f");
      const outside = join(root, `outside-${CTL}.md`);
      await writeFile(outside, "---\nname: x\n---\n");
      const badMd = join(work, `badmd-${CTL}`);
      await mkdir(badMd);
      await symlink(outside, join(badMd, "SKILL.md"));
      for (const arg of [
        `./missing-${CTL}`,
        `./file-${CTL}`,
        `./empty-${CTL}`,
        `./badmd-${CTL}`,
      ]) {
        const res = await inspect([arg]);
        expect(res.exitCode).toBe(1);
        expect(res.stderr).not.toBe("");
        expect(raw(res.stderr)).toBe(0);
        const machine = await inspect([arg, "--machine"]);
        expect(raw(JSON.parse(machine.stdout).error.message)).toBe(0);
      }
    },
  );
});
