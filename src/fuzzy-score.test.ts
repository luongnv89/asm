import { describe, test, expect } from "vitest";
import {
  MIN_SCORE,
  scoreDescription,
  scoreName,
  scoreSkill,
} from "./fuzzy-score";

const codeReview = {
  name: "code-review",
  description: "Review pull requests and diffs for bugs and security issues",
};
const pdfTools = {
  name: "pdf-tools",
  description: "Extract text and tables from PDF documents",
};

describe("scoreName (issue #735)", () => {
  test("exact name scores highest", () => {
    expect(scoreName("code-review", "code-review")).toBe(100);
  });

  test("separators are normalized before comparing", () => {
    expect(scoreName("code review", "code-review")).toBe(100);
    expect(scoreName("Code_Review", "code-review")).toBe(100);
  });

  test("partial name (prefix) still matches", () => {
    expect(scoreName("code", "code-review")).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  test("partial name (substring) still matches", () => {
    expect(scoreName("review", "code-review")).toBeGreaterThanOrEqual(
      MIN_SCORE,
    );
  });

  test("misspelled name token still matches", () => {
    expect(scoreName("revew", "code-review")).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  test("misspelled full name still matches", () => {
    expect(scoreName("code-reveiw", "code-review")).toBeGreaterThanOrEqual(
      MIN_SCORE,
    );
  });

  test("short tokens get no typo credit", () => {
    expect(scoreName("pdg", "pdf-tools")).toBe(0);
  });

  test("unrelated name scores zero", () => {
    expect(scoreName("revew", "pdf-tools")).toBe(0);
  });
});

describe("scoreDescription (issue #735)", () => {
  test("matches description words, ignoring stopwords", () => {
    expect(
      scoreDescription("find bugs in my pull requests", codeReview.description),
    ).toBeGreaterThan(0);
  });

  test("credits word-stem variants", () => {
    expect(
      scoreDescription("reviewing", codeReview.description),
    ).toBeGreaterThan(0);
  });

  test("returns zero for unrelated descriptions", () => {
    expect(
      scoreDescription("find bugs in my pull requests", pdfTools.description),
    ).toBe(0);
  });
});

describe("scoreSkill (issue #735)", () => {
  test("a description-only query finds the skill and excludes unrelated ones", () => {
    const query = "check pull requests for security bugs";
    expect(scoreSkill(query, codeReview)).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(scoreSkill(query, pdfTools)).toBeLessThan(MIN_SCORE);
  });

  test("exact name outranks substring, which outranks a typo", () => {
    const exact = scoreSkill("review", { name: "review", description: "" });
    const substring = scoreSkill("review", {
      name: "code-review",
      description: "",
    });
    const typo = scoreSkill("review", { name: "reviw", description: "" });
    expect(exact).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  test("description credit cannot lift a partial name above an exact one", () => {
    const exactNoDesc = scoreSkill("code", { name: "code", description: "" });
    const prefixFullDesc = scoreSkill("code", {
      name: "code-review",
      description: "code code code",
    });
    expect(exactNoDesc).toBeGreaterThan(prefixFullDesc);
  });

  test("empty query scores zero", () => {
    expect(scoreSkill("  ", codeReview)).toBe(0);
  });
});
