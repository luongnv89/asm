# Run stats — field definitions

Per-field formatting for the mandatory run-stats block defined in SKILL.md → _Run stats (mandatory)_. SKILL.md carries the block, the field order, and the omission rules; this file carries the formatting detail you consult once.

## Capturing the start time

Capture `run_started_epoch` **once** at skill start, in the same shell as the skill's first command:

```bash
cmd; ec=$?; date +%s >&2; exit "$ec"
```

Read the epoch off **stderr** so stdout and the exit code stay intact. A run that already recorded a start time reuses it — never re-stamp mid-run. A run that stopped before the epoch was captured has no anchor, so `elapsed` prints `n/a`.

## Fields

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `elapsed`    | wall-clock duration, `{H}h {M}m {S}s`; drop zero-valued leading units only (`6m 04s`, `48s`)     |
| `tokens`     | **conditional** — printed only where the host reported a usage figure, with thousands separators |
| `cost`       | **conditional** — printed only where the host reported a run cost, as `$0.42`                    |
| `agents`     | subagents this run spawned                                                                       |
| `skills`     | other skills this run invoked                                                                    |
| `tool calls` | tool invocations this run made                                                                   |

## Cost of measuring

Measuring must not become a measurable share of what it measures: one epoch read at start, one at the end, two lines of output — never a timing call per step, and never a summarization pass to reconstruct the figures.

Never estimate `tokens` or `cost` from output length, file sizes, or step counts, and never reconstruct either from host transcripts or logs. An unreported figure is omitted, not guessed.
