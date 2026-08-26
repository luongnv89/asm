---
name: skill-creator
description: "Create, improve, evaluate, benchmark skills. Use when authoring a new skill, updating an existing one, running evals, or optimizing a skill's description for triggering. Don't use for invoking skills, writing prose, or scaffolding Python projects."
license: MIT
effort: max
metadata:
  version: 1.15.0
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

**Intent Capture phase checks:** `Worth building`, `Goal defined`, `Triggers identified`, `Output format agreed`

**Skill Writing phase checks:** `SKILL.md written`, `README generated`, `Subagents designed`, `Dependency preflight` (√ when the skill has no skill dependencies, or when it has them and ships a gate for each; × when a dependency is invoked without one), `Predictability pass` (the 7 rubric items from _Make it predictable_ — √ when each is satisfied, × naming the gap), `Adversarial review` (fresh-subagent findings addressed)

**Testing phase checks:** `Evals created`, `Runs completed`, `Viewer launched`

**Iteration phase checks:** `Feedback incorporated`, `Benchmarks improved`, `Description optimized`

## Run stats (mandatory)

Every run that creates or updates a skill closes its summary with a run-stats block — the last thing printed, after the final Step Completion Report. It reports what the run **cost**, and nothing the run already reported.

Capture `run_started_epoch` once at skill start, in the same shell as the skill's first command (`cmd; ec=$?; date +%s >&2; exit "$ec"` — read the epoch off stderr so stdout and the exit code stay intact). A run that already recorded a start time reuses it.

```
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 6m 04s · tokens 128,400 · cost $0.42
              agents 3 · skills 1 · tool calls 47
```

Fields are fixed and in this order — never reordered, renamed, or added to:

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `elapsed`    | wall-clock duration, `{H}h {M}m {S}s`; drop zero-valued leading units only (`6m 04s`, `48s`)     |
| `tokens`     | **conditional** — printed only where the host reported a usage figure, with thousands separators |
| `cost`       | **conditional** — printed only where the host reported a run cost, as `$0.42`                    |
| `agents`     | subagents this run spawned                                                                       |
| `skills`     | other skills this run invoked                                                                    |
| `tool calls` | tool invocations this run made                                                                   |

- **`tokens` and `cost` are omitted entirely when the host reported no figure** — no dangling `·`, no placeholder. Never estimate one from output length, file sizes, or step counts, and never reconstruct one from host transcripts or logs.
- **`elapsed`, `agents`, `skills`, and `tool calls` always print.** A value that cannot be determined prints the literal `n/a`; `0` is a determined value and is correct where it is true (a run that spawned no subagents prints `agents 0`).
- A missing optional figure never suppresses the rest of the block.

Print it on **every** path that finishes a create or update — Path A, Subpath B1, and Subpath B2 — and on every other terminal outcome too: an early stop, a gate that refused to continue, or a failed step. Only a run that produced no output at all has no block. Measuring must not become a measurable share of what it measures: one epoch read at start, one at the end, two lines of output — never a timing call per step or a summarization pass.

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

Establish, for every skill you author or retrofit, whether it invokes, delegates to, or reads **another skill**. Ask it as a question in the interview (Capture Intent, question 6) and confirm it against the draft — prose naming `/another-skill`, or a read under `~/.claude/skills/`, is a dependency even when the author said there were none.

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

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user fills the gaps and confirms before proceeding.

