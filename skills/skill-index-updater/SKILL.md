---
name: skill-index-updater
description: "Add GitHub skill repos to the ASM index: clone, audit, eval, regenerate index, rebuild catalog, open PR. Use when given GitHub URLs to onboard. Don't use for authoring (skill-creator), improving (skill-auto-improver), or install (asm install)."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob WebFetch Agent
effort: high
metadata:
  version: 2.0.0
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
  Step 3: Audit OK on 14/14, eval scores 71–94
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

## Input

The user provides one or more GitHub repository URLs. These can be in various formats:

- `https://github.com/owner/repo`
- `github.com/owner/repo`
- `github:owner/repo`
- `owner/repo` (shorthand)

Normalize all inputs to extract `owner` and `repo`.

## Pipeline

Follow these steps in order. Each step has a verification check — do not proceed to the next step if verification fails.

You are the **orchestrator**. Steps 2 and 3 are the heavy ones, and you delegate both: each names the slice of `references/` its worker needs and hands that slice over as the worker's `Input`. In those two steps you never clone a repo, read a `SKILL.md`, or run `asm eval` yourself, and you never open the two contract files — the workers do. (Step 7's manual-generation fallback is the one place you may call `asm eval` directly.)

**No Agent tool?** Degrade gracefully: read `references/discovery-contract.md` and `references/audit-eval-contract.md` yourself, run Steps 2 and 3 inline, in order, and say so in the Step 9 summary. The pipeline is identical; only the context cost changes.

### Step 1: Parse and Validate Input URLs

For each URL provided:

1. Extract `owner` and `repo` from the URL
2. Verify the repository exists by checking `https://api.github.com/repos/{owner}/{repo}`
3. Check if the repo is already in `data/skill-index-resources.json` — if so, mark it for **update** instead of **add**

Output a summary table:

```
| # | Owner/Repo          | Status   | Notes                    |
|---|---------------------|----------|--------------------------|
| 1 | owner/repo          | NEW      | Will be added            |
| 2 | other/repo          | EXISTS   | Will be re-indexed       |
| 3 | bad/repo            | INVALID  | 404 - repo not found     |
```

If ALL repos are invalid, stop and tell the user.

### Step 2: Discover Skills in Each Repository (workers, one per repo)

Spawn one discovery worker per valid repo, **in the same turn** so they run concurrently. Each worker's contract:

- Input: `references/discovery-contract.md`, plus that repo's `owner` and `repo`
- Output: the fixed JSON in that contract — `{owner, repo, tempRoot, clonePath, status, error, skills[]}`, one object per repo
- You do NOT read `references/discovery-contract.md` yourself; the worker does

Keep every worker's `tempRoot` and `clonePath`: Step 3 runs against the clone, Cleanup deletes the `tempRoot`. There is no shared `$TEMP_DIR` in your shell — the clones were made in the workers'.

Report how many skills were found per repo. A repo that comes back `status: "no-skills"` gets flagged — ask the user whether to include it anyway (it might have skills added later). A repo that comes back `status: "clone-failed"` is skipped with its `error` reported; the other repos continue.

### Step 3: Audit and Evaluate Discovered Skills (workers, one per batch)

Spawn one audit worker per repo — or per batch of ~20 skills for a large repo — again in the same turn. Each worker's contract:

- Input: `references/audit-eval-contract.md`, that repo's `clonePath` from Step 2, and the `relPath` list for its batch
- Output: the fixed JSON array in that contract — one object per skill, `{relPath, name, auditStatus, notes[], overallScore, grade}`
- You do NOT read `references/audit-eval-contract.md` yourself, and no worker re-clones: they run against the Step 2 clones

#### Combined report

Merge the workers' JSON — no re-reading of any skill file — into one table so the user sees quality and safety at a glance:

```
Repo: owner/repo (N skills discovered)

  skill-name-1        OK     92 / A    name + description present, no security flags
  skill-name-2        WARN   58 / D    missing description
  skill-name-3        FLAG   71 / C    contains shell execution patterns (exec, spawn)
```

Columns: `audit status`, `eval overallScore / grade`, notes.

The current policy is **permissive** — accept all repos that have at least one valid skill (with name + description). Security warnings and low eval scores are informational only and do not block inclusion; they exist so the reviewer can make an informed call. If a user asks "should we really add this one?", point at the eval categories for specifics. This policy may become stricter in future versions.

