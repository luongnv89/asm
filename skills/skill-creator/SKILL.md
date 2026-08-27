---
name: skill-creator
description: "Create, improve, evaluate, benchmark skills. Use when authoring a new skill, updating an existing one, running evals, or optimizing a skill's description for triggering. Don't use for invoking skills, writing prose, or scaffolding Python projects."
license: MIT
effort: max
metadata:
  version: 1.16.2
  author: "Luong NGUYEN <luongnv89@gmail.com>"
---

# Skill Creator

A skill for creating new skills and iteratively improving them. The agent's context budget is the primary constraint, so this SKILL.md links out to focused reference files.

The core loop:

1. Decide what the skill should do and how it should do it
2. Write a draft
3. Run test prompts against claude-with-access-to-the-skill
4. Evaluate results with the user (qualitative review via `eval-viewer/generate_review.py`, plus quantitative evals)
5. Revise the skill based on feedback and benchmarks
6. Repeat until satisfied; expand the test set and try again at scale

Identify where the user is in this loop and jump in there. New skill from scratch → start at step 1. Existing draft → jump to step 3 or 4. User wants to vibe-iterate without formal evals → support that. After the skill stabilizes, optionally run the description improver to optimize triggering.

## Two entry paths

The skill supports two distinct workflows. **Identify which one the user is on before you do anything else** — they don't share a starting step.

- **Path A — Create a new skill from scratch.** The user wants to capture a workflow, codify a pattern, or build a new capability. Start at **"Creating a skill"** below (Capture Intent → Interview → Write SKILL.md → Test → Eval).
- **Path B — Improve an existing skill.** The user points to a skill that already exists and wants it brought up to standard, fixed, optimized, or iterated based on eval feedback. **Do not start with Capture Intent** — the intent is already encoded in the existing SKILL.md. Start at **"Improving an existing skill"** below.

If the request is ambiguous ("can you look at this skill?"), assume **Path B** and confirm before interviewing as if it were new. Path B also fires when `/skill-creator` is invoked on a skill directory or file.

Both paths share the mandatory rules below: **Repo Sync Before Edits**, **Dependency Preflight**, **Version Management**, **YAML Frontmatter Safety**, and **Frontmatter Audit on Review/Evaluation**. Apply them in either path. Both paths also close with the **Run stats** block.

## Step Completion Reports

After completing each major step, output a status report in this format:

```
◆ [Step Name] ([step N of M] — [context])
··································································
  [Check 1]:          √ pass
  [Check 2]:          √ pass (note if relevant)
  [Check 3]:          × fail — [reason]
  [Check 4]:          √ pass
  [Criteria]:         √ N/M met
  ____________________________
  Result:             PASS | FAIL | PARTIAL
```

Adapt the check names to match what the step actually validates. Use `√` for pass, `×` for fail, and `—` to add brief context. The "Criteria" line summarizes how many acceptance criteria were met. The "Result" line gives the overall verdict.

Per-phase checks:

| Phase          | Checks                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Intent Capture | `Worth building`, `Goal defined`, `Triggers identified`, `Output format agreed`                                                   |
| Skill Writing  | `SKILL.md written`, `README generated`, `Subagents designed`, `Dependency preflight`, `Predictability pass`, `Adversarial review` |
| Testing        | `Evals created`, `Runs completed`, `Viewer launched`                                                                              |
| Iteration      | `Feedback incorporated`, `Benchmarks improved`, `Description optimized`                                                           |

`Dependency preflight` is `√` when the skill has no skill dependencies, or has them and ships a gate for each; `×` when a dependency is invoked without one. `Predictability pass` walks the 7 rubric items from _Make it predictable_ — `√` per item satisfied, `×` naming the gap. `Adversarial review` is `√` once fresh-subagent findings are addressed.

## Run stats (mandatory)

Every run that creates or updates a skill closes its summary with a run-stats block — the last thing printed, after the final Step Completion Report. It reports what the run **cost**, and nothing the run already reported.

Capture `run_started_epoch` **once**, in the same shell as the skill's first command — `cmd; ec=$?; date +%s >&2; exit "$ec"` — reading the epoch off stderr so stdout and the exit code stay intact. Set it there, not later: without the anchor `elapsed` prints `n/a`, and the block still has to print on an early stop.

