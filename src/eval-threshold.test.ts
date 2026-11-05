import { describe, it, expect } from "vitest";
import {
  checkThresholds,
  countVerdicts,
  describeThresholds,
  formatThresholdSummary,
  formatVerdictLine,
  hasThresholds,
  parseThresholdValue,
  thresholdsJSON,
  thresholdsMachine,
  verdictMachine,
  type EvalThresholds,
} from "./eval-threshold";
import type { EvaluationReport } from "./evaluator-types";

function report(overall: number, scores: Record<string, number>) {
  return {
    skillPath: "/x",
    skillMdPath: "/x/SKILL.md",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    overallScore: overall,
    grade: "B",
    topSuggestions: [],
    frontmatter: {},
    categories: Object.entries(scores).map(([id, score]) => ({
      id,
      name: id.toUpperCase(),
      score,
      max: 10,
      findings: [],
      suggestions: [],
    })),
  } satisfies EvaluationReport;
}

const GATE2: EvalThresholds = { minScore: 86, minCategory: 8 };

describe("parseThresholdValue", () => {
  it("accepts in-range integers and decimals, inclusive of both bounds", () => {
    expect(parseThresholdValue("--min-score", "0")).toEqual({ value: 0 });
    expect(parseThresholdValue("--min-score", "100")).toEqual({ value: 100 });
    expect(parseThresholdValue("--min-score", "85.5")).toEqual({ value: 85.5 });
    expect(parseThresholdValue("--min-category", "10")).toEqual({ value: 10 });
    expect(parseThresholdValue("--min-category", " 8 ")).toEqual({ value: 8 });
  });

  it.each([
    ["--min-score", "101"],
    ["--min-score", "-1"],
    ["--min-score", "abc"],
    ["--min-score", ""],
    ["--min-score", undefined],
    ["--min-score", "Infinity"],
    ["--min-category", "11"],
    ["--min-category", "NaN"],
    ["--min-category", "8x"],
    ["--min-category", "0x8"],
    ["--min-score", "1e1"],
    ["--min-score", "+5"],
  ] as const)("rejects %s %j with a range message", (flag, raw) => {
    const r = parseThresholdValue(flag, raw);
    expect(r).toHaveProperty("error");
    const max = flag === "--min-score" ? 100 : 10;
    expect((r as { error: string }).error).toBe(
      `Invalid ${flag}: "${raw ?? ""}". Must be a number between 0 and ${max}.`,
    );
  });
});

describe("checkThresholds", () => {
  it("passes when no threshold is set", () => {
    const t = { minScore: null, minCategory: null };
    expect(hasThresholds(t)).toBe(false);
    expect(checkThresholds(report(10, { a: 0 }), t)).toEqual({
      passed: true,
      overallBelowMin: false,
      failingCategories: [],
    });
  });

  it("treats --min-score as inclusive", () => {
    const t = { minScore: 86, minCategory: null };
    expect(checkThresholds(report(86, { a: 0 }), t).passed).toBe(true);
    const v = checkThresholds(report(85, { a: 0 }), t);
    expect(v.passed).toBe(false);
    expect(v.overallBelowMin).toBe(true);
    expect(v.failingCategories).toEqual([]);
  });

  it("names every category below --min-category (inclusive)", () => {
    const v = checkThresholds(report(99, { a: 8, b: 7, c: 0 }), {
      minScore: null,
      minCategory: 8,
    });
    expect(v.passed).toBe(false);
    expect(v.overallBelowMin).toBe(false);
    expect(v.failingCategories.map((c) => [c.id, c.score])).toEqual([
      ["b", 7],
      ["c", 0],
    ]);
  });

  it("combines both gates (Gate 2)", () => {
    expect(checkThresholds(report(90, { a: 8, b: 9 }), GATE2).passed).toBe(
      true,
    );
    expect(checkThresholds(report(85, { a: 8 }), GATE2).passed).toBe(false);
    expect(checkThresholds(report(98, { a: 5 }), GATE2).passed).toBe(false);
  });
});

describe("text rendering", () => {
  it("describes only the flags that were set", () => {
    expect(describeThresholds(GATE2)).toBe("min-score 86, min-category 8");
    expect(describeThresholds({ minScore: null, minCategory: 8 })).toBe(
      "min-category 8",
    );
  });

  it("formats PASS and FAIL lines", () => {
    const ok = report(90, { a: 9 });
    expect(formatVerdictLine(ok, checkThresholds(ok, GATE2), GATE2)).toBe(
      "Threshold:        PASS  (min-score 86, min-category 8)",
    );
    const bad = report(53, { a: 9, b: 0, c: 5 });
    expect(formatVerdictLine(bad, checkThresholds(bad, GATE2), GATE2)).toBe(
      "Threshold:        FAIL  overall 53/100 < 86; categories < 8: B (0/10), C (5/10)",
    );
  });

  it("counts verdicts, skipping errored skills, and renders the summary", () => {
    const pass = checkThresholds(report(90, { a: 9 }), GATE2);
    const fail = checkThresholds(report(50, { a: 9 }), GATE2);
    const counts = countVerdicts([
      { label: "one", verdict: pass },
      { label: "two", verdict: fail },
      { label: "broken", verdict: null },
      { label: "three", verdict: fail },
    ]);
    expect(counts).toEqual({
      passed: 1,
      failed: 2,
      failedLabels: ["two", "three"],
    });
    expect(formatThresholdSummary(counts, GATE2)).toBe(
      [
        "  Thresholds:            min-score 86, min-category 8",
        "  Passed:                1/3",
        "  Failed:                2/3  (two, three)",
      ].join("\n"),
    );
    expect(
      formatThresholdSummary(
        { passed: 2, failed: 0, failedLabels: [] },
        { minScore: 0, minCategory: null },
      ),
    ).toContain("  Failed:                0/2");
  });
});

describe("structured shapes", () => {
  it("emits camelCase for --json and snake_case for --machine", () => {
    expect(thresholdsJSON(GATE2)).toEqual({ minScore: 86, minCategory: 8 });
    expect(thresholdsMachine({ minScore: null, minCategory: 8 })).toEqual({
      min_score: null,
      min_category: 8,
    });
    const v = checkThresholds(report(50, { a: 3 }), GATE2);
    expect(verdictMachine(v)).toEqual({
      passed: false,
      overall_below_min: true,
      failing_categories: [{ id: "a", name: "A", score: 3, max: 10 }],
    });
  });
});
