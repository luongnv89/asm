# Category Playbook

Per-category fix patterns used by the `skill-auto-improver` workflow. Each section lists what the evaluator rewards, common failure modes, and concrete edits that move the score up.

All scoring rules mirror `src/evaluator.ts` in the ASM repo. Numbers change when the evaluator evolves — re-read that file if scores behave unexpectedly.

## 1. Structure & completeness (`structure`)

**What it rewards (10 pts):**

- YAML frontmatter block present (2 pts)
- `name` and `description` filled (3 pts)
- `version` set and not default `0.0.0` (1 pt)
- `creator` present (1 pt)
- `license` present (1 pt)
- Body has >=20 chars of content (1 pt)
- Body has at least one markdown heading (1 pt)

**Fix patterns:**

- Missing frontmatter fields: run `asm eval --fix` first — it adds `version`, `creator` (from git), and `effort` automatically
- Missing `license`: add `license: MIT` (or whatever the repo uses)
- Empty body: write at least a `## When to Use` section
- No headings: add `## Instructions`, `## Prerequisites`, `## Example` as appropriate

## 2. Description quality (`description`)

**What it rewards (10 pts):**

- Length between 8 and 40 words (4 pts)
- Starts with an action verb (see `ACTION_VERBS` in evaluator.ts) (3 pts)
- Contains a trigger phrase: "use when", "when", "for", "before", "after", "during", "trigger" (3 pts)

**Fix patterns:**

- Too short (<8 words): rewrite to name the action AND the trigger
- Too long (>40 words): move detail to the body, keep the description to one sentence
- Doesn't start with a verb: rewrite so the first word is an imperative. Good first words: `Analyze`, `Audit`, `Build`, `Check`, `Create`, `Debug`, `Deploy`, `Evaluate`, `Find`, `Fix`, `Generate`, `Improve`, `Index`, `Install`, `Migrate`, `Optimize`, `Plan`, `Publish`, `Refactor`, `Remove`, `Review`, `Run`, `Scan`, `Search`, `Summarize`, `Sync`, `Test`, `Update`, `Validate`, `Verify`, `Write`
- No trigger phrase: append `Use when...` or `...for <situation>` to the description

**Example rewrite:**

- Before: `A minimal test skill that greets the user and demonstrates the ASM publish workflow.`
- After: `Generate a personalized greeting. Use when testing the ASM publish workflow or demoing skill scaffolding.`

## 3. Prompt engineering (`prompt-engineering`)

**What it rewards (10 pts):**

- Progressive disclosure cues: "when to use", "quick start", "overview", "instructions", "steps", "workflow", "phases" (3 pts if >=2, 1 pt if 1)
- Uses lists or numbered steps (2 pts)
- Has code block AND mentions "example" (2 pts if both, 1 pt if one)
- Imperative voice cues: `Do`, `Use`, `Run`, `Call`, `Check`, `Validate`, `Return`, `Emit`, `Write`, `Read`, `Ask`, `Confirm`, `Avoid`, `Never`, `Always` — at least 3 occurrences (2 pts for >=3, 1 pt for 1-2)
- Body length between 80 and 3000 words (1 pt)

**Fix patterns:**

- Missing section structure: add `## When to Use` and `## Instructions` headings
- No lists: convert prose paragraphs to bulleted or numbered steps
- No examples: add `## Example` section with a fenced code block (`bash ... ` or similar)
- Passive voice: rewrite to imperative. "The user might want to run..." becomes "Run..."
- Body too short (<80 words): expand — underspecified skills give the agent too much freedom
- Body too long (>3000 words): split into `references/*.md` files and link

## 4. Context efficiency (`context-efficiency`)

**What it rewards (10 pts):**

- Body length between 120 and 1500 words (4 pts)
- References external files: "reference", "references", "see", "template", "templates", "script", "scripts", "helper", "helpers", "link" — at least 2 mentions (3 pts for >=2, 1 pt for 1)
- No code blocks longer than 60 lines (2 pts)
- Mentions "token", "budget", or "context window" (1 pt)

**Fix patterns:**

