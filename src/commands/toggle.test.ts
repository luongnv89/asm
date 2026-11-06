import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { reconstructDisabledSkills } from "./toggle";
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
