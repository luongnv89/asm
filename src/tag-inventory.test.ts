import { describe, expect, it } from "vitest";
import {
  buildTagInventory,
  type MissingSkillRecord,
  type TagInventoryInput,
  type TagInventorySkill,
} from "./tag-inventory";
import type { SkillTagStateFile } from "./utils/types";

function skill(realPath: string, tags: string[] = []): TagInventorySkill {
  return { realPath, tags };
}

function emptyState(): SkillTagStateFile {
  return { version: 1, skills: {} };
}

function state(skills: SkillTagStateFile["skills"]): SkillTagStateFile {
  return { version: 1, skills };
}

function missing(realPath: string, tags: string[] = []): MissingSkillRecord {
  return { realPath, tags };
}

function input(overrides: Partial<TagInventoryInput> = {}): TagInventoryInput {
  return {
    activated: [],
    libraryOnly: [],
    missing: [],
    state: emptyState(),
    activatedOnly: false,
    scope: "both",
    provider: null,
    ...overrides,
  };
}

describe("tag inventory counts", () => {
  it("counts frontmatter tags per class and deduplicates by realPath", () => {
    const inventory = buildTagInventory(
      input({
        activated: [
          skill("/skills/activated-a", ["docs", "cli"]),
          // Same skill directory, second provider instance: one skill.
          skill("/skills/activated-a", ["docs", "cli"]),
        ],
        libraryOnly: [skill("/skills/library-b", ["docs"])],
        scope: "global",
        provider: "claude",
      }),
    );

    expect(inventory).toMatchObject({
      activatedOnly: false,
      scope: "global",
      provider: "claude",
      tagCount: 2,
      tagSkillPairCount: 3,
      taggedSkillCount: { all: 2, activated: 1, libraryOnly: 1 },
      untaggedSkillCount: { all: 0, activated: 0, libraryOnly: 0 },
      missingRecordCount: 0,
    });
    expect(inventory.tags).toEqual([
      { tag: "docs", all: 2, activated: 1, libraryOnly: 1, missing: 0 },
      { tag: "cli", all: 1, activated: 1, libraryOnly: 0, missing: 0 },
    ]);
  });

  it("adds overlay-added tags to a skill that has no frontmatter tags", () => {
    const overlay = state({
      "/skills/activated-a": { added: ["local-only"], removed: [] },
    });
    const inventory = buildTagInventory(
      input({
        activated: [skill("/skills/activated-a")],
        state: overlay,
      }),
    );

    expect(inventory.taggedSkillCount).toEqual({
      all: 1,
      activated: 1,
      libraryOnly: 0,
    });
    expect(inventory.tags).toEqual([
      {
        tag: "local-only",
        all: 1,
        activated: 1,
        libraryOnly: 0,
        missing: 0,
      },
    ]);
  });

  it("honours removed tombstones for frontmatter tags, including added conflicts", () => {
    const overlay = state({
      "/skills/activated-a": {
        added: ["docs", "extra"],
        removed: ["docs", "cli"],
      },
    });
    const inventory = buildTagInventory(
      input({
        activated: [skill("/skills/activated-a", ["docs", "cli", "testing"])],
        state: overlay,
      }),
    );

    // docs was frontmatter + re-added, but the tombstone wins; cli is hidden.
    expect(inventory.tags.map((row) => row.tag)).toEqual(["extra", "testing"]);
    expect(inventory.tags.every((row) => row.all === 1)).toBe(true);
    expect(inventory.tagSkillPairCount).toBe(2);
  });

  it("counts a shared realPath once with ACTIVATED taking priority", () => {
    const inventory = buildTagInventory(
      input({
        activated: [skill("/skills/shared", ["docs"])],
        libraryOnly: [skill("/skills/shared", ["docs", "library-tag"])],
        missing: [missing("/skills/shared", ["stale-tag"])],
      }),
    );

    expect(inventory.tagCount).toBe(1);
    expect(inventory.tagSkillPairCount).toBe(1);
    expect(inventory.taggedSkillCount).toEqual({
      all: 1,
      activated: 1,
      libraryOnly: 0,
    });
    expect(inventory.missingRecordCount).toBe(0);
    expect(inventory.tags).toEqual([
      { tag: "docs", all: 1, activated: 1, libraryOnly: 0, missing: 0 },
    ]);
  });

  it("keeps tags that exist only on missing records out of ALL", () => {
    const inventory = buildTagInventory(
      input({
        libraryOnly: [skill("/skills/library-a", ["docs"])],
        missing: [missing("/skills/gone", ["legacy", "another"])],
      }),
    );

    expect(inventory.tagCount).toBe(3);
    expect(inventory.tagSkillPairCount).toBe(1);
    expect(inventory.taggedSkillCount).toEqual({
      all: 1,
      activated: 0,
      libraryOnly: 1,
    });
    expect(inventory.missingRecordCount).toBe(1);
    expect(inventory.tags).toEqual([
      { tag: "docs", all: 1, activated: 0, libraryOnly: 1, missing: 0 },
      { tag: "another", all: 0, activated: 0, libraryOnly: 0, missing: 1 },
      { tag: "legacy", all: 0, activated: 0, libraryOnly: 0, missing: 1 },
    ]);
  });

  it("counts missing records rather than missing tags", () => {
    const inventory = buildTagInventory(
      input({
        missing: [
          missing("/skills/gone-a", ["one", "two", "three"]),
          missing("/skills/gone-b"),
        ],
      }),
    );

    expect(inventory.missingRecordCount).toBe(2);
    expect(inventory.tagCount).toBe(3);
    expect(inventory.tagSkillPairCount).toBe(0);
    expect(inventory.taggedSkillCount).toEqual({
      all: 0,
      activated: 0,
      libraryOnly: 0,
    });
    expect(inventory.untaggedSkillCount).toEqual({
      all: 0,
      activated: 0,
      libraryOnly: 0,
    });
  });

  it("counts tagged and untagged skills separately per class", () => {
    const inventory = buildTagInventory(
      input({
        activated: [
          skill("/skills/activated-tagged", ["docs"]),
          skill("/skills/activated-untagged"),
        ],
        libraryOnly: [
          skill("/skills/library-tagged", ["docs"]),
          skill("/skills/library-untagged-a"),
          skill("/skills/library-untagged-b"),
        ],
      }),
    );

    expect(inventory.taggedSkillCount).toEqual({
      all: 2,
      activated: 1,
      libraryOnly: 1,
    });
    expect(inventory.untaggedSkillCount).toEqual({
      all: 3,
      activated: 1,
      libraryOnly: 2,
    });
  });

  it("returns an empty inventory for empty input", () => {
    expect(buildTagInventory(input())).toEqual({
      activatedOnly: false,
      scope: "both",
      provider: null,
      tagCount: 0,
      tagSkillPairCount: 0,
      taggedSkillCount: { all: 0, activated: 0, libraryOnly: 0 },
      untaggedSkillCount: { all: 0, activated: 0, libraryOnly: 0 },
      missingRecordCount: 0,
      tags: [],
    });
  });
});

