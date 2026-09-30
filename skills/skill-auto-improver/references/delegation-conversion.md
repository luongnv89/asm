# Delegation conversion (Mode 2)

The procedure for converting an **already-written** skill onto **per-step context
delegation** — each heavy step naming the slice of the skill's own `references/`
tree its worker needs, handed over as the worker's `Input`.

This is Mode 2 from SKILL.md → _Two modes_. It is not part of the Phase 0–7
retrofit loop, and it never runs on its own: a Phase 2b delegability finding
_reports_ the gap, the user _opts into_ the conversion.

The pattern itself has one home, upstream in skill-creator:

```
~/.claude/skills/skill-creator/references/subagent-patterns.md → Per-Step Context Delegation
```

Read that for the _why_ and the pass bar. This file is the operational recipe for
applying it to a skill that already exists.

## When Mode 2 applies

All four must hold. Any miss and the answer is Mode 1, or nothing:

1. The target **clears Gate 1** already. A conversion on top of an unpublishable
   skill compounds two problems; retrofit first.
2. The target has a `references/` tree with **more than one file**, or SKILL.md
   carries an inlined procedure long enough to move out.
3. At least one step is **heavy** — a multi-file read, a per-item fan-out, a fixed
   procedure of a dozen-plus lines — and is not ruled out by _Identifying a
   delegable step_ below.
4. **The user has confirmed the restructure in this run.** Name the steps you would
   convert and the version bump it forces, and wait. A conversion rewrites the
   skill's workflow; it is never something this skill decides on the user's behalf.

## Identifying a delegable step

Per step, in order. The first `no` ends it:

| Test                   | The step is not delegable when                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Context weight**     | It reads one short file, or makes a single decision (a version bump, a branch name)         |
| **Independence**       | Its output depends on the exact text of the previous step, not on that step's stated result |
| **No user mid-step**   | It asks the user a question, or waits on a confirmation, partway through                    |
| **Slice is separable** | The only material it needs is what every run of the skill reads anyway                      |

A step that fails a test is a **recorded** non-delegable step, not a silent skip:
the conversion report names it and says which test it failed. That is the same
`step N is not delegable because …` wording the Phase 2b finding uses.

## Deriving the slice

1. **List what the step touches** — reference files, agent prompts, templates, and
   any procedure still inlined in SKILL.md.
2. **Move the inlined procedure out** to `references/<topic>.md`, one level deep,
   kebab-case, and leave a one-line pointer in the step. Nothing is delegable while
   its procedure stays in SKILL.md — the main agent has loaded that text before it
   can dispatch anything, so the handoff buys back no context at all.
3. **Write the slice as the worker's `Input`** — the existing Role/Context/Task/
   Input/Output/Constraints contract, not a new notation. The `Input` names the
   files by path plus the runtime values the worker cannot derive.
4. **Pin the `Output`** to a fixed shape (JSON where the main agent merges results),
   so the merge step stays dumb and never re-reads the slice to interpret prose.
5. **Chain the slices.** Where step N+1 needs something step N produced — a temp
   clone path, a workspace directory — step N's `Output` must carry it. An `Input`
   that resolves through a shell variable an earlier step set in inline bash stops
   resolving the instant that step is delegated: the worker's shell exits taking the
   value with it, and no field the main agent can read replaces it. Check every
   extracted step for this before you finish.

## The restructure recipe

Per converted step:

1. Extract the inline procedure to `references/<topic>-contract.md`.
2. Replace it in SKILL.md with a one-line pointer plus the worker contract —
   `Input` (the slice), `Output` (the fixed shape), and the boundary line saying the
   main agent does not read the slice itself.
3. Add or extend the **graceful-degradation** clause: with no Agent tool, the main
   agent reads the named slices itself and runs the steps inline, in order, and says
   so (skill-creator's `subagent-patterns.md` → _Graceful degradation pattern_).
4. Confirm `Agent` is in the target's `allowed-tools`; add it if not.
5. Re-point `docs/README.md` at the new reference files.

SKILL.md should **net shrink**. A conversion that grows the body has moved nothing —
it has documented the delegation on top of the procedure it was meant to replace.

## Why it runs outside the Phase 6 loop

Phase 6 stops on _2 consecutive iterations with regression on either gate_. A
restructure moves a large block of body text in one edit; the intermediate state can
regress `context-efficiency` or a Gate 1 check before the extraction lands, and the
loop would revert the conversion halfway through. Mode 2 therefore runs as a single
deliberate pass, with its gates checked once at the end:

- **Take the baseline first.** Mode 2 is selected _before_ Phase 0, so no earlier run
  has captured one. Before the first edit, run `python "$QV" "$SKILL_PATH"`,
  `asm eval "$SKILL_PATH" --json`, and a SKILL.md body line count, and record all
  three as the conversion report's **Before** column. That same run is how
  precondition #1 (_clears Gate 1 already_) is verified.
- Re-run `python "$QV" "$SKILL_PATH"` and `asm eval "$SKILL_PATH" --json`.
- **Both gates must be no worse than before the conversion.** If either regressed and
  a targeted fix does not recover it, **revert the conversion** and report the
  delegability finding as advisory — the same outcome as never converting.

## Version bump

A conversion is a **MAJOR** bump on the target (`X.0.0`) — restructured workflow, per
SKILL.md → _Phase 5_. Bump once for the whole conversion, not per converted step, and
record baseline → final in the conversion report (`references/report-template.md` →
_Mode 2 — conversion report_).

## When conversion does not pay for itself

Say so and stop — an unconverted skill is a fine outcome:

- **Nothing to withhold.** No `references/` tree, or one file every run reads anyway.
- **Every step is a single decision.** The spawn costs more than the slice saves.
- **One slice serves consecutive steps.** Two workers reading the same file is one
  worker with two tasks; leave it as one step.
- **The skill is a knowledge skill.** Its body _is_ the material; there is no step to
  delegate.
- **The user declines the restructure.** The finding stays advisory. It is never
  promoted to a blocker, and Mode 1 never converts a skill quietly.
