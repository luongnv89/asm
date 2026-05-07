import { describe, expect, it } from "vitest";
import { dedupeSkillsByName } from "./skill-dedupe";

type Sample = { name: string; relPath: string };

const make = (name: string, relPath: string): Sample => ({ name, relPath });

describe("dedupeSkillsByName", () => {
  it("returns input unchanged when all names are unique", () => {
    const input = [
      make("foo", "skills/foo"),
      make("bar", ".claude/skills/bar"),
      make("baz", ".agent/skills/baz"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toEqual(input);
    expect(decisions).toEqual([]);
  });

  it("returns empty when input is empty", () => {
    const { kept, decisions } = dedupeSkillsByName([]);
    expect(kept).toEqual([]);
    expect(decisions).toEqual([]);
  });

  it("keeps skills/ over .claude/skills/", () => {
    const input = [
      make("foo", ".claude/skills/foo"),
      make("foo", "skills/foo"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("skills/foo");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].name).toBe("foo");
    expect(decisions[0].kept.root).toBe("skills/");
    expect(decisions[0].dropped).toEqual([
      { relPath: ".claude/skills/foo", root: ".claude/skills/" },
    ]);
    expect(decisions[0].reason).toBe("skills/ priority");
  });

  it("keeps .claude/skills/ over .agent/skills/", () => {
    const input = [
      make("foo", ".agent/skills/foo"),
      make("foo", ".claude/skills/foo"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe(".claude/skills/foo");
    expect(decisions[0].kept.root).toBe(".claude/skills/");
    expect(decisions[0].reason).toBe(".claude/skills/ priority");
  });

  it("treats .agent/skills/ and .agents/skills/ as the same priority tier (first found wins)", () => {
    const inputA = [
      make("foo", ".agent/skills/foo"),
      make("foo", ".agents/skills/foo"),
    ];
    const resA = dedupeSkillsByName(inputA);
    expect(resA.kept).toHaveLength(1);
    expect(resA.kept[0].relPath).toBe(".agent/skills/foo");

    const inputB = [
      make("foo", ".agents/skills/foo"),
      make("foo", ".agent/skills/foo"),
    ];
    const resB = dedupeSkillsByName(inputB);
    expect(resB.kept).toHaveLength(1);
    expect(resB.kept[0].relPath).toBe(".agents/skills/foo");
  });

  it("falls through to first occurrence when no entry matches a priority root", () => {
    const input = [
      make("foo", "custom/dir/foo"),
      make("foo", "another/loc/foo"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("custom/dir/foo");
    expect(decisions[0].kept.root).toBe("(other)");
    expect(decisions[0].reason).toBe("first occurrence (no priority match)");
  });

  it("picks the highest-priority entry across three same-name skills", () => {
    const input = [
      make("foo", ".agent/skills/foo"),
      make("foo", ".claude/skills/foo"),
      make("foo", "skills/foo"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("skills/foo");
    expect(decisions[0].dropped.map((d) => d.relPath).sort()).toEqual([
      ".agent/skills/foo",
      ".claude/skills/foo",
    ]);
  });

  it("preserves unrelated skills when deduping a single colliding name", () => {
    const input = [
      make("alpha", "skills/alpha"),
      make("foo", ".claude/skills/foo"),
      make("beta", ".agent/skills/beta"),
      make("foo", "skills/foo"),
      make("gamma", "custom/gamma"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept.map((s) => s.relPath)).toEqual([
      "skills/alpha",
      "skills/foo",
      ".agent/skills/beta",
      "custom/gamma",
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].name).toBe("foo");
  });

  it("recognizes a top-level repo dir literally named 'skills' (relPath === 'skills')", () => {
    const input = [
      make("foo", ".claude/skills/foo"),
      make("foo", "skills"),
    ];
    const { kept } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("skills");
  });

  it("on a tie within the same priority tier, keeps the first occurrence", () => {
    // Two same-name skills, both under skills/ (priority 1). Tie → first found.
    const input = [
      make("foo", "skills/foo"),
      make("foo", "skills/sub/foo"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("skills/foo");
    expect(decisions[0].kept.root).toBe("skills/");
    expect(decisions[0].dropped[0].relPath).toBe("skills/sub/foo");
  });

  it("does not affect different names that happen to share the same directory", () => {
    const input = [
      make("foo", "skills/foo"),
      make("bar", "skills/bar"),
    ];
    const { kept, decisions } = dedupeSkillsByName(input);
    expect(kept).toEqual(input);
    expect(decisions).toEqual([]);
  });

  it("is idempotent — applying dedupe to its own output yields the same kept set", () => {
    const input = [
      make("foo", ".agent/skills/foo"),
      make("foo", ".claude/skills/foo"),
      make("foo", "skills/foo"),
      make("bar", "skills/bar"),
    ];
    const first = dedupeSkillsByName(input);
    const second = dedupeSkillsByName(first.kept);
    expect(second.kept).toEqual(first.kept);
    expect(second.decisions).toEqual([]);
  });

  it("includes the dropped entry's root classification in the decision record", () => {
    const input = [
      make("foo", "skills/foo"),
      make("foo", ".agents/skills/foo"),
    ];
    const { decisions } = dedupeSkillsByName(input);
    expect(decisions[0].dropped).toEqual([
      { relPath: ".agents/skills/foo", root: ".agents/skills/" },
    ]);
  });

  it("keeps entries from different repos independent (caller-scoped)", () => {
    // Cross-repo isolation is the caller's responsibility — this helper
    // operates on a single repo's input. Verify same-name entries with
    // different relPaths but conceptually-different repos don't dedupe
    // unless the caller mixes them.
    const repoA = [make("foo", "skills/foo")];
    const repoB = [make("foo", "skills/foo")];
    const a = dedupeSkillsByName(repoA);
    const b = dedupeSkillsByName(repoB);
    expect(a.kept).toHaveLength(1);
    expect(b.kept).toHaveLength(1);
    expect(a.decisions).toEqual([]);
    expect(b.decisions).toEqual([]);
  });
});
