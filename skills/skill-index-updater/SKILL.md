---
name: skill-index-updater
description: "Add GitHub skill repos to the ASM index: clone, audit, eval, regenerate index, rebuild catalog, open PR. Use when given GitHub URLs to onboard. Don't use for refreshing indexed repos (refresh-index), improving skills (skill-creator), or install."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob WebFetch Agent
effort: high
metadata:
  version: 2.2.0
  author: luongnv89
---

# Skill Index Updater

You are adding new skill repository sources to the ASM (Agent Skill Manager) curated index. This is the pipeline that powers the skill catalog at https://luongnv.com/asm/ — every repo you add here becomes discoverable and installable by thousands of users.

## Example

```
User: add github.com/anthropics/skills to the index
Skill output:
  Step 1: Parsed 1 URL → anthropics/skills (NEW)
  Step 2: Discovered 14 SKILL.md files
  Step 3: Audit 13 OK / 1 WARN, eval scores 71–94
  Step 6–8: data/skill-index-resources.json + data/skill-index/anthropics_skills.json updated, catalog rebuilt
  Step 10: PR #312 opened — feat(index): add anthropics/skills (14 skills)
```

## Repo Sync Before Edits (mandatory)

Before modifying any files, pull the latest remote branch:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --rebase origin "$branch"
```

If the working tree is dirty: stash, sync, then pop. If `origin` is missing or conflicts occur: stop and ask the user before continuing.

## Prerequisites

Check each before Step 1. If one fails, stop and name it.

- `node` (>= 22), `jq`, and `git` on PATH; `npm install` done in the repo, so `npx tsx` resolves
- `asm` on PATH — the Step 3 workers run `asm eval`
- `gh auth status` succeeds — Step 10 opens the PR
- `git status --porcelain -- website/ data/` prints nothing. Step 8 restores the tracked `website/` files and `data/repo-stars.json` that `build-catalog` rewrites, which is safe only from a clean start.

## Input

The user provides one or more GitHub repository URLs: `https://github.com/owner/repo`, `github.com/owner/repo`, `github:owner/repo`, or `owner/repo`. Normalize each to `owner` and `repo`.

## Pipeline

Follow these steps in order. Each step has a verification check — do not proceed to the next step if verification fails.

You are the **orchestrator**. Steps 2 and 3 are the heavy ones, and you delegate both: each names the slice of `references/` its worker needs and hands that slice over as the worker's `Input`. In those two steps you never clone a repo, read a `SKILL.md`, or run `asm eval` yourself, and you never open the two contract files — the workers do. This keeps the clones and contract text out of your context budget. (Step 7's manual-generation fallback is the one place you may call `asm eval` directly.)

**No Agent tool?** Degrade gracefully: read `references/discovery-contract.md` and `references/audit-eval-contract.md` yourself, run Steps 2 and 3 inline, in order, and say so in the Step 9 summary. The pipeline is identical; only the context cost changes.

### Step 1: Parse and Validate Input URLs

For each URL provided:

1. Extract `owner` and `repo` from the URL.
2. Request `https://api.github.com/repos/{owner}/{repo}`. A 200 response means the repo exists; any other status marks it `INVALID` with that status.
3. Replace `owner` and `repo` with the two halves of the response's `full_name`. The ingester names files and `installUrl`s with the case it is given, so `Anthropics/Skills` would otherwise create a duplicate entry.
4. Look up `github:{owner}/{repo}` in `data/skill-index-resources.json`. If present, mark it `EXISTS` (re-index); otherwise mark it `NEW`.

Output a summary table:

```
| # | Owner/Repo          | Status   | Notes                    |
|---|---------------------|----------|--------------------------|
| 1 | owner/repo          | NEW      | Will be added            |
| 2 | other/repo          | EXISTS   | Will be re-indexed       |
| 3 | bad/repo            | INVALID  | 404 - repo not found     |
```

If every repo is `INVALID`, stop and tell the user.

### Step 2: Discover Skills in Each Repository (workers, one per repo)

