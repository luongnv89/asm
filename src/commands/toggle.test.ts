import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { reconstructDisabledSkills } from "./toggle";
import { createDirSymlink } from "../utils/fs";
import { runCliInProcess } from "../cli-test-harness";
import { getDefaultConfig } from "../config";
import { emptyState, setDisabled, disabledFilePath } from "../skill-state";
import type { AppConfig } from "../utils/types";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "asm-toggle-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("reconstructDisabledSkills creator (#787)", () => {
  it("resolves creator from metadata.author, metadata.creator, or neither", async () => {
    const config: AppConfig = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: root,
          project: join(root, "nonexistent-project"),
          enabled: true,
        },
      ],
      customPaths: [],
    };
    const cases: Array<[string, string, string]> = [
      ["author-only", "metadata:\n  author: luongnv89", "luongnv89"],
      ["both-keys", "metadata:\n  creator: c1\n  author: a1", "c1"],
      ["neither", "effort: low", ""],
    ];
    const state = emptyState();
    for (const [dir, meta] of cases) {
      const skillDir = join(root, dir);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        disabledFilePath(skillDir),
        `---\nname: ${dir}\ndescription: d\n${meta}\n---\n`,
      );
      setDisabled(state, dir, "test", "global");
    }

    const rows = await reconstructDisabledSkills(config, state, "global");
    for (const [dir, , expected] of cases) {
      expect(rows.find((r) => r.dirName === dir)?.creator).toBe(expected);
    }
  });
});

describe("reconstructDisabledSkills SKILL.md.disabled outside the folder (#795)", () => {
  it("never reads a disabled marker that links out of the skill folder", async () => {
    const skillsDir = join(root, "skills");
    const config: AppConfig = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: skillsDir,
          project: join(root, "nonexistent-project"),
          enabled: true,
        },
      ],
      customPaths: [],
    };
    const outsideFile = join(root, "outside-secret.md");
    await writeFile(
      outsideFile,
      "---\nname: outside-name\ndescription: outside-description\nversion: 9.9.9\nmetadata:\n  creator: outside-creator\n---\n",
    );
    const evilDir = join(skillsDir, "evil");
    await mkdir(evilDir, { recursive: true });
    await symlink(outsideFile, disabledFilePath(evilDir));

    const goodDir = join(skillsDir, "good");
    await mkdir(goodDir, { recursive: true });
    await writeFile(
      disabledFilePath(goodDir),
      "---\nname: good-name\ndescription: good-description\n---\n",
    );

    const state = emptyState();
    setDisabled(state, "evil", "test", "global");
    setDisabled(state, "good", "test", "global");

    const rows = await reconstructDisabledSkills(config, state, "global");
    const evil = rows.find((r) => r.dirName === "evil");
    expect(evil).toBeDefined();
    expect(evil!.name).toBe("evil");
    expect(evil!.version).toBe("0.0.0");
    expect(evil!.description).toBe("");
    expect(evil!.creator).toBe("");
    const json = JSON.stringify(evil);
    for (const leaked of [
      "outside-name",
      "outside-description",
      "9.9.9",
      "outside-creator",
    ]) {
      expect(json).not.toContain(leaked);
    }
    expect(evil!.warnings?.map((w) => w.category)).toEqual([
      "skill-md-outside-folder",
    ]);

    const good = rows.find((r) => r.dirName === "good");
    expect(good!.name).toBe("good-name");
    expect(good!.description).toBe("good-description");
    expect(good!.warnings).toBeUndefined();
  });
});

