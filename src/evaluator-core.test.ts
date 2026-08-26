import { describe, expect, it } from "vitest";
import {
  lineCount,
  scoreStructure,
  scoreDescription,
  scorePromptEngineering,
  scoreContextEfficiency,
  scoreSafety,
  scoreTestability,
  scoreNaming,
} from "./evaluator-core";

// These helpers are exported from `evaluator-core` for cross-module wiring but
// are deliberately NOT re-exported through the `./evaluator` facade, so they
// can only be reached by importing the core module directly.

const COMPLETE_FM: Record<string, string> = {
  name: "code-review",
  description: "Review pull request diffs before merging them.",
  version: "1.2.0",
  author: "Test Author",
  license: "MIT",
};

const STRUCTURED_BODY =
  "# Code review\n\nReview every changed file carefully.\n";

/** ~100 words, lists, code block, imperative cues, two disclosure headings. */
const RICH_BODY = `# Sample skill

## When to Use

Use this skill when reviewing a pull request diff before merging it into the
main branch. It applies to any repository that keeps a changelog and expects
contributors to justify behavioural changes in the description of the change.

## Instructions

- Run the linter across every changed file and record each warning.
- Check the diff for unexplained deletions and note them in the summary.
- Validate that the changelog entry matches the behaviour of the change.
- Never rewrite history on a shared branch.

## Example

\`\`\`bash
npm run lint
\`\`\`
`;

/** ~145 words, links out to references/templates, mentions the token budget. */
const EFFICIENT_BODY = `# Reporter

## Overview

This skill produces a compact report. See the references directory for the
long form material, and use the templates it ships with rather than pasting
their content here. Every helper script referenced below is kept outside this
document so the token budget of the agent stays small even when the underlying
material grows over time. Keep the document itself short; the agent reads it on
every invocation and a longer file costs more of the available context window
than the extra detail is worth.

## Instructions

- Read the input file and collect each measurement it contains.
- Validate the measurement against the schema stored in references/schema.md.
- Write the summary into the output file named by the caller.
- Link back to the template that produced the layout of the report.

## Example

\`\`\`bash
node report.js --input data.json
\`\`\`
`;

const SAFE_BODY = `## Prerequisites

This skill requires git and node. Validate the environment before running.

## Safety

- Confirm before you delete any file; run with --dry-run first.
- On error, restore from the backup created at the start.
`;

const TESTABLE_BODY = `## Acceptance criteria

- Given a valid input, then the tool writes a report.
- Expected output: a JSON file with an overallScore field.
- Verify the schema with the bundled tests.

## Edge cases

- Reject empty input.
`;

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

describe("scoreStructure", () => {
  it("awards the full 10 points for complete frontmatter and a structured body", () => {
    const result = scoreStructure(
      COMPLETE_FM,
      STRUCTURED_BODY,
      "name: code-review",
    );
    expect(result.id).toBe("structure");
    expect(result.name).toBe("Structure & completeness");
    expect(result.max).toBe(10);
    expect(result.score).toBe(10);
    expect(result.suggestions).toEqual([]);
  });

  it("deducts the license point and names the missing field", () => {
    const { license: _license, ...noLicense } = COMPLETE_FM;
    const result = scoreStructure(noLicense, STRUCTURED_BODY, "name: x");
    expect(result.score).toBe(9);
    expect(result.findings).toContain("Missing `license`.");
    expect(
      result.suggestions.some((s) =>
        s.includes("Add a `license` field (e.g. `license: MIT`)"),
      ),
    ).toBe(true);
  });

  it("reports a short, heading-free body", () => {
    const result = scoreStructure(COMPLETE_FM, "hi", "name: x");
    expect(result.score).toBe(8);
    expect(
      result.findings.some((f) => /Body content is too short/.test(f)),
    ).toBe(true);
    expect(result.findings).toContain("Body has no markdown headings.");
    expect(
      result.suggestions.some((s) => s.includes("Add section headings")),
    ).toBe(true);
  });

  it("suggests adding frontmatter when the block is absent", () => {
    const result = scoreStructure({}, STRUCTURED_BODY, null);
    expect(result.findings).toContain("SKILL.md has no YAML frontmatter.");
    expect(
      result.suggestions.some((s) =>
        s.includes("Add a YAML frontmatter block delimited by `---`"),
      ),
    ).toBe(true);
  });

  it("matches a root README case-insensitively without changing the score", () => {
    const withReadme = scoreStructure(COMPLETE_FM, STRUCTURED_BODY, "name: x", [
      "SKILL.md",
      "ReadMe.md",
    ]);
    const withoutReadme = scoreStructure(
      COMPLETE_FM,
      STRUCTURED_BODY,
      "name: x",
      ["SKILL.md"],
    );
    expect(withReadme.score).toBe(withoutReadme.score);
    expect(
      withReadme.findings.some((f) =>
        f.includes("`ReadMe.md` found at skill root"),
      ),
    ).toBe(true);
    expect(withReadme.suggestions.some((s) => s.includes("Relocate"))).toBe(
      true,
    );
  });
});

