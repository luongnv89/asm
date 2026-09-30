# Edge cases and error handling

Each row names a condition, the step that owns it, and the required response. When two rows touch the same guardrail (never stage `website/catalog.json`; `yes`-only gate), honor it at every point of action — the cost of forgetting mid-run is a bad push.

| Condition                                                               | Response                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **No enabled repos** (`enabled[]` empty)                                | Stop in Step 1 — nothing to refresh.                                                                                             |
| **Pre-existing corrupt `data/skill-index/*.json`**                      | Step 1 `jq empty` catches it — stop before the refresh masks it.                                                                 |
| **Existing local edits to `data/skill-index/`**                         | The mandatory pre-edit stash captures them; if the post-run pop conflicts, follow the recovery hint in the stash block and stop. |
| **A single upstream repo unreachable** (404, network blip)              | `preindex` marks it `FAILED` and continues; it lands in **failed**. The PR still ships the rest.                                 |
| **All upstream repos fail** (no network, outage)                        | Every repo lands in **failed**; the diff is empty; stop before Step 8 — nothing to commit.                                       |
| **Ingest produces zero `skillCount`** (upstream removed every SKILL.md) | Treat as **updated** with a negative delta — a real change worth shipping.                                                       |
| **`preindex` errors before any log line**                               | Stop in Step 3 — environmental, not per-repo. Prompt `npm install` and retry.                                                    |
| **`preindex` exits 1 with a partial log**                               | Continue to Step 4 — partial results are still useful.                                                                           |
| **`build-catalog` fails after preindex**                                | Stop in Step 5 — the index is internally inconsistent. Investigate before committing.                                            |
| **`website/catalog.json` in `git status`**                              | It is gitignored; if `.gitignore` broke, fix it. **Never `git add website/catalog.json`.**                                       |
| **Unexpected files in the diff** (WIP in `src/`, `skills/`)             | Stop in Step 6 — do not commit a mixed change. Ask the user to revert or run on a clean branch.                                  |
| **User declines the Step 8 gate**                                       | Stop cleanly. Leave the refreshed files in the working tree for inspection. Do not `git checkout --` anything.                   |
| **`gh` not authenticated**                                              | Prompt `gh auth login` before retrying Step 8.                                                                                   |
| **`gh pr create` fails** (auth, network, missing remote)                | Print the committed SHA so the user can push and open the PR manually.                                                           |
