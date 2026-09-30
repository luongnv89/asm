---
name: refresh-index
description: "Sync every enabled repo in the curated skill index and open a confirmation-gated PR. Use when refreshing already-indexed sources. Don't use for adding new repos, improving a single skill, or installing skills locally."
license: MIT
compatibility: "Claude Code"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 1.1.0
  author: luongnv89
---

# Refresh Index

Re-ingest every enabled repository in `data/skill-index-resources.json` so `data/skill-index/{owner}_{repo}.json` matches upstream. Classify each repo as **updated / unchanged / failed / skipped**, verify the catalog rebuilds, then open one data-only PR after explicit confirmation.

This is the inverse of `skill-index-updater` (that skill **adds** repos). Keep SKILL.md as the spine and load step detail from `references/` so the agent's context budget stays small.

## When to Use

- User asks to "refresh the index", "update the indexed skills", "sync the catalog", "re-ingest all repos", or "batch-maintain the skill index"
- A scheduled refresh is due, or a release needs current upstream skill metadata

Do **not** trigger for: adding a new repository (`skill-index-updater`), authoring or improving a single skill (`skill-creator`, `skill-auto-improver`), opening an upstream PR (`skill-upstream-pr`), or installing/updating skills on the local machine (`asm install`, `asm update`).

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

- `node` on PATH (`command -v node`) — Node >= 22 per `package.json` engines
- `npm` on PATH (`command -v npm`) — required by `npm run preindex`
- `asm` on PATH (`command -v asm`) — invoked transitively by the ingester for `asm eval`
- `gh` on PATH and authenticated (`gh auth status`) — required for PR creation
- `git` on PATH and inside the ASM repo working tree (`git rev-parse --show-toplevel`)
- Network access to `github.com` (each ingest clones the upstream repo)

## Pipeline

Follow these steps in order. Each step has a verification check — do not proceed if the check fails. Long scripts and templates live in `references/`; read the linked file when you reach that step.

### Step 1: Enumerate the index

Read `data/skill-index-resources.json` and split entries, keyed on the `source` string (`github:owner/repo`) because that is the identifier `preindex` echoes:

```bash
ROOT="$(git rev-parse --show-toplevel)"
RES="$ROOT/data/skill-index-resources.json"
jq -r '.repos[] | select(.enabled == true)  | .source' "$RES"
jq -r '.repos[] | select(.enabled == false) | .source' "$RES"
jq -r '.repos[] | select(.enabled == true) | "\(.source)\t\(.owner)_\(.repo)"' "$RES"
jq empty data/skill-index/*.json   # exits non-zero if any file is invalid
```

- `enabled[]` — `"enabled": true`. These will be refreshed.
- `disabled[]` — `"enabled": false`. These land in **skipped** with reason `"disabled in skill-index-resources.json"`.

Verification: both lists are non-empty (the index always contains at least one enabled repo and one disabled self-reference) and existing per-repo JSON is parseable. If `enabled[]` is empty or pre-validation fails, stop.

### Step 2: Snapshot pre-run skill counts

Record current `skillCount` for each enabled repo so Step 7 can report deltas. Run the loop in `references/snapshot.md`. Missing index file → pre-count `0`.

### Step 3: Run `npm run preindex`

Re-ingest every enabled repo. Capture stdout and the exit code — `preindex` exits 1 if any repo fails, but **do not abort**. Partial results still classify.

```bash
LOG="/tmp/refresh-index/preindex.log"
cd "$ROOT"
set +e
npm run preindex 2>&1 | tee "$LOG"
PREINDEX_EXIT=$?
set -e
```

Verification: the log exists and contains one line per enabled repo: `  {source} ... {N} skills` or `  {source} ... FAILED: {error}`. If the log is empty or no line matches, stop — that is environmental, not a per-repo failure.

### Step 4: Classify each repo

Match each `{source}` log line to `data/skill-index/{owner}_{repo}.json` in `git diff`. Read `references/classify.md` for the four-row signal table. Capture post-run `skillCount`; failed repos keep the pre-count.

### Step 5: Rebuild the website catalog (verification only)

Confirm the refreshed index is structurally valid. **`website/catalog.json` is gitignored — never stage it.**

```bash
cd "$ROOT"
npx tsx scripts/build-catalog.ts
jq empty website/catalog.json
```

Verification: both commands exit 0. If either fails, stop — the data files are internally inconsistent and the PR must not land.

### Step 6: Detect unexpected diff scope

Confirm the only files that changed are under `data/skill-index/` (and `data/skill-index-resources.json` only if the user explicitly bumped `updatedAt`):

