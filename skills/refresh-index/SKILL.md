---
name: refresh-index
description: "Re-ingest every already-enabled repo in data/skill-index-resources.json: sync the working tree, run preindex, rebuild the catalog for verification, summarize updated/unchanged/failed/skipped, then gate commit + PR behind explicit confirmation. Use when asked to refresh the index, re-ingest indexed repos, or batch-maintain already-indexed skill sources. Don't use for adding new repos (use skill-index-updater), improving a single skill (use skill-auto-improver), or installing/updating skills on the local machine (use asm install or asm update)."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 1.0.0
  author: luongnv89
---

# Refresh Index

You are refreshing every enabled repository in the ASM curated skill index. The goal is to re-ingest each source so `data/skill-index/{owner}_{repo}.json` reflects the latest upstream state, classify each repo as **updated / unchanged / failed / skipped**, verify the catalog still rebuilds cleanly, and open a single PR that ships only the data changes — with explicit user confirmation before any commit or push.

This is the inverse of `skill-index-updater`. That skill **adds new repos** from URLs the user supplies. This skill **refreshes the repos that are already enabled** in `data/skill-index-resources.json`.

## Repo Sync Before Edits (mandatory)

Before re-ingesting anything, pull the latest remote branch:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
dirty=0
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-refresh-index: ${branch}"
  dirty=1
fi
git fetch origin
git pull --rebase origin "$branch"
if [ "$dirty" -eq 1 ]; then
  git stash pop || {
    echo "✗ Stash pop failed — recover with: git stash list && git stash show -p stash@{0}"
    exit 1
  }
