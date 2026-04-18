/**
 * Adapter snapshot + mapping-invariant tests.
 *
 * The adapter is a pure function — every test here feeds in a known
 * skillgrade JSON shape (either a recorded fixture or a hand-crafted
 * micro-shape) and asserts the resulting `EvalResult`.
 *
 * We do NOT touch disk for the runtime path here; that's covered by
 * `index.test.ts`. Snapshot tests that compare against recorded JSON
 * fixtures live in `index.test.ts` so they exercise the provider end to
 * end, not just the adapter in isolation.
 */

import { describe, expect, it } from "bun:test";
import { adaptSkillgradeReport } from "./adapter";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "fixtures");

const DEFAULT_INPUTS = {
  providerId: "skillgrade",
  providerVersion: "1.0.0",
  schemaVersion: 1,
  thresholdFraction: 0.8,
};

describe("adaptSkillgradeReport — identity fields", () => {
  it("stamps providerId / providerVersion / schemaVersion from inputs", () => {
    const r = adaptSkillgradeReport(
      { passRate: 1.0, passed: true },
      {
        ...DEFAULT_INPUTS,
        providerId: "skillgrade",
        providerVersion: "1.2.3",
        schemaVersion: 2,
      },
    );
    expect(r.providerId).toBe("skillgrade");
    expect(r.providerVersion).toBe("1.2.3");
    expect(r.schemaVersion).toBe(2);
  });

  it("leaves startedAt / durationMs as placeholders for the runner", () => {
    const r = adaptSkillgradeReport({ passRate: 0.5 }, DEFAULT_INPUTS);
    expect(r.startedAt).toBe("");
    expect(r.durationMs).toBe(0);
  });
});

describe("adaptSkillgradeReport — score mapping", () => {
  it("multiplies passRate into a 0..100 integer", () => {
    expect(
      adaptSkillgradeReport({ passRate: 0.92 }, DEFAULT_INPUTS).score,
    ).toBe(92);
    expect(adaptSkillgradeReport({ passRate: 1.0 }, DEFAULT_INPUTS).score).toBe(
      100,
    );
    expect(adaptSkillgradeReport({ passRate: 0 }, DEFAULT_INPUTS).score).toBe(
      0,
    );
  });

  it("clamps out-of-range passRate", () => {
    expect(adaptSkillgradeReport({ passRate: 1.5 }, DEFAULT_INPUTS).score).toBe(
      100,
    );
    expect(
      adaptSkillgradeReport({ passRate: -0.2 }, DEFAULT_INPUTS).score,
    ).toBe(0);
  });

  it("defaults to 0 when passRate is missing or non-numeric", () => {
    expect(adaptSkillgradeReport({}, DEFAULT_INPUTS).score).toBe(0);
    expect(
      adaptSkillgradeReport({ passRate: "nope" as any }, DEFAULT_INPUTS).score,
    ).toBe(0);
  });
});

describe("adaptSkillgradeReport — passed resolution", () => {
  it("prefers explicit passed flag over threshold compare", () => {
    const r = adaptSkillgradeReport(
      { passRate: 0.2, passed: true },
      DEFAULT_INPUTS,
    );
    expect(r.passed).toBe(true);
  });

  it("falls back to threshold compare when passed is absent", () => {
    expect(
      adaptSkillgradeReport({ passRate: 0.9 }, DEFAULT_INPUTS).passed,
    ).toBe(true);
    expect(
      adaptSkillgradeReport({ passRate: 0.4 }, DEFAULT_INPUTS).passed,
    ).toBe(false);
  });

  it("is false when both passed and passRate are missing", () => {
    expect(adaptSkillgradeReport({}, DEFAULT_INPUTS).passed).toBe(false);
  });
});

