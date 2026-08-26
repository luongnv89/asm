# Dependency Preflight

The rule for skills that **invoke other skills**. A skill that calls
`/other-skill`, tells the agent to read another skill's `SKILL.md`, or delegates
a phase to a named skill has a **skill dependency**. Without a gate, the miss
surfaces halfway through someone else's work, after the run has already made
edits.

This file is the single home of the rule. `skill-creator` applies it while
authoring; `skill-auto-improver` audits for it
(`references/skill-creator-checklist.md` → _Dependency preflight_).

## When the rule applies

Establish the answer during the interview — one question, asked every time:

> Does this skill invoke, delegate to, or read another skill?

- **No** → the rule is satisfied by doing nothing. Do **not** add an empty
  preflight section, a "no dependencies" note, or a placeholder heading. A skill
  with no skill dependencies ships exactly as it would have.
- **Yes** → the skill you produce carries a `## Dependency Preflight (mandatory)`
  section that runs **before** the first step that changes anything.

Signals that the answer is yes even when the author says no: the draft names
another skill in prose (`/skill-name`), reads a path under `~/.claude/skills/`,
`~/.agents/skills/`, or `~/.codex/skills/`, or hands a phase to a skill by name.

## What a generated preflight must contain

Four things, per dependency. A gate that detects a miss but leaves the user to
work out the fix is worse than no gate — it stops the run and explains nothing.

| Element                 | Requirement                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| **Name**                | The missing skill, named exactly as it is installed                             |
| **Install command**     | The command that installs that skill, complete enough to run unattended         |
| **Installer bootstrap** | The command that installs the installer itself, for a user who does not have it |
| **Verification**        | A command the user runs to confirm the install landed                           |

State the behavior on a miss too: **stop before the first mutation** by default.
A dependency used by only one optional branch may degrade instead — say which,
and say what the run does without it.

## Template to emit into the authored skill

Copy this into the skill being authored, replacing `<skill-name>` with each real
dependency **and `<tool>` with the provider it installs for** (e.g. `claude`).
Both placeholders must be substituted — an unreplaced `<tool>` is read by the
shell as a redirection, not a flag. Keep it above the first step that writes,
commits, or publishes.

````markdown
## Dependency Preflight (mandatory)

This skill invokes `<skill-name>`. Verify it is installed **before** the first
step that changes anything:

```bash
asm list -p <tool> --json | grep -q '"<skill-name>"' || {
  echo "Missing required skill: <skill-name>" >&2
  echo "Install it:      asm install <skill-name> -p <tool> --yes" >&2
  echo "No asm yet:      npm install -g agent-skill-manager" >&2
  echo "Verify:          asm list -p <tool> --json | grep '<skill-name>'" >&2
  exit 1
}
```

If the check fails, stop and print the three commands above — do not continue
with a partial run.
````

Name the provider explicitly (`-p <tool>`, e.g. `claude`): `asm install` refuses
to guess one in a non-interactive shell and `--yes` does not cover that choice,
so an install command without it errors instead of installing — the one outcome
this gate exists to prevent. Use the same `-p` in the detection and the
verification so an install landing under a different tool cannot report success
while the dependency is still missing.

Adapt the detection to what the host offers: `asm list -p <tool> --json` where
`asm` is on PATH, otherwise a path test such as
`test -f "$HOME/.claude/skills/<skill-name>/SKILL.md"`. The four elements are
fixed; the mechanics are not.

## Author-facing summary

An author following this file without running either skill needs only this:

1. Ask whether the skill invokes another skill.
2. If it does, emit the template above, one entry per dependency, before the
   first mutating step.
3. Name the dependency, its install command, the installer's own install
   command, and a verification command.
4. If it does not, add nothing.
