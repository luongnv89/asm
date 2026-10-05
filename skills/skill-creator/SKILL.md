---
name: "skill-creator"
description: "Create a skill or bring an existing one up to the same standard (validate + asm eval fix loop); run evals, tune triggering. Use when authoring, fixing, or retrofitting a skill. Don't use for invoking skills, writing prose, or Python scaffolds."
license: MIT
compatibility: "Python 3 for scripts/quick_validate.py; `asm` on PATH for the Gate 2 score check"
effort: max
metadata:
  version: 2.0.0
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

Both paths share the mandatory rules below: **Repo Sync Before Edits**, **Dependency Preflight**, **Version Management**, **YAML Frontmatter Safety**, and **Frontmatter Audit on Review/Evaluation**. Both close with the **Run stats** block. Both paths end at the same skill standard.

## The skill standard (both paths)

One bar for a created skill and an updated one — `references/skill-standard.md` holds the detail:

- **Gate 1 — must-pass floor.** `quick_validate.py` clean, the Frontmatter Audit, body under 500 lines and 3000 words, a negative-trigger clause, version and author, the README notice, script errors, dependency preflight when another skill is invoked, and the five human-review checks.
- **Gate 2 — asm-eval floor.** `overallScore > 85` AND `min(categories) >= 8`.

PASS only when both gates pass; anything else after the loop caps is a BLOCKER naming each failing check. Without `asm` on PATH, Gate 2 is **not measured** and the run never reports PASS. The predictability rubric stays advisory on both paths.

## Step Completion Reports

After each major step, print a compact status block — `√` pass, `×` fail, `—` context, a `Criteria` line, and a `Result: PASS | FAIL | PARTIAL` line — with checks tied to commands, file states, or counts. The block format and the per-phase checks (Intent Capture, Skill Writing, Testing, Iteration, Closing check) are in `references/writing-guide.md` → _Step Completion Reports_.

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

Print it on **every** path that finishes a create or update — Path A, Subpath B1, Subpath B2, and Subpath B3 — and at **every** terminal outcome: a PASS, a BLOCKER, the Phase 0 early exit, a failed prerequisite, an aborted run. Only a run that produced no output at all has no block.

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

- **It does** → declare each optional dependency in the frontmatter `dependencies` list and ship a `## Dependency Preflight (mandatory)` section above the first step that changes anything. The main agent acquires only a dependency whose branch it reaches with `asm deps acquire ... --session <caller-session-id>`, uses the returned path directly, and releases the session in caller-owned `finally`/shutdown handling.
- **It does not** → add nothing. No empty preflight section, no "no dependencies" placeholder.

Read `references/dependency-preflight.md` for the copyable template and the on-miss behavior. The skill standard's Gate 1 checks this same rule on both paths, so a skill that ships without a required gate fails its closing check.

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

### Write for execution and human review

Apply the controlled-language rules in `references/writing-guide.md` → _Controlled instructions_ when drafting or revising instructions. Define a human-review output contract for every skill using `references/human-review.md`. Read that reference when choosing the output format or evaluating whether the user can understand the result. Apply these standards on both creation and improvement paths.

For skill-creator's own final response, state the skill changes, checks actually run, untested behavior, and any decision requiring approval. If no approval is needed, say so. Keep this concise; retain the Step Completion Reports and final Run stats block.

### Make it predictable (publish-ready by construction)

The goal of creating a skill here is a **predictable process** — the agent follows the same reliable path every run — and a skill that ships **publish-ready** and clears the skill standard (below) on its first closing check. Read `references/predictability-rubric.md` for the full standard and its checkable pass/fail bar. The hooks you apply _while writing_:

- **Demanding completion criteria.** End every major step with a bar the agent can _check_, not vibe — tied to a command, file state, or count. The Step Completion Reports format above is the vehicle. Strong criteria are what stop the agent declaring success early.
- **Progressive disclosure for non-universal material.** Anything branch-specific, long, or not needed on every run goes to `references/` behind a one-line pointer — this keeps context load low and SKILL.md under the caps. Its step-level analogue is **per-step context delegation**: a delegable step names the slice of `references/` its worker needs and hands that slice over as the worker's `Input`, so the main agent never holds the whole tree (`references/subagent-patterns.md` → _Per-Step Context Delegation_, which also says when the slice isn't worth taking).
- **Leading words.** Name a recurring concept once with a short load-bearing term ("atomic commit", "fail-soft", "publish-ready") and reuse the term, rather than re-explaining it at each use.
- **Pruning pass — run before finishing.** One explicit pass to cut duplication, stale sediment, sprawl, and no-op instructions ("be careful", "use good judgment"). This pass is what most often separates a skill that clears the standard first time from one that loops in the retrofit.

Before finishing, **walk all 7 rubric items** (the four hooks above plus invocation choice, branch mapping, and publish-ready) and emit the result as the `Predictability pass` row of the Skill Writing Step Completion Report. This makes the rubric walk visible instead of silent — a `×` is a fix-before-publish signal, not a blocker.

### Adversarial review (mandatory before evals)

