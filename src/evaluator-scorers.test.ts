import { describe, it, expect } from "vitest";
import {
  scoreStructure,
  scoreDescription,
  scorePromptEngineering,
  scoreContextEfficiency,
} from "./evaluator-scorers";
import {
  COMPLETE_FM,
  STRUCTURED_BODY,
  RICH_BODY,
  EFFICIENT_BODY,
} from "./evaluator-test-fixtures";
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
