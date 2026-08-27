# Run stats — field definitions

The per-field contract behind the run-stats block in `SKILL.md` → _Run stats (mandatory)_. That section carries the block's shape, its ordering rule, and the never-invent rule; this file carries the formatting detail for each field. If the two diverge, SKILL.md wins.

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `elapsed`    | wall-clock duration, `{H}h {M}m {S}s`; drop zero-valued leading units only (`4m 12s`, `48s`)     |
| `tokens`     | **conditional** — printed only where the host reported a usage figure, with thousands separators |
| `cost`       | **conditional** — printed only where the host reported a run cost, as `$0.42`                    |
| `agents`     | subagents this run spawned                                                                       |
| `skills`     | other skills this run invoked (`skill-creator`'s validator counts as one)                        |
| `tool calls` | tool invocations this run made                                                                   |

## Cost of the block itself

One epoch read at the start (the `date +%s >&2` in _Dependency Preflight (mandatory)_), one at the end, two lines of output. Never a timing call per phase, and never a summarization pass to reconstruct the counts.

## Why `tokens` and `cost` are conditional

Not every host surfaces a usage or cost figure to the agent. A run that cannot read one omits the field rather than estimating it — an estimate reads as a measurement in the report and is unfalsifiable after the fact. This is why the block has no placeholder for these two, while the four unconditional fields fall back to the literal `n/a`.
