import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeTokenBudget,
  formatTokenBudgetReport,
  median,
} from "./stats-tokens";
import { makeSkill } from "./stats-test-fixtures";
describe("median", () => {
  it("returns 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe("computeTokenBudget", () => {
  it("derives resident cost from the description, not the body", () => {
    const report = computeTokenBudget([
      makeSkill({ description: "hello world", tokenCount: 5000 }),
    ]);
    expect(report.totalResidentTokens).toBe(3);
    expect(report.totalBodyTokens).toBe(5000);
    expect(report.totalResidentTokens).not.toBe(report.totalBodyTokens);
  });

  it("breaks resident and body totals down per provider", () => {
    const report = computeTokenBudget([
      makeSkill({
        dirName: "a",
        provider: "claude",
        providerLabel: "Claude Code",
        description: "aa bb cc",
        tokenCount: 100,
      }),
      makeSkill({
        dirName: "b",
        provider: "codex",
        providerLabel: "Codex",
        description: "dd",
        tokenCount: 40,
      }),
    ]);
    const claude = report.byProvider.find((g) => g.key === "claude");
    const codex = report.byProvider.find((g) => g.key === "codex");
    expect(claude).toMatchObject({
      label: "Claude Code",
      skills: 1,
      residentTokens: 5,
      bodyTokens: 100,
    });
    expect(codex).toMatchObject({
      skills: 1,
      residentTokens: 1,
      bodyTokens: 40,
    });
    // Sorted by resident cost, heaviest first.
    expect(report.byProvider[0].key).toBe("claude");
  });

  it("breaks totals down per scope", () => {
    const report = computeTokenBudget([
      makeSkill({ dirName: "a", scope: "global", description: "a b c" }),
      makeSkill({ dirName: "b", scope: "project", description: "d" }),
    ]);
    const keys = report.byScope.map((g) => g.key).sort();
    expect(keys).toEqual(["global", "project"]);
    expect(report.byScope.find((g) => g.key === "project")!.skills).toBe(1);
  });

  it("ranks the heaviest resident descriptions first", () => {
    const report = computeTokenBudget([
      makeSkill({ name: "small", dirName: "small", description: "a" }),
      makeSkill({
        name: "big",
        dirName: "big",
        description: "one two three four five six",
      }),
    ]);
    expect(report.heaviestResident[0].name).toBe("big");
    expect(report.heaviestResident[0].residentTokens).toBeGreaterThan(
      report.heaviestResident[1].residentTokens,
    );
  });

  it("honours the heaviest-resident limit", () => {
    const skills = Array.from({ length: 5 }, (_, i) =>
      makeSkill({ name: `s${i}`, dirName: `s${i}`, description: "a b c" }),
    );
    expect(computeTokenBudget(skills, 2).heaviestResident).toHaveLength(2);
  });

  it("caps heaviestResident at 10 and reports the untruncated total", () => {
    const skills = Array.from({ length: 11 }, (_, i) =>
      makeSkill({ name: `s${i}`, dirName: `s${i}`, description: "a b c" }),
    );
    const report = computeTokenBudget(skills);
    expect(report.heaviestResident).toHaveLength(10);
    expect(report.heaviestResidentTotal).toBe(11);
    expect(report.heaviestResidentTruncated).toBe(true);
  });

  it("does not mark an exact-limit list as truncated", () => {
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkill({ name: `s${i}`, dirName: `s${i}`, description: "a b c" }),
    );
    const report = computeTokenBudget(skills);
    expect(report.heaviestResident).toHaveLength(10);
    expect(report.heaviestResidentTotal).toBe(10);
    expect(report.heaviestResidentTruncated).toBe(false);
  });

  it("reports zeroes for an empty installed set", () => {
    const report = computeTokenBudget([]);
    expect(report).toMatchObject({
      totalSkills: 0,
      totalResidentTokens: 0,
      totalBodyTokens: 0,
      medianResidentTokens: 0,
      heaviestResidentTotal: 0,
      heaviestResidentTruncated: false,
    });
    expect(report.heaviestResident).toEqual([]);
  });
});

describe("formatTokenBudgetReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });

  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  it("renders every token figure with the `~` approximation prefix", () => {
    const output = formatTokenBudgetReport(
      computeTokenBudget([
        makeSkill({ description: "one two three", tokenCount: 1234 }),
      ]),
    );
    expect(output).toContain("Attention Budget");
    expect(output).toContain("~5 tokens");
    expect(output).toContain("~1.2k tokens");
    // Token totals must never be rendered as disk sizes.
    expect(output).not.toMatch(/\d\s?(KB|MB|GB)/);
  });

  it("right-aligns the heaviest-resident token column", () => {
    // `~9 tokens` and `~11 tokens` differ in width; left-aligning them makes
    // the trailing `(provider, scope)` column ragged in a magnitude ranking.
    const output = formatTokenBudgetReport(
      computeTokenBudget([
        makeSkill({
          name: "big",
          dirName: "big",
          description: "one two three four five six",
        }),
        makeSkill({
          name: "small",
          dirName: "small",
          description: "one two three four five",
        }),
      ]),
    );
    expect(output).toContain("big    ~11 tokens");
    expect(output).toContain("small   ~9 tokens");
  });

  it("handles an empty installed set", () => {
    expect(formatTokenBudgetReport(computeTokenBudget([]))).toContain(
      "  No installed skills.",
    );
  });

  it("mentions hidden heaviest rows when the list is truncated", () => {
    const skills = Array.from({ length: 11 }, (_, i) =>
      makeSkill({ name: `s${i}`, dirName: `s${i}`, description: "a b c" }),
    );
    expect(formatTokenBudgetReport(computeTokenBudget(skills))).toContain(
      "… 1 more not shown — use --json for the full list",
    );
  });
});
