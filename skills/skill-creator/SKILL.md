---
name: skill-creator
description: "Create, improve, evaluate, benchmark skills. Use when authoring a new skill, updating an existing one, running evals, or optimizing a skill's description for triggering. Don't use for invoking skills, writing prose, or scaffolding Python projects."
license: MIT
effort: max
metadata:
  version: 1.9.0
  author: Luong NGUYEN <luongnv89@gmail.com>
---

# Skill Creator

A skill for creating new skills and iteratively improving them. The agent's context budget is the primary constraint, so this SKILL.md links out to focused reference files instead of inlining their content.

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

If the user's request is ambiguous ("can you look at this skill?"), assume **Path B** and ask them to confirm before interviewing them as if it were a new skill. Path B is also the one that fires when the user invokes `/skill-creator` while pointing at a skill directory or file.

Both paths share the mandatory rules below: **Repo Sync Before Edits**, **Version Management**, **YAML Frontmatter Safety**, and **Frontmatter Audit on Review/Evaluation**. Apply them in either path.

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

**Intent Capture phase checks:** `Goal defined`, `Triggers identified`, `Output format agreed`

**Skill Writing phase checks:** `SKILL.md written`, `README generated`, `Subagents designed`

**Testing phase checks:** `Evals created`, `Runs completed`, `Viewer launched`

**Iteration phase checks:** `Feedback incorporated`, `Benchmarks improved`, `Description optimized`

## Communicating with the user

Users span a wide range of technical familiarity. Match jargon to context cues: "evaluation" and "benchmark" are borderline-fine; "JSON" and "assertion" need clear cues that the user knows the term before you use it without explaining. Briefly define terms when in doubt.

---

## Mandatory Rule for Repo-Mutating Skills

When creating or updating any skill that changes files in a git repository (code, docs, config, commits, publishing), include this rule in that skill's SKILL.md:

- Add a **"Repo Sync Before Edits (mandatory)"** section near the top.
- Require pulling latest remote branch before modifications:
  - `branch="$(git rev-parse --abbrev-ref HEAD)"`
  - `git fetch origin`
  - `git pull --rebase origin "$branch"`
- If working tree is dirty: stash, sync, then pop.
- If `origin` is missing or conflicts occur: stop and ask the user before continuing.

Do not ship repo-mutating skills without this pre-sync guardrail.

## Frontmatter rules (mandatory)

Read `references/frontmatter-rules.md` for the full mandatory rules:

- **Version Management** — set `metadata.version: 1.0.0` on creation; bump patch/minor/major on every edit.
- **YAML Frontmatter Safety** — quote any string value containing `:`, `#`, `-`, `<`, `>`, `|`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `?`, `=`, `!`, `%`, `@`, or `` ` ``.
- **Frontmatter Audit on Review/Evaluation** — required-field check, name/dir match, allowed top-level keys, `metadata.version`, `metadata.author`, YAML safety, and consistency with `docs/README.md`. Run `python scripts/quick_validate.py <skill-path>` first; it catches mechanical issues without LLM reasoning.

These rules apply on every write. Always confirm them before saving.

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user fills the gaps and confirms before proceeding.

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't. Suggest the appropriate default based on the skill type, but let the user decide.
5. **Should this skill use subagents?** Read `references/subagent-patterns.md` for the full guide. Key signals:
   - Will the skill read many files or scan large codebases? → Explorer subagent
   - Can parts of the work run in parallel? → Parallel worker subagents
   - Does the skill need independent quality review? → Review loop with fresh subagents
   - Will the skill produce large artifacts that require focused reasoning? → Executor subagent
     If any apply, design the skill with a main-agent-as-orchestrator architecture so subagents handle the heavy lifting and the main conversation context stays clean.
6. **Model-invoked or user-invoked?** Decide the _primary_ invocation before drafting — it changes how you write the skill. **Model-invoked** (the default) is for a reusable discipline the agent applies on its own when the situation fits; optimize the description for reliable triggering. **User-invoked** (`/skill-name`) is for orchestration or control the user runs deliberately (a pipeline, an expensive or destructive action); the body reads as "the user asked for this, proceed." Weigh the **context-load and cognitive-load** budgets here too — keep the skill small and design its structure around them. See `references/predictability-rubric.md` for the full tradeoff.

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until this part is ironed out. Check available MCPs — research in parallel via subagents if available, otherwise inline.

**Map the skill's branches before drafting the body.** Identify the distinct modes the skill runs in — the paths that need different instructions (create-vs-improve, per-framework, per-environment, dry-run-vs-apply). Knowing them first lets you open the SKILL.md with a short selector and disclose branch-specific material only on the branch that uses it, instead of forcing every run to read every branch. The "Two entry paths" block at the top of this skill is itself an example of a branch selector. See `references/predictability-rubric.md` → _Map branches before drafting_.

### Write the SKILL.md

Based on the user interview, fill in:

- **name**: 1-64 chars, lowercase letters/digits/hyphens, no consecutive hyphens, exactly matches parent directory. Enforced by `scripts/quick_validate.py`.
- **description**: When to trigger and what it does. Primary triggering mechanism. Single line, no newlines. Claude tends to _undertrigger_ — make descriptions a little "pushy", with negative triggers.
- **effort** (optional): `low | medium | high | xhigh | max`. Defaults to `high`.
- **metadata.version**: Semver string (see frontmatter rules).
- **compatibility**: Required tools or dependencies (rare).

#### Writing a good description: pushy + negative triggers

A description has two jobs: pull in the queries that _should_ trigger the skill, and push away the queries from adjacent domains that _shouldn't_. Most authors do the first part well and forget the second, producing false-positive triggers — a Tailwind skill running on a Vue project, a Python skill firing on shell-script questions.

**The fix is a "Don't use for ..." clause.** Name adjacent domains that share keywords or intent but are the wrong fit.

- Positive only: `Creates React components using Tailwind CSS.`
- With negatives: `Creates React components using Tailwind CSS. Use whenever the user asks for a new React component, UI element, or styled layout. Don't use for Vue, Svelte, vanilla CSS, or plain HTML projects.`

