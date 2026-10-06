# Step 10 — Commit, push, and PR

`website/catalog.json` is gitignored and rebuilt by CI (`deploy-website.yml`) on
merge. Never stage it — stage only the data files:

```bash
git add data/skill-index-resources.json
git add data/skill-index/{owner}_{repo}.json   # one per added or updated repo
```

Stage each repo's index file by name. Never `git add data/skill-index/*.json`:
a glob picks up unrelated index files if anything else touched them.

## Commit message

Use `add` for NEW repos. For a run that only re-indexes EXISTS repos, use
`feat(index): update {owner}/{repo} ({N} skills)` and title the PR table
"Updated Repos"; for a mixed run, list both groups.

One repo:

```bash
git commit -m "feat(index): add {owner}/{repo} ({N} skills)"
```

Several repos:

```bash
git commit -F - <<'EOF'
feat(index): add {N} new skill sources

Added:
- owner1/repo1 (X skills)
- owner2/repo2 (Y skills)
EOF
```

## Push and PR

```bash
git push -u origin HEAD
gh pr create --title "feat(index): add {description}" --body-file - <<'EOF'
## Summary
- Added {N} new skill repository source(s) to the curated index
- Total new skills: {X}

### New Repos
| Repo | Skills | Description |
|------|--------|-------------|
| [owner/repo](url) | N | description |

### Audit Summary
{OK count} OK · {WARN count} WARN · {FLAG count} FLAG (from the Step 3 combined report)
{One line per WARN or FLAG skill: name — note}

## Test Plan
- [ ] `data/skill-index-resources.json` is valid JSON
- [ ] Index files generated in `data/skill-index/`
- [ ] `website/catalog.json` rebuilt successfully
- [ ] CI passes
EOF
```

Fill every `{…}` placeholder from Steps 1–9 before running the command. Build the
Audit Summary from the Step 3 combined report. Never write "all skills passed"
or "no security flags" unless the report shows zero WARN and zero FLAG rows.

Verification: `gh pr view --json url` returns the PR URL. Print it to the user.
If `gh pr create` fails, print the commit SHA (`git rev-parse HEAD`) so the user
can push and open the PR manually.
