# Subagent Patterns for Skills

A guide for designing skills that use the Agent tool to delegate work to subagents. The core idea: the main agent stays lightweight (orchestrating, communicating with the user) while subagents handle the heavy lifting (reading many files, executing multi-step work, producing artifacts).

## Table of Contents

1. [Why Subagents Matter](#why-subagents-matter)
2. [When to Use Subagents](#when-to-use-subagents)
3. [When NOT to Use Subagents](#when-not-to-use-subagents)
4. [Subagent Architecture Patterns](#subagent-architecture-patterns)
5. [Writing Subagent Prompts](#writing-subagent-prompts)
6. [Subagent Prompt Files](#subagent-prompt-files)
7. [Data Flow Between Main Agent and Subagents](#data-flow-between-main-agent-and-subagents)
8. [Per-Step Context Delegation](#per-step-context-delegation)
9. [Error Handling and Graceful Degradation](#error-handling-and-graceful-degradation)
10. [Examples from Real Skills](#examples-from-real-skills)

---

## Why Subagents Matter

Every tool call, file read, and reasoning step in the main conversation adds to the context window. When a skill makes the main agent do heavy work directly (reading 20 files, writing scripts, iterating on output), the conversation context grows fast. This causes:

- **Slower responses** as the model processes more context per turn
- **Context compression** that drops important earlier details
- **Confused reasoning** when unrelated task details bleed into each other
- **Poor user experience** — the user sees a wall of tool calls instead of clean progress updates

Subagents solve this by running in isolated context. The main agent spawns a subagent with a focused prompt, the subagent does the heavy work independently, and only the result comes back to the main conversation. The main agent's context stays clean.

Think of it like a project manager (main agent) delegating to specialists (subagents). The PM doesn't read every source file — they assign the work, get results, and coordinate next steps.

## When to Use Subagents

Design a skill to use subagents when any of these apply:

### 1. Heavy codebase exploration

The task requires reading many files (5+), grepping across the codebase, or building a mental model of a large code area. A subagent can explore, synthesize, and return a summary — keeping all those file contents out of the main context.

**Signal:** The skill instructions say "read all files in X", "scan the codebase for Y", "analyze the project structure".

### 2. Independent parallel work

Multiple parts of the task can run simultaneously without depending on each other. Subagents can execute in parallel, finishing faster than sequential execution.

**Signal:** "For each X, do Y" where the Ys don't depend on each other. Or "research A while generating B".

### 3. Repeated work with fresh context

The same type of task runs multiple times (e.g., reviewing several PRs, processing multiple files). Each instance benefits from a clean slate — no contamination from previous iterations.

**Signal:** Loops, batch processing, iterative review cycles where independence between iterations matters.

### 4. Context isolation for objectivity

Some tasks require an independent perspective — code review, quality assessment, comparison. A subagent that hasn't seen the creation process gives a more objective evaluation.

**Signal:** Review, audit, comparison, grading tasks where bias from prior context would hurt quality.

### 5. Large output generation

Creating substantial artifacts (documents, reports, code files) that require focused attention. Keeping the generation work in a subagent means the main agent isn't burdened with the intermediate steps.

**Signal:** The skill produces files that require significant reasoning to create (not just template fills).

## When NOT to Use Subagents

Subagents add overhead (spawn time, coordination complexity). Don't use them when:

- **The task is simple and linear** — reading 1-2 files and making a small edit doesn't need a subagent
- **User interaction is required mid-task** — subagents can't ask the user questions; if the workflow needs user input between steps, keep it in the main agent
- **The work is sequential and each step depends on the previous** — subagents shine for parallel or independent work, not long chains where step 3 needs the exact output of step 2
- **The context is already small** — if the skill only reads a few files and writes one output, the overhead of spawning a subagent isn't worth it
- **The environment doesn't support it** — Claude.ai doesn't have the Agent tool; skills should have fallback paths (see "Graceful degradation" below)

## Subagent Architecture Patterns

### Pattern A: Explorer + Executor

The most common pattern. One subagent researches/analyzes, the main agent makes decisions, then another subagent executes.

```
Main Agent (orchestrator)
├── Spawn: Explorer subagent
│   "Analyze the codebase and return: [specific questions]"
│   Returns: structured findings
│
├── Main agent: Reviews findings, makes decisions, talks to user
│
└── Spawn: Executor subagent
    "Given these decisions, implement: [specific changes]"
    Returns: confirmation + file paths changed
```

**When to use:** Tasks where understanding the codebase is a prerequisite to acting on it, and you don't want the exploration context polluting the execution.

**Skill instructions pattern:**

```markdown
## Phase 1: Analyze

Spawn an explorer subagent to understand the current state:

- What files exist in [area]
- What patterns are used
- What dependencies exist

Read `agents/explorer.md` for the full explorer prompt.

## Phase 2: Decide

Based on the explorer's findings, determine the approach.
Present the plan to the user for confirmation.

## Phase 3: Execute

Spawn an executor subagent with the confirmed plan.
Read `agents/executor.md` for the full executor prompt.
```

### Pattern B: Parallel Workers

Multiple subagents handle independent chunks of work simultaneously.

```
Main Agent (orchestrator)
├── Spawn (parallel): Worker 1 — "Process file A"
├── Spawn (parallel): Worker 2 — "Process file B"
├── Spawn (parallel): Worker 3 — "Process file C"
│
└── Main agent: Collects results, merges, reports to user
```

**When to use:** Batch processing, multi-file transformations, independent analyses that don't share state.

**Skill instructions pattern:**

```markdown
## Execution

For each [item] identified in the analysis phase, spawn a worker subagent.
Launch all workers in the same turn (parallel execution).

Each worker receives:

- The specific [item] to process
- The shared configuration/rules
- An output directory path

Read `agents/worker.md` for the worker prompt.

After all workers complete, aggregate the results.
```

### Pattern C: Review Loop

A creation agent and an independent review agent alternate until quality is met.

```
Main Agent (orchestrator)
├── Spawn: Creator subagent — produces output
├── Spawn: Reviewer subagent (fresh context!) — evaluates output
│   Returns: PASS or NEEDS_FIX with specific issues
│
├── If NEEDS_FIX:
│   ├── Spawn: Fixer subagent — addresses issues
│   └── Spawn: Reviewer subagent (fresh again!) — re-evaluates
│
└── If PASS: Report to user
```

**When to use:** Tasks where quality matters and self-review is unreliable. The reviewer's fresh context means it judges the output on its merits, not on the effort that went into creating it.

**Skill instructions pattern:**

```markdown
## Quality Loop

After generating the output, spawn a reviewer subagent for independent assessment.
The reviewer must be a separate agent (via the Agent tool) so it has fresh context.

Read `agents/reviewer.md` for the reviewer prompt.

If the reviewer returns NEEDS_FIX:

1. Spawn a fixer subagent with the specific issues
2. Spawn a fresh reviewer (never reuse the same reviewer agent)
3. Repeat until PASS or max 3 cycles

The main agent never reads the output files directly during this loop —
it only coordinates based on the subagents' structured responses.
```

### Pattern D: Research + Synthesis

Multiple research subagents gather information from different sources, then a synthesis subagent combines their findings.

```
Main Agent (orchestrator)
├── Spawn (parallel): Researcher 1 — "Search codebase for X patterns"
├── Spawn (parallel): Researcher 2 — "Check docs/web for Y best practices"
├── Spawn (parallel): Researcher 3 — "Analyze competitor approach in Z"
│
├── Main agent: Receives all research results
│
└── Spawn: Synthesizer subagent
    "Given these findings, produce: [structured output]"
    Returns: final deliverable
```

**When to use:** Tasks requiring multiple information sources where gathering is expensive and you want synthesis done with a clean perspective.

### Pattern E: Staged Pipeline

Each stage produces a well-defined intermediate artifact that feeds the next stage.

```
Main Agent (orchestrator)
├── Stage 1 subagent: Raw input → structured data
├── Stage 2 subagent: structured data → analyzed output
├── Stage 3 subagent: analyzed output → final deliverable
```

**When to use:** Document processing, data transformation pipelines, multi-format conversions. Each stage is self-contained and testable independently.

## Writing Subagent Prompts

The prompt you give a subagent is the single most important thing for its success. A subagent has no conversation history — only what you tell it.

### Structure of a subagent prompt

```
1. ROLE: What is the subagent? (e.g., "You are a code reviewer")
2. CONTEXT: What does it need to know? (project path, relevant files, constraints)
3. TASK: What specifically should it do? (be precise)
4. INPUT: What data is it working with? (file paths, configuration, prior results)
5. OUTPUT: What should it return? (format, location, structure)
6. CONSTRAINTS: What should it NOT do? (don't modify files, don't ask questions, etc.)
```

### Good vs. bad subagent prompts

**Bad — too vague:**

```
Review the code changes and tell me what you think.
```

**Good — specific and structured:**

```
You are a code reviewer. Review the diff between main and the current branch
in /path/to/repo.

Focus on:
- Security vulnerabilities (SQL injection, XSS, command injection)
- Logic errors that would cause incorrect behavior
- Breaking changes to public APIs

For each issue found, return a JSON object:
{
  "file": "path/to/file",
  "line": 42,
  "severity": "high|medium|low",
  "category": "security|logic|breaking-change",
  "description": "what's wrong and why it matters",
  "suggestion": "how to fix it"
}

Save your full review to /path/to/output/review.json

Do NOT make any code changes. Do NOT ask questions — use your best judgment.
If you find no issues, save an empty array.
```

### Key principles

1. **Be explicit about output format and location.** Subagents can't show results to the user directly — they need to save to files or return structured data that the main agent can relay.

2. **Include all necessary context in the prompt.** The subagent doesn't see the conversation history. If it needs to know about a user preference or prior decision, include it.

3. **Constrain what the subagent should NOT do.** Without constraints, a subagent might try to be helpful in ways that break the workflow (e.g., committing changes, asking questions, modifying files it shouldn't touch).

4. **Use `run_in_background: true` for parallel work.** When spawning multiple independent subagents, mark them as background tasks so they run simultaneously.

## Subagent Prompt Files

For complex subagent roles that are reused across invocations, store the prompt template in an `agents/` directory:

```
my-skill/
├── SKILL.md
├── agents/
│   ├── explorer.md    — Codebase analysis subagent prompt
│   ├── executor.md    — Implementation subagent prompt
│   └── reviewer.md    — Quality review subagent prompt
└── references/
```

The SKILL.md references these files: "Read `agents/explorer.md` for the full explorer prompt." This keeps the main skill instructions lean while giving subagents detailed guidance.

### Prompt file structure

```markdown
# [Role Name] Agent

## Role

[One sentence describing what this agent does]

## Context

[What the agent needs to know — passed in by the main agent at spawn time]

## Task

[Step-by-step instructions]

## Input

[What the agent receives — file paths, configuration, prior results]

## Output

[Exact format and save location]

## Constraints

[What the agent must NOT do]
```

## Data Flow Between Main Agent and Subagents

### Passing data TO subagents

- **File paths:** Include absolute paths in the prompt
- **Configuration:** Embed directly in the prompt or point to a config file
- **Prior results:** Point to output files from previous subagents
- **User preferences:** Include any relevant user choices in the prompt

### Getting data FROM subagents

- **Structured files:** Have the subagent save JSON/YAML to a known path
- **Agent return value:** The Agent tool returns the subagent's final message
- **Output directories:** Point the subagent to `outputs/` and read what's there after

### Intermediate state between stages

When multiple subagents form a pipeline, use a workspace directory:

```
workspace/
├── stage-1/           — Explorer output
│   ├── analysis.json
│   └── findings.md
├── stage-2/           — Executor output
│   ├── changes.json
│   └── modified_files/
└── stage-3/           — Reviewer output
    └── review.json
```

The SKILL.md tells the main agent to create the workspace, pass the relevant stage directory to each subagent, and read results between stages.

## Per-Step Context Delegation

A skill's `references/` tree gets loaded whole only because nothing told the main
agent otherwise. Most steps need one file out of it. **Per-step context delegation**
is the discipline of writing each step so it _declares the slice_ of the skill's own
material that step needs — and handing that slice, and only that slice, to the
subagent that runs it.

This is not a second mechanism. It is the six-field prompt contract from
[Writing Subagent Prompts](#writing-subagent-prompts) with the **Input** field used
deliberately: the slice _is_ the Input. Same Agent tool, same `agents/` prompt files,
same degradation clause — only the discipline about what the main agent reads changes.

### How a step declares its slice

Write the step so three things are visible to the main agent **without reading any of
them**:

| Element    | What it names                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Slice**  | The exact `references/`, `agents/`, or `templates/` paths this step's worker needs — by path, never "the relevant docs"    |
| **Input**  | The slice plus the runtime values the worker cannot derive (clone paths, prior worker output, user choices)                |
| **Output** | The fixed shape the worker returns, so the merge step stays dumb and never re-reads the slice to interpret a prose summary |

The main agent reads the step, passes the named paths as the worker's **Input**, and
keeps only the worker's **Output**. It never opens the slice itself — that is the
whole saving.

**Skill instructions pattern:**

```markdown
## Step 3 — Audit each batch (workers, parallel)

Spawn one worker per batch. Each worker's contract:

- Input: `references/audit-eval-contract.md`, the clone path from Step 2, the
  batch's relPaths
- Output: the fixed JSON in that contract — one object per skill, never prose
- You do NOT read `references/audit-eval-contract.md` yourself; the worker does.
```

### Deriving the slice

1. **List what the step touches** — reference files, templates, agent prompts, and
   any fixed procedure currently inlined in SKILL.md.
2. **Move the inlined procedure out.** A step whose procedure sits in SKILL.md has no
   slice to hand over: the main agent already paid for it. Extract it to
   `references/<topic>.md` and leave a one-line pointer. This is progressive
   disclosure one level deeper — file-level disclosure decides what the main agent
   loads at all, step-level slicing decides _who_ loads it.
3. **Name the paths in the step**, so the main agent can dispatch without opening them.
4. **Pin the return shape**, so results merge without a second read.

Chain the slices when steps depend on each other: a worker that returns a path (a
temp clone, a workspace directory) is what makes the _next_ step's Input resolvable.
A step whose Input silently relies on a shell variable set inside an earlier step's
inline bash breaks the moment that step becomes a worker — the variable lives in a
shell the main agent no longer owns.

### When the slice isn't worth it

Everything in [When NOT to Use Subagents](#when-not-to-use-subagents) applies first —
naming a slice does not make a step delegable that those tests already rule out. On
top of them, skip the slice when:

- **There is no tree to withhold** — a skill with no `references/`, or one file every
  run needs anyway. The handoff costs more than it saves.
- **The step is a single decision** — choosing a version bump or a branch name is
  cheaper inline than as a spawn.
- **Consecutive steps share one slice** — two workers reading the same file is one
  worker with two tasks.
- **The step talks to the user mid-way** — a worker cannot ask a question, however
  heavy its slice is.

A skill can be perfectly predictable with zero delegable steps. This is a
context-budget optimization, not a structural requirement; do not restructure a small
skill to earn it.

### Degradation

A step written this way degrades on its own: without the Agent tool the main agent
reads the named slice itself, runs the step inline, in order, and says so — the same
fallback the [Graceful degradation pattern](#graceful-degradation-pattern) below
describes. Declaring the slice costs nothing on a run that never delegates it.

## Error Handling and Graceful Degradation

### Error handling

Subagents can fail. Design skills to handle this gracefully:

1. **Check the return.** If a subagent returns an error or unexpected result, the main agent should report to the user rather than proceeding blindly.

2. **Set timeouts for background tasks.** Long-running subagents might stall. The main agent should have a reasonable expectation of how long each step takes.

3. **Provide fallback paths.** If the Agent tool isn't available (Claude.ai), the skill should degrade to inline execution.

### Graceful degradation pattern

Every skill that uses subagents should include a fallback for environments without the Agent tool. Add this near the top of the SKILL.md:

```markdown
## Environment check

If the Agent tool is available, use subagents as described below.
If not (e.g., Claude.ai), execute each phase inline instead:

- Phase 1 (explore): Read the files directly in the main conversation
- Phase 2 (execute): Make changes directly
- Phase 3 (review): Self-review the output (less rigorous, but functional)
```

This ensures the skill works everywhere, just with varying levels of context efficiency.

## Examples from Real Skills

### auto-pilot: Orchestrator Pattern

The main agent is a pure orchestrator — it never reads source files, diffs, or runs tests directly. It spawns subagents for every substantial task (resolving issues, reviewing PRs, fixing code) and coordinates their results.

**Key lesson:** When the main agent does nothing but orchestrate, the user gets clean status updates and the context stays small regardless of how many issues are processed.

### review-fix-loop: Fresh Reviewer Pattern

Each review cycle spawns a brand-new reviewer subagent. No reviewer ever sees what a previous reviewer flagged. This prevents rubber-stamping (where a reviewer sees its own prior feedback was addressed and becomes less critical).

**Key lesson:** For review tasks, fresh context per cycle produces better results than continuing the same agent.

### skill-creator: Parallel Eval Pattern

Test cases are run in parallel — each test prompt spawns two subagents (with-skill and baseline) simultaneously. Timing data is captured from each subagent's completion notification.

**Key lesson:** When running the same operation on multiple inputs, parallel subagents finish faster and each operates with clean context.
