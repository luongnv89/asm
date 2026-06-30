# Report template

The final `.asm-improver/report.md` produced by this skill. PASS layout first, BLOCKER layout second.

The report keeps **three sections visually distinct** so a reader never confuses one for another:

1. **Gate status** — the two hard gates (Gate 1 = skill-creator standard, Gate 2 = asm-eval 85/8). These decide PASS vs BLOCKER.
2. **Predictability findings** — the advisory Phase 2b audit. Listed in rubric order (items 1–7), never pass/fail; an open finding here is _not_ a gate failure.
3. **Unresolved blockers** — present only on BLOCKER, and only ever a failed **hard gate**.

## PASS example

```
# Skill improvement report

Skill: skills/my-skill
Verdict: PASS
Gate 1 (skill-creator standard): √ pass
Gate 2 (asm-eval): overallScore 91, min category 8
Predictability audit: 5/7 pass, 2 advisory (non-blocking)
Iterations: 3 of 8
Target version: 0.2.0 → 1.0.0

## Gate 1 — skill-creator standard

| Check                                | Baseline    | Final |
|--------------------------------------|-------------|-------|
| quick_validate.py exit code          | 1 (rejected)| 0     |
| Allowed top-level keys only          | ×           | √     |
| metadata.version present             | ×           | √     |
| metadata.author present              | ×           | √     |
| Description ≤250 chars               | √           | √     |
| Negative-trigger clause              | × (warning) | √     |
| SKILL.md body <500 lines             | √ (290)     | √ (290)|
| docs/README.md AI-skip notice        | √           | √     |
| Bundled scripts have descriptive errors | n/a      | n/a   |

## Gate 2 — asm-eval categories

| Category            | Baseline | Final | Delta   |
|---------------------|----------|-------|---------|
| structure           | 10       | 10    | 0       |
| description         | 4        | 9     | +5      |
| prompt-engineering  | 3        | 10    | +7      |
| context-efficiency  | 6        | 9     | +3      |
| safety              | 5        | 8     | +3      |
| testability         | 2        | 8     | +6      |
| naming              | 10       | 10    | 0       |
| **Overall**         | **57**   | **91**| **+34** |

## Predictability findings (advisory — not gates)

Source: Phase 2b audit against skill-creator's predictability rubric. None of these block PASS.

| # | Rubric item                          | Status   | Note |
|---|--------------------------------------|----------|------|
| 1 | Invocation chosen intentionally      | pass     | model-invoked; description triggers reliably |
| 2 | Branches mapped before the body      | pass     | create/improve selector at top |
| 3 | Demanding, checkable completion bars | advisory | step 4 ends on "looks complete" — tie to a count; left as-is to avoid scope creep |
| 4 | Progressive disclosure               | pass     | long tables already in references/ |
| 5 | Leading words                        | pass     | — |
| 6 | No duplication / sprawl / no-ops     | advisory | "be thorough" line in step 2 is a no-op; candidate for a later pass |
| 7 | Publish-ready                        | pass     | would clear the rubric if re-created |

(If Phase 2b was skipped fail-soft because the rubric was unavailable, this section reads: `Predictability audit skipped — rubric not found at $RUBRIC (hard gates unaffected).`)

## Files changed
- SKILL.md
- references/examples.md (new)
- references/prerequisites.md (new)
- docs/README.md (added AI-skip notice)
```

## BLOCKER example

Same layout as PASS — including the advisory **Predictability findings** section — plus an `## Unresolved blockers` section listing every **hard gate** check still failing with a one-line reason. Only failed gates appear here; open predictability findings stay in the advisory section and are never promoted to blockers.

```
## Unresolved blockers

- **Gate 1 — quick_validate.py**: still rejecting top-level key `architecture`. Field encodes no runtime info; author decision needed: drop it or move under metadata.
- **Gate 2 — testability** (stuck at 6/10): evaluator wants verifiable outputs; skill output is subjective prose. Author decision needed.
- **Gate 2 — safety** (stuck at 7/10): no destructive-action guardrail; add a dry-run or confirmation step.
```

The verdict line on a blocker reads:

```
Verdict: BLOCKER
Gate 1 (skill-creator standard): × failing 1 check
Gate 2 (asm-eval): overallScore 86, min category 6 (below floor)
Predictability audit: 4/7 pass, 3 advisory (non-blocking)
```

Both gate states are reported even when only one is failing — so a reviewer can see at a glance which gate is the holdup. The predictability line is informational: it never changes the verdict.
