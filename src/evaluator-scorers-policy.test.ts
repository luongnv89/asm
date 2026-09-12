import { describe, it, expect } from "vitest";
import {
  scoreSafety,
  scoreTestability,
  scoreNaming,
} from "./evaluator-scorers-policy";
import { SAFE_BODY, TESTABLE_BODY } from "./evaluator-test-fixtures";
describe("scoreSafety", () => {
  it("awards the full 10 points when destructive actions are paired with a confirmation", () => {
    const result = scoreSafety({}, SAFE_BODY);
    expect(result.id).toBe("safety");
    expect(result.score).toBe(10);
    expect(result.findings).toContain(
      "Destructive actions paired with confirmation/dry-run.",
    );
    expect(result.findings).toContain(
      "Declares prerequisites or requirements.",
    );
  });

  it("credits only half the destructive bucket when nothing destructive is mentioned", () => {
    const result = scoreSafety({}, SAFE_BODY.replace("delete", "archive"));
    expect(result.score).toBe(9);
    expect(result.findings).not.toContain(
      "Destructive actions paired with confirmation/dry-run.",
    );
  });

  it("scores a single safety cue with no prerequisites at 3", () => {
    const result = scoreSafety({}, "Run the check.");
    expect(result.score).toBe(3);
    expect(result.findings).toContain(
      "No prerequisites / requirements section.",
    );
    expect(
      result.suggestions.some((s) => s.includes("Expand the safety section")),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a "## Prerequisites" block'),
      ),
    ).toBe(true);
  });
});

describe("scoreTestability", () => {
  it("awards the full 10 points for acceptance criteria, expected output and edge cases", () => {
    const result = scoreTestability({}, TESTABLE_BODY);
    expect(result.id).toBe("testability");
    expect(result.score).toBe(10);
    expect(result.findings).toContain("Describes expected output/result.");
    expect(result.findings).toContain("Mentions edge cases or limitations.");
  });

  it("gives 3 points for a couple of cues and asks for acceptance criteria", () => {
    const result = scoreTestability({}, "Run the tests and verify the report.");
    expect(result.score).toBe(3);
    expect(result.findings).toContain(
      "Some testability cues: test, tests, verify.",
    );
    expect(
      result.suggestions.some((s) =>
        s.includes('Add an "## Acceptance Criteria" block'),
      ),
    ).toBe(true);
  });

  it("scores 0 and asks for a testable section when no cue is present", () => {
    const result = scoreTestability({}, "Do the thing.");
    expect(result.score).toBe(0);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a "## Acceptance Criteria" section'),
      ),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Include an "Expected output"'),
      ),
    ).toBe(true);
    expect(
      result.suggestions.some((s) =>
        s.includes('Add a short "Edge cases" list'),
      ),
    ).toBe(true);
  });
});

describe("scoreNaming", () => {
  it("caps at 9 of 10 because the basename point is scored by the aggregator", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n\n## Examples\n",
    );
    expect(result.id).toBe("naming");
    expect(result.max).toBe(10);
    expect(result.score).toBe(9);
    expect(result.findings).toContain(
      'name "code-review" follows kebab-case convention.',
    );
    expect(result.findings).toContain(
      "Most headings use action/imperative labels.",
    );
  });

  it("skips the heading bucket entirely when the body has no headings", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "no headings here",
    );
    expect(result.score).toBe(6);
    expect(result.findings).not.toContain(
      "Most headings use action/imperative labels.",
    );
  });

  it("gives 1 point when fewer than half the headings are action labels", () => {
    const result = scoreNaming(
      { name: "code-review", description: "Review diffs for smells." },
      "# lowercase thing\n\n## another lowercase\n",
    );
    expect(result.score).toBe(7);
    expect(
      result.suggestions.some((s) =>
        s.includes("Rename body headings to action-oriented labels"),
      ),
    ).toBe(true);
  });

  it("reports over-long names and drops the naming bucket", () => {
    const longName = "a-very-long-skill-name-that-keeps-on-going-forever";
    const result = scoreNaming(
      { name: longName, description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n",
    );
    expect(result.score).toBe(5);
    expect(result.findings).toContain(
      `name is ${longName.length} chars; keep it <= 40.`,
    );
  });

  it("withholds the clean-label point for noisy descriptions", () => {
    const result = scoreNaming(
      { name: "code-review", description: "TODO  write this" },
      "# Code review\n\n## Instructions\n",
    );
    expect(result.score).toBe(7);
    expect(
      result.suggestions.some((s) => s.includes("Clean up description")),
    ).toBe(true);
  });

  it("asks for a name when frontmatter has none", () => {
    const result = scoreNaming(
      { description: "Review diffs for smells." },
      "# Code review\n\n## Instructions\n",
    );
    expect(
      result.suggestions.some((s) =>
        s.includes("Add a kebab-case `name` (e.g. `my-skill`)"),
      ),
    ).toBe(true);
  });
});