Write positive and negative halves as one continuous sentence or two back-to-back sentences — not a structured list. `scripts/quick_validate.py` warns (non-fatal) when the negative-trigger clause appears missing.

#### Description length budget

Three limits, in order of which one bites first:

1. **250 chars** — Claude Code's `/skills` listing cap. Anything beyond is **truncated tail-first**, chopping the negative-trigger clause. This is the limit that actually shapes triggering behavior.
2. **~2% of context window** (~16k chars total, ~109 chars overhead per skill) — the shared `available_skills` budget. When it overflows, extra skills become **invisible to the agent**.
3. **1024 chars** — the API spec ceiling, hard error.

**Rule: target ≤250 characters.** Treat 1024 as a hard error, not a goal. Lead with verbs, drop hedge words ("helps", "allows you to"), collapse synonyms, keep the negative half to two or three adjacent domains.

### Skill Writing Guide

Read `references/writing-guide.md` for the full guide. It covers:

- **Anatomy of a skill** — directory layout, where `agents/`, `references/`, `scripts/`, `assets/`, `docs/` go.
- **Progressive disclosure** — three-level loading, the 500-line SKILL.md cap, when to split into `references/`.
- **Principle of Lack of Surprise** — no malware, no misleading skills.
- **Writing patterns** — imperative voice, output-format templates, examples patterns.
- **Bundled scripts and error messages** — scripts must print descriptive errors before exiting so the agent can self-correct.
- **Step Completion Reports** — every skill emits one after each major phase.
- **Writing style** — explain _why_ in lieu of heavy MUSTs.
- **Generate README.md** — `docs/README.md` only, with AI-skip notice; see `references/readme-template.md`.
- **Test Cases** — 2-3 realistic prompts saved to `evals/evals.json`; see `references/schemas.md`.
- **Optional pre-eval LLM validation** — see `references/validation-prompts.md`.

### Make it predictable (publish-ready by construction)

The goal of creating a skill here is a **predictable process** — the agent follows the same reliable path every run — and a skill that ships **publish-ready** without later needing a `skill-auto-improver` cleanup pass. Read `references/predictability-rubric.md` for the full standard and its checkable pass/fail bar; the hooks below are the ones you apply _while writing_:

