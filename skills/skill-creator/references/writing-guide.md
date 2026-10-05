# Skill Writing Guide

Anatomy, progressive disclosure, writing patterns, workflow patterns, output patterns, bundled-script hygiene, test cases, and the report-format conventions used in skill bodies.

Contents: [Anatomy](#anatomy-of-a-skill) · [Progressive Disclosure](#progressive-disclosure) · [Lack of Surprise](#principle-of-lack-of-surprise) · [Writing Patterns](#writing-patterns) · [Workflow Patterns](#workflow-patterns) · [Scripts & Errors](#bundled-scripts-and-error-messages) · [Step Completion Reports](#step-completion-reports) · [Style](#writing-style) · [README](#generate-readmemd) · [Test Cases](#test-cases) · [Pre-eval Validation](#pre-eval-llm-validation)

## Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
├── docs/ (optional — human-only, never auto-loaded)
│   └── README.md (optional — catalog-browsing docs with AI-skip notice)
├── references/ (optional — loaded into agent context when SKILL.md points to them)
│   └── *.md (optional — additional docs loaded as needed)
├── agents/ (optional — subagent prompt files)
│   ├── explorer.md   - Codebase analysis subagent
│   ├── executor.md   - Implementation subagent
│   └── reviewer.md   - Quality review subagent
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    └── assets/     - Files used in output (templates, icons, fonts)
```

The `agents/` directory is for skills that use the Agent tool to delegate work to subagents. Each file contains a complete prompt template for a specific subagent role (what it does, what it receives, what it returns). The SKILL.md references these files — e.g., "Read `agents/explorer.md` for the full explorer prompt" — so the main skill stays lean while subagents get detailed instructions. See `references/subagent-patterns.md` for when and how to use this pattern.

## Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) — Always in context (~100 words)
2. **SKILL.md body** — In context whenever skill triggers (keep under 500 lines)
3. **Bundled resources** — As needed (unlimited, scripts can execute without loading)

**Key patterns:**

- Keep SKILL.md under 500 lines. This is a hard rule — longer SKILL.md files waste tokens on every invocation and tend to bury important guidance. Approaching the limit means it's time to add another layer of hierarchy: pull dense sections out to `references/` and replace them with a one-line pointer like "Read `references/foo.md` when you need X."
- Reference files clearly from SKILL.md with guidance on when to read them
- For large reference files (>300 lines), include a table of contents

**Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:

```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

Claude reads only the relevant reference file.

## Principle of Lack of Surprise

Skills must not contain malware, exploit code, or any content that could compromise system security. A skill's contents should not surprise the user in their intent if described. Don't go along with requests to create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities. "Roleplay as an XYZ" skills are fine.

## Writing Patterns

Prefer the imperative form in instructions.

### Controlled instructions

Use a practical, softened approach inspired by ASD-STE100 controlled language. Formal compliance is not required. These rules help the executing agent and the human reviewer interpret the same instruction:

- Write one action per instruction. Put a dependent action in the next instruction.
- Choose one name for each concept. Reuse that name throughout the skill.
- State the condition before a conditional action. State each exception and the action to take when it applies.
- Replace vague adjectives with observable checks. Name the input, expected result, and failure response when a step validates an outcome.

Weak: “Ensure the deployment is secure and working.”

Better:

1. Request the protected API without credentials.
2. Check that the response status is HTTP 401 or 403. If it is neither, report an access-control failure.
3. Request the dashboard.
4. Check that the response status is HTTP 200. If it differs, report a dashboard availability failure.

These checks establish only the stated HTTP behavior. They do not establish that the entire deployment is secure or that every dashboard feature works.

### Output patterns

Before choosing a template, apply `human-review.md`: define the result, evidence, uncertainty, and decision the user needs to inspect. Select the simplest format that supports that review task.

**Defining output formats** — match strictness to requirements. For strict formats (API responses, data files), pin the template:

```markdown
## Report structure

ALWAYS use this exact template:

# [Title]

## Executive summary

## Key findings

## Recommendations
```

For flexible guidance, offer a sensible default and say adaptation is allowed ("Here is a sensible default format, but use your best judgment; adjust sections for the analysis type"). Choosing the wrong strictness cuts both ways: a pinned template on a judgment task produces rigid junk; a loose one on a data format produces parse failures.

**Examples pattern** — where output quality depends on style, one or two input/output pairs teach more than paragraphs of description:

```markdown
## Commit message format

**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication

Follow this style: type(scope): brief description
```

**Validation checklist pattern** — for skills that deliver artifacts, end with a short verify-before-delivering checklist (required sections present, no placeholder text, links valid, error cases handled). Keep it specific to the artifact type.

For description writing (pushy triggers, negative clauses, length budget), read `references/description-guide.md`. For three fully annotated exemplar skills to imitate, read `references/exemplars.md`.

## Workflow Patterns

Pick the pattern that matches the skill's control flow — don't force a sequential spine onto a knowledge skill (see the `postgres-migrations` exemplar for the no-workflow archetype).

| Pattern                      | Use when                                                | Key techniques                                                                                             |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sequential workflow          | Multi-step process, order matters                       | Explicit step order, dependencies named, validation gate per step, rollback instructions                   |
| Conditional branches         | Distinct modes (create vs edit, per-framework)          | Early selector, branch-local instructions, shared rules stated once                                        |
| Multi-service coordination   | Workflow spans several tools/MCPs                       | Clear phase separation, data passed explicitly between phases, validate before advancing                   |
| Iterative refinement         | Quality improves with iteration                         | Explicit quality criteria, validation script, a stop condition ("repeat until X or N rounds")              |
| Context-aware tool selection | Same outcome, different tool by context                 | Decision criteria as a table/tree, fallback option, tell the user why                                      |
| Domain-specific intelligence | Skill adds compliance/expertise gates around tool calls | Check before act, document the decision, audit trail                                                       |
| Subagent orchestration       | Heavy reading or parallel work would bloat main context | Read `references/subagent-patterns.md` — orchestrator stays lean, contracts per role, fresh-context review |
| Guided discovery             | Skill must gather info from the user before acting      | Ask → confirm understanding → execute only after explicit approval → report                                |

Two of these deserve a concrete sketch because authors most often get them wrong:

**Conditional branches** — put the selector first, so a run only reads its own branch:

```markdown
1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below
```

**Iterative refinement** — always give the loop a stop condition:

```markdown
1. Generate draft → 2. Run `scripts/check_report.py` → 3. Fix each flagged issue
   → 4. Re-validate. Repeat until the checker passes or 3 rounds — then report
   remaining issues instead of looping forever.
```

## Bundled scripts and error messages

When a skill includes scripts under `scripts/`, the scripts become part of the agent's execution surface — an agent runs them and reacts to what they print. A terse, unexplained `exit 1` is effectively a dead end: the agent sees a non-zero exit and has no idea what went wrong or how to recover.

**Rule: scripts must print descriptive, human-readable error messages on stderr (or stdout) before exiting.** The agent that just ran the script should be able to self-correct without the user intervening.

**Bad:**

```bash
if [ -z "$FIELD" ]; then
  exit 1
fi
```

```python
if not frontmatter.get('name'):
    sys.exit(1)
```

**Good:**

```bash
if [ -z "$FIELD" ]; then
  echo "Error: missing required field 'name' in SKILL.md frontmatter." >&2
  echo "Expected format: name: my-skill-name" >&2
  exit 1
fi
```

```python
if not frontmatter.get('name'):
    print(
        "Error: missing required field 'name' in SKILL.md frontmatter. "
        "Expected format: name: my-skill-name",
        file=sys.stderr,
    )
    sys.exit(1)
```

Good error messages say three things: **what went wrong, which input caused it, and how to fix it.** If the fix involves a filename, config key, or command, mention it explicitly — the agent will copy it verbatim.

## Step Completion Reports

Every skill must produce a structured status report after each major phase — compact monospace block with checkmark rows and a summary result line, so pass/fail is immediately scannable. Tailor the check names to what each step actually validates (e.g., a code review skill might use `Correctness`, `Test coverage`, `Security`, `Edge cases`; a deploy skill might use `Build`, `Tests`, `Lint`, `CI status`).

### The format skill-creator itself emits

After each major step of a create or update run, skill-creator prints:

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

Adapt the check names to what the step actually validates. Use `√` for pass, `×` for fail, and `—` to add brief context. The "Criteria" line summarizes how many acceptance criteria were met; the "Result" line gives the overall verdict.

Per-phase checks:

| Phase          | Checks                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Intent Capture | `Worth building`, `Goal defined`, `Triggers identified`, `Output format agreed`                                                   |
| Skill Writing  | `SKILL.md written`, `README generated`, `Subagents designed`, `Dependency preflight`, `Predictability pass`, `Adversarial review` |
| Testing        | `Evals created`, `Runs completed`, `Viewer launched`                                                                              |
| Iteration      | `Feedback incorporated`, `Benchmarks improved`, `Description optimized`                                                           |
| Closing check  | `Gate 1`, `Gate 2`, `Verdict` (PASS, BLOCKER, or Gate 2 not measured)                                                             |

`Dependency preflight` is `√` when the skill has no skill dependencies, or has them and ships a gate for each; `×` when a dependency is invoked without one. `Predictability pass` walks the 7 rubric items from SKILL.md → _Make it predictable_ — `√` per item satisfied, `×` naming the gap. `Adversarial review` is `√` once fresh-subagent findings are addressed. The retrofit loop's own per-phase block is in `retrofit-loop.md` → _Step Completion Reports_.

## Writing Style

Explain to the model _why_ things are important in lieu of heavy-handed musty MUSTs. Use theory of mind and try to make the skill general and not super-narrow to specific examples. Start with a draft, then look at it with fresh eyes and improve it.

## Generate README.md

If the skill ships a README.md, place it in `docs/README.md`. **README.md is for human catalog browsing only — it ships inside the `.skill` package but is never auto-loaded into agent context**, so it costs zero runtime tokens. Every README.md must carry an AI-skip HTML comment at the top so agents don't accidentally read it.

Read `references/readme-template.md` when authoring or updating a `docs/README.md` — it contains the AI-skip notice, the full template (title, highlights, when-to-use table, mermaid `How It Works` diagram, usage, resources, output), and the rules for each section.

## Test Cases

After writing the skill draft, build a test set of **at least 5 prompts**:

- **≥3 realistic happy-path prompts** — the kind of thing a real user would actually say, phrased differently from each other.
- **≥1 edge case** — boundary input, missing precondition, or a conflicting instruction the skill should handle or refuse cleanly.
- **≥1 should-NOT-trigger prompt** — an adjacent-domain request (the ones named in the description's negative clause). The pass condition is that the agent does _not_ apply the skill's workflow to it.

Two or three happy-path prompts alone verify only the demo path — they will not catch the failures users actually hit. Share the set with the user and ask whether to add more, then run them.

Save test cases to `evals/evals.json` with a `kind` per eval (`happy-path` | `edge` | `negative-trigger`). Don't write assertions yet — just the prompts. Draft assertions in the next step while runs are in progress; include at least one **process assertion** per happy-path eval (did the run follow the skill's mandated sequence, use its scripts, emit its report?) — output-only assertions let a run pass while ignoring the skill entirely.

See `references/schemas.md` for the full schema (including the `assertions` field, added later).

Read `references/subagent-patterns.md` when the skill involves heavy exploration, parallel tasks, review loops, or large artifact generation.

## Pre-eval LLM validation

Phases 1–3 of `references/validation-prompts.md` (discovery, logic walk, edge-case attack) are the material the **mandatory adversarial review** runs against every new draft — see "Adversarial review" in SKILL.md. Phase 4 (architecture refinement) is optional: run it after a large rewrite, before publishing, or when an eval fails in a way you can't explain.
