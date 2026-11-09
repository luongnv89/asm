import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
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
  it("clears the old project entry folded into the global row", async () => {
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
      expect(JSON.parse(await readFile(statePath, "utf-8")).disabled).toEqual(
        {},
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
