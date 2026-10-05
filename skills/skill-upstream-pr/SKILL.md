---
name: skill-upstream-pr
description: "Improve an open-source GitHub skill and open a friendly suggestion PR upstream: fork, run skill-creator's retrofit, attach asm eval before/after metrics. Don't use for local-only skills, authoring from scratch, bulk repos, or registry publish."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 1.1.0
  author: luongnv89
---

# Skill Upstream PR

You are contributing quality improvements to someone else's open-source skill. The workflow is: fork → clone → improve via skill-creator's retrofit loop → push to fork → open a friendly suggestion PR upstream. You do not own the target repo. Every step assumes you are a polite contributor, not a maintainer.

## Repo Sync Before Edits (mandatory)

Before any modification to the cloned fork, pull the latest from the fork's tracked branch:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --rebase origin "$branch"
```

If the working tree is dirty: stash, sync, pop. If `origin` is missing or conflicts occur: stop and ask the user. A stale fork that PRs yesterday's tree is worse than no PR.

## When to Use

- User shares a GitHub URL to a public skill repo and asks to "improve", "level up", or "contribute to" it
- User says "open a PR to this skill" or "suggest improvements upstream"
- The target skill scores below 85/8 on `asm eval` and the user wants the upstream author to benefit

Do **not** trigger for: editing a local skill with no upstream, authoring a brand-new skill, publishing to the ASM registry, or bulk-improving many repos in one pass. One skill → one PR.

## Prerequisites

Verify each before cloning anything. Stop and tell the user if any fails.

- `asm` on PATH (`command -v asm`)
- `gh` on PATH and authenticated (`gh auth status`)
- `git` on PATH
- Network access to GitHub
- Write access to your own GitHub account (for the fork)

## Input

The user provides a GitHub reference to a skill. Accept any of:

- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/<branch>/<path/to/skill>`
- `github:owner/repo[#ref][:path]`

Normalize to `owner`, `repo`, optional `ref`, optional `path`. If `path` is not given and the repo has multiple `SKILL.md` files, ask the user which one.

## Workflow

Execute phases in order. Do not skip or reorder.

### Phase 0 — Fork and clone

```bash
cd "$(mktemp -d)"
gh repo fork "$OWNER/$REPO" --clone --remote
cd "$REPO"
# If a ref was provided:
git checkout "$REF"
```

`gh repo fork --clone --remote` creates the fork under your account, clones it locally, sets `origin` to your fork and `upstream` to the original repo. Verify with `git remote -v` before continuing.

Create a dedicated branch for the improvement:

```bash
git checkout -b "skill-upstream-pr/improve-$(date +%Y%m%d-%H%M%S)"
```

### Phase 1 — Locate the target SKILL.md

If the user gave a `path`, use it. Otherwise:

```bash
find . -maxdepth 5 -name "SKILL.md" -type f
```

If more than one match and no `path` was given, list the candidates and ask the user to pick. Never guess — a wrong PR is worse than a delayed one.

Set `SKILL_PATH` to the **directory** containing the chosen SKILL.md (not the file itself) — `asm eval` takes a directory.

### Phase 2 — Delegate to skill-creator's retrofit loop

This skill does not reimplement the improvement loop. Follow `skills/skill-creator/references/retrofit-loop.md` with `$SKILL_PATH` as the target:

1. Phase 0: capture `.asm-improver/baseline.json`
2. Phase 1: `asm eval --fix` plus frontmatter normalization
3. Phases 2–4: Gate 1 fixes, then the category loop against the 85/8 floor
4. Phases 5–6: version bump and the loop cap (8 iterations / 3 no-move / 2 regressions)
5. Phase 7: `.asm-improver/report.md`

If the baseline already passes both gates, stop and tell the user — no PR needed for a skill that already meets the floor. Offer to find a different skill or a different target.

### Phase 3 — Harvest metrics for the PR

Read two files produced by the retrofit loop:

- `.asm-improver/baseline.json` — the before snapshot
- The latest `.asm-improver/iter-N.json` — the after snapshot

Extract for both:

- `overallScore`, `grade`
- Every `categories[].score` (7 categories)
- `topSuggestions` summary (for context, not quoted verbatim)

Compute deltas. If the overall score did not improve by at least 3 points **or** no category moved from below 8 to at least 8, stop and tell the user — the change isn't meaningful enough to justify a PR. Offer the retrofit report as feedback they can share informally instead.

### Phase 4 — Build the PR body

Read `references/pr-template.md` and fill it in. The template enforces friendly, suggestion-style tone. Key sections:

- **What changed** — one-sentence summary
- **Before/after metrics** — table with overallScore, grade, and all 7 categories
- **Files touched** — list every modified path under `$SKILL_PATH`
- **Iterations taken** — N of 8 from the retrofit loop
- **How to verify** — the `asm eval` command the maintainer can run locally

Tone rules (read `references/tone-guide.md`):

- Lead with "Hi — noticed X, wanted to share Y"
- Frame as a suggestion, not a fix: "happy to adjust if the direction doesn't fit"
- Never imply the maintainer did something wrong
- Thank them for open-sourcing the skill
- Close with "no obligation to merge — totally fine to close if this isn't the right direction"

### Phase 5 — Last-mile confirmation (mandatory)

Opening a PR on someone else's repo is public and hard to reverse. Before pushing anything, show the user:

1. The PR title
2. The full PR body (rendered markdown)
3. The exact diff (`git diff upstream/<default-branch>`)
4. The commands you are about to run

Ask the user to confirm. If they want edits, apply them and re-preview. Do not push until the user says "go" or equivalent.

### Phase 6 — Push and open the PR

After approval:

```bash
# Commit the changes
git add -A
git commit -m "$(cat <<'EOF'
improve SKILL.md: clarify triggers, add acceptance criteria, fix frontmatter

Suggested via skill-upstream-pr. See PR body for before/after metrics.
EOF
)"

# Push to the fork
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"

# Open the PR upstream
gh pr create \
  --repo "$OWNER/$REPO" \
  --title "$PR_TITLE" \
  --body-file .asm-improver/pr-body.md
```

Never push to `upstream`. Never use `--no-verify` or other hook-skip flags. If `gh pr create` fails, stop and report — do not retry in a loop.

Print the PR URL returned by `gh pr create` so the user can open it.

## Step Completion Reports (mandatory)

Emit a compact status block after each phase:

```
◆ Phase N — [phase name] ([N of 6])
··································································
  [check 1]:         √ pass
  [check 2]:         √ pass (note if relevant)
  [check 3]:         × fail — [reason]
  Criteria:          √ M/K met
  ______________________________
  Result:            PASS | FAIL | PARTIAL
```

Checks per phase:

- **Phase 0** — `Fork created`, `Clone succeeded`, `Branch created`, `Remotes correct`
- **Phase 1** — `SKILL.md located`, `Path unambiguous`
- **Phase 2** — `Baseline captured`, `Retrofit loop ran`, `Final score >= 85`, `All categories >= 8`
- **Phase 3** — `Before/after delta >= 3 points OR category promoted`
- **Phase 4** — `PR body rendered`, `Tone checks passed`
- **Phase 5** — `User approved`
- **Phase 6** — `Push succeeded`, `PR opened`, `URL printed`

## Acceptance Criteria

- Fork + clone done via `gh repo fork --clone --remote` — never a direct clone of upstream
- Dedicated feature branch created before any edits
- skill-creator retrofit loop run on the target; baseline + final JSON captured under `.asm-improver/`
- Overall score improved by ≥ 3 points, OR at least one category moved from below 8 to ≥ 8
- PR body built from `references/pr-template.md` with the full before/after table
- User explicitly approved the PR preview before push
- `git push` targets `origin` (the fork), never `upstream`
- `gh pr create --repo $OWNER/$REPO` used — the PR targets the upstream repo
- PR URL printed to the user at the end

### Expected output

- A new branch on the user's fork of `$OWNER/$REPO`
- A public PR on `$OWNER/$REPO` with a before/after metrics table and friendly tone
- A local `.asm-improver/` directory with baseline, iterations, report, and `pr-body.md`

## Edge Cases

- **Skill already passes 85/8** — stop at Phase 2; do not open a PR for a skill that already meets the floor
- **Improvement too small** (< 3 point overall delta AND no category promoted) — stop at Phase 3; offer the retrofit report as informal feedback instead
- **Multiple SKILL.md files in the repo** — ask the user which one; never batch
- **Fork already exists from a prior run** — `gh repo fork --clone --remote` reuses it; rebase on upstream's default branch before editing
- **Upstream force-pushed or rewrote history** — stop and ask the user; do not force-push the fork to "catch up"
- **`asm eval --fix` writes changes you disagree with** — revert `SKILL.md.bak` and do targeted edits only; don't ship the auto-fix if it harms the skill
- **Maintainer has a CONTRIBUTING.md or PR template** — read it before Phase 4 and align the PR body with their conventions; their template wins over ours

## References

- `references/pr-template.md` — PR title + body template with before/after table
- `references/tone-guide.md` — wording patterns for friendly, suggestion-style contributions
- `skills/skill-creator/references/retrofit-loop.md` — the improvement loop this skill delegates to
- `asm eval --help` — flag reference for the evaluator