fi
```

If `origin` is missing or rebase conflicts occur, **stop and ask the user** before continuing. Never silently overwrite local edits to `data/skill-index/` or `data/skill-index-resources.json`.

## Prerequisites

Verify each before any ingest. Stop and tell the user if any fails.

- `node` and `npm` on PATH (`command -v node`, `command -v npm`) — required by `npm run preindex`
- `asm` on PATH (`command -v asm`) — invoked transitively by the ingester for `asm eval`
- `gh` on PATH and authenticated (`gh auth status`) — required for PR creation
- `git` on PATH and inside the ASM repo working tree (`git rev-parse --show-toplevel`)
- Network access to `github.com` (each ingest clones the upstream repo)

## Pipeline

Follow these steps in order. Each step has a verification check — do not proceed if the check fails.

### Step 1: Enumerate the index

Read `data/skill-index-resources.json` and split entries into two lists:

```bash
ROOT="$(git rev-parse --show-toplevel)"
RES="$ROOT/data/skill-index-resources.json"
```

Use `jq` (or your equivalent JSON reader) to build two lists, keyed on the `source` string (`github:owner/repo`) because that is the identifier `preindex` echoes in its log lines:

- `enabled[]` — every repo with `"enabled": true`. These will be refreshed.
- `disabled[]` — every repo with `"enabled": false`. These land in the **skipped** bucket up front with reason `"disabled in skill-index-resources.json"`.

```bash
jq -r '.repos[] | select(.enabled == true)  | .source' "$RES"   # e.g. github:anthropics/skills
jq -r '.repos[] | select(.enabled == false) | .source' "$RES"
```

Also derive the on-disk file key (`{owner}_{repo}`) for each enabled repo — this is what `data/skill-index/{owner}_{repo}.json` is named:

```bash
jq -r '.repos[] | select(.enabled == true) | "\(.source)\t\(.owner)_\(.repo)"' "$RES"
```

Verification: both lists are non-empty (the index always contains at least one enabled repo and one disabled self-reference). Also validate the existing per-repo JSON is parseable before re-ingesting — a pre-existing corruption otherwise gets masked by the refresh:

```bash
jq empty data/skill-index/*.json   # exits non-zero if any file is invalid
```

If `enabled[]` is empty or pre-validation fails, stop — there is nothing safe to refresh.

### Step 2: Snapshot pre-run skill counts

Before re-ingesting, record the current `skillCount` for each enabled repo. This lets Step 7 report skill-count deltas.

```bash
mkdir -p /tmp/refresh-index
SNAPSHOT="/tmp/refresh-index/pre-snapshot.json"
echo "{}" > "$SNAPSHOT"
for entry in $(jq -r '.repos[] | select(.enabled == true) | "\(.owner)_\(.repo)"' "$RES"); do
  file="$ROOT/data/skill-index/${entry}.json"
  if [ -f "$file" ]; then
    count=$(jq -r '.skillCount // 0' "$file")
    jq --arg k "$entry" --argjson v "$count" '. + {($k): $v}' "$SNAPSHOT" > "$SNAPSHOT.tmp" && mv "$SNAPSHOT.tmp" "$SNAPSHOT"
  fi
done
```

If a repo is enabled but has no existing index file, treat the pre-count as `0`. The repo will then show up in **updated** with a positive delta in Step 7.

### Step 3: Run `npm run preindex`

Re-ingest every enabled repo via the project's preindex script. Capture both stdout and the exit code — `preindex` exits 1 if any repo fails, but **do not abort the run**. We still want partial results so the summary can show what succeeded.

```bash
LOG="/tmp/refresh-index/preindex.log"
cd "$ROOT"
set +e
npm run preindex 2>&1 | tee "$LOG"
PREINDEX_EXIT=$?
set -e
```

Verification: the log file exists and contains one line per enabled repo formatted as either `  {source} ... {N} skills` (success) or `  {source} ... FAILED: {error}` (failure), where `{source}` matches the `github:owner/repo` strings from Step 1. If the log is empty or no line matches, stop and surface the error.

### Step 4: Classify each repo

Build per-repo status from three signals — the preindex log, `git diff` on `data/skill-index/`, and the `disabled[]` list from Step 1.

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

For each `disabled[]` repo: **skipped** with the disabled reason.

Capture each repo's post-run `skillCount` by reading the (possibly updated) `data/skill-index/{owner}_{repo}.json`. For **failed** repos, post-count = pre-count (no change on disk).

### Step 5: Rebuild the website catalog (verification only)

Run the catalog build to confirm the refreshed index is structurally valid. **`website/catalog.json` is gitignored — never stage it.** A failure here means the data files are internally inconsistent and the PR must not land.

```bash
cd "$ROOT"
npx tsx scripts/build-catalog.ts
```

Verification: the script exits 0 and `website/catalog.json` is valid JSON (`jq empty website/catalog.json`). If it fails, stop the pipeline — investigate the data issue before committing anything.

### Step 6: Detect unexpected diff scope

Confirm the only files that changed are the ones we expect — per-repo data under `data/skill-index/` and, only if the user explicitly bumped the top-level `updatedAt`, `data/skill-index-resources.json`:

```bash
UNEXPECTED=$(git diff --name-only \
  | grep -v -E '^data/skill-index/' \
  | grep -v -E '^data/skill-index-resources\.json$' \
  || true)
if [ -n "$UNEXPECTED" ]; then
  echo "⚠ Unexpected files in diff:"
  printf '%s\n' "$UNEXPECTED"
  # stop and surface to user
fi
```

Note: `npm run preindex` does **not** modify `data/skill-index-resources.json` — it only writes per-repo files under `data/skill-index/`. The resources file should only appear in the diff if the user is also refreshing the top-level `updatedAt` timestamp (optional — leave it alone unless asked).

If unexpected files appear (e.g. someone left edits in `src/` or `skills/`), stop and tell the user. Do not commit a mixed change.

### Step 7: Print the four-bucket summary

Render a markdown table grouped by bucket, with skill-count deltas. This is what the user reads to decide whether to confirm the PR.

```
## Refresh summary — N repos processed

### ✓ Updated (X)
| Repo | Before | After | Δ |
|------|--------|-------|---|
| anthropics/skills | 14 | 15 | +1 |
| obra/superpowers  | 22 | 22 |  0 |

### · Unchanged (Y)
| Repo | Skills |
|------|--------|
| owner1/repo1 | 7 |

### ✗ Failed (Z)
| Repo | Error |
|------|-------|
| owner2/repo2 | clone failed: 404 Not Found |

### ○ Skipped (W)
| Repo | Reason |
|------|--------|
| luongnv89/asm | disabled in skill-index-resources.json |
```

If `X + Y + Z + W` does not equal `len(enabled) + len(disabled)`, the classification is inconsistent — stop and re-check Step 4 before moving on.

### Step 8: Confirmation gate, commit, and PR

**Do not proceed without explicit user confirmation.** Print the diff stat and ask:

```bash
git diff --stat -- data/skill-index/ data/skill-index-resources.json
echo
echo "Ready to commit the files above and open a PR."
echo "Type 'yes' to continue, anything else to abort."
```

On `yes` (and only `yes`), stage **only** the index data files — never `website/catalog.json`, never anything outside `data/skill-index/` — commit with the conventional-commit message below, push, and open the PR:

```bash
git add data/skill-index/
# Only add the resources file if it was intentionally modified (e.g., updatedAt bump):
if git diff --name-only | grep -q '^data/skill-index-resources\.json$'; then
  git add data/skill-index-resources.json
fi

git commit -m "$(cat <<'EOF'
chore(index): refresh indexed skill sources

Re-ingested all enabled repos in data/skill-index-resources.json.

Updated: <X> repo(s)
Unchanged: <Y> repo(s)
Failed: <Z> repo(s)
Skipped: <W> repo(s)
EOF
)"

branch="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$branch"

gh pr create --title "chore(index): refresh indexed skill sources" --body "$(cat <<'EOF'
## Summary
Re-ingested all enabled repos in `data/skill-index-resources.json` to bring the catalog up to date with upstream.

## Results
- **Updated:** <X> repo(s)
- **Unchanged:** <Y> repo(s)
- **Failed:** <Z> repo(s) (see body for details)
- **Skipped:** <W> repo(s) (disabled in resources file)

### Updated repos
| Repo | Before | After | Δ |
|------|--------|-------|---|
| ... | ... | ... | ... |

### Failed repos
| Repo | Error |
|------|-------|
| ... | ... |

## Test Plan
- [ ] `data/skill-index/*.json` files are valid JSON
- [ ] `npx tsx scripts/build-catalog.ts` rebuilds `website/catalog.json` without errors
- [ ] No files outside `data/skill-index/` and `data/skill-index-resources.json` are staged
- [ ] CI passes
EOF
)"
```

Fill the `<X>` / `<Y>` / `<Z>` / `<W>` placeholders and the per-bucket tables with the actual numbers from Step 7 before running `gh pr create`.

Verification: `gh pr view --json url` returns the new PR URL. Print it back to the user.

## Edge Cases & Error Handling

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

## Cleanup

After the PR is opened (or the pipeline aborts), remove temporary artifacts:

```bash
rm -rf /tmp/refresh-index
```

Leave the working tree as the user left it. Do not `git checkout` anything they did not stage.