#### Where the eval result ends up

After Step 7 regenerates the index, each skill entry in `data/skill-index/{owner}_{repo}.json` gains two derived fields:

- `tokenCount`: heuristic token estimate for the SKILL.md body
- `evalSummary`: `{ overallScore, grade, categories[], evaluatedAt, evaluatedVersion }`

These power the "est. tokens" and "eval score" badges shown in the website catalog, the TUI, and `asm inspect`. No manual editing required — the ingester populates them as part of `preindex`.

### Step 4: Check for Existing Repos to Update

For repos already in the index (`EXISTS` status from Step 1):

1. Compare the existing index file (`data/skill-index/{owner}_{repo}.json`) against freshly discovered skills
2. Report what changed:
   - New skills added
   - Skills removed
   - Skills with updated metadata (version, description, etc.)

Ask the user to confirm updates before proceeding.

### Step 5: Create Feature Branch

Only proceed if there are legitimate new repos to add or existing repos to update.

```bash
git checkout -b feat/index-add-{repo-names}
```

Use a descriptive branch name. If adding multiple repos, abbreviate: `feat/index-add-multiple-repos-{date}`.

### Step 6: Update skill-index-resources.json

For each NEW repo, add an entry to `data/skill-index-resources.json` in the `repos` array:

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

Also update the `updatedAt` timestamp at the top level to the current ISO date.

### Step 7: Generate Index Files

For each repo (new and updated), generate the index JSON file. Use the project's built-in `preindex` script if possible:

```bash
cd "$(git rev-parse --show-toplevel)"
npm run preindex
```

If `npm run preindex` fails or takes too long, generate the index file manually by creating `data/skill-index/{owner}_{repo}.json` with this structure:

```json
{
  "repoUrl": "https://github.com/{owner}/{repo}.git",
  "owner": "{owner}",
  "repo": "{repo}",
  "updatedAt": "{ISO timestamp}",
  "skillCount": N,
  "skills": [
    {
      "name": "skill-name",
      "description": "Skill description from frontmatter",
      "version": "0.0.0",
      "license": "",
      "creator": "",
      "compatibility": "",
      "allowedTools": [],
      "installUrl": "github:{owner}/{repo}:{relative/path/to/skill}",
      "relPath": "relative/path/to/skill",
      "tokenCount": 0,
      "evalSummary": {
        "overallScore": 0,
        "grade": "F",
        "categories": [
          { "id": "structure", "name": "Structure & completeness", "score": 0, "max": 10 }
        ],
        "evaluatedAt": "{ISO timestamp}",
        "evaluatedVersion": "0.0.0"
      }
    }
  ]
}
```

The `installUrl` format matters — it's how `asm install` locates skills. For single-skill repos (SKILL.md at root), omit the path portion. For multi-skill repos, include the relative path to the skill directory.

If you fall back to manual generation, you can populate `tokenCount` and `evalSummary` by calling `asm eval <clonePath>/<relPath> --json` on each skill directory — both values come from that repo's Step 2 worker result, and a root-level skill has an empty `relPath`, so its path is just `clonePath` — and lifting the `overallScore`, `grade`, `categories`, `evaluatedAt` fields into the skill entry. When `preindex` succeeds, the ingester handles this for you automatically.

### Step 8: Rebuild Website Catalog

Run the catalog build script to regenerate `website/catalog.json`:

```bash
npx tsx scripts/build-catalog.ts
```

Verify the output:

- `website/catalog.json` was updated
- Total skill count increased (or stayed the same for pure updates)
- No errors in the build output

### Step 9: Verify Everything

Run a final check:

1. `data/skill-index-resources.json` is valid JSON and contains the new entries
2. Each new `data/skill-index/{owner}_{repo}.json` exists and is valid JSON
3. Each skill entry in those index files has `tokenCount` (number) and `evalSummary` (object with `overallScore`, `grade`, `categories`) populated — if any are missing, re-run `npm run preindex` or fall back to manual population as described in Step 7
4. `website/catalog.json` is valid JSON and includes the new skills
5. `git diff --stat` shows only the expected files changed

Report a summary to the user:

