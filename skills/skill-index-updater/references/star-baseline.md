# Star baseline for NEW repos

`src/repo-stars.test.ts` requires a `data/repo-stars.json` entry for every
enabled repo in `data/skill-index-resources.json` (#788). Offline CI builds read
stars from this file alone. A NEW repo without an entry leaves the unit suite red,
and the pre-push hook (`vitest run src/`) then blocks Step 10.

## When

Run this in Step 8, **after** `git restore -- website/ data/repo-stars.json`.
That restore reverts every star count `build-catalog` refreshed, so an entry
written before it is lost. EXISTS (re-index) repos already have a baseline: they
get no star entry, and the file stays untouched.

## Add one entry per NEW repo

Use the `stargazers_count` from that repo's Step 1 GitHub API response. Do not
fetch it again. Write to a temp file, then copy it back over the original:

```bash
ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp)"
jq --arg k "{owner}/{repo}" --argjson n {stargazers_count} '
    if .stars | has($k) then error("data/repo-stars.json already has \($k)")
    else .stars += {($k): $n} end' \
  "$ROOT/data/repo-stars.json" > "$TMP" \
  && cat "$TMP" > "$ROOT/data/repo-stars.json"
rm -f "$TMP"
```

The filter touches only `.stars`. `generatedAt` and every other entry stay as
they were. jq keeps the existing key order and adds the new key last, the same
order as the resources file, where Step 6 appended the repo. Run the block once
per NEW repo. If it stops on `already has`, the repo has a baseline; leave it
and note it under Uncertainty.

## Verify (Step 9)

```bash
jq -n --slurpfile a <(git show HEAD:data/repo-stars.json) \
      --slurpfile b data/repo-stars.json '
  { generatedAtKept: ($a[0].generatedAt == $b[0].generatedAt),
    othersKept: ([$a[0].stars | to_entries[] | select($b[0].stars[.key] != .value)] | length == 0),
    added: (($b[0].stars | keys_unsorted) - ($a[0].stars | keys_unsorted)) }'
CI=true npx vitest run src/repo-stars.test.ts
```

Pass: `generatedAtKept` and `othersKept` are `true`, `added` lists exactly
this run's NEW repos (`[]` for an EXISTS-only run), and the test exits 0.
