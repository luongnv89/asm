import { describe, expect, it, beforeEach } from "bun:test";
import { registerBuiltins } from "./index";
import { list, __resetForTests } from "../registry";

describe("registerBuiltins", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("is a callable function", () => {
    expect(typeof registerBuiltins).toBe("function");
  });

  it("registers zero providers in PR 1 (empty by design)", () => {
    registerBuiltins();
    // PR 1 ships with no built-in providers wired — PR 2 adds `quality`.
    expect(list()).toHaveLength(0);
  });

  it("does not throw when invoked", () => {
    expect(() => registerBuiltins()).not.toThrow();
  });
});
