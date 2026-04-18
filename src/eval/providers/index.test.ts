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

  it("registers the quality provider (PR 2)", () => {
    registerBuiltins();
    // PR 2 lands `quality@1.0.0`. PR 4 will add skillgrade — bump this count
    // when it does.
    const providers = list();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe("quality");
    expect(providers[0]!.version).toBe("1.0.0");
    expect(providers[0]!.schemaVersion).toBe(1);
  });

  it("makes quality resolvable via semver range", () => {
    registerBuiltins();
    const provider = resolve("quality", "^1.0.0");
    expect(provider.id).toBe("quality");
    expect(provider.version).toBe("1.0.0");
  });

  it("does not throw when invoked", () => {
    expect(() => registerBuiltins()).not.toThrow();
  });
});
