# Capture Intent — the gate, the questions, and the research pass

The Path A opening (SKILL.md → _Creating a skill_). Read this before the first interview question; it is not needed on Path B, where the intent is already encoded in the existing SKILL.md.

## Start from the conversation, not a blank form

The current conversation might already contain the workflow the user wants to capture (e.g. they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user fills the gaps and confirms before you proceed.

## Gate first — should this be a skill at all?

A skill earns its place when the workflow is:

- **repeated** — it will come up again,
- **non-obvious** — a capable agent without it would get it wrong, and
- **stable** — the process won't change next month.

If it fails any of these, recommend against creating it. A one-off is better served by a plain prompt, and every unnecessary skill pollutes triggering for the rest. The user can override; the gate exists so the default isn't "always yes".

## The seven questions

1. What should this skill enable Claude to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. **Should we set up test cases to verify the skill works?** Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't. Suggest the appropriate default based on the skill type, but let the user decide.
5. **Should this skill use subagents?** Read `subagent-patterns.md` for the full guide. Key signals:
   - Will the skill read many files or scan large codebases? → Explorer subagent
   - Can parts of the work run in parallel? → Parallel worker subagents
   - Does the skill need independent quality review? → Review loop with fresh subagents
   - Will the skill produce large artifacts that require focused reasoning? → Executor subagent
   - Does any single step need only a **slice** of `references/` rather than the whole tree? → Per-step context delegation: the step names the slice, the worker receives it as its `Input` (`subagent-patterns.md` → _Per-Step Context Delegation_)

   If any apply, design the skill with a main-agent-as-orchestrator architecture so subagents handle the heavy lifting and the main conversation context stays clean.

6. **Does this skill invoke other skills?** Name every skill it calls, delegates a phase to, or reads. If any exist, the skill you write ships a dependency preflight for them — see SKILL.md → _Mandatory Rule for Skills That Invoke Other Skills_ and `dependency-preflight.md`. If none exist, nothing is added.
7. **Model-invoked or user-invoked?** Decide the _primary_ invocation before drafting — it changes how you write. **Model-invoked** (the default) is a reusable discipline the agent applies when the situation fits; optimize the description for reliable triggering. **User-invoked** (`/skill-name`) is orchestration the user runs deliberately (a pipeline, an expensive or destructive action); the body reads as "the user asked for this, proceed." Weigh the **context-load and cognitive-load** budgets here too. See `predictability-rubric.md` for the full tradeoff.

## Interview and research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until this part is ironed out. Check available MCPs — research in parallel via subagents if available, otherwise inline.

## Map the skill's branches before drafting the body

Identify the distinct modes the skill runs in — the paths that need different instructions (create-vs-improve, per-framework, per-environment, dry-run-vs-apply). Knowing them first lets you open the SKILL.md with a short selector and disclose branch-specific material only on the branch that uses it, instead of forcing every run to read every branch. The "Two entry paths" block at the top of this skill's own SKILL.md is itself an example of a branch selector. See `predictability-rubric.md` → _Map branches before drafting_.