- Body too long: move large sections (>80 lines) into `references/<topic>.md`, replace with `See references/<topic>.md for...`
- No reference links: add phrases like `See references/examples.md` or `Run scripts/foo.sh`
- Code block >60 lines: save to `scripts/<name>.sh` or `templates/<name>.md`, link from SKILL.md
- Miss the token-bonus: add one sentence referencing "the agent's context budget" or similar

## 5. Safety & guardrails (`safety`)

**What it rewards (10 pts):**

- Safety keywords: "confirm", "error", "fail", "caution", "warning", "prerequisite", "requires", "rollback", "dry-run", "safety", "validate", "check", "backup" — at least 4 (4 pts), 2-3 (2 pts), 1 (1 pt)
- Destructive action paired with confirmation/dry-run/backup (3 pts if both mentioned, 1.5 pts if no destructive actions)
- Prerequisites section (3 pts for any of: "prerequisite", "require", "depend")

**Fix patterns:**

- Add `## Prerequisites` listing tools, creds, env state
- Mention error-handling: "If X fails, do Y"
- Pair any destructive command with a confirmation or dry-run: "Run `rm -rf X` only after `--dry-run` confirms the path is correct"
- Add a "Validate" or "Check" step before committing

## 6. Testability (`testability`)

**What it rewards (10 pts):**

- Testability keywords: "acceptance criteria", "expected output", "expected result", "edge case", "test", "verify", "assert", "example input", "example output", "given", "then" — 4+ (5 pts), 2-3 (3 pts), 1 (1 pt)
- Describes expected output/result (3 pts for "expected output/result/response")
- Mentions edge cases, gotchas, pitfalls, limitations (2 pts)

**Fix patterns:**

- Add `## Acceptance Criteria` with a checklist of verifiable outputs
- Include an `Expected output:` code block under the main example
- Add `## Edge Cases` listing inputs the skill rejects or handles specially
- Use "verify" / "assert" / "check" in the instructions

**Anti-pattern to avoid:** do not pad the body with "acceptance criteria" filler just to hit the keyword. Write real, testable statements — "produces a JSON report with `overallScore`", "exits 0 on success", "creates `.asm-improver/report.md`".

## 7. Naming & conventions (`naming`)

**What it rewards (10 pts):**

- `name` is lowercase kebab-case, <=40 chars (4 pts)
- Body headings use action/imperative labels: `## When to Use`, `## Instructions`, `## Examples`, `## Steps`, `## Acceptance Criteria`, etc. (3 pts if >=50% of headings match, 1 pt otherwise)
- Description has no TODO/FIXME/double-space/stray `??` (2 pts)
- Bonus: directory basename matches frontmatter `name` (+1 pt)

**Fix patterns:**

- Rename directory to match `name` (or vice versa)
- `name: foo_bar` → `name: foo-bar` (kebab-case)
- `## About this skill` → `## When to Use`
- `## Details` → `## Instructions`
- `## Notes` → `## Edge Cases` or `## Prerequisites`
- Strip TODO/FIXME comments from the description field

## Tradeoff awareness

Fixes in one category can regress another. The common collisions:

| Fix applied                           | Possible regression                                   |
| ------------------------------------- | ----------------------------------------------------- |
| Add big "Acceptance Criteria" section | `context-efficiency` drops if body exceeds 1500 words |
| Add long example code                 | `context-efficiency` drops for code blocks >60 lines  |
| Shorten description to fix length     | `description` regresses if trigger or verb lost       |
| Split body into references            | `prompt-engineering` drops if word count <80          |

When in doubt, prefer **linking to `references/*.md`** over inlining. The evaluator rewards references in two categories (context-efficiency, naming via action-oriented heading when the reference is named well) and doesn't penalize them anywhere.

## Re-eval checklist

After every edit:

1. Run `asm eval "$SKILL_PATH" --json | jq '.overallScore, [.categories[].score] | add, [.categories[] | {id, score}]'` (or read the full JSON)
2. Compare each category against the previous iteration
3. If anything regressed, revert that specific edit and try a different pattern from this playbook
4. If the 85/8 floor is cleared, stop — do not over-optimize
