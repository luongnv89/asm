# Report template

The final `.asm-improver/report.md` produced by this skill. PASS layout first, BLOCKER layout second. These examples define the information to preserve, not a minimum report length. Use compact text for quick operations, a diagram for relationships, or interactive HTML for repeated filtering and evidence inspection, following `human-review-audit.md`. Keep report.md as the audit record linking to any additional artifact.

Keep these sections visually distinct:

1. **Gate status** — the two hard gates (Gate 1 = skill-creator standard, Gate 2 = asm-eval 85/8). These decide PASS vs BLOCKER.
2. **Predictability findings** — the advisory Phase 2b audit. Listed in rubric order (items 1–7), never pass/fail; an open finding here is _not_ a gate failure.
3. **Target writing and human-review checks (Gate 1)** — five checks with before/after target locations, applied edits, and re-check results. An unresolved applicable requirement fails Gate 1. Report behavioral testing and human feedback separately from instruction compliance.
4. **Unresolved blockers** — present only on BLOCKER, and only ever a failed **hard gate**.

For PASS, BLOCKER, Mode 2, and early exits, lead with **Result**, **Evidence**, **Uncertainty**, and **Decision**. Link material claims to the saved checks or source locations. State “No approval needed” when applicable; list any remaining user action separately. Never infer confirmed understanding from a numeric score or blank feedback. Keep blockers and material uncertainty visible in the initial view of an interactive report.

## PASS example

```
# Skill improvement report

Skill: skills/my-skill
Verdict: PASS
Result: Added the target's output contract and clarified its validation steps.
Evidence: baseline-quickvalidate.txt and iter-3-gates.txt record the validator results; baseline.json and iter-3.json record the scores.
Uncertainty: Target behavior was not executed. Human understanding is unconfirmed.
Decision: No approval needed.
Gate 1 (skill-creator standard): √ pass
Target requirements: 4 pass, interactive-report check not applicable (quick operation)
Gate 2 (asm-eval): overallScore 91, min category 8
Predictability audit: 6/7 pass, 1 advisory (non-blocking)
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
| Dependency preflight (invokes 1 skill)  | ×        | √     |

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
| 3 | Demanding, checkable completion bars | pass     | vague completion checks repaired under Gate 1 |
| 4 | Progressive disclosure + delegability | pass     | long tables already in references/; no step heavy enough to hand a slice to a worker (a delegability finding would read: "step 3 is not delegable because it asks the user mid-step") |
| 5 | Leading words                        | pass     | — |
| 6 | No duplication / sprawl / no-ops     | advisory | repeated workflow background could be shortened; required instruction checks pass |
| 7 | Publish-ready                        | pass     | would clear the rubric if re-created |

(If Phase 2b was skipped fail-soft because the rubric was unavailable, this section reads: `Predictability audit skipped — rubric not found at $RUBRIC (hard gates unaffected).`)

## Target writing and human-review checks (Gate 1)

| Target check | Before | Edit / after evidence | Status |
| --- | --- | --- | --- |
| Controlled instructions | SKILL.md:40 had a vague success condition | SKILL.md:40 now names a command and expected exit status | pass |
| Output contract | Final summary omitted uncertainty | references/output.md:8 requires all four contract items | pass |
| Format selection | Long report required for a quick operation | references/output.md:3 specifies concise text | pass |
| Interactive reports | Target performs a single quick operation | No repeated filtering or evidence navigation needed | not applicable |
| Understanding criteria | Acceptance criteria covered correctness only | references/evaluation.md:12 contains four review checks and missing-feedback handling | pass |

Replace these illustrative locations with actual target evidence. No behavioral evals or human understanding review were performed in this example.

## Files changed
- SKILL.md
- references/examples.md (new)
- references/prerequisites.md (new)
- docs/README.md (added AI-skip notice)
- references/dependency-preflight.md (new — gate for the skill it invokes)

  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 4m 12s · tokens 128,400 · cost $0.42
              agents 0 · skills 1 · tool calls 63
```

The `Dependency preflight` row always appears; its label is **conditional**. A target that invokes another skill carries the count (`invokes 1 skill`); a target that invokes none reads `n/a` in both columns — exactly like the `Bundled scripts` row above it — and no preflight section is added to it.

The **Run stats** block closes the report and the printed summary at every terminal outcome — PASS, BLOCKER, the Phase 0 early exit, and a failed prerequisite. `elapsed`, `agents`, `skills`, and `tool calls` always print (`n/a` when undetermined); `tokens` and `cost` print only where the host reported a figure and are left out entirely otherwise, never invented and never suppressing the rest of the block. Field definitions live in SKILL.md → _Run stats (mandatory)_.

## Mode 2 — conversion report

A **delegation conversion** (SKILL.md → _Two modes_) writes its own report instead of a gate diff — none of the loop's iteration bookkeeping applies to it:

```
# Delegation conversion report

Skill: skills/my-skill
Mode: 2 — delegation conversion (user-confirmed)
Target version: 1.3.0 → 2.0.0   (MAJOR — restructured workflow)
Result: Converted the listed steps to context delegation.
Evidence: The step contracts and saved before/after gate checks support this result.
Uncertainty: Worker execution and human understanding remain untested.
Decision: No further approval needed for the authorized conversion.

## Steps converted

| Step | Slice handed over as the worker's `Input`             | Verdict                            |
|------|-------------------------------------------------------|------------------------------------|
| 2    | references/discovery-contract.md + the repo list      | converted                          |
| 3    | references/audit-eval-contract.md + the clone path    | converted                          |
| 5    | —                                                     | left inline — single decision      |
| 6    | —                                                     | left inline — needs the user mid-step |

## Gate re-check after conversion

| Gate                            | Before     | After      |
|---------------------------------|------------|------------|
| Gate 1 (skill-creator standard) | √ pass     | √ pass     |
| Gate 2 (asm-eval)               | 89 / min 8 | 90 / min 8 |
| SKILL.md body lines             | 349        | 305        |
```

Every converted step names its slice; every step left inline names why. Both gates are re-checked **once**, at the end — and a conversion that leaves either gate worse than it found it is **reverted**, with the delegability finding left advisory. `references/delegation-conversion.md` owns that rule and the rest of the procedure.

Include the five target instruction checks in the conversion report's Gate 1 results. Replace example evidence descriptions with actual target locations or saved results.

## BLOCKER example

Same layout as PASS — including the advisory **Predictability findings** section — plus an `## Unresolved blockers` section listing every **hard gate** check still failing with a one-line reason. Only failed gates appear here; open predictability findings stay in the advisory section and are never promoted to blockers.

```
## Unresolved blockers

- **Gate 1 — quick_validate.py**: still rejecting top-level key `architecture`. Field encodes no runtime info; author decision needed: drop it or move under metadata.
- **Gate 1 — target output contract**: success evidence is undefined; the author must specify which observation confirms the target's requested outcome.
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
