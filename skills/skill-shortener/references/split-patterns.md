# Split patterns — the MOVE disposition

Read this while assigning `MOVE`. It decides the destination, the pointer, and the shape of the file that lands there.

## Choosing the destination

| Content                                                                 | Destination                      |
| ----------------------------------------------------------------------- | -------------------------------- |
| Schemas, API docs, long examples, edge-case catalogs, per-branch detail | `references/*.md`                |
| Flat lists — commands, error codes, field names                         | `references/*.txt`               |
| A fragile multi-step procedure the agent repeats                        | `scripts/*` (rewrite it as code) |
| Templates, boilerplate, files that appear in the output                 | `assets/*`                       |
| A complete prompt for a delegated worker                                | `agents/*.md`                    |

**Scripts are the biggest win.** A twenty-step procedure moved to `references/` still costs full tokens when read. Rewritten as a CLI, only its _output_ enters context. Any section that reads "do these N fragile steps" and could be deterministic is a script, not a reference. Give it descriptive stderr errors saying what went wrong, which input caused it, and how to fix it — an agent that hits a bare `exit 1` is stuck.

## Splitting by branch or by sequence

- **By branch** — a skill covering AWS _and_ GCP, or create _and_ edit, gets one file per branch and a selector in the body. This is the highest-value split: a run loads its own branch and never sees the other.
- **By sequence** — a long phase 5 moves to its own file, read when the run reaches it. This also keeps the agent from seeing the finish line early and rushing the step in front of it.

Name files after the branch or phase, not the content type: `aws.md`, `phase-5-publish.md` — not `details.md` or `advanced.md`.

## Writing the pointer

A pointer without a load condition is relocation, not disclosure — the agent either reads everything anyway or skips something it needed. Verification fails a pointer with no `when` / `if` / `before` / `after` cue.

- Good: ``Read `references/api-errors.md` when the API returns a non-200.``
- Good: ``Run `scripts/validate.py` before committing.``
- Good: ``For the full command list, read `references/commands.txt` if the common four are not enough.``
- Bad: ``See `references/api-errors.md`.``
- Bad: ``More detail in `references/advanced.md`.``

Write **illustrative** paths as placeholders — `references/<topic>.md`, not `references/api-errors.md`. Verification reads every concrete `references/…` path in the body as a real pointer and fails the ones that do not resolve; a placeholder is unmistakably an example.

State the condition the way the agent will meet it — a state it can observe, not a topic it might be interested in.

## Rules for the destination file

1. **One level deep.** A reference must not point to another reference. If two belong together, merge them; if one is genuinely shared, promote it to a sibling the body points at directly. Chains defeat disclosure — the agent pays for both files to reach the second.
2. **Self-contained.** The reader arrives with the pointer's sentence and nothing else. Restate the context in one line rather than writing "as described above".
3. **Contents map over 300 lines.** A one-line list of headings at the top so the agent can skim to its section.
4. **Flatten dense material.** Markdown headings, fences, and blank lines cost real tokens on a list of commands. A flat `.txt` of `command — what it does` lines is often an order of magnitude cheaper than the same content as formatted Markdown, and just as readable to the agent.
5. **No orphans.** Every file under `references/` and `scripts/` must be pointed at from the body. An unpointed file is either dead or a pointer you forgot to write.

## Delegating the write

With three or more destinations and the Agent tool available, give each file its own worker. The worker receives this file plus the section's original text as its `Input`, and returns the finished destination file. Keep the body rewrite with the main agent — it is the one step that needs every pointer in view at once.