```
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 6m 04s · tokens 128,400 · cost $0.42
              agents 3 · skills 1 · tool calls 47
```

Fields are fixed and in this order — never reordered, renamed, or added to: `elapsed`, `tokens`, `cost`, `agents`, `skills`, `tool calls`. Per-field formatting: `references/run-stats.md`.

- **`tokens` and `cost` are omitted entirely when the host reported no figure** — no dangling `·`, no placeholder. Never estimate one, and never reconstruct one from host transcripts or logs.
- **`elapsed`, `agents`, `skills`, and `tool calls` always print.** A value that cannot be determined prints the literal `n/a`; `0` is a determined value and is correct where it is true (a run that spawned no subagents prints `agents 0`).
- A missing optional figure never suppresses the rest of the block.

Print it on **every** path that finishes a create or update — Path A, Subpath B1, and Subpath B2 — and on every other terminal outcome too: an early stop, a gate that refused to continue, or a failed step. Only a run that produced no output at all has no block.

## Communicating with the user

Users span a wide range of technical familiarity. Match jargon to context cues — terms like "JSON" or "assertion" need evidence the user knows them; briefly define terms when in doubt.

---

## Mandatory Rule for Repo-Mutating Skills

When creating or updating any skill that changes files in a git repository (code, docs, config, commits, publishing), include this rule in that skill's SKILL.md:

- Add a **"Repo Sync Before Edits (mandatory)"** section near the top requiring `branch="$(git rev-parse --abbrev-ref HEAD)"; git fetch origin && git pull --rebase origin "$branch"` before modifications.
- If the working tree is dirty: stash, sync, then pop.
- If `origin` is missing or conflicts occur: stop and ask the user before continuing.

Do not ship repo-mutating skills without this pre-sync guardrail.

## Mandatory Rule for Skills That Invoke Other Skills

Establish, for every skill you author or retrofit, whether it invokes, delegates to, or reads **another skill**. Ask it in the interview — _Does this skill invoke other skills?_ is Capture Intent question 6 — and confirm the answer against the draft: prose naming `/another-skill`, or a read under `~/.claude/skills/`, is a dependency even when the author said there were none.

- **It does** → the skill you produce ships a `## Dependency Preflight (mandatory)` section, placed above the first step that changes anything. Per dependency it names the skill, the command that installs it, the command that installs the installer itself, and a verification command; on a miss it stops before the first mutation.
- **It does not** → add nothing. No empty preflight section, no "no dependencies" placeholder.

Read `references/dependency-preflight.md` for the copyable template and the on-miss behavior. `skill-auto-improver` audits for this same rule, so a skill that ships without a required gate comes back as a finding later.

## Frontmatter rules (mandatory)

Read `references/frontmatter-rules.md` for the full mandatory rules:

- **Version Management** — set `metadata.version: 1.0.0` on creation; bump patch/minor/major on every edit.
- **YAML Frontmatter Safety** — double-quote any string value containing YAML-special characters (full list in the reference).
- **Frontmatter Audit on Review/Evaluation** — required-field check, name/dir match, allowed top-level keys, `metadata.version`, `metadata.author`, YAML safety, and consistency with `docs/README.md`. Run `python scripts/quick_validate.py <skill-path>` first; it catches mechanical issues without LLM reasoning.

These rules apply on every write. Always confirm them before saving.

## Creating a skill

### Capture Intent

Read `references/intent-interview.md` and work it top to bottom. It carries:

- **The gate** — a skill earns its place only when the workflow is repeated, non-obvious, and stable. Recommend against creating it otherwise; the user can override.
- **The seven interview questions** — purpose, triggers, the expected output format, test cases, subagents (including per-step context delegation), skill dependencies, and model-invoked vs. user-invoked (`/skill-name` is orchestration the user runs deliberately — a pipeline, or an expensive or destructive action they confirm first).
- **Interview and research** — edge cases, example files, success criteria, available MCPs.
- **Branch mapping before drafting** — name the distinct modes the skill runs in, so branch-specific material is disclosed only on the branch that uses it.

Extract what the conversation already answers before asking the user anything; they fill the gaps and confirm.

### Write the SKILL.md

