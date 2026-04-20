---
name: skill-index-updater
description: Add new GitHub skill repositories to the ASM curated index, audit discovered skills, update the website catalog, and create a PR. Use whenever someone shares GitHub URLs of skill repos to add, says "add this repo to the index", "update the skill catalog", "index these skills", "add new skill source", "new skill repo", or wants to onboard a new skill collection into ASM — even if they just paste a GitHub link without explanation.
version: 1.0.0
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob WebFetch Agent
effort: high
metadata:
  creator: luongnv89
---

# Skill Index Updater

You are adding new skill repository sources to the ASM (Agent Skill Manager) curated index. This is the pipeline that powers the skill catalog at https://luongnv.com/asm/ — every repo you add here becomes discoverable and installable by thousands of users.

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

For each discovered SKILL.md, parse the YAML frontmatter to extract:

- `name` (required)
- `description` (required)
- `version` (defaults to "0.0.0")
- `license`
- `creator`
- `compatibility`
- `allowed-tools` / `allowedTools`

Report how many skills were found per repo. If a repo has **zero** SKILL.md files, flag it and ask the user whether to still include it (it might have skills added later).

### Step 3: Audit Discovered Skills

For each discovered skill, perform a lightweight audit:

1. **Frontmatter completeness**: Does it have at minimum `name` and `description`?
2. **Content check**: Does the SKILL.md have meaningful instruction content (not just frontmatter)?
3. **Security scan**: Check for suspicious patterns in the skill files:
   - Shell execution (`exec`, `spawn`, `child_process`, `bash -c`)
   - Network access (`curl`, `wget`, `fetch(`, `axios`)
   - Credential patterns (`API_KEY=`, `SECRET_KEY=`, `PASSWORD=`)
   - Obfuscation (`atob(`, base64 encoded strings, hex escape sequences)

This is a lightweight check — the full security audit runs when users install individual skills via `asm install`. The goal here is to catch obvious red flags before adding a repo to the curated index.

Report the audit results:

```
Repo: owner/repo (N skills discovered)

  skill-name-1        OK     name + description present, no security flags
  skill-name-2        WARN   missing description
  skill-name-3        FLAG   contains shell execution patterns (exec, spawn)
```

The current policy is **permissive** — accept all repos that have at least one valid skill (with name + description). Security warnings are informational only and do not block inclusion. This policy may become stricter in future versions.

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
bun run preindex
```

If `bun run preindex` fails or takes too long, generate the index file manually by creating `data/skill-index/{owner}_{repo}.json` with this structure:

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
      "relPath": "relative/path/to/skill"
    }
  ]
}
```

The `installUrl` format matters — it's how `asm install` locates skills. For single-skill repos (SKILL.md at root), omit the path portion. For multi-skill repos, include the relative path to the skill directory.

### Step 8: Rebuild Website Catalog

Run the catalog build script to regenerate `website/catalog.json`:

```bash
bun scripts/build-catalog.ts
```

Verify the output:

- `website/catalog.json` was updated
- Total skill count increased (or stayed the same for pure updates)
- No errors in the build output

### Step 9: Verify Everything

Run a final check:

1. `data/skill-index-resources.json` is valid JSON and contains the new entries
2. Each new `data/skill-index/{owner}_{repo}.json` exists and is valid JSON
3. `website/catalog.json` is valid JSON and includes the new skills
4. `git diff --stat` shows only the expected files changed

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
