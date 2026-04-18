import { describe, expect, it } from "bun:test";
import {
  compareResults,
  findingKey,
  parseCompareArg,
  type CompareOptions,
} from "./compare";
import type { EvalResult } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal `EvalResult` for tests. Overrides are shallow-merged
 * so individual tests can tweak one field at a time without repeating
 * every other default.
 */
function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    providerId: "quality",
    providerVersion: "1.0.0",
    schemaVersion: 1,
    score: 80,
    passed: true,
    categories: [
      { id: "structure", name: "Structure", score: 20, max: 25 },
      { id: "safety", name: "Safety", score: 15, max: 15 },
    ],
    findings: [],
    startedAt: "2026-04-18T12:00:00.000Z",
    durationMs: 100,
    ...overrides,
  };
}

/** Colorless render opts used throughout — ANSI codes make snapshot churn. */
const NO_COLOR: CompareOptions = { useColor: false };

// ─── Header & labels ────────────────────────────────────────────────────────

describe("compareResults header", () => {
  it("uses providerId@providerVersion as default labels", () => {
    const before = makeResult({ providerVersion: "1.0.0" });
    const after = makeResult({ providerVersion: "1.1.0" });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Compare:");
    expect(out).toContain("quality@1.0.0 → quality@1.1.0");
  });

  it("accepts custom before/after labels", () => {
    const before = makeResult();
    const after = makeResult();
    const out = compareResults(before, after, {
      useColor: false,
      beforeLabel: "old",
      afterLabel: "new",
    });
    expect(out).toContain("old → new");
  });
});

// ─── Score & verdict ────────────────────────────────────────────────────────

describe("compareResults score & verdict", () => {
  it("renders an improving score with a '+' delta", () => {
    const before = makeResult({ score: 70 });
    const after = makeResult({ score: 85 });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("70/100 → 85/100");
    expect(out).toContain("+15");
  });

  it("renders a regression with a negative delta", () => {
    const before = makeResult({ score: 85 });
    const after = makeResult({ score: 60 });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("85/100 → 60/100");
    expect(out).toContain("-25");
  });

  it("renders zero delta as '±0' with no change footer", () => {
    const before = makeResult();
    const after = makeResult();
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("±0");
    expect(out).toContain("No differences between versions.");
  });

  it("flags pass → fail as a regression", () => {
    const before = makeResult({ passed: true });
    const after = makeResult({ passed: false });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Verdict:");
    expect(out).toContain("PASS");
    expect(out).toContain("FAIL");
    expect(out).toContain("regression introduced");
  });

  it("flags fail → pass as a regression fixed", () => {
    const before = makeResult({ passed: false });
    const after = makeResult({ passed: true });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("regression fixed");
  });

  it("labels unchanged verdict explicitly", () => {
    const before = makeResult({ passed: true });
    const after = makeResult({ passed: true });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("(unchanged)");
  });
});

// ─── Schema-version mismatch ────────────────────────────────────────────────

describe("compareResults schema mismatch", () => {
  it("emits a warning line when schemaVersion differs", () => {
    const before = makeResult({ schemaVersion: 1 });
    const after = makeResult({ schemaVersion: 2 });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("schema version mismatch: 1 → 2");
  });

  it("stays silent when schemaVersion matches", () => {
    const before = makeResult({ schemaVersion: 1 });
    const after = makeResult({ schemaVersion: 1 });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).not.toContain("schema version mismatch");
  });
});

// ─── Categories ─────────────────────────────────────────────────────────────

describe("compareResults categories", () => {
  it("shows per-category deltas for changed scores", () => {
    const before = makeResult({
      categories: [{ id: "structure", name: "Structure", score: 20, max: 25 }],
    });
    const after = makeResult({
      categories: [{ id: "structure", name: "Structure", score: 25, max: 25 }],
    });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Categories:");
    expect(out).toContain("Structure");
    expect(out).toContain("20/25 → 25/25");
    expect(out).toContain("+5");
  });

  it("flags added categories with (new)", () => {
    const before = makeResult({ categories: [] });
    const after = makeResult({
      categories: [{ id: "safety", name: "Safety", score: 10, max: 10 }],
    });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Safety");
    expect(out).toContain("(new)");
  });

  it("flags removed categories with (removed)", () => {
    const before = makeResult({
      categories: [{ id: "legacy", name: "Legacy", score: 5, max: 10 }],
    });
    const after = makeResult({ categories: [] });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Legacy");
    expect(out).toContain("(removed)");
  });

  it("omits the Categories block when nothing changed", () => {
    const cats = [{ id: "x", name: "X", score: 5, max: 5 }];
    const before = makeResult({ categories: cats });
    const after = makeResult({ categories: cats });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).not.toContain("Categories:");
  });
});

// ─── Findings ───────────────────────────────────────────────────────────────

describe("compareResults findings", () => {
  it("lists added findings with a '+' marker", () => {
    const before = makeResult({ findings: [] });
    const after = makeResult({
      findings: [
        { severity: "warning", message: "new warning", code: "new-code" },
      ],
    });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("Findings:");
    expect(out).toContain("+ [warn]");
    expect(out).toContain("new warning");
    expect(out).toContain("new-code");
  });

  it("lists removed findings with a '-' marker", () => {
    const before = makeResult({
      findings: [
        { severity: "info", message: "stale suggestion", code: "old-code" },
      ],
    });
    const after = makeResult({ findings: [] });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).toContain("- [info]");
    expect(out).toContain("stale suggestion");
  });

  it("keys same-message findings by code so the diff is stable", () => {
    // Same code on both sides = the same finding, even if the message
    // text was edited between versions.
    const before = makeResult({
      findings: [{ severity: "warning", message: "v1 wording", code: "K" }],
    });
    const after = makeResult({
      findings: [{ severity: "warning", message: "v2 wording", code: "K" }],
    });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).not.toContain("Findings:");
  });

  it("falls back to message when no code is present", () => {
    const before = makeResult({
      findings: [{ severity: "info", message: "identical" }],
    });
    const after = makeResult({
      findings: [{ severity: "info", message: "identical" }],
    });
    const out = compareResults(before, after, NO_COLOR);
    expect(out).not.toContain("Findings:");
  });
});