```bash
UNEXPECTED=$(git diff --name-only \
  | grep -v -E '^data/skill-index/' \
  | grep -v -E '^data/skill-index-resources\.json$' \
  || true)
if [ -n "$UNEXPECTED" ]; then
  echo "⚠ Unexpected files in diff:"
  printf '%s\n' "$UNEXPECTED"
fi
```

`npm run preindex` does **not** modify `data/skill-index-resources.json`. If unexpected files appear, stop. Do not commit a mixed change.

### Step 7: Print the four-bucket summary

Render the markdown in `references/summary-template.md`. If `X + Y + Z + W` does not equal `len(enabled) + len(disabled)`, stop and re-check Step 4.

### Step 8: Confirmation gate, commit, and PR

**Do not proceed without explicit user confirmation** (`yes` only). Read `references/commit-and-pr.md` for the diff-stat prompt, conventional-commit message, and `gh pr create` body. Stage **only** `data/skill-index/` (plus the resources file if intentionally modified). Never stage `website/catalog.json`.

Verification: `gh pr view --json url` returns the new PR URL. Print it back to the user.

## Step Completion Reports

Emit a compact status block after each step:

```
◆ Step N — [step name]
··································································
  [check 1]:         √ pass
  [check 2]:         × fail — [reason]
  Result:            PASS | FAIL | PARTIAL
```

Use `√` for pass, `×` for fail, `—` for context. Checks per step:

- **Repo sync** — `branch up to date`, `stash restored (if dirty)`
- **Step 1** — `enabled[] non-empty`, `disabled[] non-empty`, `per-repo JSON parseable`
- **Step 2** — `snapshot written`
- **Step 3** — `log exists`, `one line per enabled source`
- **Step 4** — `every repo in exactly one bucket`, `totals add up`
- **Step 5** — `build-catalog exit 0`, `catalog.json valid JSON`
- **Step 6** — `diff scope contained`
- **Step 7** — `summary printed`, `X+Y+Z+W matches list sizes`
- **Step 8** — `user confirmed yes`, `PR URL returned` (skip this block if the user declined)

## Expected Output

On a successful run, verify all of the following:

1. **Repo synced** — branch is up to date with `origin`; any local edits were stashed and restored cleanly.
2. **`npm run preindex` completed** — exit code captured; per-repo lines visible in the log.
3. **All four buckets populated** — every enabled repo lands in exactly one of updated / unchanged / failed, and every disabled repo lands in skipped. Totals add up.
4. **`npx tsx scripts/build-catalog.ts` succeeded** — `website/catalog.json` rebuilt and is valid JSON. **Not staged.**
5. **Diff scope contained** — only `data/skill-index/*.json` (and optionally `data/skill-index-resources.json` if explicitly refreshed) appear in `git diff`.
6. **User confirmed** — explicit `yes` recorded before commit + push.
7. **PR opened** — conventional-commit title (`chore(index): refresh indexed skill sources`), body filled from the Step 8 template, URL returned to the user.

If any of items 1–5 fails, do **not** proceed to Steps 6–7 of this list.

## Acceptance Criteria

- Exactly the files under `data/skill-index/` (and optionally `data/skill-index-resources.json`) are staged
- `website/catalog.json` was rebuilt as a check and was **not** staged
- Four-bucket totals equal `len(enabled) + len(disabled)`
- Commit message matches the template in `references/commit-and-pr.md`
- `gh pr view --json url` returns a URL

## Example

Given 2 enabled repos (one gained a skill) and 1 disabled self-reference, the expected output summary looks like:

```
## Refresh summary — 3 repos processed

### ✓ Updated (1)
| Repo | Before | After | Δ |
|------|--------|-------|---|
| anthropics/skills | 14 | 15 | +1 |

### · Unchanged (1)
| Repo | Skills |
|------|--------|
| obra/superpowers | 22 |

### ○ Skipped (1)
| Repo | Reason |
|------|--------|
| luongnv89/asm | disabled in skill-index-resources.json |
```

## Edge Cases

Read `references/edge-cases.md` for the full list (empty enabled set, unreachable upstream, empty ingest, catalog rebuild failure, declined confirmation, unauthenticated `gh`). Handle those without crashing; never `git checkout --` files the user did not stage.

## Cleanup

After the PR is opened (or the pipeline aborts), remove temporary artifacts:

```bash
rm -rf /tmp/refresh-index
```

Leave the working tree as the user left it. Do not `git checkout` anything they did not stage.

## References

- `references/snapshot.md` — Step 2 skill-count snapshot loop
- `references/classify.md` — Step 4 signal table (updated / unchanged / failed / skipped)
- `references/summary-template.md` — Step 7 four-bucket markdown
- `references/commit-and-pr.md` — Step 8 confirmation, commit, and PR commands
- `references/edge-cases.md` — edge cases and error handling
