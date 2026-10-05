# The skill standard

The single bar every skill leaves skill-creator at — a skill created on Path A and a skill updated on Path B clear the same two hard gates. Predictability stays advisory on both paths.

This file defines the gates. It does not restate the rules behind them: each Gate 1 item links to the reference that owns its rule. The loop that measures and repairs a skill against this standard is `retrofit-loop.md`.

## Gate 1 — must-pass floor

A skill passes Gate 1 when **all** of these hold. `$QV` is skill-creator's own `scripts/quick_validate.py` (resolution: `retrofit-loop.md` → _Resolve the validator_).

| #   | Check                                                                                                                                                      | Rule owner                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `python "$QV" "$SKILL_PATH"` exits 0 with no `WARNING` lines on stderr — a warning (missing negative trigger, description over 250 chars) is a finding     | `scripts/quick_validate.py`                                                                              |
| 2   | The Frontmatter Audit passes: allowed top-level keys, name/dir match, YAML safety, README consistency; `asm eval --fix` output normalized under `metadata` | `frontmatter-rules.md` → _Frontmatter Audit on Review/Evaluation_, _Normalizing `asm eval --fix` output_ |
| 3   | The SKILL.md body is under 500 lines **and** under 3000 words — use the evaluator's count from the Context efficiency findings, never a hand estimate      | `writing-guide.md` → _Progressive Disclosure_; `cross-gate-tradeoffs.md`                                 |
| 4   | The description is one line, ≤250 characters (1024 hard), and carries a negative-trigger clause naming 2–3 adjacent domains                                | `description-guide.md`                                                                                   |
| 5   | `metadata.version` is `MAJOR.MINOR.PATCH` and `metadata.author` is present; every edited iteration bumps the version once                                  | `frontmatter-rules.md` → _Version Management_                                                            |
| 6   | A `docs/README.md`, if present, opens with the AI-skip HTML comment and carries the template sections                                                      | `readme-template.md`                                                                                     |
| 7   | Every bundled script under `scripts/` prints a descriptive error on stderr before exiting: what went wrong, which input, how to fix it                     | `writing-guide.md` → _Bundled scripts and error messages_                                                |
| 8   | Every path SKILL.md points to under `references/` exists, one level deep                                                                                   | `writing-guide.md` → _Progressive Disclosure_                                                            |
| 9   | Step Completion Reports after each major step; a `Repo Sync Before Edits (mandatory)` section when the skill mutates a git repo                            | `writing-guide.md` → _Step Completion Reports_; SKILL.md → _Mandatory Rule for Repo-Mutating Skills_     |
| 10  | Dependency preflight (conditional) — see below                                                                                                             | `references/dependency-preflight.md`                                                                     |
| 11  | The five target writing and human-review checks pass; only the interactive-report check may be not applicable, with a recorded reason                      | `human-review-audit.md` (authoring guide: `human-review.md`)                                             |

**Dependency preflight (item 10).** **If the target skill invokes another skill**, it declares frontmatter `dependencies` and carries a caller-owned first-use acquire/release lifecycle, as `references/dependency-preflight.md` specifies (four elements: discovery, first-use acquisition, direct use, cleanup). The finding reads: **Skill invokes another skill without dependency metadata and a first-use lease lifecycle**. No validator catches it, so look for it deliberately: scan for `/skill-name` invocations, reads under `~/.claude/skills/`, `~/.agents/skills/`, or `~/.codex/skills/`, and phases handed to a named skill. A skill that invokes none needs neither — add nothing: an absent preflight is not a finding, and an empty list or section is itself a defect.

`quick_validate.py` covers only the mechanical part of items 1, 2, and 4. Items 3 and 5–11 need an inspection; a validator exit and an asm score cannot substitute for it.

## Gate 2 — asm-eval quality floor

```
overallScore > 85   AND   min(categories[*].score) >= 8
```

Stricter than the overall score alone — 86 with a 5 in `testability` still fails — so one strong area cannot hide a weak one. Per-category fix patterns: `category-playbook.md`.

## Verdict

- **PASS** — Gate 1 passes **and** Gate 2 passes, measured on the final state.
- **BLOCKER** — anything else once the loop stops (`retrofit-loop.md` → _Phase 6_). The report names every failing Gate 1 check and every category still below 8, each with a one-line reason.
- **Advisory** — predictability findings (`predictability-rubric.md` while creating, `predictability-audit.md` in the loop) never block and are never promoted to a blocker, on either path.

## Without `asm`

Gate 2 needs `asm` on PATH. Without it the outcome is **Gate 2 not measured**, and a run never reports PASS on either path — a guessed score is not a measurement.

- **Subpath B1** stops at its prerequisites as a failed prerequisite, before Phase 0, and prints the Run stats block.
- **Path A** still runs the Gate 1 checks, reports their status plus `Gate 2 not measured`, and ends without PASS, naming the fix: install `asm` and re-run the closing check.

## How each path applies the standard

- **Path A — closing check.** After the adversarial review and evals, run `retrofit-loop.md` Phase 0 on the new skill. Both gates pass → the early exit; report PASS. Otherwise continue that same loop from Phase 1 under the same caps and report PASS or BLOCKER.
- **Subpath B1 — retrofit.** This is the loop itself: `retrofit-loop.md` Phases 0–7.
- **Subpath B2 — eval feedback.** Close with the same Phase 0 check as Path A once the revision lands.
- **Subpath B3 — delegation conversion.** Requires a Gate 1 pass before it starts, and leaves both gates no worse than it found them (`delegation-conversion.md`).
