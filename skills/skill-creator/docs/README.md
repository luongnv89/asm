<!--
  DO NOT READ THIS FILE — This README.md is for human catalog browsing only.
  It ships inside the .skill package but is NEVER auto-loaded into agent context.
  The runtime loader only reads SKILL.md + references/ + scripts/ + agents/ when the skill triggers.
  If you're an AI agent, read the SKILL.md file instead for skill instructions.
-->

# Skill Creator

> Create, evaluate, benchmark, and iteratively improve agent skills.

## Highlights

- Iterative skill loop: draft, test prompts, evaluate, refine
- Subagent architecture guidance: design skills that delegate heavy work to subagents, keeping the main agent lean
- Quantitative + qualitative eval workflow with baseline comparison
- Benchmark aggregation, variance analysis, and report tooling
- Description optimization flow to improve triggering accuracy
- Dedicated eval viewer and grading agents for structured review
- Dependency preflight: a skill that invokes other skills ships a gate naming each dependency, how to install it, and how to verify it
- Run stats on every create/update run: elapsed time, agents, skills, tool calls, plus tokens and cost where the host reports them

## When to Use

| Say this...                        | Skill will...                                                        |
| ---------------------------------- | -------------------------------------------------------------------- |
| "Create a skill for X"             | Interview you, draft SKILL.md + README.md, run test cases            |
| "Improve this skill"               | Run evals, collect feedback, suggest subagent restructuring, iterate |
| "Run evals for my skill"           | Execute test prompts, grade results, show benchmark                  |
| "Optimize skill triggering"        | Generate trigger eval queries, run optimization loop                 |
| "This skill is too slow / bloated" | Analyze for subagent refactoring opportunities                       |

## How It Works

```mermaid
graph TD
    A["Capture Intent & Interview"] --> B["Assess Subagent Architecture"]
    B --> C["Draft SKILL.md + agents/ + README.md"]
    C --> D["Run Test Cases & Baselines"]
    D --> E["Evaluate: Viewer + Benchmarks"]
    E --> F["Iterate & Refactor"]
    F --> D
    F --> G["Optimize Description & Package"]
    style A fill:#4CAF50,color:#fff
    style G fill:#2196F3,color:#fff
```

## Installation

Install via [npx (Vercel)](https://www.npmjs.com/package/skills):

```bash
npx skills add https://github.com/luongnv89/skills --skill skill-creator
```

Or via [agent-skill-manager (asm)](https://www.npmjs.com/package/agent-skill-manager):

```bash
asm install github:luongnv89/skills:skills/skill-creator
```

## Usage

```
/skill-creator
```

## Resources

| Path           | Description                                              |
| -------------- | -------------------------------------------------------- |
| `scripts/`     | Eval loop, benchmarking, packaging, validation utilities |
| `references/`  | Evals schema, subagent patterns, workflow patterns       |
| `eval-viewer/` | Generate/view review pages for eval results              |
| `agents/`      | Analyzer, comparator, and grader agent prompts           |
| `assets/`      | Viewer template assets                                   |

## Output

Produces complete skill packages (SKILL.md + docs/README.md + agents/), eval results with benchmark reports, subagent restructuring recommendations, and optimized skill descriptions for accurate triggering.
