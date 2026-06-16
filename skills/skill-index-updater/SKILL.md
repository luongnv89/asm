---
name: skill-index-updater
description: "Add GitHub skill repos to the ASM index: clone, audit, eval, regenerate index, rebuild catalog, open PR. Use when given GitHub URLs to onboard. Don't use for authoring (skill-creator), improving (skill-auto-improver), or install (asm install)."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob WebFetch Agent
effort: high
metadata:
  version: 1.3.0
  author: luongnv89
---

# Skill Index Updater

You are adding new skill repository sources to the ASM (Agent Skill Manager) curated index. This is the pipeline that powers the skill catalog at https://luongnv.com/asm/ — every repo you add here becomes discoverable and installable by thousands of users.

## When to Use

- The user pastes one or more GitHub URLs and asks to "add to the index", "index these", "onboard this repo"
- The user wants to refresh the catalog after upstream skill repos change
- A new skill collection is ready to ship to the ASM website catalog

If the user wants to author a skill from scratch, send them to `skill-creator`. If they want to improve a single existing skill, use `skill-auto-improver`. If they only want to install one skill, use `asm install`.

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

### Step 2: Discover Skills in Each Repository

For each valid repository, clone it to a temp directory and scan for SKILL.md files (up to 5 levels deep). This is what the ASM tool does internally, and we replicate the logic here:

```bash
# Clone to temp
TEMP_DIR=$(mktemp -d)
git clone --depth 1 "https://github.com/{owner}/{repo}.git" "$TEMP_DIR/{repo}"

# Find SKILL.md files (max 5 levels deep, matching ASM's discoverSkills)
find "$TEMP_DIR/{repo}" -maxdepth 5 -name "SKILL.md" -type f
```

`discoverSkills` (used by `asm index ingest` and preindex) indexes a **root** `SKILL.md` when present **and** continues scanning subdirectories for additional skills. A repo with both root and nested skills should list every skill in the index entry — not only the root.

For each discovered SKILL.md, parse the YAML frontmatter to extract:

- `name` (required)
- `description` (required)
- `version` (defaults to "0.0.0")
- `license`
- `creator`
- `compatibility`
- `allowed-tools` / `allowedTools`

Report how many skills were found per repo. If a repo has **zero** SKILL.md files, flag it and ask the user whether to still include it (it might have skills added later).

### Step 3: Audit and Evaluate Discovered Skills

For each discovered skill, perform two checks — a lightweight audit **and** a quality evaluation using `asm eval`. Both run against the temp clone from Step 2; do not re-clone.

#### 3a. Lightweight audit

1. **Frontmatter completeness**: Does it have at minimum `name` and `description`?
2. **Content check**: Does the SKILL.md have meaningful instruction content (not just frontmatter)?
3. **Security scan**: Check for suspicious patterns in the skill files:
   - Shell execution (`exec`, `spawn`, `child_process`, `bash -c`)
   - Network access (`curl`, `wget`, `fetch(`, `axios`)
   - Credential patterns (`API_KEY=`, `SECRET_KEY=`, `PASSWORD=`)
   - Obfuscation (`atob(`, base64 encoded strings, hex escape sequences)

This is a lightweight check — the full security audit runs when users install individual skills via `asm install`. The goal here is to catch obvious red flags before adding a repo to the curated index.

#### 3b. Quality evaluation with `asm eval`

Run `asm eval` on each discovered skill directory and capture the JSON report. This gives reviewers a quality signal (structure, description, prompt engineering, safety, testability, naming) **before** the repo lands in the index, so they can spot obvious quality issues early:

```bash
asm eval "$TEMP_DIR/{repo}/{relPath}" --json
```

The JSON report contains `overallScore` (0-100), a letter `grade` (A/B/C/D/F), and a `categories[]` array with per-category scores. You do not need to re-run eval during indexing — `npm run preindex` (Step 7) invokes the evaluator via the ingester and writes `evalSummary` + `tokenCount` into `data/skill-index/{owner}_{repo}.json` automatically. The explicit run here is for **pre-commit visibility** only.

#### Combined report

Merge both checks into a single table so the user can see quality and safety at a glance:

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

If you fall back to manual generation, you can populate `tokenCount` and `evalSummary` by calling `asm eval <path> --json` on each skill directory and lifting the `overallScore`, `grade`, `categories`, `evaluatedAt` fields into the skill entry. When `preindex` succeeds, the ingester handles this for you automatically.

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

## Expected Output

On a successful run, the user should see (and the agent should verify) all of the following:

1. **Branch created** with name `feat/index-add-{repo-names}` checked out.
2. **`data/skill-index-resources.json`** parses as valid JSON, contains a new entry for each NEW repo, and has an updated `updatedAt` timestamp.
3. **One file per repo** under `data/skill-index/{owner}_{repo}.json`, each containing:
   - `repoUrl`, `owner`, `repo`, `updatedAt`, `skillCount`, `skills[]`
   - Every skill in `skills[]` has populated `tokenCount` (number > 0) and `evalSummary.overallScore` (number 0–100).
4. **`website/catalog.json`** rebuilt without errors and includes the new skills (note: gitignored, do not stage).
5. **A summary report** posted back to the user, in this exact shape:

   ```
   Added 2 new repo(s), updated 0 existing repo(s)
   Total new skills indexed: 7
   Files changed:
     M data/skill-index-resources.json
     A data/skill-index/owner_repo1.json
     A data/skill-index/owner_repo2.json

   Ready to commit and create PR.
   ```

6. **Open PR** on GitHub, conventional-commit title (`feat(index): ...`), body filled from the template in Step 10.

If any of items 1–5 fails verification in Step 9, do **not** proceed to Step 10. Re-run the failing step or surface the error to the user.

## Edge Cases

Inputs the skill must handle without crashing, in order of likelihood:

- **Repo URL points to a 404 / private repo**: mark `INVALID` in the Step 1 table and skip; do not abort the whole run if other URLs are valid.
- **Repo has zero SKILL.md files**: flag and ask the user whether to include anyway (some repos seed empty and add skills later).
- **Repo has 50+ SKILL.md files**: keep going, but warn the user about runtime — `asm eval` over many skills is slow.
- **Repo is already in the index but unchanged**: report `EXISTS, no diff` and skip the index regeneration for that repo.
- **Repo is already in the index with breaking changes** (skill removed, name renamed): show a diff and require explicit user confirmation before overwriting.
- **`npm run preindex` is missing or fails**: fall back to manual generation per Step 7; do not block the PR.
- **`npx tsx scripts/build-catalog.ts` fails**: stop — this is structural and a PR with a broken catalog should not land.
- **`gh` CLI not authenticated**: prompt the user to run `gh auth login`; do not attempt to push without auth.
- **User passes a non-GitHub URL** (GitLab, Bitbucket): reject in Step 1 — this skill only indexes github.com.
- **User passes a URL to a single skill subdirectory** (`github.com/owner/repo/tree/main/skills/foo`): treat as the parent repo URL and let Step 2's discoverer pick up just that skill.

When in doubt, prefer surfacing the issue to the user over silently dropping a repo. The reviewer policy is **permissive** but **transparent**.

## Error Handling

- **Git clone fails**: Skip the repo, report the error, continue with others
- **No SKILL.md found**: Warn the user, ask whether to include anyway
- **preindex script fails**: Fall back to manual index file generation
- **Build catalog fails**: Stop and report — this likely means a structural issue
- **PR creation fails**: Ensure `gh` CLI is authenticated, suggest `gh auth login` if needed

## Cleanup

After completion, remove any temp directories used for cloning:

```bash
rm -rf "$TEMP_DIR"
```
