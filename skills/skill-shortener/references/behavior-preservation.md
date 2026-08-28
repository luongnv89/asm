# Behavior preservation — the KEEP disposition

Read this while assigning `KEEP`. It answers one question: what must stay in the body no matter what it costs?

## Never cut, never move

These blocks look like overhead to a line-count optimizer and are exactly what it should not touch. Each one changes what the agent _does_; removing it silently changes the skill's behavior while every mechanical check still passes.

| Block                             | Why it stays                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| **Dependency Preflight**          | Without the gate, a missing dependency surfaces mid-run, after edits have landed   |
| **Repo sync / snapshot gates**    | The undo path. Cutting it makes the skill unrecoverable on failure                 |
| **Stop-and-ask gates**            | Approval points are the user's control over the run                                |
| **Per-step completion criteria**  | The bar that stops the agent declaring success early                               |
| **Loop stop conditions**          | "…or 3 rounds, then report" is what prevents an infinite loop                      |
| **Step Completion Report format** | The report is the skill's observable contract                                      |
| **Run stats block**               | Same — a terminal output other tooling and the user rely on                        |
| **Negative-trigger clause**       | In the description. Cutting it produces false-positive triggering across the fleet |
| **Safety and refusal rules**      | Never a size optimization                                                          |

A block on this list may be **tightened** — three sentences to one, prose to a table — but its instruction must survive the edit intact.

## What else earns KEEP

- **The routing spine**: mode selector, ordered step headings, and the pointer lines themselves. A run must be able to reach every branch without loading anything.
- **Anything every run needs**: if a piece is read on 100% of activations, moving it to `references/` adds a hop and saves nothing. Schemas the workflow writes on every run belong in the body for this reason.
- **Decision rules**: the criteria that pick between branches. Move the elaboration, keep the rule.
- **Project-specific conventions and non-obvious gotchas**: the reason the skill exists.

## Tightening without changing behavior

Order of preference, cheapest first:

1. Prose → table, when the content is parallel (three options with the same fields).
2. Repeated explanation → a **leading word** used consistently ("behavior-preserving", "disposition", "load condition").
3. Multi-sentence rationale → one clause. Keep _why_ only where the agent would otherwise do the wrong thing.
4. Several near-identical examples → the single best one.

## When the read-back fails

Phase 4's read-back is where a moved section is found to have lost something — a caveat that only made sense next to the step it qualified, a reference to "the table above" that no longer resolves. Fix it in the destination file, not by reverting the move: make the file self-contained by restating the context in a sentence. If it cannot be made self-contained, the section was mis-classified — change its disposition to `KEEP` and re-run the phase.