// ─── Key selection ──────────────────────────────────────────────────────────

describe("findingKey", () => {
  it("prefers code when present", () => {
    expect(findingKey({ severity: "info", message: "m", code: "c" })).toBe(
      "code:c",
    );
  });

  it("falls back to message", () => {
    expect(findingKey({ severity: "info", message: "m" })).toBe("msg:m");
  });
});

// ─── parseCompareArg ────────────────────────────────────────────────────────

describe("parseCompareArg", () => {
  it("parses two full id@version specs", () => {
    expect(parseCompareArg("quality@1.0.0,quality@2.0.0")).toEqual([
      { id: "quality", version: "1.0.0" },
      { id: "quality", version: "2.0.0" },
    ]);
  });

  it("inherits id from the first spec for the second", () => {
    expect(parseCompareArg("skillgrade@1.0.0,2.0.0-next")).toEqual([
      { id: "skillgrade", version: "1.0.0" },
      { id: "skillgrade", version: "2.0.0-next" },
    ]);
  });

  it("accepts different provider ids on each side", () => {
    expect(parseCompareArg("quality@1.0.0,skillgrade@1.0.0")).toEqual([
      { id: "quality", version: "1.0.0" },
      { id: "skillgrade", version: "1.0.0" },
    ]);
  });

  it("trims whitespace around specs", () => {
    expect(parseCompareArg("  quality@1.0.0 , quality@2.0.0  ")).toEqual([
      { id: "quality", version: "1.0.0" },
      { id: "quality", version: "2.0.0" },
    ]);
  });

  it("rejects empty input", () => {
    expect(() => parseCompareArg("")).toThrow(/requires two provider specs/);
    expect(() => parseCompareArg("   ")).toThrow(/requires two provider specs/);
  });

  it("rejects a single spec", () => {
    expect(() => parseCompareArg("quality@1.0.0")).toThrow(
      /requires exactly two specs/,
    );
  });

  it("rejects three-plus specs", () => {
    expect(() =>
      parseCompareArg("quality@1.0.0,quality@2.0.0,quality@3.0.0"),
    ).toThrow(/requires exactly two specs/);
  });

  it("rejects a first spec without an id", () => {
    // Bare version in the first position is ambiguous — we require
    // an id on the left so users don't accidentally ask for
    // "1.0.0,2.0.0" of some unknown provider.
    expect(() => parseCompareArg("1.0.0,1.1.0")).toThrow(
      /must be of the form id@version/,
    );
  });

  it("rejects specs with empty id or version", () => {
    expect(() => parseCompareArg("@1.0.0,@2.0.0")).toThrow(
      /both id and version/,
    );
    expect(() => parseCompareArg("quality@,quality@")).toThrow(
      /both id and version/,
    );
  });
});

// ─── Integration smoke test ─────────────────────────────────────────────────

describe("compareResults end-to-end rendering", () => {
  it("produces a self-contained readable diff for mixed changes", () => {
    // A scenario that exercises every diff dimension at once — the
    // headline "demonstrate --compare on a fixture corpus" acceptance.
    const before = makeResult({
      providerVersion: "1.0.0",
      score: 70,
      passed: false,
      categories: [
        { id: "structure", name: "Structure", score: 15, max: 25 },
        { id: "safety", name: "Safety", score: 10, max: 15 },
      ],
      findings: [
        { severity: "warning", message: "missing-frontmatter", code: "mf" },
      ],
      durationMs: 120,
    });
    const after = makeResult({
      providerVersion: "2.0.0",
      score: 90,
      passed: true,
      categories: [
        { id: "structure", name: "Structure", score: 25, max: 25 },
        { id: "safety", name: "Safety", score: 10, max: 15 },
        { id: "prompt", name: "Prompt Engineering", score: 15, max: 20 },
      ],
      findings: [
        { severity: "info", message: "add examples", code: "examples" },
      ],
      durationMs: 250,
    });
    const out = compareResults(before, after, NO_COLOR);

    // All six sections present in the combined render.
    expect(out).toContain("Compare: quality@1.0.0 → quality@2.0.0");
    expect(out).toContain("70/100 → 90/100");
    expect(out).toContain("+20");
    expect(out).toContain("regression fixed");
    expect(out).toContain("duration: 120ms → 250ms");
    expect(out).toContain("Structure");
    expect(out).toContain("15/25 → 25/25");
    expect(out).toContain("Prompt Engineering");
    expect(out).toContain("(new)");
    expect(out).toContain("- [warn]");
    expect(out).toContain("missing-frontmatter");
    expect(out).toContain("+ [info]");
    expect(out).toContain("add examples");
    expect(out).not.toContain("No differences");
  });

  it("emits ANSI codes when useColor is not false", () => {
    const out = compareResults(makeResult(), makeResult(), {});
    // Bold + dim codes from the color palette.
    expect(out).toMatch(/\x1b\[/);
  });
});
