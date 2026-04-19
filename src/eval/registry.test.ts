import { describe, expect, it, beforeEach } from "bun:test";
import {
  register,
  resolve,
  list,
  satisfiesRange,
  parseSemver,
  compareSemver,
  __resetForTests,
} from "./registry";
import type { EvalProvider } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProvider(overrides: Partial<EvalProvider> = {}): EvalProvider {
  return {
    id: "quality",
    version: "1.0.0",
    schemaVersion: 1,
    description: "test provider",
    async applicable() {
      return { ok: true };
    },
    async run() {
      return {
        providerId: overrides.id ?? "quality",
        providerVersion: overrides.version ?? "1.0.0",
        schemaVersion: overrides.schemaVersion ?? 1,
        score: 100,
        passed: true,
        categories: [],
        findings: [],
        startedAt: new Date().toISOString(),
        durationMs: 0,
      };
    },
    ...overrides,
  };
}

beforeEach(() => {
  __resetForTests();
});

// ─── parseSemver ────────────────────────────────────────────────────────────

describe("parseSemver", () => {
  it("parses major.minor.patch", () => {
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("parses pre-release identifiers", () => {
    expect(parseSemver("1.0.0-next")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["next"],
    });
    expect(parseSemver("1.0.0-alpha.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["alpha", "1"],
    });
  });

  it("discards build metadata", () => {
    expect(parseSemver("1.0.0+sha.1234")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: [],
    });
  });

  it("returns null for invalid strings", () => {
    expect(parseSemver("1.0")).toBeNull();
    expect(parseSemver("v1.0.0")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("abc")).toBeNull();
  });

  it("returns null for non-string input", () => {
    // @ts-expect-error — defensive
    expect(parseSemver(undefined)).toBeNull();
    // @ts-expect-error — defensive
    expect(parseSemver(null)).toBeNull();
  });
});

// ─── compareSemver ──────────────────────────────────────────────────────────

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    const a = parseSemver("1.0.0")!;
    const b = parseSemver("2.0.0")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
    expect(compareSemver(b, a)).toBeGreaterThan(0);
    expect(compareSemver(a, a)).toBe(0);
  });

  it("treats pre-release as lower than release", () => {
    const rel = parseSemver("1.0.0")!;
    const pre = parseSemver("1.0.0-next")!;
    expect(compareSemver(pre, rel)).toBeLessThan(0);
    expect(compareSemver(rel, pre)).toBeGreaterThan(0);
  });

  it("compares pre-release identifiers segment by segment", () => {
    const a = parseSemver("1.0.0-alpha.1")!;
    const b = parseSemver("1.0.0-alpha.2")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
  });

  it("treats numeric pre-release segments as less than alphanumeric", () => {
    const a = parseSemver("1.0.0-1")!;
    const b = parseSemver("1.0.0-alpha")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
  });
});

// ─── satisfiesRange ─────────────────────────────────────────────────────────

