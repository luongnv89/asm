import { describe, expect, it, beforeEach } from "vitest";
import { registerBuiltins } from "./index";
import { list, resolve, __resetForTests } from "../registry";

describe("registerBuiltins", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("is a callable function", () => {
    expect(typeof registerBuiltins).toBe("function");
  });

  it("registers the built-in providers", () => {
    registerBuiltins();
    const providers = list();
    expect(providers).toHaveLength(2);
    const ids = providers.map((p) => p.id).sort();
    expect(ids).toEqual(["quality", "skill-best-practice"]);
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    expect(byId.quality?.version).toBe("1.0.0");
    expect(byId["skill-best-practice"]?.version).toBe("1.2.0");
    for (const p of providers) {
      expect(p.schemaVersion).toBe(1);
    }
  });

  it("makes quality resolvable via semver range", () => {
    registerBuiltins();
    const provider = resolve("quality", "^1.0.0");
    expect(provider.id).toBe("quality");
    expect(provider.version).toBe("1.0.0");
  });

  it("makes skill-best-practice resolvable via semver range", () => {
    registerBuiltins();
    const provider = resolve("skill-best-practice", "^1.0.0");
    expect(provider.id).toBe("skill-best-practice");
    expect(provider.version).toBe("1.2.0");
  });

  it("does not throw when invoked", () => {
    expect(() => registerBuiltins()).not.toThrow();
  });
});