describe("adaptSkillgradeReport — categories", () => {
  it("produces one category per task, using passing/trials directly", () => {
    const r = adaptSkillgradeReport(
      {
        passRate: 0.8,
        tasks: [
          { id: "first", passing: 4, trials: 5, passRate: 0.8 },
          { id: "second", passing: 5, trials: 5, passRate: 1.0 },
        ],
      },
      DEFAULT_INPUTS,
    );
    expect(r.categories).toHaveLength(2);
    expect(r.categories[0]).toEqual({
      id: "first",
      name: "First",
      score: 4,
      max: 5,
    });
    expect(r.categories[1]).toEqual({
      id: "second",
      name: "Second",
      score: 5,
      max: 5,
    });
  });

  it("falls back to passRate × 10 when trials are absent", () => {
    const r = adaptSkillgradeReport(
      {
        tasks: [{ id: "only", passRate: 0.6 }],
      },
      DEFAULT_INPUTS,
    );
    expect(r.categories[0]).toEqual({
      id: "only",
      name: "Only",
      score: 6,
      max: 10,
    });
  });

  it("synthesizes an id when task.id is missing", () => {
    const r = adaptSkillgradeReport(
      { tasks: [{ passing: 1, trials: 2 }] },
      DEFAULT_INPUTS,
    );
    expect(r.categories[0]!.id).toBe("task-1");
  });

  it("humanizes hyphenated ids", () => {
    const r = adaptSkillgradeReport(
      { tasks: [{ id: "weather-known-city", passing: 2, trials: 5 }] },
      DEFAULT_INPUTS,
    );
    expect(r.categories[0]!.name).toBe("Weather Known City");
  });
});

describe("adaptSkillgradeReport — findings", () => {
  it("emits one finding per grader with severity by pass", () => {
    const r = adaptSkillgradeReport(
      {
        tasks: [
          {
            id: "t",
            passing: 1,
            trials: 2,
            graders: [
              { id: "g1", passed: true, message: "OK" },
              { id: "g2", passed: false, message: "BAD" },
            ],
          },
        ],
      },
      DEFAULT_INPUTS,
    );
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]).toEqual({
      severity: "info",
      message: "OK",
      categoryId: "t",
      code: "grader:g1",
    });
    expect(r.findings[1]).toEqual({
      severity: "warning",
      message: "BAD",
      categoryId: "t",
      code: "grader:g2",
    });
  });

  it("synthesizes a finding for tasks with no graders", () => {
    const r = adaptSkillgradeReport(
      {
        tasks: [
          { id: "quiet", passing: 2, trials: 5, passed: true },
          { id: "loud", passing: 0, trials: 5, passed: false },
        ],
      },
      DEFAULT_INPUTS,
    );
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]!.severity).toBe("info");
    expect(r.findings[1]!.severity).toBe("warning");
  });
});

describe("adaptSkillgradeReport — raw passthrough", () => {
  it("keeps the original report under raw", () => {
    const report = { passRate: 0.5, custom: "data" };
    const r = adaptSkillgradeReport(report, DEFAULT_INPUTS);
    expect(r.raw).toEqual(report);
  });

  it("accepts non-object input without throwing", () => {
    const r = adaptSkillgradeReport(null as any, DEFAULT_INPUTS);
    expect(r.passed).toBe(false);
    expect(r.score).toBe(0);
    expect(r.categories).toEqual([]);
  });
});

describe("adaptSkillgradeReport — snapshot of recorded fixtures", () => {
  it("maps with-eval-yaml.skillgrade.json onto a passing EvalResult", () => {
    const raw = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "with-eval-yaml.skillgrade.json"),
        "utf-8",
      ),
    );
    const r = adaptSkillgradeReport(raw, DEFAULT_INPUTS);
    expect(r.passed).toBe(true);
    expect(r.score).toBe(92);
    expect(r.categories.map((c) => c.id)).toEqual([
      "summarize-empty-range",
      "summarize-typical-range",
    ]);
    // Every finding should carry its task's categoryId.
    for (const f of r.findings) {
      expect(typeof f.categoryId).toBe("string");
    }
  });

  it("maps runtime-broken.skillgrade.json onto a failing EvalResult", () => {
    const raw = JSON.parse(
      readFileSync(
        join(FIXTURES_DIR, "runtime-broken.skillgrade.json"),
        "utf-8",
      ),
    );
    const r = adaptSkillgradeReport(raw, DEFAULT_INPUTS);
    expect(r.passed).toBe(false);
    expect(r.score).toBe(40);
    // At least one grader-derived warning must surface.
    expect(r.findings.some((f) => f.severity === "warning")).toBe(true);
  });
});