Spawn one discovery worker per valid repo, **in the same turn** so they run concurrently. Each worker's contract:

- Input: `references/discovery-contract.md`, plus that repo's `owner` and `repo`
- Output: the fixed JSON in that contract — `{owner, repo, tempRoot, clonePath, status, error, skills[]}`, one object per repo
- You do NOT read `references/discovery-contract.md` yourself; the worker does

Keep every worker's `tempRoot` and `clonePath`: Step 3 runs against the clone, Cleanup deletes the `tempRoot`. There is no shared `$TEMP_DIR` in your shell — the clones were made in the workers'.

Report how many skills were found per repo. If a repo returns `status: "no-skills"`, ask the user whether to include it anyway. If a repo returns `status: "clone-failed"`, skip it, report its `error`, and continue with the others.

### Step 3: Audit and Evaluate Discovered Skills (workers, one per batch)

Spawn one audit worker per repo — or per batch of ~20 skills for a large repo — again in the same turn. Each worker's contract:

- Input: `references/audit-eval-contract.md`, that repo's `clonePath` from Step 2, and the `relPath` list for its batch
- Output: the fixed JSON array in that contract — one object per skill, `{relPath, name, auditStatus, notes[], overallScore, grade}`
- You do NOT read `references/audit-eval-contract.md` yourself

No worker re-clones; they run against the Step 2 clones. Merge the workers' JSON — no re-reading of any skill file — into one combined report:

```
Repo: owner/repo (N skills discovered)

  skill-name-1        OK     92 / A    name + description present, no security flags
  skill-name-2        WARN   58 / D    missing description
  skill-name-3        FLAG   71 / C    contains shell execution patterns (exec, spawn)
```

The policy is **permissive but transparent**: accept every repo with at least one valid skill (name + description). WARN, FLAG, and low eval scores do not block inclusion; they are reported so the reviewer can decide. Keep the OK / WARN / FLAG counts per repo — Step 10's PR body uses them.

### Step 4: Check for Existing Repos to Update

For each `EXISTS` repo from Step 1:

1. Compare `data/skill-index/{owner}_{repo}.json` against the Step 2 skill list.
2. Report new skills, removed skills, and skills with changed metadata (version, description, …).
3. Ask the user to confirm. If they decline, drop that repo from Steps 6–10.

### Step 5: Create Feature Branch

If no `NEW` repo and no confirmed `EXISTS` repo remains, stop and report that there is nothing to add. If the current branch is not `main`, ask the user whether to branch from it or from `main`. Then:

```bash
git checkout -b feat/index-add-{repo-names}
```

For several repos, use `feat/index-add-multiple-repos-{date}`.

### Step 6: Update skill-index-resources.json

For each NEW repo, append to the `repos` array in `data/skill-index-resources.json`:

```json
{
  "source": "github:{owner}/{repo}",
  "url": "https://github.com/{owner}/{repo}",
  "owner": "{owner}",
  "repo": "{repo}",
  "description": "{repo description from GitHub API}",
  "maintainer": "@{owner}",
  "enabled": true
}
```

Set the top-level `updatedAt` to the current ISO date.

### Step 7: Generate Index Files (one repo at a time)

