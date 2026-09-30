# Step 8 — Confirmation gate, commit, and PR

**Do not proceed without explicit user confirmation.** Print the diff stat and ask:

```bash
git diff --stat -- data/skill-index/ data/skill-index-resources.json
echo
echo "Ready to commit the files above and open a PR."
echo "Type 'yes' to continue, anything else to abort."
```

On `yes` (and only `yes`), stage **only** the index data files — never `website/catalog.json`, never anything outside `data/skill-index/` — commit with the conventional-commit message below, push, and open the PR.

`npm run preindex` does **not** modify `data/skill-index-resources.json`. Add that file only if the user explicitly bumped `updatedAt`.

```bash
git add data/skill-index/
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

If the user declines, stop cleanly. Leave the refreshed `data/skill-index/*.json` files in the working tree. Do not `git checkout --` anything.