Before drafting, skim `references/exemplars.md` and imitate the archetype closest to this skill — workflow, knowledge, or orchestrator. Then, based on the user interview, fill in:

- **name**: 1-64 chars, lowercase letters/digits/hyphens, no consecutive hyphens, exactly matches parent directory. Enforced by `scripts/quick_validate.py`.
- **description**: When to trigger and what it does. Primary triggering mechanism. Single line, no newlines. Claude tends to _undertrigger_ — make descriptions a little "pushy", with negative triggers.
- **effort** (optional): `low | medium | high | xhigh | max`. Defaults to `high`.
- **metadata.version**: Semver string (see frontmatter rules).
- **compatibility**: Required tools or dependencies (rare).

#### Writing a good description

Read `references/description-guide.md` for the full guide: the pushy + negative-triggers pattern (a "Don't use for ..." clause naming 2–3 adjacent domains), one trigger per branch, and the three length limits. The rule that bites first: **target ≤250 characters** — Claude Code's `/skills` listing truncates tail-first beyond that, chopping the negative-trigger clause. `scripts/quick_validate.py` warns (non-fatal) when the negative clause looks missing.

### Skill Writing Guide

Read `references/writing-guide.md` for the full guide. It covers anatomy (where `agents/`, `references/`, `scripts/`, `assets/`, `docs/` go), progressive disclosure and the 500-line SKILL.md cap, the Principle of Lack of Surprise, writing and workflow patterns, bundled-script error messages, Step Completion Reports, writing style, `docs/README.md` generation (`references/readme-template.md`), the 5-prompt test-case floor saved to `evals/evals.json` (`references/schemas.md`), and the pre-eval LLM validation phases (`references/validation-prompts.md`).

### Make it predictable (publish-ready by construction)

The goal of creating a skill here is a **predictable process** — the agent follows the same reliable path every run — and a skill that ships **publish-ready** without later needing a `skill-auto-improver` cleanup pass. Read `references/predictability-rubric.md` for the full standard and its checkable pass/fail bar. The hooks you apply _while writing_:

- **Demanding completion criteria.** End every major step with a bar the agent can _check_, not vibe — tied to a command, file state, or count. The Step Completion Reports format above is the vehicle. Strong criteria are what stop the agent declaring success early.
- **Progressive disclosure for non-universal material.** Anything branch-specific, long, or not needed on every run goes to `references/` behind a one-line pointer — this keeps context load low and SKILL.md under the caps. Its step-level analogue is **per-step context delegation**: a delegable step names the slice of `references/` its worker needs and hands that slice over as the worker's `Input`, so the main agent never holds the whole tree (`references/subagent-patterns.md` → _Per-Step Context Delegation_, which also says when the slice isn't worth taking).
- **Leading words.** Name a recurring concept once with a short load-bearing term ("atomic commit", "fail-soft", "publish-ready") and reuse the term, rather than re-explaining it at each use.
- **Pruning pass — run before finishing.** One explicit pass to cut duplication, stale sediment, sprawl, and no-op instructions ("be careful", "use good judgment"). This pass is what most often separates a skill-creator-authored skill from one that still needs `skill-auto-improver`.

Before finishing, **walk all 7 rubric items** (the four hooks above plus invocation choice, branch mapping, and publish-ready) and emit the result as the `Predictability pass` row of the Skill Writing Step Completion Report. This makes the rubric walk visible instead of silent — a `×` is a fix-before-publish signal, not a blocker.

`skill-auto-improver` remains the remediation tool for _externally authored_ or _legacy_ skills — not a required second stage for a skill created through this path.

### Adversarial review (mandatory before evals)

The drafting context cannot review its own draft — it fills every gap from memory instead of from the page. After the rubric walk, spawn a **fresh subagent** with the draft skill and phases 1–3 of `references/validation-prompts.md` (discovery, logic walk, edge-case attack); it returns trigger misses, ambiguous steps, and breaking prompts. Fix the real findings before running evals; carry the rest into the test set. If no Agent tool is available, run the phases yourself in a fresh session (see `references/environment-modes.md`).

## Running and evaluating test cases