Ingest **only** the repos this run adds or updates. Do not run `npm run preindex`: it re-ingests every enabled repo, which fills the diff with unrelated index refreshes (that is `refresh-index`'s job). Use the repo's own CLI, with `ASM_CONFIG_DIR` pointed at a scratch directory so the user's real `~/.config/agent-skill-manager/skill-index/` is never written:

Create the scratch directory once and record its literal path (many hosts start each command in a fresh shell):

```bash
mktemp -d    # e.g. /var/folders/.../tmp.AbC123 — use this literal path as INGEST_HOME below
```

Then, once per repo:

```bash
ROOT="$(git rev-parse --show-toplevel)"
INGEST_HOME="<literal path from mktemp>"
ASM_CONFIG_DIR="$INGEST_HOME" npx tsx "$ROOT/bin/agent-skill-manager.ts" \
  index ingest "github:{owner}/{repo}" --json
cp "$INGEST_HOME/skill-index/{owner}_{repo}.json" "$ROOT/data/skill-index/"
```

The ingested file's `skillCount` is authoritative. Use it in Step 9, the commit message, and the PR. If it differs from the Step 2 count, report both. The ingester populates `tokenCount` and `evalSummary` (`overallScore`, `grade`, `categories`, `evaluatedAt`, `evaluatedVersion`) on every skill entry; these power the catalog's "est. tokens" and "eval score" badges.

If the ingest exits non-zero for a repo, follow `references/manual-index.md` for that repo only, and record it as manually generated. That fallback populates `tokenCount` and `evalSummary` with `asm eval <clonePath>/<relPath> --json`, both values taken from that repo's Step 2 worker result.

### Step 8: Rebuild Website Catalog

```bash
npx tsx scripts/build-catalog.ts
jq empty website/catalog.json
jq --arg p "github:{owner}/{repo}" \
  '[.skills[] | select(.installUrl == $p or (.installUrl | startswith($p + ":")))] | length' \
  website/catalog.json
git restore -- website/ data/repo-stars.json
```

Verification: `build-catalog` and `jq empty` exit 0, and the count for each repo equals its `skillCount`. If `build-catalog` fails, stop — a PR with a broken catalog must not land. `build-catalog` also rewrites tracked outputs (`website/*-stats.json`, `website/robots.txt`, and `data/repo-stars.json` on any networked run) with fresh values; `git restore -- website/ data/repo-stars.json` reverts them (safe because the prerequisites required a clean `website/` and `data/`). It leaves the gitignored `website/catalog.json` in place.

### Step 9: Verify Everything

Check each item. If one fails, fix it before Step 10:

1. `jq empty data/skill-index-resources.json` exits 0 and the file contains every NEW repo.
2. Each added or updated `data/skill-index/{owner}_{repo}.json` passes `jq empty`.
3. Every skill entry in those files has a numeric `tokenCount` and an `evalSummary` with `overallScore`, `grade`, and `categories`. Evaluation is best-effort in the ingester: list any skill missing `evalSummary` under Uncertainty instead of failing the run.
4. `git status --porcelain | cut -c4-` lists only `data/skill-index-resources.json` and the index files of the repos in this run.

Print the pre-PR summary:

```
Added N new repo(s), updated M existing repo(s)
Total new skills indexed: X
Audit: A OK · B WARN · C FLAG
Files changed: <list>
```

### Step 10: Commit, Push, and Create PR

Read `references/commit-and-pr.md` for the staging rule, commit message, and PR body. Stage only the data files; never stage `website/catalog.json`. Build the PR's audit summary from the Step 3 counts.

Verification: `gh pr view --json url` returns the PR URL.

## Step Completion Reports

After each step, print a compact status block: `√` pass, `×` fail, `—` context.

```
◆ Step N — [step name]
··································································
  [check]:           √ pass
  Result:            PASS | FAIL | PARTIAL
```

Checks per step:

- **Repo sync** — `branch up to date`
- **Step 1** — `every URL classified NEW / EXISTS / INVALID`
- **Steps 2–3** — `one result per repo`, `one audit row per discovered skill`
- **Steps 4–6** — `EXISTS changes confirmed`, `branch created`, `resources entry added per NEW repo`
- **Step 7** — `one index file per repo`, `manual fallbacks named (if any)`
- **Steps 8–9** — `build-catalog exit 0`, `catalog count matches skillCount`, `diff scope contained`
- **Step 10** — `PR URL returned`

## Final output

End the run with a short report:

1. **Result** — first line: `PR opened`, `nothing to add`, or `blocked at Step N` with the reason.
2. **Evidence** — the Step 9 summary, the per-repo audit counts, and the PR URL.
3. **Uncertainty** — the audit is lightweight and `asm eval` scores structure, not behavior: no indexed skill was run. Name any repo indexed by the manual fallback, and any repo skipped as INVALID or clone-failed.
4. **Decision** — the user reviews and merges the PR. Name any WARN/FLAG skill they should look at first. If nothing needs their attention, say "No approval needed beyond the PR review."

## Acceptance Criteria

The expected output of a successful run, each item checkable:

- Every input URL appears in the Step 1 table with a status.
- `git status --porcelain` before commit lists only the resources file and the index files of this run's repos.
- Each added skill appears in `website/catalog.json`, and `website/catalog.json` is not staged.
- The PR audit summary matches the Step 3 OK / WARN / FLAG counts.
- `gh pr view --json url` returns a URL, or the commit SHA is reported on failure.

When reviewing a run's output (by eval or by a human), also check that a reader can:

- **Find the main result** — the first line states the completion status.
- **Separate facts from assumptions** — observed checks (exit codes, counts) are distinct from the stated limits of the audit and eval.
- **Trace claims** — each repo's skill count and audit counts map to a Step 2 or Step 3 result; "PR opened" maps to a URL.
- **See the next decision** — the PR review, plus any WARN/FLAG skill to inspect.

An agent's own review cannot confirm human understanding. A reviewer who received no human feedback records understanding as unconfirmed.

## Edge Cases & Error Handling

Each row names a condition and the required response. When in doubt, surface the issue to the user rather than silently dropping a repo.

| Condition                                                           | Response                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Repo URL is a 404 / private repo**                                | Mark `INVALID` in Step 1 and skip; continue with valid URLs.                                        |
| **Git clone fails**                                                 | The Step 2 worker returns `status: clone-failed`; skip that repo, report its `error`, continue.     |
| **Repo has zero SKILL.md files**                                    | The Step 2 worker returns `status: no-skills`; ask whether to include anyway.                       |
| **Repo has 50+ SKILL.md files**                                     | Continue, and warn that `asm eval` over many skills is slow.                                        |
| **Repo already in index, unchanged**                                | Report `EXISTS, no diff` and skip Steps 6–7 for that repo.                                          |
| **Repo already in index, breaking changes** (skill removed/renamed) | Show the Step 4 diff and require explicit confirmation before overwriting.                          |
| **`index ingest` fails for a repo**                                 | Use `references/manual-index.md` for that repo; name it in the final output.                        |
| **`npx tsx scripts/build-catalog.ts` fails**                        | Stop in Step 8.                                                                                     |
| **Unrelated files in the diff**                                     | Stop in Step 9; do not commit a mixed change. Ask the user to revert them or run on a clean branch. |
| **`gh` not authenticated**                                          | Prompt `gh auth login`; do not push without auth.                                                   |
| **`gh pr create` fails** (auth, network, missing remote)            | Print the commit SHA so the user can push and open the PR manually.                                 |
| **Non-GitHub URL** (GitLab, Bitbucket)                              | Reject in Step 1 — this skill only indexes github.com.                                              |
| **URL to a single skill subdirectory** (`.../tree/main/skills/foo`) | Treat it as the parent repo URL; the Step 2 worker picks up every skill, including that one.        |
| **Agent tool unavailable**                                          | Read both contract files yourself, run Steps 2 and 3 inline, and say so in the Step 9 summary.      |

## Cleanup

After completion, delete every temp directory this run made:

- When Step 2 was delegated: the `tempRoot` each worker returned verbatim. Never derive the target from `clonePath`.
- If you ran Step 2 inline, your own `mktemp -d` directory instead.
- The Step 7 `INGEST_HOME` (its literal path).

```bash
rm -rf "<tempRoot>"      # one per repo
rm -rf "<INGEST_HOME literal path>"
```

## References

- `references/discovery-contract.md` — the Step 2 worker's slice: clone, discover, and report every SKILL.md as fixed JSON (including the `tempRoot` Cleanup deletes)
- `references/audit-eval-contract.md` — the Step 3 worker's slice: lightweight audit + `asm eval`, returned as fixed JSON rows
- `references/manual-index.md` — Step 7 fallback: hand-built index file for a repo whose ingest failed
- `references/commit-and-pr.md` — Step 10 staging, commit message, and PR body template