describe("reconstructDisabledSkills project dir that is the global dir (#806)", () => {
  async function disabledSkill(dir: string, name: string): Promise<void> {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(
      disabledFilePath(join(dir, name)),
      `---\nname: ${name}\ndescription: d\n---\n`,
    );
  }

  function configWith(global: string, project: string): AppConfig {
    return {
      ...getDefaultConfig(),
      providers: [
        { name: "claude", label: "Claude", global, project, enabled: true },
      ],
      customPaths: [],
    };
  }

  const rowsOf = (
    rows: Awaited<ReturnType<typeof reconstructDisabledSkills>>,
  ) => rows.map((r) => [r.dirName, r.scope]);

  it("folds old {global,project} state into one global row", async () => {
    const global = join(root, "home", ".claude", "skills");
    await disabledSkill(global, "s1");
    const config = configWith(global, global);
    const state = emptyState();
    setDisabled(state, "s1", "claude", "global");
    setDisabled(state, "s1", "claude", "project");

    expect(
      rowsOf(await reconstructDisabledSkills(config, state, "both")),
    ).toEqual([["s1", "global"]]);
    expect(
      rowsOf(await reconstructDisabledSkills(config, state, "global")),
    ).toEqual([["s1", "global"]]);
    expect(await reconstructDisabledSkills(config, state, "project")).toEqual(
      [],
    );
  });

  it("keeps a skill disabled only as project visible, as global", async () => {
    const global = join(root, "home", ".claude", "skills");
    await disabledSkill(global, "s1");
    const project = join(root, "proj", ".claude", "skills");
    await mkdir(join(root, "proj", ".claude"), { recursive: true });
    await createDirSymlink(global, project);
    const state = emptyState();
    setDisabled(state, "s1", "claude", "project");

    expect(
      rowsOf(
        await reconstructDisabledSkills(
          configWith(global, project),
          state,
          "both",
        ),
      ),
    ).toEqual([["s1", "global"]]);
  });

  it("still lists a real project install as project", async () => {
    const global = join(root, "home", ".claude", "skills");
    const project = join(root, "proj", ".claude", "skills");
    await disabledSkill(global, "s1");
    await disabledSkill(project, "s1");
    const state = emptyState();
    setDisabled(state, "s1", "claude", "global");
    setDisabled(state, "s1", "claude", "project");

    expect(
      rowsOf(
        await reconstructDisabledSkills(
          configWith(global, project),
          state,
          "both",
        ),
      ),
    ).toEqual([
      ["s1", "global"],
      ["s1", "project"],
    ]);
  });

  it("uses a precomputed alias set when the caller passes one", async () => {
    const global = join(root, "home", ".claude", "skills");
    const project = join(root, "proj", ".claude", "skills");
    await disabledSkill(global, "s1");
    await disabledSkill(project, "s1");
    const config = configWith(global, project);
    const state = emptyState();
    setDisabled(state, "s1", "claude", "global");
    setDisabled(state, "s1", "claude", "project");

    expect(
      rowsOf(
        await reconstructDisabledSkills(
          config,
          state,
          "both",
          undefined,
          undefined,
          new Set(["claude"]),
        ),
      ),
    ).toEqual([["s1", "global"]]);
  });
});