The drafting context cannot review its own draft — it fills every gap from memory instead of from the page. After the rubric walk, spawn a **fresh subagent** with the draft skill and phases 1–3 of `references/validation-prompts.md` (discovery, logic walk, edge-case attack); it returns trigger misses, ambiguous steps, and breaking prompts. Fix the real findings before running evals; carry the rest into the test set. If no Agent tool is available, run the phases yourself in a fresh session (see `references/environment-modes.md`).

### Close with the skill standard (mandatory)

After the adversarial review and evals, run `references/retrofit-loop.md` Phase 0 on the new skill. If both gates pass, finish. Otherwise continue that same loop from Phase 1 under the same caps, then report PASS or BLOCKER (`references/skill-standard.md`). Without `asm`, report Gate 1 status and "Gate 2 not measured" — never PASS.

## Running and evaluating test cases

Read `references/eval-loop.md` for the full 5-step sequence (spawn runs, draft assertions, capture timing, grade/aggregate/view, read feedback). It covers the with-skill + baseline subagent pattern, the `eval_metadata.json` and `timing.json` formats, the `generate_review.py` invocation, and reading `feedback.json`.

Do NOT use `/skill-test` or any other testing skill — the flow in `references/eval-loop.md` is the one this skill expects.

## Improving an existing skill

This is **Path B**. Read `references/improving-existing.md` and choose the subpath before Phase 0 — they don't share an opening move. Every subpath ends at `references/skill-standard.md`.

- **Subpath B1 — retrofit to the standard (default).** "Fix this skill," "improve," "bring up to standard," any ambiguous request. Follow `references/retrofit-loop.md`: Phases 0–7 measure both gates, apply `asm eval --fix`, repair Gate 1, then lift the lowest categories, capped at 8 iterations, 3 with no movement, or 2 regressions. Artifacts land in `.asm-improver/` (`baseline.json`, `iter-N.json`, `report.md`). **Do not interview the user** — purpose and triggers are already encoded. Review-only: run Phase 0 and report, no edits.
- **Subpath B2 — iterate on eval feedback.** The user has eval results or wants to run them. The opening move is the **eval loop**, not interviewing: `evals/misfires.jsonl` first, then results and `feedback.json`, revise per `references/iteration.md`, audit frontmatter alongside, bump the version, re-run evals into a new `iteration-<N+1>/` directory.
- **Subpath B3 — delegation conversion (opt-in).** Restructure heavy steps onto per-step context delegation via `references/delegation-conversion.md` — only on a target that clears Gate 1, after user confirmation, outside the Phase 6 loop.

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

| File                          | Contents                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| `skill-standard.md`           | The two gates both paths end at; PASS/BLOCKER; missing-`asm` rule       |
| `retrofit-loop.md`            | Subpath B1 and the Path A closing check: Phases 0–7, caps, artifacts    |
| `improving-existing.md`       | Path B selector: Subpaths B1, B2, B3                                    |
| `frontmatter-rules.md`        | Version Management, YAML Safety, Frontmatter Audit, `--fix` normalizing |
| `dependency-preflight.md`     | When a preflight gate is required and the template to emit              |
| `predictability-rubric.md`    | The 7-item predictability standard (advisory)                           |
| `predictability-audit.md`     | The rubric as the retrofit loop's Phase 2b checklist                    |
| `human-review.md`             | Output contract, format selection, interactive reports, understanding   |
| `human-review-audit.md`       | Gate 1 detect/repair/re-check table for the five human-review checks    |
| `category-playbook.md`        | Per-category Gate 2 fix patterns                                        |
| `cross-gate-tradeoffs.md`     | Body length across the two gates; link out, don't inline                |
| `delegation-conversion.md`    | Subpath B3 procedure                                                    |
| `report-template.md`          | `.asm-improver/report.md` layouts: PASS, BLOCKER, B3                    |
| `intent-interview.md`         | Path A opening: the gate, the 7 questions, branch mapping               |
| `description-guide.md`        | Pushy + negative-trigger descriptions, length budget                    |
| `exemplars.md`                | Three annotated exemplar skills to imitate                              |
| `writing-guide.md`            | Anatomy, disclosure, patterns, errors, Step Completion Reports, tests   |
| `schemas.md`                  | JSON structures for `evals.json`, `grading.json`, etc.                  |
| `subagent-patterns.md`        | Agent tool use, per-step context delegation                             |
| `validation-prompts.md`       | The 4 validation phases; 1–3 script the adversarial review              |
| `eval-loop.md`                | The 5-step eval run / grade / viewer flow                               |
| `iteration.md`                | Revising from feedback; blind comparison                                |
| `description-optimization.md` | 4-step description-tuning workflow                                      |
| `environment-modes.md`        | Claude.ai and Cowork adaptations                                        |
| `readme-template.md`          | AI-skip notice and template for `docs/README.md`                        |
| `run-stats.md`                | Run-stats field definitions and the start-epoch capture                 |

---

In any task list, include "Create evals JSON and run `eval-viewer/generate_review.py` for human review" — especially in Cowork, where it's easy to skip.
