import { describe, test, expect } from "vitest";

import { errorMessage } from "./errors";

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