describe("scoreDescription", () => {
  it("awards the full 10 points for a verb-led description with a trigger", () => {
    const result = scoreDescription(
      {
        description:
          "Review pull request diffs for code smells and style problems before merging.",
      },
      "",
    );
    expect(result.id).toBe("description");
    expect(result.score).toBe(10);
    expect(result.findings).toContain("Description is 12 words.");
    expect(result.findings).toContain("Starts with an action verb.");
    expect(result.findings).toContain("Mentions a trigger or use-case signal.");
  });

  it("short-circuits to 0 when there is no description", () => {
    const result = scoreDescription({}, "");
    expect(result.score).toBe(0);
    expect(result.findings).toEqual(["No description."]);
    expect(result.suggestions).toHaveLength(1);
  });

  it("scores a 6-word, verbless, triggerless description at 2", () => {
    const result = scoreDescription(
      { description: "Skill that handles the odd bits" },
      "",
    );
    expect(result.score).toBe(2);
    expect(result.findings).toContain(
      'Does not start with a recognized action verb (got "skill").',
    );
    expect(result.findings).toContain("No explicit trigger / use-case phrase.");
    expect(
      result.suggestions.some((s) =>
        s.includes("Lengthen the description slightly"),
      ),
    ).toBe(true);
  });

  it("halves the length credit at 41-60 words and drops it past 60", () => {
    const medium = scoreDescription(
      { description: ["Generate", ...Array(44).fill("thing")].join(" ") },
      "",
    );
    expect(medium.score).toBe(5);
    expect(
      medium.suggestions.some((s) => s.includes("Trim the description")),
    ).toBe(true);

    const long = scoreDescription(
      { description: ["Generate", ...Array(70).fill("thing")].join(" ") },
      "",
    );
    expect(long.score).toBe(3);
    expect(
      long.suggestions.some((s) => s.includes("Description is too long")),
    ).toBe(true);
  });
});

describe("scorePromptEngineering", () => {
  it("awards the full 10 points for disclosure cues, lists, examples and imperatives", () => {
    const result = scorePromptEngineering({}, RICH_BODY);
    expect(result.id).toBe("prompt-engineering");
    expect(result.score).toBe(10);
    expect(result.findings).toContain("Uses lists or numbered steps.");
    expect(result.findings).toContain("Includes example code block.");
    expect(
      result.findings.some((f) => /Uses imperative voice \(\d+ cues\)/.test(f)),
    ).toBe(true);
  });

  it("gives partial credit for a single disclosure cue and a single imperative", () => {
    const result = scorePromptEngineering({}, "Overview\n\nRun it.\n");
    expect(result.score).toBe(2);
    expect(
      result.suggestions.some((s) => s.includes("Add clearer section labels")),
    ).toBe(true);
    expect(
      result.suggestions.some((s) => s.includes("Favor imperative voice")),
    ).toBe(true);
    expect(result.findings).toContain("Body is very short (3 words).");
  });

  it("halves the example credit when a code block has no `example` label", () => {
    const body = "# Title\n\n```bash\nls\n```\n";
    const result = scorePromptEngineering({}, body);
    expect(result.score).toBe(1);
    expect(
      result.suggestions.some((s) =>
        s.includes("Back up examples with fenced code blocks"),
      ),
    ).toBe(true);
    expect(result.findings).not.toContain("Includes example code block.");
  });
});

describe("scoreContextEfficiency", () => {
  it("awards the full 10 points for a right-sized body that links out", () => {
    const result = scoreContextEfficiency({}, EFFICIENT_BODY);
    expect(result.id).toBe("context-efficiency");
    expect(result.score).toBe(10);
    expect(
      result.findings.some((f) =>
        f.startsWith("References external files or links (reference,"),
      ),
    ).toBe(true);
    expect(result.findings).toContain("No oversized code blocks.");
    expect(result.findings).toContain("Mentions tokens/budget/context window.");
  });

  it("flags code blocks longer than 60 lines", () => {
    const huge =
      "```js\n" + Array(70).fill("const x = 1;").join("\n") + "\n```\n";
    const result = scoreContextEfficiency({}, EFFICIENT_BODY + huge);
    expect(result.findings).toContain("1 code block(s) longer than 60 lines.");
    expect(
      result.suggestions.some((s) => s.includes("Move large code blocks")),
    ).toBe(true);
  });

  it("emits no length feedback for bodies under 60 words", () => {
    const result = scoreContextEfficiency({}, "Quick note only.");
    expect(result.score).toBe(2);
    expect(result.findings).toContain("Body is 3 words.");
    // The <60-word bucket has no branch, so no length suggestion is produced.
    expect(
      result.suggestions.some((s) => s.includes("Expand instructions")),
    ).toBe(false);
    expect(
      result.suggestions.some((s) => s.includes("Offload verbose content")),
    ).toBe(true);
  });
});

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