describe("satisfiesRange", () => {
  it("matches exact versions", () => {
    expect(satisfiesRange("1.0.0", "1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.1", "1.0.0")).toBe(false);
  });

  it("matches exact versions with leading =", () => {
    expect(satisfiesRange("1.0.0", "=1.0.0")).toBe(true);
  });

  it("matches caret ranges within the same major", () => {
    expect(satisfiesRange("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesRange("0.9.0", "^1.0.0")).toBe(false);
  });

  it("caret range respects 0.x semantics (same minor only)", () => {
    expect(satisfiesRange("0.1.5", "^0.1.0")).toBe(true);
    expect(satisfiesRange("0.2.0", "^0.1.0")).toBe(false);
  });

  it("caret range respects 0.0.x semantics (exact patch)", () => {
    expect(satisfiesRange("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfiesRange("0.0.4", "^0.0.3")).toBe(false);
  });

  it("matches tilde ranges within the same major.minor", () => {
    expect(satisfiesRange("1.2.5", "~1.2.3")).toBe(true);
    expect(satisfiesRange("1.2.2", "~1.2.3")).toBe(false);
    expect(satisfiesRange("1.3.0", "~1.2.3")).toBe(false);
  });

  it("wildcards match any version", () => {
    expect(satisfiesRange("1.2.3", "*")).toBe(true);
    expect(satisfiesRange("0.0.0", "*")).toBe(true);
    expect(satisfiesRange("99.0.0-beta", "x")).toBe(true);
  });

  it("throws on invalid range syntax", () => {
    expect(() => satisfiesRange("1.0.0", "")).toThrow(/invalid semver range/);
    // @ts-expect-error — defensive runtime check
    expect(() => satisfiesRange("1.0.0", null)).toThrow(/invalid semver range/);
    expect(() => satisfiesRange("1.0.0", "^notaversion")).toThrow(
      /invalid semver/,
    );
    expect(() => satisfiesRange("1.0.0", "garbage")).toThrow(
      /invalid semver range/,
    );
  });

  it("returns false for invalid provider version strings", () => {
    expect(satisfiesRange("not-a-version", "^1.0.0")).toBe(false);
  });
});

// ─── register() ─────────────────────────────────────────────────────────────

describe("register", () => {
  it("accepts a valid provider", () => {
    expect(() => register(makeProvider())).not.toThrow();
    expect(list()).toHaveLength(1);
  });

  it("rejects providers with missing id", () => {
    expect(() => register(makeProvider({ id: "" }))).toThrow(/id is required/);
  });

  it("rejects providers with invalid semver version", () => {
    expect(() => register(makeProvider({ version: "not-a-version" }))).toThrow(
      /invalid semver/,
    );
    expect(() => register(makeProvider({ version: "1.0" }))).toThrow(
      /invalid semver/,
    );
  });

  it("rejects providers with non-integer schemaVersion", () => {
    expect(() =>
      register(makeProvider({ schemaVersion: 1.5 as unknown as number })),
    ).toThrow(/schemaVersion must be an integer/);
  });

  it("allows multiple versions of the same provider", () => {
    register(makeProvider({ version: "1.0.0" }));
    register(makeProvider({ version: "1.2.0" }));
    register(makeProvider({ version: "2.0.0-next" }));
    expect(list()).toHaveLength(3);
  });

  it("rejects exact duplicate (id, version) pairs", () => {
    register(makeProvider({ version: "1.0.0" }));
    expect(() => register(makeProvider({ version: "1.0.0" }))).toThrow(
      /already registered/,
    );
  });
});

// ─── resolve() — semver range matching ──────────────────────────────────────

describe("resolve", () => {
  it("returns the registered provider on exact match", () => {
    const p = makeProvider({ version: "1.0.0" });
    register(p);
    expect(resolve("quality", "1.0.0")).toBe(p);
  });

  it("returns the highest version within a caret range", () => {
    const p10 = makeProvider({ version: "1.0.0" });
    const p12 = makeProvider({ version: "1.2.0" });
    register(p10);
    register(p12);

    // 1.2.0 > 1.0.0 under SemVer precedence.
    expect(resolve("quality", "^1.0.0")).toBe(p12);
  });

  it("prefers release over pre-release at same major.minor.patch", () => {
    const pre = makeProvider({ version: "1.3.0-beta" });
    const rel = makeProvider({ version: "1.3.0" });
    register(pre);
    register(rel);

    // 1.3.0 > 1.3.0-beta per SemVer §11.
    expect(resolve("quality", "^1.0.0")).toBe(rel);
  });

  it("picks pre-release when it is the only version in range", () => {
    const pre = makeProvider({ version: "1.3.0-beta" });
    const lower = makeProvider({ version: "1.2.0" });
    register(pre);
    register(lower);

    // 1.3.0-beta > 1.2.0 because its release precedence (1.3.0) is higher.
    expect(resolve("quality", "^1.0.0")).toBe(pre);
  });

  it("ignores versions outside the requested range", () => {
    const p1 = makeProvider({ version: "1.2.0" });
    const p2 = makeProvider({ version: "2.0.0" });
    register(p1);
    register(p2);

    expect(resolve("quality", "^1.0.0")).toBe(p1);
    expect(resolve("quality", "^2.0.0")).toBe(p2);
  });

  it("supports tilde ranges", () => {
    const p1 = makeProvider({ version: "1.2.3" });
    const p2 = makeProvider({ version: "1.2.8" });
    const p3 = makeProvider({ version: "1.3.0" });
    register(p1);
    register(p2);
    register(p3);

    expect(resolve("quality", "~1.2.3")).toBe(p2);
  });

  it("throws when the id is not registered", () => {
    expect(() => resolve("missing", "^1.0.0")).toThrow(/not registered/);
  });

  it("throws when no version satisfies the range", () => {
    register(makeProvider({ version: "1.0.0" }));
    expect(() => resolve("quality", "^2.0.0")).toThrow(
      /no version of "quality" satisfies/,
    );
  });

  it("throws on invalid semver range", () => {
    register(makeProvider({ version: "1.0.0" }));
    expect(() => resolve("quality", "")).toThrow(/invalid semver range/);
    expect(() => resolve("quality", "^notaversion")).toThrow(/invalid semver/);
  });

  it("throws when id is empty", () => {
    expect(() => resolve("", "^1.0.0")).toThrow(/id is required/);
  });
});

// ─── list() ─────────────────────────────────────────────────────────────────

describe("list", () => {
  it("returns an empty array when nothing is registered", () => {
    expect(list()).toEqual([]);
  });

  it("returns every (id, version) pair flattened", () => {
    register(makeProvider({ id: "quality", version: "1.0.0" }));
    register(makeProvider({ id: "quality", version: "2.0.0" }));
    register(makeProvider({ id: "example", version: "1.0.0" }));

    const all = list();
    expect(all).toHaveLength(3);
    const tuples = all.map((p) => `${p.id}@${p.version}`).sort();
    expect(tuples).toEqual(["example@1.0.0", "quality@1.0.0", "quality@2.0.0"]);
  });

  it("returns a shallow copy that can be mutated", () => {
    register(makeProvider());
    const first = list();
    first.pop();
    expect(list()).toHaveLength(1);
  });
});