```
Added N new repo(s), updated M existing repo(s)
Total new skills indexed: X
Files changed: list of files

Ready to commit and create PR.
```

### Step 10: Commit, Push, and Create PR

Stage and commit with the conventional commit format:

Note: `website/catalog.json` is gitignored and rebuilt by CI (`deploy-website.yml`) on merge. Do NOT stage it — only stage the data files.

```bash
git add data/skill-index-resources.json data/skill-index/*.json
git commit -m "feat(index): add {owner}/{repo} to curated skill index"
```

For multiple repos:

```bash
git commit -m "feat(index): add N new skill sources

Added:
- owner1/repo1 (X skills)
- owner2/repo2 (Y skills)
"
```

Push and create a PR:

```bash
git push -u origin HEAD
gh pr create --title "feat(index): add {description}" --body "$(cat <<'EOF'
## Summary
- Added N new skill repository source(s) to the curated index
- Total new skills: X

### New Repos
| Repo | Skills | Description |
|------|--------|-------------|
| [owner/repo](url) | N | description |

### Audit Summary
All skills passed the lightweight audit. No critical security flags.

## Test Plan
- [ ] `data/skill-index-resources.json` is valid JSON
- [ ] Index files generated in `data/skill-index/`
- [ ] `website/catalog.json` rebuilt successfully
- [ ] CI passes
EOF
)"
```

## Edge Cases & Error Handling

Each row names a condition, the step that owns it, and the required response. When in doubt, surface the issue to the user rather than silently dropping a repo — the reviewer policy is **permissive** but **transparent**.

| Condition                                                           | Response                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo URL is a 404 / private repo**                                | Mark `INVALID` in the Step 1 table and skip; don't abort if other URLs are valid.                                                      |
| **Git clone fails**                                                 | The Step 2 worker returns `status: clone-failed`; skip that repo, report its `error`, continue with the others.                        |
| **Repo has zero SKILL.md files**                                    | The Step 2 worker returns `status: no-skills`; flag it and ask whether to include anyway (some repos seed empty and add skills later). |
| **Repo has 50+ SKILL.md files**                                     | Keep going, but warn about runtime — `asm eval` over many skills is slow.                                                              |
| **Repo already in index, unchanged**                                | Report `EXISTS, no diff` and skip index regeneration for that repo.                                                                    |
| **Repo already in index, breaking changes** (skill removed/renamed) | Show a diff in Step 4 and require explicit user confirmation before overwriting.                                                       |
| **`npm run preindex` missing or fails**                             | Fall back to manual generation per Step 7; do not block the PR.                                                                        |
| **`npx tsx scripts/build-catalog.ts` fails**                        | Stop in Step 8 — structural; a PR with a broken catalog must not land.                                                                 |
| **`gh` not authenticated**                                          | Prompt `gh auth login`; do not attempt to push without auth.                                                                           |
| **`gh pr create` fails** (auth, network, missing remote)            | Print the committed SHA so the user can push and open the PR manually.                                                                 |
| **Non-GitHub URL** (GitLab, Bitbucket)                              | Reject in Step 1 — this skill only indexes github.com.                                                                                 |
| **URL to a single skill subdirectory** (`.../tree/main/skills/foo`) | Treat as the parent repo URL; let the Step 2 worker pick up just that skill.                                                           |
| **Agent tool unavailable**                                          | Read both contract files yourself, run Steps 2 and 3 inline, and say so in the Step 9 summary.                                         |

## Cleanup

After completion, delete every temp directory Step 2 made. When Step 2 was delegated, use the `tempRoot` each worker returned verbatim — the clones live in the workers' temp directories, so there is no `$TEMP_DIR` in your shell to remove. If you ran Step 2 inline because the Agent tool was unavailable, the `mktemp -d` directory is your own: remove that one instead. Either way, never derive the target from `clonePath`:

```bash
# one per repo, the tempRoot from that repo's Step 2 result
rm -rf "<tempRoot>"
```

## References

- `references/discovery-contract.md` — the Step 2 worker's slice: clone, discover, and report every SKILL.md as fixed JSON (including the `tempRoot` Cleanup deletes)
- `references/audit-eval-contract.md` — the Step 3 worker's slice: lightweight audit + `asm eval`, returned as fixed JSON rows
