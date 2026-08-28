# The cut list — the CUT disposition

Read this while assigning `CUT`. A cut is a deletion with no forwarding address, so each one needs a `reason` in the manifest that survives review.

## The test

Delete a sentence and ask: **would the agent behave differently without it?** If not, it is content the skill is paying for on every activation and getting nothing back. Cut it.

## Safe to cut

| Category                        | Examples                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| **Common knowledge**            | What JSON/REST/Python/PDF/git _is_; how a well-known library works; syntax primers |
| **When-to-use prose**           | Already the job of the `description`; a body section restating it is dead weight   |
| **Setup and install notes**     | Unless the skill's own run depends on them — then they belong in a preflight       |
| **History and attribution**     | Changelogs, "v2 added…", author notes, credits                                     |
| **Template placeholders**       | `[TODO: …]` scaffolding left over from `init_skill.py`                             |
| **No-op instructions**          | "Be careful", "use good judgment", "make it high quality", "think step by step"    |
| **`--help`-level completeness** | Exhaustive flag lists. Keep the common 80% and say to run `--help` for the rest    |
| **Duplication**                 | The same rule stated in two sections. Keep one home and link to it                 |
| **Stale sediment**              | Guidance for a flow that no longer exists; pointers to deleted files               |
| **Every-edge-case enumeration** | Cases a capable agent handles by judgment. Keep the ones where judgment goes wrong |

## Cut with care

- **File paths, line numbers, magic constants** — cut unless the skill is a code-navigation runbook, where they are the payload.
- **Rationale ("why")** — keep exactly where the agent would otherwise do the wrong thing, cut where it is reassurance for a human reader.
- **Examples** — one worked example teaches more than five variants. Cut the variants, keep the best one.

## Never cut

The blocked list lives with the KEEP disposition. Before cutting anything that reads like process overhead — a gate, a stop condition, a report format, a completion criterion — check it there first.

## Writing the reason

The `reason` field is read by whoever reviews the plan, so make it a claim they can check:

- Good: `"restates the description's when-to-use; changes no behavior"`
- Good: `"exhaustive flag list; body now says to run --help"`
- Weak: `"not needed"`, `"redundant"`, `"cleanup"`

If the reason cannot be written in one checkable clause, the section is probably a `MOVE`, not a `CUT`.