**Gate first — should this be a skill at all?** A skill earns its place when the workflow is **repeated** (it will come up again), **non-obvious** (a capable agent without it would get it wrong), and **stable** (the process won't change next month). If it fails any of these, recommend against creating it — a one-off is better served by a plain prompt, and every unnecessary skill pollutes triggering for the rest. The user can override; the gate exists so the default isn't "always yes".

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't. Suggest the appropriate default based on the skill type, but let the user decide.
5. **Should this skill use subagents?** Read `references/subagent-patterns.md` for the full guide. Key signals:
   - Will the skill read many files or scan large codebases? → Explorer subagent
   - Can parts of the work run in parallel? → Parallel worker subagents
   - Does the skill need independent quality review? → Review loop with fresh subagents
   - Will the skill produce large artifacts that require focused reasoning? → Executor subagent
   - Does any single step need only a **slice** of `references/` rather than the whole tree? → Per-step context delegation: the step names the slice, the worker receives it as its `Input` (`references/subagent-patterns.md` → _Per-Step Context Delegation_)
     If any apply, design the skill with a main-agent-as-orchestrator architecture so subagents handle the heavy lifting and the main conversation context stays clean.
6. **Does this skill invoke other skills?** Name every skill it calls, delegates a phase to, or reads. If any exist, the skill you write ships a dependency preflight for them — see _Mandatory Rule for Skills That Invoke Other Skills_ above and `references/dependency-preflight.md`. If none exist, nothing is added.
7. **Model-invoked or user-invoked?** Decide the _primary_ invocation before drafting — it changes how you write. **Model-invoked** (the default) is a reusable discipline the agent applies when the situation fits; optimize the description for reliable triggering. **User-invoked** (`/skill-name`) is orchestration the user runs deliberately (a pipeline, an expensive or destructive action); the body reads as "the user asked for this, proceed." Weigh the **context-load and cognitive-load** budgets here too. See `references/predictability-rubric.md` for the full tradeoff.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until this part is ironed out. Check available MCPs — research in parallel via subagents if available, otherwise inline.

**Map the skill's branches before drafting the body.** Identify the distinct modes the skill runs in — the paths that need different instructions (create-vs-improve, per-framework, per-environment, dry-run-vs-apply). Knowing them first lets you open the SKILL.md with a short selector and disclose branch-specific material only on the branch that uses it, instead of forcing every run to read every branch. The "Two entry paths" block at the top of this skill is itself an example of a branch selector. See `references/predictability-rubric.md` → _Map branches before drafting_.

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

Read `references/writing-guide.md` for the full guide. It covers:

- **Anatomy of a skill** — directory layout, where `agents/`, `references/`, `scripts/`, `assets/`, `docs/` go.
- **Progressive disclosure** — three-level loading, the 500-line SKILL.md cap, when to split into `references/`.
- **Principle of Lack of Surprise** — no malware, no misleading skills.
- **Writing and workflow patterns** — imperative voice, output-format strictness, examples, the workflow-pattern table.
- **Bundled scripts and error messages** — scripts must print descriptive errors before exiting so the agent can self-correct.
- **Step Completion Reports** — every skill emits one after each major phase.
- **Writing style** — explain _why_ in lieu of heavy MUSTs.
- **Generate README.md** — `docs/README.md` only, with AI-skip notice; see `references/readme-template.md`.
- **Test Cases** — the 5-prompt floor (≥3 happy-path, ≥1 edge, ≥1 should-NOT-trigger) saved to `evals/evals.json`; see `references/schemas.md`.
- **Pre-eval LLM validation** — the phases behind the mandatory adversarial review; see `references/validation-prompts.md`.

### Make it predictable (publish-ready by construction)

The goal of creating a skill here is a **predictable process** — the agent follows the same reliable path every run — and a skill that ships **publish-ready** without later needing a `skill-auto-improver` cleanup pass. Read `references/predictability-rubric.md` for the full standard and its checkable pass/fail bar; the hooks below are the ones you apply _while writing_:

- **Demanding completion criteria.** For step-based workflows, end every major step with a bar the agent can _check_, not vibe — tied to a command, file state, or count. The Step Completion Reports format above is the vehicle (`√/×` checks + a `Result:` line). Strong criteria are what stop the agent declaring success early; this is the difference between a repeatable process and a hopeful one.
- **Progressive disclosure for non-universal material.** Anything branch-specific, long, or not needed on every run goes to `references/` behind a one-line pointer (mechanics in `references/writing-guide.md` → _Progressive Disclosure_) — keeps context load low and SKILL.md under 500 lines. Its step-level analogue is **per-step context delegation**: a delegable step names the slice of `references/` its worker needs and hands that slice over as the worker's `Input`, so the main agent never holds the whole tree. Not every skill has one — `references/subagent-patterns.md` → _When the slice isn't worth it_ says when to skip it.
- **Leading words.** Name a recurring concept once with a short load-bearing term ("atomic commit", "fail-soft", "publish-ready") and reuse the term, rather than re-explaining it at each use.
- **Pruning pass — run before finishing.** Make one explicit pass to cut **duplication** (the same instruction in two places — keep one home, link to it), **stale sediment** (leftover guidance, dead references, obsolete names), **sprawl** (sections grown past their value, prose that should be a table or a leading word), and **no-op instructions** (lines that change nothing the agent does — "be careful", "use good judgment" — replace with a checkable criterion or delete). This pass is what most often separates a skill-creator-authored skill from one that still needs `skill-auto-improver`.

Before finishing, **walk all 7 rubric items** (`references/predictability-rubric.md` — the four hooks above plus invocation choice, branch mapping, and publish-ready) and emit the result as the `Predictability pass` row of the Skill Writing Step Completion Report: `√` per item satisfied, `×` naming any gap. This makes the rubric walk visible instead of silent — a `×` is a fix-before-publish signal, not a blocker.

`skill-auto-improver` remains the remediation tool for _externally authored_ or _legacy_ skills — not a required second stage for a skill created through this path.

### Adversarial review (mandatory before evals)

The drafting context cannot review its own draft — it fills every gap from memory instead of from the page. After the rubric walk, spawn a **fresh subagent** with the draft skill and phases 1–3 of `references/validation-prompts.md` (discovery, logic walk, edge-case attack); it returns trigger misses, ambiguous steps, and breaking prompts. Fix the real findings before running evals; carry the rest into the test set. If no Agent tool is available, run the phases yourself in a fresh session (see `references/environment-modes.md`).

## Running and evaluating test cases

Read `references/eval-loop.md` for the full 5-step sequence (spawn runs, draft assertions, capture timing, grade/aggregate/view, read feedback). It covers the with-skill + baseline subagent pattern, the `eval_metadata.json` and `timing.json` formats, the `generate_review.py` invocation, and reading `feedback.json`.

Do NOT use `/skill-test` or any other testing skill — the flow in `references/eval-loop.md` is the one this skill expects.

## Improving an existing skill

This is **Path B** from the entry-paths block at the top. Two distinct subpaths — pick based on what the user is asking for.

### Subpath B1 — Retrofit an existing skill to the standard

Use this when the user says "update this skill to match the standard," "fix this skill," "review and improve," or invokes `/skill-creator` on a published skill that hasn't been touched in a while. The goal is mechanical conformance, not behavioral redesign. **Do not interview the user about purpose, triggers, or output format** — those are encoded in the existing SKILL.md.

Sequence:

1. Read the existing SKILL.md and surrounding directory. Note current frontmatter, body length, references, scripts, version. Skim `docs/README.md` for human-facing claims.
2. Run `python scripts/quick_validate.py <skill-path>`. Validates allowed keys, name format, description length, missing negative trigger, broken YAML.
3. Run the **Frontmatter Audit** described in `references/frontmatter-rules.md`. Cover every checklist item, not just what `quick_validate.py` flagged.
4. Inspect the body against the standards in this skill:
   - SKILL.md under 500 lines (split to `references/` if not).
   - Step Completion Reports section present.
   - "Repo Sync Before Edits" section if the skill mutates a git repo.
   - "Dependency Preflight" section if the skill invokes another skill — and none if it invokes none (`references/dependency-preflight.md`).
   - Bundled scripts print descriptive errors before exiting.
   - Progressive disclosure used appropriately; references one level deep.
5. Decide fix vs. review-only mode. If fixing, apply edits and **bump `metadata.version`** — patch for frontmatter-only fixes, minor for new sections, major for restructuring. If reviewing only, surface findings as before/after suggestions and don't silently edit.
6. Re-run `quick_validate.py` to confirm clean. Output a Step Completion Report with a `Frontmatter valid` check.
7. Optional: offer description optimization (see below). Don't run it automatically — it costs eval tokens.

This subpath does **not** require running evals. Skip to subpath B2 only if body changes are substantive enough that the user wants verification.

### Subpath B2 — Iterate on a skill based on eval feedback

Use this when the user has eval results (or wants to run evals) and wants the skill revised based on what the evals show. The opening move is the **eval loop**, not interviewing.

1. Read `evals/misfires.jsonl` first if present — logged real-world failures are the highest-signal evals; convert them into test cases (schema in `references/schemas.md`). Then, if evals already exist, read the latest results and the user's `feedback.json`; if not, run them per "Running and evaluating test cases" above.
2. Read `references/iteration.md` for the five principles of revision (generalize, stay lean, explain the why, spot repeated work, consider subagents) and the iteration loop (apply → rerun → review → repeat).
3. Run the **Frontmatter Audit** alongside content revision — a polished body on top of broken frontmatter still fails validation.
4. Bump `metadata.version` per Version Management — minor for new capabilities or expanded triggers, patch for wording fixes.
5. Re-run evals into a new `iteration-<N+1>/` directory and let the user compare.

`references/iteration.md` also documents the optional blind A/B comparison system.

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

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent.

- `agents/grader.md` — How to evaluate assertions against outputs
- `agents/comparator.md` — How to do blind A/B comparison between two outputs
- `agents/analyzer.md` — How to analyze why one version beat another

The `references/` directory has additional documentation:

- `references/frontmatter-rules.md` — Version Management, YAML Safety, and Frontmatter Audit (mandatory).
- `references/dependency-preflight.md` — The skill-dependency rule: when a preflight gate is required, what it must name, and the template to emit (mandatory).
- `references/predictability-rubric.md` — The predictability standard a new skill must meet by construction: invocation choice, branch mapping, demanding completion criteria, leading words, the pruning pass, and publish-ready (no auto-improver dependency).
- `references/description-guide.md` — Pushy + negative-trigger description pattern, one trigger per branch, length budget.
- `references/exemplars.md` — Three annotated exemplar skills (workflow, knowledge, orchestrator) to imitate.
- `references/writing-guide.md` — Anatomy, progressive disclosure, writing and workflow patterns, error messages, test cases.
- `references/schemas.md` — JSON structures for evals.json, misfires.jsonl, grading.json, etc.
- `references/subagent-patterns.md` — When and how to design skills that use the Agent tool, including per-step context delegation (a step declares its `references/` slice; the worker receives it as `Input`) and when that slice is not worth taking.
- `references/validation-prompts.md` — The 4 validation phases; 1–3 script the mandatory adversarial review.
- `references/eval-loop.md` — Full 5-step eval run / grade / viewer flow.
- `references/iteration.md` — Principles for improving a skill based on feedback; blind comparison.
- `references/description-optimization.md` — 4-step description-tuning workflow.
- `references/environment-modes.md` — Claude.ai and Cowork-specific adaptations.
- `references/readme-template.md` — AI-skip notice, template, and rules for `docs/README.md`.

---

In any task list, include "Create evals JSON and run `eval-viewer/generate_review.py` for human review" — especially in Cowork, where it's easy to skip.
