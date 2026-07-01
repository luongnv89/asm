# Predictability audit (Phase 2b — advisory)

The checklist for the advisory predictability audit. It applies skill-creator's predictability rubric to the **target** skill so the auto-improver can spot process-reliability gaps that the two hard gates miss. Findings here are **judgment-based and never pass/fail** — they inform targeted Phase 3 edits and a distinct report section, but they do not gate the loop.

## Source of truth (link, do not copy)

The rubric this audit scores against lives in skill-creator, not here:

```
~/.claude/skills/skill-creator/references/predictability-rubric.md
```

Read that file for the full _why_ and pass/fail bar of each item. This file is the **operational checklist** the auto-improver walks; it deliberately does not restate the rubric's prose (duplication is one of the things the rubric tells you to prune). If the two ever diverge, the rubric upstream wins.

**Fail-soft.** A locally-installed skill-creator may predate the rubric (it shipped in a later repo revision). If `$RUBRIC` does not resolve, **skip this phase**: log `⚠ predictability audit skipped (rubric unavailable)`, note the skip in the report's advisory section, and proceed to Phase 3. The hard gates (Gate 1, Gate 2) are unaffected — they never depend on this file.

## Root virtue

**Predictability** — the skill should make the agent follow the _same reliable process_ every run. A converging _process_, not byte-identical _output_, is the bar. Every check below serves that.

## The 7 checks

Walk these in order. For each, record `pass` or `advisory` with a one-line, _specific_ note — never "looks fine." A finding names the concrete gap and, where useful, the targeted fix.

| #   | Rubric item                                                         | What an `advisory` finding looks like                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Invocation chosen intentionally**                                 | Description optimizes for triggering but the skill is really user-invoked orchestration (or vice-versa); body voice and `description` job disagree with the actual invocation path.                                                                                                                                       |
| 2   | **Branches mapped before the body**                                 | The skill has distinct modes (create-vs-improve, per-framework, dry-run-vs-apply) but no early selector; every run reads branch-specific material it does not need.                                                                                                                                                       |
| 3   | **Demanding, checkable completion criteria**                        | A step ends on vibe ("done when it looks good") instead of a checkable bar tied to a command, file state, or count; the skill can declare success without meeting a verifiable condition.                                                                                                                                 |
| 4   | **Progressive disclosure & co-location for non-universal material** | Long, branch-specific, or rarely-needed content is inlined in SKILL.md instead of a one-line pointer to `references/`; SKILL.md drifts toward the 500-line cap; or a concept's definition, rules, and caveats are scattered across the file rather than co-located under one heading (the seed of drift and duplication). |
| 5   | **Leading words**                                                   | A recurring concept is re-explained in full at each use instead of named once (e.g. "atomic commit", "fail-soft", "publish-ready") and referred to by that name.                                                                                                                                                          |
| 6   | **No duplication / stale sediment / sprawl / no-ops**               | The same instruction appears in two places; a reference points to a file that no longer exists; a section grew past its value; a line says "be careful" / "use good judgment" without changing what the agent does.                                                                                                       |
| 7   | **Publish-ready — no auto-improver dependency**                     | (Mostly informational here — this _is_ the auto-improver.) Note structural debt that would make the skill fail the rubric if re-created through skill-creator.                                                                                                                                                            |

## Turning findings into action

- **Targeted only.** Act on a finding when the fix is small and preserves the skill's intent. A good predictability fix often _also_ lifts an asm-eval category — adding a checkable completion bar (#3) helps `testability`; collapsing a re-explained concept into a leading word (#5) helps `context-efficiency`.
- **Never bloat to satisfy a finding.** Do not inline long material or rewrite a skill wholesale to close a finding — that regresses `context-efficiency` and contradicts check #4. If a fix would grow SKILL.md past the 500-line cap, link out instead, or leave the finding open and advisory.
- **Open findings stay advisory.** A finding you choose not to act on goes into the report's **Predictability findings** section as advisory. It does **not** block PASS and is **not** a blocker entry.

## Output

Save the walk to `.asm-improver/predictability-audit.md` as a 7-row table (item → `pass`/`advisory` → note). The report's advisory section (see `references/report-template.md`) lifts from this file.
