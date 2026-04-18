import { describe, expect, it, beforeEach } from "bun:test";
import { registerBuiltins } from "./index";
import { list, resolve, __resetForTests } from "../registry";

describe("registerBuiltins", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("is a callable function", () => {
    expect(typeof registerBuiltins).toBe("function");
  });

  it("registers the quality and skillgrade providers", () => {
    registerBuiltins();
    // PR 2 (#156) added `quality@1.0.0`. PR 4 (#158) adds `skillgrade@1.0.0`.
    // Bump this count when new built-ins land.
    const providers = list();
    expect(providers).toHaveLength(2);
    const ids = providers.map((p) => p.id).sort();
    expect(ids).toEqual(["quality", "skillgrade"]);
    for (const p of providers) {
      expect(p.version).toBe("1.0.0");
      expect(p.schemaVersion).toBe(1);
    }
  });

  it("makes quality resolvable via semver range", () => {
    registerBuiltins();
    const provider = resolve("quality", "^1.0.0");
    expect(provider.id).toBe("quality");
    expect(provider.version).toBe("1.0.0");
  });

  it("makes skillgrade resolvable via semver range", () => {
    registerBuiltins();
    const provider = resolve("skillgrade", "^1.0.0");
    expect(provider.id).toBe("skillgrade");
    expect(provider.version).toBe("1.0.0");
    expect(provider.externalRequires?.binary).toBe("skillgrade");
  });

  it("does not throw when invoked", () => {
    expect(() => registerBuiltins()).not.toThrow();
  });
});
