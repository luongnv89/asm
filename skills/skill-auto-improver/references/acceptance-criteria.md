# Acceptance criteria (full list)

`SKILL.md` → _Acceptance Criteria_ carries the bars that decide PASS vs BLOCKER. This file is the complete run checklist — the process obligations that hold whichever way the run ends. Walk it before writing the Phase 7 report.

## Artifacts

- `.asm-improver/baseline.json`, `.asm-improver/baseline-quickvalidate.txt`, and `.asm-improver/baseline-frontmatter-audit.md` captured **before any edits**
- Every iteration's `asm eval --json` saved to `.asm-improver/iter-N.json`, with a one-line gate summary in `.asm-improver/iter-N-gates.txt`
- `.asm-improver/predictability-audit.md` holds the Phase 2b walk, or records the fail-soft skip when the rubric was unavailable
- `.asm-improver/report.md` exists on exit, pass or blocker, with gate status, advisory predictability findings, and unresolved blockers as three visually distinct sections

## Process

- `asm eval --fix` run (at minimum `--dry-run`), then frontmatter normalized so `quick_validate.py` accepts the result
- Each Gate 1 check addressed at least once **before** any Gate 2 work
- A target that invokes another skill ends the run with a dependency preflight naming each dependency, its install command, the command that installs the installer itself, and a verification step; a target that invokes none gains no such section
- Each `asm eval` category below 8 addressed at least once
- Both gates re-evaluated after every iteration
- The target's `metadata.version` bumped exactly once per iteration that produced edits
- The loop stopped on one of the 4 conditions in Phase 6 — never unbounded

## Outcome

- On **PASS**: `python "$QV" "$SKILL_PATH"` exits 0 AND the final eval JSON shows `overallScore > 85` AND `min(categories[*].score) >= 8`
- On **BLOCKER**: the report names every Gate 1 check still failing and every category still below 8, each with a one-line reason. Open predictability findings alone never constitute a blocker
- Either way, the summary closes with the Run stats block — `elapsed`, `agents`, `skills`, and `tool calls` always present (`n/a` when undetermined), `tokens` and `cost` printed only where the host reported them and never invented
