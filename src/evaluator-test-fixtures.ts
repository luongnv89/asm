// Shared fixture strings for the evaluator test files — split from evaluator-core.test.ts (#677).

export const COMPLETE_FM: Record<string, string> = {
  name: "code-review",
  description: "Review pull request diffs before merging them.",
  version: "1.2.0",
  author: "Test Author",
  license: "MIT",
};

export const STRUCTURED_BODY =
  "# Code review\n\nReview every changed file carefully.\n";

/** ~100 words, lists, code block, imperative cues, two disclosure headings. */
export const RICH_BODY = `# Sample skill

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
export const EFFICIENT_BODY = `# Reporter

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

export const SAFE_BODY = `## Prerequisites

This skill requires git and node. Validate the environment before running.

## Safety

- Confirm before you delete any file; run with --dry-run first.
- On error, restore from the backup created at the start.
`;

export const TESTABLE_BODY = `## Acceptance criteria

- Given a valid input, then the tool writes a report.
- Expected output: a JSON file with an overallScore field.
- Verify the schema with the bundled tests.

## Edge cases

- Reject empty input.
`;