- **Demanding completion criteria.** For step-based workflows, end every major step with a bar the agent can _check_, not vibe — tied to a command, file state, or count. The Step Completion Reports format above is the vehicle (`√/×` checks + a `Result:` line). Strong criteria are what stop the agent declaring success early; this is the difference between a repeatable process and a hopeful one.
- **Progressive disclosure for non-universal material.** Anything branch-specific, long, or not needed on every run goes to `references/` behind a one-line pointer (mechanics in `references/writing-guide.md` → _Progressive Disclosure_) — keeps context load low and SKILL.md under 500 lines.
- **Leading words.** Name a recurring concept once with a short load-bearing term ("atomic commit", "fail-soft", "publish-ready") and reuse the term, rather than re-explaining it at each use.
- **Pruning pass — run before finishing.** Make one explicit pass to cut **duplication** (the same instruction in two places — keep one home, link to it), **stale sediment** (leftover guidance, dead references, obsolete names), **sprawl** (sections grown past their value, prose that should be a table or a leading word), and **no-op instructions** (lines that change nothing the agent does — "be careful", "use good judgment" — replace with a checkable criterion or delete). This pass is what most often separates a skill-creator-authored skill from one that still needs `skill-auto-improver`.

`skill-auto-improver` remains the remediation tool for _externally authored_ or _legacy_ skills — not a required second stage for a skill created through this path.

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
   - Bundled scripts print descriptive errors before exiting.
   - Progressive disclosure used appropriately; references one level deep.
5. Decide fix vs. review-only mode. If fixing, apply edits and **bump `metadata.version`** — patch for frontmatter-only fixes, minor for new sections, major for restructuring. If reviewing only, surface findings as before/after suggestions and don't silently edit.
6. Re-run `quick_validate.py` to confirm clean. Output a Step Completion Report with a `Frontmatter valid` check.
7. Optional: offer description optimization (see below). Don't run it automatically — it costs eval tokens.

This subpath does **not** require running evals. Skip to subpath B2 only if body changes are substantive enough that the user wants verification.

### Subpath B2 — Iterate on a skill based on eval feedback

Use this when the user has eval results (or wants to run evals) and wants the skill revised based on what the evals show. The opening move is the **eval loop**, not interviewing.

1. If evals already exist, read the latest results and the user's `feedback.json`. If not, run them per "Running and evaluating test cases" above.
2. Read `references/iteration.md` for the five principles of revision (generalize, stay lean, explain the why, spot repeated work, consider subagents) and the iteration loop (apply → rerun → review → repeat).
3. Run the **Frontmatter Audit** alongside content revision — a polished body on top of broken frontmatter still fails validation.
4. Bump `metadata.version` per Version Management — minor for new capabilities or expanded triggers, patch for wording fixes.
5. Re-run evals into a new `iteration-<N+1>/` directory and let the user compare.

`references/iteration.md` also documents the optional blind A/B comparison system.

## Description Optimization

The description field is the primary mechanism that determines whether Claude invokes a skill. After creating or improving a skill, offer to optimize the description for better triggering accuracy.

Read `references/description-optimization.md` for the full 4-step flow: generate trigger eval queries, review with the user via the HTML template, run the optimization loop with `run_loop.py`, apply the best description.

### Package and Present (only if `present_files` tool is available)

Check whether you have access to the `present_files` tool. If not, skip. If yes, package the skill and present the `.skill` file:

```bash
python -m scripts.package_skill <path/to/skill-folder>
```

After packaging, direct the user to the resulting `.skill` file path so they can install it.

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
- `references/predictability-rubric.md` — The predictability standard a new skill must meet by construction: invocation choice, branch mapping, demanding completion criteria, leading words, the pruning pass, and publish-ready (no auto-improver dependency).
- `references/writing-guide.md` — Anatomy, progressive disclosure, writing patterns, error messages, test cases.
- `references/schemas.md` — JSON structures for evals.json, grading.json, etc.
- `references/subagent-patterns.md` — When and how to design skills that use the Agent tool.
- `references/workflows.md` — Workflow patterns for structuring skill instructions.
- `references/output-patterns.md` — Output format and file-writing patterns.
- `references/validation-prompts.md` — Optional 4-phase LLM validation pass for a draft skill.
- `references/eval-loop.md` — Full 5-step eval run / grade / viewer flow.
- `references/iteration.md` — Principles for improving a skill based on feedback; blind comparison.
- `references/description-optimization.md` — 4-step description-tuning workflow.
- `references/environment-modes.md` — Claude.ai and Cowork-specific adaptations.
- `references/readme-template.md` — AI-skip notice, template, and rules for `docs/README.md`.

---

If you maintain a task list, include "Create evals JSON and run `eval-viewer/generate_review.py` so human can review test cases" — especially in Cowork, where it's easy to skip.
