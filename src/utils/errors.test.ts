import { describe, test, expect } from "vitest";

import { format } from "node:util";

import { errorMessage, fatalErrorForDisplay } from "./errors";

describe("errorMessage", () => {
  test("returns .message for Error instances", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  test("returns .message for error subclasses", () => {
    expect(errorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  test("reads .message off error-like plain objects", () => {
    expect(errorMessage({ message: "oops", code: "ENOENT" })).toBe("oops");
  });

  test("stringifies a thrown string as itself", () => {
    expect(errorMessage("plain failure")).toBe("plain failure");
  });

  test("falls back to String(err) when .message is missing", () => {
    expect(errorMessage({ code: "ENOENT" })).toBe("[object Object]");
  });

  test("stringifies nullish thrown values", () => {
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  test("stringifies a non-string .message like err?.message in a template", () => {
    expect(errorMessage({ message: 42 })).toBe("42");
  });

  test("keeps an empty-string .message verbatim", () => {
    expect(errorMessage(new Error())).toBe("");
  });
});

describe("fatalErrorForDisplay (#834)", () => {
  const H = "\x1b[31m\u009b\x7f";
  // eslint-disable-next-line no-control-regex
  const RAW = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

  test("strips an Error's message and stack in place, keeping lines", () => {
    const err = new Error(`bad ${H}\nsecond`);
    const out = fatalErrorForDisplay(err);
    expect(out).toBe(err);
    expect(err.message).toBe("bad ?[31m??\nsecond");
    expect(err.stack).not.toMatch(RAW);
    expect(err.stack).toContain("bad ?[31m??");
    expect(format("Fatal error:", out)).not.toMatch(RAW);
  });

  test("strips the cause chain and AggregateError members", () => {
    const inner = new Error(`inner ${H}`);
    const agg = new AggregateError([new Error(`member ${H}`)], `agg ${H}`, {
      cause: inner,
    });
    const out = fatalErrorForDisplay(new Error(`outer ${H}`, { cause: agg }));
    expect(format("Fatal error:", out)).not.toMatch(RAW);
    expect(format("Fatal error:", out)).toContain("inner ?[31m??");
  });

  test("falls back to stripped text when the message cannot be set", () => {
    const frozen = Object.freeze(new Error(`frozen ${H}`));
    const out = fatalErrorForDisplay(frozen);
    expect(typeof out).toBe("string");
    expect(out as string).toContain("frozen ?[31m??");
    expect(out as string).not.toMatch(RAW);
    const dom = fatalErrorForDisplay(new DOMException(`dom ${H}`));
    expect(format("Fatal error:", dom)).not.toMatch(RAW);
  });

  test("strips a thrown string and passes other values through", () => {
    expect(fatalErrorForDisplay(`s ${H}`)).toBe("s ?[31m??");
    const obj = { a: 1 };
    expect(fatalErrorForDisplay(obj)).toBe(obj);
  });

  test("leaves an ordinary error's formatting unchanged", () => {
    const err = new Error("plain failure");
    const before = format("Fatal error:", err);
    expect(format("Fatal error:", fatalErrorForDisplay(err))).toBe(before);
  });
});
