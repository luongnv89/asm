# PR Template

Fill in the placeholders below. Write the final body to `.asm-improver/pr-body.md` and pass it to `gh pr create --body-file`.

## Title

```
Suggest SKILL.md improvements for <skill-name> (+<N> overall, <weakest-category> +<M>)
```

Keep it under 72 chars. Lead with "Suggest" so the reader immediately sees this is a suggestion PR, not a drive-by rewrite.

## Body

````markdown
Hi! 👋 I came across **<skill-name>** while browsing skills and really appreciated <one specific thing you liked>. Wanted to share a few suggestions that surfaced when I ran the skill through [`asm eval`](https://github.com/luongnv89/asm) — totally happy to adjust or drop any of this if it doesn't fit your direction.

## What I suggested

<One or two sentences describing the main focus of the changes. E.g. "Tightened the description for better triggering, added an Acceptance Criteria section, and moved the long example list into `references/` to keep the body under the context-efficiency budget.">

## Before / after metrics (`asm eval`)

| Metric            | Before  | After   | Δ           |
| ----------------- | ------- | ------- | ----------- |
| **Overall score** | <X>/100 | <Y>/100 | **+<Y-X>**  |
| **Grade**         | <old>   | <new>   | <old → new> |
| <category name>   | <a>/10  | <b>/10  | <b-a>       |

<One row per entry in the eval JSON's `categories[]`, in JSON order, named by its `name` field.>

Iterations: <N> of 8 (retrofit loop).

## Files touched

- `<path/to/SKILL.md>`
- `<path/to/references/new-file.md>` (new)
- `<path/to/other-file>`

## How to verify locally

```bash
# From the repo root
asm eval <path-to-skill>          # human-readable score
asm eval <path-to-skill> --json   # full JSON report
```
````

The full iteration log and before/after JSON snapshots are attached as commits on this branch under `.asm-improver/` — feel free to delete them before merging if you don't want them in the repo.

## Why these changes

<One short paragraph per category that moved, in plain language. Avoid quoting the evaluator verbatim — translate the finding into human terms.>

- **<category>** — <human-readable reason, e.g. "The description was missing a 'Don't use for' clause, which helps Claude skip the skill on adjacent queries. Added one naming the nearby domains.">

## Notes

- These are suggestions, not prescriptions — happy to revise based on your preferences, or close this if the direction isn't right for the project.
- Thanks for open-sourcing <skill-name>! It's a useful skill and hope this is helpful.

_Opened via [skill-upstream-pr](https://github.com/luongnv89/asm/tree/main/skills/skill-upstream-pr). No obligation to merge._

```

## Rendering rules

- Always render the full metrics table, even when only one or two categories changed — maintainers appreciate the complete picture
- Bold the **Overall score** row; bold any category that moved more than 1 point
- If any category's `score` dropped, mention it up front in "What I suggested" so the maintainer isn't surprised — honesty beats tidy numbers
- Strip trailing whitespace and ensure one trailing newline in `pr-body.md` before passing it to `gh`
```
