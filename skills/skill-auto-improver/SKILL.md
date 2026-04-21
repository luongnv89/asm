---
name: skill-auto-improver
description: Improve a SKILL.md skill by running `asm eval`, fixing weakest categories, and looping until it clears the 85/8 floor or stops with a blocker. Use when leveling up a skill, preparing for publish, or rescuing a failing eval.
version: 0.1.0
license: MIT
creator: luongnv89
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
tags: eval, quality, authoring
metadata:
  creator: luongnv89
---

# Skill Auto-Improver

You are running an eval-driven improvement loop for a SKILL.md-based skill. The target is a hard quality floor: **overallScore > 85** AND **every category score >= 8**. Do not stop improving until that floor is cleared or you hit the blocker conditions in the final section.

## When to Use

- The user asks to "improve", "level up", "fix", or "polish" a skill
- A skill scores below 85 on `asm eval` and must ship
- You are preparing a skill for `asm publish` or inclusion in the index
- You want to dogfood quality improvements on one of your own skills

If the user only wants a report without changes, run `asm eval <path>` directly — that is not this skill.

## Prerequisites

Verify all of the following before touching any files. Stop and tell the user if any fails.

- `asm` is available on PATH (`command -v asm` or `which asm`)
- The target skill path contains a `SKILL.md` file
- The working tree has no unrelated uncommitted edits (dirty files get mixed into diffs)
- You have write access to the skill directory

## Inputs

The user provides one of:

- A local skill path: `skills/foo` or `/abs/path/to/skill`
- A direct `SKILL.md` file path
- A GitHub shorthand: `github:owner/repo` or `github:owner/repo:path/to/skill`

For GitHub inputs, either clone locally first or ask the user whether they want you to open a PR back to that repo. This skill's default path is **local editing** — remote editing is out of scope for v0.1.

## The 85/8 Quality Floor

Every iteration must satisfy both checks on the final eval:

```
overallScore > 85   AND   min(categories[*].score) >= 8
```

The 85/8 rule is stricter than overall score alone. A skill at 86 with a 5 in `testability` still fails, because a single weak category is enough to block the skill. This is the whole point of the rule — force balanced quality instead of letting one strong area hide a weak one.

## Workflow

Do these phases in order. Do not skip phases or change the order.

### Phase 0 — Capture baseline

Save the starting report so the before/after diff is auditable:

```bash
mkdir -p .asm-improver
asm eval "$SKILL_PATH" --json > .asm-improver/baseline.json
```

If the target skill lives inside a git repo, suggest adding `.asm-improver/` to `.gitignore` so iteration artifacts stay out of version control.

Read the JSON and note:

