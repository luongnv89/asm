# Step 4 — Classify each repo

Build per-repo status from three signals: the preindex log, the content change of `data/skill-index/{owner}_{repo}.json`, and the `disabled[]` list from Step 1.

Every successful ingest rewrites `updatedAt`, each skill's `evalSummary.evaluatedAt` and per-provider `evalSummaries.<provider>.evaluatedAt`, and each inferred bundle's `createdAt`, so a plain `git diff` shows every repo as changed. Compare with those timestamps stripped:

```bash
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
STRIP='del(.updatedAt, .bundles[]?.createdAt) | .skills |= map(del(.evalSummary.evaluatedAt) | if .evalSummaries then .evalSummaries |= map_values(del(.evaluatedAt)) else . end)'
changed() {   # $1 = data/skill-index/{owner}_{repo}.json
  git cat-file -e "HEAD:$1" 2>/dev/null || return 0   # new, untracked file → changed
  [ "$(git show "HEAD:$1" | jq -S "$STRIP")" != "$(jq -S "$STRIP" "$1")" ]
}
```

For each enabled repo, match the preindex log line by its `{source}` string (`github:owner/repo`) and test the on-disk file `{owner}_{repo}`:

| Signal in `preindex.log` (per `{source}` line) | `changed` on `data/skill-index/{owner}_{repo}.json` | Bucket                                              |
| ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `  {source} ... N skills`                      | true                                                | **updated**                                         |
| `  {source} ... N skills`                      | false (timestamps only)                             | **unchanged**                                       |
| `  {source} ... FAILED: ...`                   | (either)                                            | **failed** (capture error message)                  |
| (no line for this `{source}`)                  | (either)                                            | **failed** (capture as `"no output from preindex"`) |

For each `disabled[]` repo: **skipped** with reason `"disabled in skill-index-resources.json"`.

Capture each repo's post-run `skillCount` by reading the (possibly updated) `data/skill-index/{owner}_{repo}.json`. For **failed** repos, post-count = pre-count (no change on disk).

Unchanged repos still carry timestamp-only edits in the working tree. They are staged with the rest in Step 8 (existing behavior); the summary lists them under **Unchanged** so the reviewer knows their diff is timestamps only.