describe("tag inventory sorting and activated-only mode", () => {
  it("sorts by all desc, then missing desc, then tag name asc", () => {
    const inventory = buildTagInventory(
      input({
        activated: [
          skill("/skills/a-1", ["a"]),
          skill("/skills/a-2", ["a"]),
          skill("/skills/b-1", ["b"]),
          skill("/skills/b-2", ["b"]),
        ],
        libraryOnly: [skill("/skills/y", ["y"]), skill("/skills/z", ["z"])],
        missing: [
          missing("/skills/gone-1", ["y", "z", "m", "n"]),
          missing("/skills/gone-2", ["y", "z", "m", "n"]),
          missing("/skills/gone-3", ["y", "z", "m", "n"]),
          missing("/skills/gone-4", ["m", "n"]),
          missing("/skills/gone-5", ["m", "n"]),
        ],
      }),
    );

    expect(inventory.tags.map((row) => row.tag)).toEqual([
      "a",
      "b",
      "y",
      "z",
      "m",
      "n",
    ]);
    expect(inventory.tags).toEqual([
      { tag: "a", all: 2, activated: 2, libraryOnly: 0, missing: 0 },
      { tag: "b", all: 2, activated: 2, libraryOnly: 0, missing: 0 },
      { tag: "y", all: 1, activated: 0, libraryOnly: 1, missing: 3 },
      { tag: "z", all: 1, activated: 0, libraryOnly: 1, missing: 3 },
      { tag: "m", all: 0, activated: 0, libraryOnly: 0, missing: 5 },
      { tag: "n", all: 0, activated: 0, libraryOnly: 0, missing: 5 },
    ]);
    expect(inventory.tagCount).toBe(6);
    expect(inventory.tagSkillPairCount).toBe(6);
    expect(inventory.missingRecordCount).toBe(5);
  });

  it("breaks all-count ties on missing desc before tag name", () => {
    // `a` and `z` both have all=1; `z` has more missing records, so it must
    // come first even though plain name-ascending would put `a` first.
    const inventory = buildTagInventory(
      input({
        activated: [skill("/skills/one", ["a", "z"])],
        missing: [missing("/gone-1", ["z"]), missing("/gone-2", ["z"])],
      }),
    );

    expect(inventory.tags.map((row) => row.tag)).toEqual(["z", "a"]);
    expect(inventory.tags[0]).toEqual({
      tag: "z",
      all: 1,
      activated: 1,
      libraryOnly: 0,
      missing: 2,
    });
    expect(inventory.tags[1]).toEqual({
      tag: "a",
      all: 1,
      activated: 1,
      libraryOnly: 0,
      missing: 0,
    });
  });

  it("counts only ACTIVATED skills in activated-only mode", () => {
    const inventory = buildTagInventory(
      input({
        activated: [skill("/skills/activated", ["docs"])],
        libraryOnly: [skill("/skills/library", ["docs", "other"])],
        missing: [missing("/skills/gone", ["legacy"])],
        activatedOnly: true,
        scope: "project",
        provider: "codex",
      }),
    );

    expect(inventory).toMatchObject({
      activatedOnly: true,
      scope: "project",
      provider: "codex",
      tagCount: 1,
      tagSkillPairCount: 1,
      taggedSkillCount: { all: 1, activated: 1, libraryOnly: 0 },
      untaggedSkillCount: { all: 0, activated: 0, libraryOnly: 0 },
      missingRecordCount: 0,
    });
    expect(inventory.tags).toEqual([
      { tag: "docs", all: 1, activated: 1, libraryOnly: 0, missing: 0 },
    ]);
  });

  it("still reports untagged activated skills in activated-only mode", () => {
    const inventory = buildTagInventory(
      input({
        activated: [
          skill("/skills/not-tagged"),
          skill("/skills/tagged", ["docs"]),
        ],
        activatedOnly: true,
        scope: "project",
      }),
    );

    expect(inventory.untaggedSkillCount).toEqual({
      all: 1,
      activated: 1,
      libraryOnly: 0,
    });
    expect(inventory.taggedSkillCount).toEqual({
      all: 1,
      activated: 1,
      libraryOnly: 0,
    });
  });
});
