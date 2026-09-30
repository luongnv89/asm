import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addSkillTags,
  applySkillTagState,
  effectiveSkillTags,
  emptySkillTagState,
  loadSkillTagState,
  matchesAllTags,
  parseTagInputs,
  removeSkillTags,
  saveSkillTagState,
} from "./skill-tags";
import type { SkillInfo } from "./utils/types";

function skill(realPath: string, tags: string[] = []): SkillInfo {
  return {
    name: "example",
    version: "1.0.0",
    description: "",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    tags,
    dirName: "example",
    path: realPath,
    originalPath: realPath,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath,
  };
}

describe("skill tag parsing and filtering", () => {
  it("accepts repeatable and comma-separated tag values", () => {
    expect(parseTagInputs(["CLI,testing", "frontend"])).toEqual({
      tags: ["cli", "testing", "frontend"],
      invalid: [],
    });
  });

  it("reports empty and malformed tag values", () => {
    expect(parseTagInputs(["cli,,bad tag"]).invalid).toEqual(["", "bad tag"]);
  });

  it("matches multiple tags with AND semantics", () => {
    expect(matchesAllTags(["CLI", "testing"], ["cli", "TESTING"])).toBe(true);
    expect(matchesAllTags(["cli"], ["cli", "testing"])).toBe(false);
  });
});

describe("skill tag overlay edits", () => {
  it("merges normalized additions with authoritative frontmatter tags", () => {
    const state = emptySkillTagState();
    expect(
      addSkillTags(state, "/skills/example", ["CLI"], ["Testing", "cli"]),
    ).toEqual(["cli", "testing"]);
    expect(state.skills["/skills/example"]).toEqual({
      added: ["testing"],
      removed: [],
    });
  });

  it("removes frontmatter tags with tombstones and restores them on add", () => {
    const state = emptySkillTagState();
    expect(
      removeSkillTags(state, "/skills/example", ["cli", "testing"], ["CLI"]),
    ).toEqual(["testing"]);
    expect(state.skills["/skills/example"].removed).toEqual(["cli"]);

    expect(
      addSkillTags(state, "/skills/example", ["cli", "testing"], ["cli"]),
    ).toEqual(["cli", "testing"]);
    expect(state.skills).toEqual({});
  });

  it("removes local additions and prunes empty entries", () => {
    const state = emptySkillTagState();
    addSkillTags(state, "/skills/example", [], ["frontend"]);
    expect(removeSkillTags(state, "/skills/example", [], ["frontend"])).toEqual(
      [],
    );
    expect(state.skills).toEqual({});
  });

  it("applies independent overlays to canonical skill identities", () => {
    const first = skill("/skills/one", ["cli"]);
    const second = skill("/skills/two", ["cli"]);
    const state = emptySkillTagState();
    addSkillTags(state, first.realPath, first.tags, ["testing"]);
    removeSkillTags(state, second.realPath, second.tags, ["cli"]);

    applySkillTagState([first, second], state);
    expect(first.tags).toEqual(["cli", "testing"]);
    expect(second.tags).toEqual([]);
  });

  it("treats missing overlays as normalized frontmatter-only tags", () => {
    expect(effectiveSkillTags(["CLI", "cli"], undefined)).toEqual(["cli"]);
  });
});

describe("skill tag state persistence", () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "asm-skill-tags-"));
    statePath = join(dir, "skill-tags.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty state for a missing file", async () => {
    await expect(loadSkillTagState(statePath)).resolves.toEqual({
      version: 1,
      skills: {},
    });
  });

  it("persists edits across loads", async () => {
    const state = emptySkillTagState();
    addSkillTags(state, "/skills/example", ["cli"], ["testing"]);
    removeSkillTags(state, "/skills/example", ["cli"], ["cli"]);
    await saveSkillTagState(state, statePath);

    const loaded = await loadSkillTagState(statePath);
    expect(loaded).toEqual(state);
    expect(await readFile(statePath, "utf-8")).toMatch(/"testing"/);
  });

  it("normalizes valid entries while loading", async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        skills: {
          "/skills/example": {
            added: ["CLI", "cli", 7],
            removed: ["Testing", null],
          },
          empty: { added: [], removed: [] },
        },
      }),
    );
    await expect(loadSkillTagState(statePath)).resolves.toEqual({
      version: 1,
      skills: {
        "/skills/example": { added: ["cli"], removed: ["testing"] },
      },
    });
  });

  it("backs up malformed state and starts empty", async () => {
    await writeFile(statePath, "{not-json", "utf-8");
    await expect(loadSkillTagState(statePath)).resolves.toEqual({
      version: 1,
      skills: {},
    });
    await expect(access(`${statePath}.bak`)).resolves.toBeUndefined();
  });
});
