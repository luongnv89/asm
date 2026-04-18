/**
 * Tests for the compound-range matcher used by `externalRequires`.
 *
 * The registry's built-in matcher covers ^ / ~ / exact — this helper
 * adds ≥, >, ≤, <, = and conjunctions. Tests exercise each operator,
 * compound ranges, invalid input, and pre-release precedence.
 */

import { describe, expect, it } from "bun:test";
import { satisfiesExternalRange } from "./semver-range";

describe("satisfiesExternalRange — single comparator", () => {
  it(">= matches higher and equal", () => {
    expect(satisfiesExternalRange("0.1.3", ">=0.1.3")).toBe(true);
    expect(satisfiesExternalRange("0.2.0", ">=0.1.3")).toBe(true);
  });

  it(">= rejects lower", () => {
    expect(satisfiesExternalRange("0.1.2", ">=0.1.3")).toBe(false);
  });

  it("> rejects equal", () => {
    expect(satisfiesExternalRange("0.1.3", ">0.1.3")).toBe(false);
    expect(satisfiesExternalRange("0.1.4", ">0.1.3")).toBe(true);
  });

  it("<= matches lower and equal", () => {
    expect(satisfiesExternalRange("0.1.3", "<=0.1.3")).toBe(true);
    expect(satisfiesExternalRange("0.1.2", "<=0.1.3")).toBe(true);
  });

  it("< rejects equal", () => {
    expect(satisfiesExternalRange("0.1.3", "<0.1.3")).toBe(false);
  });

  it("= matches exact only", () => {
    expect(satisfiesExternalRange("0.1.3", "=0.1.3")).toBe(true);
    expect(satisfiesExternalRange("0.1.4", "=0.1.3")).toBe(false);
  });
});

describe("satisfiesExternalRange — compound conjunction", () => {
  it("matches inside a closed half-open range", () => {
    expect(satisfiesExternalRange("0.1.3", ">=0.1.3 <0.3.0")).toBe(true);
    expect(satisfiesExternalRange("0.2.9", ">=0.1.3 <0.3.0")).toBe(true);
  });

  it("rejects outside a closed half-open range", () => {
    expect(satisfiesExternalRange("0.1.2", ">=0.1.3 <0.3.0")).toBe(false);
    expect(satisfiesExternalRange("0.3.0", ">=0.1.3 <0.3.0")).toBe(false);
    expect(satisfiesExternalRange("1.0.0", ">=0.1.3 <0.3.0")).toBe(false);
  });

  it("tolerates extra whitespace between clauses", () => {
    expect(satisfiesExternalRange("0.2.0", " >=0.1.3   <0.3.0 ")).toBe(true);
  });
});

describe("satisfiesExternalRange — wildcards & empty", () => {
  it("undefined / empty range matches every version", () => {
    expect(satisfiesExternalRange("0.0.1", undefined)).toBe(true);
    expect(satisfiesExternalRange("0.0.1", "")).toBe(true);
    expect(satisfiesExternalRange("0.0.1", "   ")).toBe(true);
  });

  it("* / x / X match every version", () => {
    expect(satisfiesExternalRange("1.2.3", "*")).toBe(true);
    expect(satisfiesExternalRange("1.2.3", "x")).toBe(true);
    expect(satisfiesExternalRange("1.2.3", "X")).toBe(true);
  });
});

describe("satisfiesExternalRange — delegation to registry", () => {
  it("supports ^ ranges via registry matcher", () => {
    expect(satisfiesExternalRange("1.4.0", "^1.0.0")).toBe(true);
    expect(satisfiesExternalRange("2.0.0", "^1.0.0")).toBe(false);
  });

  it("supports ~ ranges via registry matcher", () => {
    expect(satisfiesExternalRange("1.2.5", "~1.2.0")).toBe(true);
    expect(satisfiesExternalRange("1.3.0", "~1.2.0")).toBe(false);
  });

  it("supports bare exact", () => {
    expect(satisfiesExternalRange("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesExternalRange("1.2.4", "1.2.3")).toBe(false);
  });
});

describe("satisfiesExternalRange — pre-release", () => {
  it("treats pre-releases as lower than their base", () => {
    expect(satisfiesExternalRange("0.2.0-next", ">=0.2.0")).toBe(false);
    expect(satisfiesExternalRange("0.2.0-next", "<0.2.0")).toBe(true);
  });
});

describe("satisfiesExternalRange — invalid input", () => {
  it("throws on nonsense clauses", () => {
    expect(() => satisfiesExternalRange("1.0.0", "totally-bogus")).toThrow(
      /invalid/i,
    );
  });

  it("returns false for invalid version strings", () => {
    expect(satisfiesExternalRange("not-semver", ">=1.0.0")).toBe(false);
  });
});
