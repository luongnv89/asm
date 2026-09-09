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

Declare every optional dependency as a top-level YAML list. Declaration is
discovery metadata only: installing the parent never installs this list.

```yaml
dependencies:
  - skill-creator
  - github:owner/repo:skills/helper
```

The workflow then names four lifecycle elements:

| Element                   | Requirement                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------ |
| **Discovery**             | `asm deps discover <parent> --json` exposes the optional list                        |
| **First-use acquisition** | acquire only the dependency whose branch is reached, with caller session identity    |
| **Direct use**            | read the returned canonical `skillMdPath`; do not wait for a provider catalog rescan |
| **Cleanup**               | release the session in caller-owned `finally`/shutdown handling                      |

Check that `asm` is available before the first mutation. Do not acquire every
declared dependency during preflight: that recreates the eager-install problem.
A dependency used by only one optional branch may degrade instead — say which,
and say what the run does without it.

## Template to emit into the authored skill

Copy this into the skill being authored, replacing `<parent-skill>` and
`<skill-name>` with real references. The surrounding main agent supplies a
unique `<caller-session-id>` and owns the `finally`; ASM does not launch or
supervise that process. Keep the preflight above the first step that writes,
commits, or publishes.

````markdown
## Dependency Preflight (mandatory)

This skill optionally invokes `<skill-name>`, declared in frontmatter
`dependencies`. Before the first mutation, verify `asm` is available:

```bash
command -v asm >/dev/null || {
  echo "Missing installer: npm install -g agent-skill-manager" >&2
  exit 1
}
asm deps discover <parent-skill> --json
```

When execution first reaches the branch that needs `<skill-name>`, the main
agent runs:

```bash
asm deps acquire <skill-name> --session <caller-session-id> --json
```

Use the returned `skillMdPath` immediately. The main agent releases the lease
from its own `finally`/shutdown handling:

```bash
asm deps release --session <caller-session-id> --json
```

Do not acquire the dependency if its branch is not reached.
````

Normal errors and catchable signals rely on the caller's `finally`/shutdown
path. `SIGKILL`, power loss, and similar uncatchable termination can leave
persistent lease state. A later caller may inspect
`asm deps cleanup --stale-before <ISO-8601> --dry-run --json`, then repeat
without `--dry-run`. Age is only a caller-selected recovery policy, not proof
of agent failure, so choose a cutoff older than the longest expected live run.

## Author-facing summary

An author following this file without running either skill needs only this:

1. Ask whether the skill invokes another skill.
2. If it does, add the frontmatter list and emit the template above before the
   first mutating step.
3. Acquire only at first use, consume the returned path directly, and make the
   caller release its session in `finally`.
4. If it does not, add nothing.
