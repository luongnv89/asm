import { describe, it, expect } from "vitest";
import { lineCount } from "./evaluator-core";
describe("lineCount", () => {
  it("returns 0 for the empty string", () => {
    expect(lineCount("")).toBe(0);
  });

  it("counts a single line without a terminator as one line", () => {
    expect(lineCount("abc")).toBe(1);
  });

  it("counts a trailing newline as an extra (empty) line", () => {
    expect(lineCount("a\n")).toBe(2);
    expect(lineCount("\n")).toBe(2);
  });

  it("counts every separated line", () => {
    expect(lineCount("a\nb\nc")).toBe(3);
  });
});
