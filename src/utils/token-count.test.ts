import { describe, expect, it } from "vitest";
import { estimateTokenCount, formatTokenCount } from "./token-count";

describe("estimateTokenCount", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("counts only literal spaces in whitespace-only string", () => {
    // 0 words + 5 literal U+0020 chars in `   \n\t  `
    expect(estimateTokenCount("   \n\t  ")).toBe(5);
  });

  it("counts a single word as one token", () => {
    expect(estimateTokenCount("hello")).toBe(1);
  });

  it("counts words plus spaces — `hello world` = 2 words + 1 space = 3", () => {
    expect(estimateTokenCount("hello world")).toBe(3);
  });

  it("counts multiple spaces between words individually", () => {
    // 2 words + 3 spaces
    expect(estimateTokenCount("hello   world")).toBe(5);
  });

  it("does not count newlines or tabs as spaces", () => {
    // 3 words ("a","b","c") + 0 literal spaces = 3
    expect(estimateTokenCount("a\nb\tc")).toBe(3);
  });

  it("scales for a realistic sentence", () => {
    const text = "Use this skill to do X.";
    // words: Use, this, skill, to, do, X. = 6
    // spaces: 5
    expect(estimateTokenCount(text)).toBe(11);
  });

  it("handles paragraph with mixed whitespace", () => {
    const text = "First line.\nSecond line with two  spaces.";
    // Words split on /\s+/: First, line., Second, line, with, two, spaces. = 7
    // Literal spaces (U+0020 only): "First line." has 1, "Second line with two  spaces." has 5
    // total spaces = 6
    expect(estimateTokenCount(text)).toBe(13);
  });
});

describe("formatTokenCount", () => {
  it("formats small counts with the leading `~`", () => {
    expect(formatTokenCount(0)).toBe("~0 tokens");
    expect(formatTokenCount(7)).toBe("~7 tokens");
    expect(formatTokenCount(999)).toBe("~999 tokens");
  });

  it("formats thousands with k suffix and decimal", () => {
    expect(formatTokenCount(1000)).toBe("~1k tokens");
    expect(formatTokenCount(1500)).toBe("~1.5k tokens");
    expect(formatTokenCount(2750)).toBe("~2.8k tokens");
  });

  it("formats large counts with rounded k", () => {
    expect(formatTokenCount(12_345)).toBe("~12k tokens");
    expect(formatTokenCount(150_000)).toBe("~150k tokens");
  });

  it("treats negative or non-finite values as zero", () => {
    expect(formatTokenCount(-1)).toBe("~0 tokens");
    expect(formatTokenCount(NaN)).toBe("~0 tokens");
    expect(formatTokenCount(Infinity)).toBe("~0 tokens");
  });
});