Read `references/eval-loop.md` for the full 5-step sequence (spawn runs, draft assertions, capture timing, grade/aggregate/view, read feedback). It covers the with-skill + baseline subagent pattern, the `eval_metadata.json` and `timing.json` formats, the `generate_review.py` invocation, and reading `feedback.json`.

Do NOT use `/skill-test` or any other testing skill — the flow in `references/eval-loop.md` is the one this skill expects.

## Improving an existing skill

This is **Path B** from the entry-paths block at the top. Read `references/improving-existing.md` and pick the subpath from what the user is asking for — they don't share an opening move.

- **Subpath B1 — retrofit to the standard.** "Update this skill to match the standard," "fix this skill," "review and improve." Mechanical conformance, not behavioral redesign: read the directory, run `quick_validate.py`, run the Frontmatter Audit, inspect the body against the standards above, fix or report, bump `metadata.version`, re-validate. **Do not interview the user about purpose, triggers, or output format** — those are already encoded in the SKILL.md. No evals required.
- **Subpath B2 — iterate on eval feedback.** The user has eval results or wants to run them. The opening move is the **eval loop**, not interviewing: `evals/misfires.jsonl` first, then results and `feedback.json`, revise per `references/iteration.md`, audit frontmatter alongside, bump the version, re-run evals into a new `iteration-<N+1>/` directory.

## Description Optimization

The description field is the primary mechanism that determines whether Claude invokes a skill. After creating or improving a skill, offer to optimize the description for better triggering accuracy.

Read `references/description-optimization.md` for the full 4-step flow: generate trigger eval queries, review with the user via the HTML template, run the optimization loop with `run_loop.py`, apply the best description.

### Package and Present (only if `present_files` tool is available)

If the `present_files` tool is available (otherwise skip), package the skill and present the resulting `.skill` file path so the user can install it:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

## Environment-specific notes

If you're on Claude.ai (no subagents) or in Cowork (subagents but no browser), some mechanics change. Read `references/environment-modes.md` for the adapted flow. The core loop (draft → test → review → improve) is the same everywhere — only execution mechanics shift.

---

## Reference files

`agents/` holds instructions for specialized subagents — read one when you spawn that subagent:

- `agents/grader.md` — evaluate assertions against outputs
- `agents/comparator.md` — blind A/B comparison between two outputs
- `agents/analyzer.md` — analyze why one version beat another

`references/` holds the material this SKILL.md links out to:

| File                          | Contents                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `frontmatter-rules.md`        | Version Management, YAML Safety, Frontmatter Audit (mandatory)                                |
| `dependency-preflight.md`     | When a preflight gate is required, what it names, and the template to emit (mandatory)        |
| `predictability-rubric.md`    | The 7-item predictability standard a new skill must meet by construction                      |
| `intent-interview.md`         | Path A opening: the should-this-exist gate, the 7 questions, research, branch mapping         |
| `improving-existing.md`       | Path B: the Subpath B1 retrofit sequence and the Subpath B2 eval-feedback sequence            |
| `description-guide.md`        | Pushy + negative-trigger description pattern, one trigger per branch, length budget           |
| `exemplars.md`                | Three annotated exemplar skills (workflow, knowledge, orchestrator) to imitate                |
| `writing-guide.md`            | Anatomy, progressive disclosure, writing and workflow patterns, error messages, test cases    |
| `schemas.md`                  | JSON structures for `evals.json`, `misfires.jsonl`, `grading.json`, etc.                      |
| `subagent-patterns.md`        | When and how to use the Agent tool, including per-step context delegation and when to skip it |
| `validation-prompts.md`       | The 4 validation phases; 1–3 script the mandatory adversarial review                          |
| `eval-loop.md`                | Full 5-step eval run / grade / viewer flow                                                    |
| `iteration.md`                | Principles for improving a skill based on feedback; blind comparison                          |
| `description-optimization.md` | 4-step description-tuning workflow                                                            |
| `environment-modes.md`        | Claude.ai and Cowork-specific adaptations                                                     |
| `readme-template.md`          | AI-skip notice, template, and rules for `docs/README.md`                                      |
| `run-stats.md`                | Run-stats field definitions and the start-epoch capture command                               |

---

In any task list, include "Create evals JSON and run `eval-viewer/generate_review.py` for human review" — especially in Cowork, where it's easy to skip.
