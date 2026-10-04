# Acceptance criteria (full list)

`SKILL.md` → _Acceptance Criteria_ carries the bars that decide PASS vs BLOCKER. This file is the complete run checklist — the process obligations that hold whichever way the run ends. Walk it before writing the Phase 7 report.

## Artifacts

- `.asm-improver/baseline.json`, `.asm-improver/baseline-quickvalidate.txt`, and `.asm-improver/baseline-frontmatter-audit.md` captured **before any edits**
- Every iteration's `asm eval --json` saved to `.asm-improver/iter-N.json`, with a one-line gate summary in `.asm-improver/iter-N-gates.txt`
- `.asm-improver/predictability-audit.md` holds the Phase 2b walk, or records the fail-soft skip when the rubric was unavailable
- `.asm-improver/baseline-human-review.md` records the five target checks before edits; `.asm-improver/human-review-audit.md` records target locations, repairs, and re-check results
- `.asm-improver/report.md` exists on exit with gate status, advisory findings, and hard-gate blockers kept distinct; it can link to additional review artifacts

## Process

- On the failing-baseline path, `asm eval --fix` run (at minimum `--dry-run`), then frontmatter normalized so `quick_validate.py` accepts the result
- Each Gate 1 check addressed at least once **before** any Gate 2 work
- A target that invokes another skill declares it in frontmatter and ends with caller-owned first-use acquire, direct-path use, and idempotent release instructions; a target that invokes none gains no empty dependency list or preflight
- Each `asm eval` category below 8 addressed at least once
- Both gates re-evaluated after every iteration
- The target's `metadata.version` bumped exactly once per iteration that produced edits
- The loop stopped on one of the 4 conditions in Phase 6, or both full gates already passed at baseline
- The human-review audit ran even if the upstream predictability rubric was missing; understanding is unconfirmed without responsive human feedback
- All applicable target requirements were repaired in the target's instructions, templates, references, and evaluation guidance; unresolved requirements fail Gate 1
- The final output states result, evidence, uncertainty, and approval decision using the simplest inspectable format

## Outcome

- On **PASS**: every Gate 1 requirement passes, including the five target checks, AND the final eval JSON shows `overallScore > 85` AND `min(categories[*].score) >= 8`. Only the interactive-report check can be not applicable, with a target-specific reason
- On **BLOCKER**: the report names every Gate 1 check still failing and every category still below 8, each with a one-line reason. Open predictability findings alone never constitute a blocker
- Either way, the summary closes with the Run stats block — `elapsed`, `agents`, `skills`, and `tool calls` always present (`n/a` when undetermined), `tokens` and `cost` printed only where the host reported them and never invented