- `overallScore`, `grade`
- Every `categories[].score` (7 categories, each out of 10)
- `topSuggestions` (the evaluator's own priorities)

If the baseline already meets 85/8, stop immediately — print a one-line summary and skip to the final report. Do not "improve" a skill that already passes.

### Phase 1 — Apply deterministic fixes first

Run the evaluator's auto-fixer for free wins:

```bash
asm eval "$SKILL_PATH" --fix --dry-run   # preview the diff
asm eval "$SKILL_PATH" --fix              # write, creates SKILL.md.bak
```

This handles frontmatter reordering, missing `version: 0.1.0`, missing `creator` from git config, `effort` inference, trailing whitespace, and CRLF normalization. Do this **before** any content work — it's deterministic and cheap, and it clears noise from the next eval.

After `--fix`, re-run `asm eval <path> --json` and re-read the categories. Many skills jump 5-15 points here without touching the body.

### Phase 2 — Fix the lowest categories first

Sort the 7 categories by score ascending. Work on the lowest one first. Stop when all of them are `>= 8`.

For each category below 8:

1. Read `references/category-playbook.md` to find the fix patterns for that category
2. Apply them with `Edit` (small targeted changes) or `Write` (when restructuring a whole section)
3. Re-run `asm eval "$SKILL_PATH" --json` and check that the category moved up

**Do not batch-edit multiple categories blindly.** Fixes can interact — expanding the body for `testability` can tank `context-efficiency`. One category at a time, re-eval after each change, keep the ones that help, revert the ones that regress.

### Phase 3 — Watch for category tradeoffs

The evaluator penalizes bodies over 1500 words (context-efficiency) and over 3000 words (prompt-engineering). When you add content, default to **linking out, not inlining**:

- Long examples → `references/examples.md` with `See references/examples.md for...`
- Long scripts → `scripts/foo.sh` with `Run scripts/foo.sh to...`
- Long tables → `references/rubric.md`
- Long prerequisite lists → `references/prerequisites.md`

This pattern earns `context-efficiency` points (the word "reference" / "see" / "link" / "template" is scanned for) and keeps SKILL.md under the budget.

Concretely, if you would need more than ~80 lines to add a section, put it in `references/` and link to it from SKILL.md in 2-3 lines.

### Phase 4 — Loop with a cap

Re-run `asm eval "$SKILL_PATH" --json` after every edit. The loop stops when any of these is true:

| Stop condition                             | Outcome                  |
| ------------------------------------------ | ------------------------ |
| `overallScore > 85` AND `min(scores) >= 8` | PASS — proceed to report |
| 8 eval runs completed                      | BLOCKER — write report   |
| 3 consecutive runs with no score change    | BLOCKER — write report   |
| 2 consecutive runs with score regression   | BLOCKER — revert, report |

Save every iteration's JSON to `.asm-improver/iter-N.json` so the final report can diff them.

### Phase 5 — Write the final report

On pass, write `.asm-improver/report.md` with:

- Target skill path
- Baseline vs final: `overallScore`, `grade`, per-category before/after table
- Files changed (list every path under the skill directory that was edited or created)
- Iterations taken (N of 8)
- Key fixes applied (one line per category that moved)

On blocker, write the same report but add a "Blockers" section explaining why the floor was not met. Blocker entries must name the category, the current score, and what the evaluator keeps flagging. Do not pretend a blocker is a pass.

Example blocker entry:

> **testability** (stuck at 6/10): The evaluator wants verifiable outputs and an "Acceptance Criteria" section. The skill's output is a subjective rewrite of prose, which is hard to express as a testable assertion. Author decision needed: accept a 6 here, or redefine scope so output is machine-checkable.

## Acceptance Criteria

- `.asm-improver/baseline.json` captured before any edits
- Deterministic fixes (`asm eval --fix`) applied before content edits
- Each category below 8 addressed at least once
- Re-eval runs after every edit, captured to `.asm-improver/iter-N.json`
- Loop stops on one of the 4 conditions in Phase 4 — never unbounded
- `.asm-improver/report.md` exists on exit, pass or blocker
- On PASS: final eval JSON shows `overallScore > 85` AND `min(categories[*].score) >= 8`
- On BLOCKER: report names every category still below 8 and explains why

### Expected output

On PASS, the final `.asm-improver/report.md` should look like:

```
# Skill improvement report

Skill: skills/my-skill
Verdict: PASS (overallScore 91, min category 8)
Iterations: 3 of 8

## Before vs after

| Category            | Baseline | Final | Delta |
|---------------------|----------|-------|-------|
| structure           | 10       | 10    | 0     |
| description         | 4        | 9     | +5    |
| prompt-engineering  | 3        | 10    | +7    |
| context-efficiency  | 6        | 9     | +3    |
| safety              | 5        | 8     | +3    |
| testability         | 2        | 8     | +6    |
| naming              | 10       | 10    | 0     |
| **Overall**         | **57**   | **91**| **+34** |

## Files changed
- SKILL.md
- references/examples.md (new)
- references/prerequisites.md (new)
```

On BLOCKER, the same layout plus a `## Blockers` section listing every category still below 8 with a one-line reason each.

## Edge Cases

- **Skill already passes 85/8**: stop at Phase 0, skip to report. Do not edit passing skills.
- **SKILL.md has no frontmatter**: `asm eval --fix` cannot add it. Ask the user whether to scaffold one, or abort.
- **Iterating regresses the score**: revert the last edit (`cp SKILL.md.bak SKILL.md` if available, or undo via git) and try a different fix pattern from the playbook.
- **Loop caps out at 8 iterations**: the skill has structural issues auto-improvement cannot solve. Write the blocker report and hand back to the user.
- **GitHub shorthand input**: for v0.1, ask the user to clone locally first. Remote editing is out of scope.
- **Destructive action**: never `rm -rf` the skill directory. `asm eval --fix` creates `SKILL.md.bak` — leave it in place until the user explicitly cleans up.

## References

- `references/category-playbook.md` — per-category fix patterns, scoring rules, and anti-patterns
- `asm eval --help` — flag reference for the evaluator
- `src/evaluator.ts` in the ASM repo — the source of truth for how each category is scored