describe("asm enable with cwd = HOME (#806)", () => {
  it("enables the global row and keeps the project-less entry folded into it", async () => {
    // A fresh home inside the src/test-setup.ts sandbox, never the real home.
    const home = await mkdtemp(join(homedir(), "home-806-enable-"));
    try {
      const skillDir = join(home, ".claude", "skills", "s1");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        disabledFilePath(skillDir),
        "---\nname: s1\ndescription: d\n---\n",
      );
      const statePath = join(
        home,
        ".config",
        "agent-skill-manager",
        "skill-state.json",
      );
      await mkdir(join(statePath, ".."), { recursive: true });
      await writeFile(
        statePath,
        JSON.stringify({
          version: 1,
          disabled: { s1: { claude: { global: true, project: true } } },
        }),
      );

      const res = await runCliInProcess(["enable", "s1", "--yes", "--json"], {
        env: { HOME: home },
        cwd: home,
      });
      expect(res.exitCode).toBe(0);
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      // The old project entry names no project, so it may be another
      // project's: it stays (#813). It is inert here — rows need a marker.
      expect(JSON.parse(await readFile(statePath, "utf-8")).disabled).toEqual({
        s1: { claude: { project: true } },
      });
      const list = await runCliInProcess(
        ["list", "--json", "--tool", "claude"],
        { env: { HOME: home }, cwd: home },
      );
      expect(
        (JSON.parse(list.stdout) as Array<{ name: string; disabled?: boolean }>)
          .filter((s) => s.name === "s1")
          .map((s) => s.disabled === true),
      ).toEqual([false]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("enable/disable state keyed by project (#813)", () => {
  // Every home is a fresh dir inside the src/test-setup.ts sandbox, never the
  // real home; the HOME override keeps state under <home>/.config.
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(homedir(), "home-813-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function installSkill(skillsDir: string): Promise<string> {
    const skillDir = join(skillsDir, "s1");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: s1\ndescription: d\n---\n",
    );
    return skillDir;
  }

  const statePath = () =>
    join(home, ".config", "agent-skill-manager", "skill-state.json");

  const asm = (cwd: string, ...argv: string[]) =>
    runCliInProcess(argv, { env: { HOME: home }, cwd });

  async function listed(cwd: string): Promise<Array<[string, boolean]>> {
    const res = await asm(cwd, "list", "--json", "--tool", "claude");
    expect(res.exitCode).toBe(0);
    return (
      JSON.parse(res.stdout) as Array<{
        name: string;
        scope: string;
        disabled?: boolean;
      }>
    )
      .filter((s) => s.name === "s1")
      .map((s): [string, boolean] => [s.scope, s.disabled === true])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  const isDisabledOnDisk = (skillDir: string) =>
    existsSync(join(skillDir, "SKILL.md.disabled")) &&
    !existsSync(join(skillDir, "SKILL.md"));

  async function setup() {
    const global = await installSkill(join(home, ".claude", "skills"));
    const proj13 = join(home, "proj13");
    const proj14 = join(home, "proj14");
    const p13 = await installSkill(join(proj13, ".claude", "skills"));
    const p14 = await installSkill(join(proj14, ".claude", "skills"));
    for (const cwd of [home, proj13, proj14]) {
      expect((await asm(cwd, "disable", "s1", "--yes")).exitCode).toBe(0);
    }
    expect([global, p13, p14].every(isDisabledOnDisk)).toBe(true);
    return { global, proj13, proj14, p13, p14 };
  }

  it("enable from $HOME leaves every project's disabled entry and file alone", async () => {
    const { global, proj13, proj14, p13, p14 } = await setup();

    expect((await asm(home, "enable", "s1", "--yes")).exitCode).toBe(0);

    expect(isDisabledOnDisk(global)).toBe(false);
    expect(isDisabledOnDisk(p13)).toBe(true);
    expect(isDisabledOnDisk(p14)).toBe(true);
    expect(await listed(home)).toEqual([["global", false]]);
    expect(await listed(proj13)).toEqual(
      expect.arrayContaining([["project", true]]),
    );
    expect(await listed(proj14)).toEqual(
      expect.arrayContaining([["project", true]]),
    );
  });

  it("enable --scope project from one project enables that project's copy only", async () => {
    const { global, proj13, proj14, p13, p14 } = await setup();

    expect(
      (await asm(proj13, "enable", "s1", "--scope", "project", "--yes"))
        .exitCode,
    ).toBe(0);

    expect(isDisabledOnDisk(p13)).toBe(false);
    expect(isDisabledOnDisk(p14)).toBe(true);
    expect(isDisabledOnDisk(global)).toBe(true);
    expect(await listed(proj13)).toEqual(
      expect.arrayContaining([
        ["project", false],
        ["global", true],
      ]),
    );
    expect(await listed(proj14)).toEqual(
      expect.arrayContaining([
        ["project", true],
        ["global", true],
      ]),
    );
  });

  it("enable from a project after the global copy is enabled touches that project only", async () => {
    const { global, proj13, p13, p14 } = await setup();
    expect((await asm(home, "enable", "s1", "--yes")).exitCode).toBe(0);

    expect((await asm(proj13, "enable", "s1", "--yes")).exitCode).toBe(0);

    expect(isDisabledOnDisk(global)).toBe(false);
    expect(isDisabledOnDisk(p13)).toBe(false);
    expect(isDisabledOnDisk(p14)).toBe(true);
  });

  it("records each project by the real path of its skills dir", async () => {
    const { proj13, proj14 } = await setup();
    const state = JSON.parse(await readFile(statePath(), "utf-8"));
    expect(state.disabled.s1.claude.global).toBe(true);
    expect(state.disabled.s1.claude.project).toBeUndefined();
    expect([...state.disabled.s1.claude.projectDirs].sort()).toEqual(
      [
        await realpath(join(proj13, ".claude", "skills")),
        await realpath(join(proj14, ".claude", "skills")),
      ].sort(),
    );
  });

  it("enabling every copy returns the state to empty", async () => {
    const { proj13, proj14 } = await setup();
    for (const cwd of [home, proj13, proj14]) {
      expect((await asm(cwd, "enable", "s1", "--yes")).exitCode).toBe(0);
    }
    expect(JSON.parse(await readFile(statePath(), "utf-8")).disabled).toEqual(
      {},
    );
  });

  it("reads an old project-less entry as an unknown project", async () => {
    const global = await installSkill(join(home, ".claude", "skills"));
    const proj13 = join(home, "proj13");
    const p13 = await installSkill(join(proj13, ".claude", "skills"));
    for (const dir of [global, p13]) {
      await rename(join(dir, "SKILL.md"), join(dir, "SKILL.md.disabled"));
    }
    await mkdir(join(statePath(), ".."), { recursive: true });
    await writeFile(
      statePath(),
      JSON.stringify({
        version: 1,
        disabled: { s1: { claude: { global: true, project: true } } },
      }),
    );

    expect((await asm(home, "enable", "s1", "--yes")).exitCode).toBe(0);
    expect(isDisabledOnDisk(global)).toBe(false);
    expect(isDisabledOnDisk(p13)).toBe(true);
    expect(await listed(proj13)).toEqual([
      ["global", false],
      ["project", true],
    ]);

    expect((await asm(proj13, "enable", "s1", "--yes")).exitCode).toBe(0);
    expect(isDisabledOnDisk(p13)).toBe(false);
    expect(JSON.parse(await readFile(statePath(), "utf-8")).disabled).toEqual(
      {},
    );
  });
});
