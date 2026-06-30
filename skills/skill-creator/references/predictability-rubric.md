# Predictability Rubric

The standard a skill must meet **by construction** when authored through skill-creator — so it ships publish-ready and does not need a later `skill-auto-improver` cleanup pass to become standard-compliant. Apply it during creation (the "Creating a skill" path in `SKILL.md`), not as an afterthought.

**Root virtue: predictability.** A good skill makes the agent follow the _same reliable process_ every run. Identical _outputs_ are not the goal — a predictable _process_ is. Everything below serves that.

Skills should stay **small, adaptable, composable**, and be designed around two budgets:

- **Context load** — how many tokens the skill costs every time it loads. Lower is better; this is why SKILL.md has a 500-line cap and dense material moves to `references/` (progressive disclosure).
- **Cognitive load** — how much the agent must hold in mind to act correctly. Ordered steps, leading words, and one-decision-at-a-time structure lower it.

The rest of this file is the checkable rubric. The matching items in `SKILL.md` are the _hooks_ (do them while writing); this file is the _why_ and the pass/fail bar.

## 1. Choose invocation intentionally

Decide **model-invoked vs user-invoked** before drafting the body — it changes how the skill is written.

| Invocation                       | Use when                                                                                                                                                       | Description job                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Model-invoked** (the default)  | The skill is a _reusable discipline_ the agent should apply on its own whenever the situation fits (a transform, a review pass, a fixed workflow).             | The `description` must trigger reliably — pushy positives + negative triggers (see `SKILL.md` → _Writing a good description_). |
| **User-invoked** (`/skill-name`) | The skill is _orchestration or control_ the user runs deliberately — a multi-step pipeline, a destructive or expensive action, a thing the user must opt into. | The `description` documents intent for the listing; triggering matters less because the user names it.                         |

A skill can be both, but pick the _primary_ path — it decides whether you optimize the description for triggering or for human-readable intent, and whether the body reads as "apply this now" or "the user asked for this, proceed."

**Checkable:** the skill states (in its own design notes or its shape) which invocation it targets, and the description/body match that choice.

## 2. Map branches before drafting

Before writing substantial body content, identify the skill's distinct **branches / modes** — the paths through it that differ enough to need different instructions (create-vs-improve, per-framework, per-environment, dry-run-vs-apply).

Why first: branches drive both structure _and_ progressive disclosure. Once you know them you can write a short selector at the top and disclose branch-specific material only on the branch that needs it — instead of forcing every run to read every branch.

**Checkable:** the SKILL.md opens with (or quickly reaches) a branch selector, and branch-specific detail is not loaded on branches that don't use it.

## 3. Demanding, checkable completion criteria

Each ordered step ends with a completion bar the agent can _check_, not vibe. "Done when the report prints PASS and `quick_validate.py` is clean" beats "done when it looks good." Strong criteria are what make the process repeatable — they stop the agent from declaring success early.

Use the Step Completion Reports format (`SKILL.md` → _Step Completion Reports_) for step-based workflows: explicit `√/×` checks plus a `Result: PASS | FAIL | PARTIAL` line. Make the checks _demanding_ — tie them to commands, file states, or counts, not impressions.

**Checkable:** every major step in a step-based skill has a verifiable completion condition; the skill cannot report success without meeting it.

## 4. Progressive disclosure for non-universal material

Anything **branch-specific, long, or not needed on every run** belongs in `references/`, reached by a one-line pointer — not inlined into SKILL.md. This is the same rule SKILL.md already states for the 500-line cap; named here so the rubric is complete. Do not re-document the mechanics — see `writing-guide.md` → _Progressive Disclosure_.

**Checkable:** SKILL.md stays under 500 lines; reference files are one level deep and pointed to with clear "read this when X" guidance.

## 5. Leading words

Use **leading words** — short, load-bearing terms that steer behavior and collapse a verbose concept into one token the agent already understands. "Atomic commit," "fail-soft," "red-capable test," "publish-ready" each carry a paragraph of meaning. Prefer one precise leading word over three sentences re-explaining it.

**Checkable:** recurring concepts are named once and referred to by that name, rather than re-explained at each use.

## 6. Pruning pass (run before finishing)

Before the skill is done, do one explicit pass to remove what the rubric above is meant to prevent. This is the step that most often separates a skill-creator-authored skill from one that still needs `skill-auto-improver`.

Cut, in this order:

- **Duplication** — the same instruction stated in two places. Keep one home; link to it. (Re-explaining progressive disclosure in three files is duplication.)
- **Stale sediment** — guidance left over from an earlier version that no longer matches the current flow, dead references, obsolete file names.
- **Sprawl** — sections that grew past their value, prose that could be a table or a leading word, SKILL.md drifting toward the 500-line cap.
- **No-op instructions** — lines that tell the agent nothing actionable ("be careful," "use good judgment," "make it high quality"). Replace with a checkable criterion or delete.

**Checkable:** a reviewer reading the finished skill finds no instruction stated twice, no reference to something that no longer exists, and no line that fails to change what the agent does.

## 7. Publish-ready — no auto-improver dependency

The output of skill-creator is a **publish-ready** skill. A skill authored through this path should clear the skill-creator standard on its own — `quick_validate.py` clean, Frontmatter Audit passing, SKILL.md under 500 lines, description with a negative-trigger clause, the items above satisfied — **without** a follow-up `skill-auto-improver` run as a normal cleanup step.

`skill-auto-improver` still has a job: bringing _externally authored_ or _legacy_ skills up to standard. It is the remediation tool for skills that did **not** go through this rubric — not a required second stage for ones that did.

**Checkable:** running `skill-auto-improver` immediately after creation would find nothing structural to fix.

---

## How to apply this rubric

Test and iterate until the skill produces a **predictable process**. Run the test prompts (`SKILL.md` → _Running and evaluating test cases_) more than once: a predictable skill drives the agent down the same path each time even when the wording of the request varies. If two runs diverge in _process_ (different steps, skipped checks), the skill is under-specified — tighten the ordered steps, completion criteria, or leading words until they converge. Converging _process_, not byte-identical _output_, is the bar.
