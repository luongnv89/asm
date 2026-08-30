# Step 4 — Classify each repo

Build per-repo status from three signals: the preindex log, `git diff` on `data/skill-index/`, and the `disabled[]` list from Step 1.

```bash
DIFF_FILES=$(git diff --name-only -- data/skill-index/ | sort -u)
```

For each enabled repo, match the preindex log line by its `{source}` string (`github:owner/repo`) and look up the on-disk file by `{owner}_{repo}`:

| Signal in `preindex.log` (per `{source}` line) | `data/skill-index/{owner}_{repo}.json` in `git diff` | Bucket                                              |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `  {source} ... N skills`                      | yes                                                  | **updated**                                         |
| `  {source} ... N skills`                      | no                                                   | **unchanged**                                       |
| `  {source} ... FAILED: ...`                   | (either)                                             | **failed** (capture error message)                  |
| (no line for this `{source}`)                  | (either)                                             | **failed** (capture as `"no output from preindex"`) |

For each `disabled[]` repo: **skipped** with reason `"disabled in skill-index-resources.json"`.

Capture each repo's post-run `skillCount` by reading the (possibly updated) `data/skill-index/{owner}_{repo}.json`. For **failed** repos, post-count = pre-count (no change on disk).
