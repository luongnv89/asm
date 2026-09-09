# Skill-creator Standard — Retrofit Checklist

The Gate 1 must-pass floor. Every item here mirrors a rule the skill-creator enforces (`quick_validate.py`, frontmatter rules, README template, writing guide). When the auto-improver retrofits a target skill, it walks this checklist top to bottom, fixing each item in place.

The upstream source of truth lives at `~/.claude/skills/skill-creator/references/frontmatter-rules.md`, `writing-guide.md`, and `readme-template.md`. This file is the operational checklist — re-check upstream when scoring rules or formats change.

## 1. SKILL.md frontmatter

Use only these top-level keys. Anything else is rejected by `quick_validate.py`:

- `name` (required, kebab-case, ≤64 chars, must match parent directory)
- `description` (required, single line, ≤1024 chars hard, ≤250 chars target)
- `license` (optional)
- `allowed-tools` (optional)
- `metadata` (required when shipping; nest `version`, `author` here)
- `compatibility` (optional, ≤500 chars)
- `effort` (optional; one of `low | medium | high | xhigh | max`)

`metadata:` must contain at minimum `version: MAJOR.MINOR.PATCH` and `author: <name>`. If a published skill has neither, add both — start version at `1.0.0` if there was none.

If `asm eval --fix` wrote top-level `creator:`, `version:`, or `tags:`, normalize per `frontmatter-audit.md` immediately — those keys fail `quick_validate.py`.

## 2. Description quality

Two clauses, written as one or two back-to-back sentences:

- **Positive**: lead with an action verb, name what the skill does and when to invoke
- **Negative**: name 2–3 adjacent domains that should NOT trigger the skill

Example:

```
description: "Improve an existing SKILL.md so it passes the skill-creator standard AND clears the asm-eval 85/8 floor. Use when leveling up a skill before publish. Don't use for authoring from scratch, bulk evaluation, or rewriting prose style."
```

`quick_validate.py` warns (non-fatal) if the negative-trigger clause is missing — treat that warning as a Gate 1 failure and fix it.

Length budget:

- Hard ceiling: **1024 chars** (API spec)
- Target: **≤250 chars** (Claude Code's `/skills` truncates tail-first beyond this, chopping the negative-trigger clause)
- Below 250 is the only safe zone for production skills

## 3. SKILL.md body

- **Under 500 lines.** Hard rule. Longer files burn tokens on every invocation and bury important guidance.
- Use progressive disclosure: dense topics live in `references/<topic>.md`, SKILL.md links to them with one-line pointers like "Read `references/foo.md` when you need X".
- Imperative voice for instructions ("Run", "Read", "Write"), not narrative ("The agent might want to consider running...").
- A `## Step Completion Reports` section that emits a status block after each major phase.
- A `## Repo Sync Before Edits (mandatory)` section if the skill mutates a git repo.

## 4. `docs/README.md` (if present)

Every README.md must carry the AI-skip HTML comment at the very top, on its own block:

```markdown
<!--
  DO NOT READ THIS FILE — This README.md is for human catalog browsing only.
  It ships inside the .skill package but is NEVER auto-loaded into agent context.
  The runtime loader only reads SKILL.md + references/ + scripts/ + agents/ when the skill triggers.
  If you're an AI agent, read the SKILL.md file instead for skill instructions.
-->
```

Required README sections (per `~/.claude/skills/skill-creator/references/readme-template.md`):

- Title (human display name)
- Tagline (one-sentence blockquote)
- Highlights (3–5 bullets)
- When to Use (table of trigger phrases → action)
- How It Works (mermaid `graph TD` diagram, first node green `#4CAF50`, last node blue `#2196F3`)
- Usage (slash-command code block)
- Output (what files / artifacts the skill produces)

## 5. Bundled scripts

If the skill ships scripts under `scripts/`, every error path must print a descriptive message before exiting, on stderr. Three things every error message says: **what went wrong, which input caused it, how to fix it.**

```bash
# BAD
[ -z "$NAME" ] && exit 1

# GOOD
if [ -z "$NAME" ]; then
  echo "Error: missing required field 'name' in SKILL.md frontmatter." >&2
  echo "Expected format: name: my-skill-name" >&2
  exit 1
fi
```

```python
# BAD
if not data.get('version'):
    sys.exit(1)

# GOOD
if not data.get('version'):
    print(
        "Error: metadata.version missing from SKILL.md frontmatter. "
        "Add `metadata:\\n  version: 1.0.0` and re-run.",
        file=sys.stderr,
    )
    sys.exit(1)
```

The agent that just ran the script should be able to self-correct without the user intervening.

## 6. References directory

If `SKILL.md` references files in `references/`, every referenced path must exist. Broken links waste a tool call. Use one-level deep references (`references/foo.md`) — don't nest `references/sub/foo.md` unless the skill genuinely needs that hierarchy.

## 7. Version bump

Every iteration that edits the SKILL.md body or frontmatter must bump `metadata.version` exactly once:

- **Patch** (`x.y.Z`) — typo, wording, frontmatter normalization
- **Minor** (`x.Y.0`) — new sections, new triggers, new references
- **Major** (`X.0.0`) — restructured workflow, breaking output format

Bump once per loop iteration, not once per individual edit — otherwise the version churns ahead of meaningful change.

## 8. Dependency preflight (conditional)

Applies only to a target that **invokes another skill** — it calls `/other-skill`, delegates a phase to a named skill, or reads a path under `~/.claude/skills/`, `~/.agents/skills/`, or `~/.codex/skills/`. Scan the target for those three signals before deciding.

- **Invokes no other skill** → nothing is required and nothing is added. An absent preflight section is **not** a finding here, and adding an empty one is itself a defect.
- **Invokes another skill** → the target must declare a non-empty frontmatter `dependencies` list and carry a `## Dependency Preflight (mandatory)` section above its first mutating step. Missing either is a Gate 1 finding.

Per dependency the gate names four things:

| Element                   | Requirement                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| **Discovery**             | the dependency is exposed by `asm deps discover <parent> --json`                      |
| **First-use acquisition** | only a reached branch runs `asm deps acquire ... --session <caller-session-id>`       |
| **Direct use**            | the workflow reads the returned canonical path immediately                            |
| **Cleanup**               | caller-owned `finally`/shutdown handling runs idempotent `asm deps release --session` |

Retrofit template — one entry per dependency:

````markdown
## Dependency Preflight (mandatory)

This skill optionally invokes `<skill-name>`, declared in frontmatter
`dependencies`. Verify `asm` exists before the first mutation, but do not
acquire the dependency until its branch is reached.

```bash
command -v asm >/dev/null || { echo "Install asm: npm install -g agent-skill-manager" >&2; exit 1; }
asm deps discover <parent-skill> --json
# At first use:
asm deps acquire <skill-name> --session <caller-session-id> --json
# In the main agent's finally:
asm deps release --session <caller-session-id> --json
```

Use the acquired `skillMdPath` directly; do not assume a foreign provider
rescans mid-session.
````

Abrupt uncatchable termination is not observable by ASM. The preflight must
state that later stale recovery uses an explicit conservative cutoff and a
`--dry-run` classification first. Upstream source of the rule:
`~/.claude/skills/skill-creator/references/dependency-preflight.md`.

## 9. Final mechanical check

Before declaring Gate 1 cleared, run:

```bash
python ~/.claude/skills/skill-creator/scripts/quick_validate.py "$SKILL_PATH"
```

Exit code 0 with no WARNING lines on stderr = Gate 1 clean. WARNING lines (e.g., missing negative-trigger, description over 250 chars) are findings that must be cleared before exit.
