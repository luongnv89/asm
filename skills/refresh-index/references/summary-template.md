# Step 7 — Four-bucket summary template

Render this markdown table grouped by bucket, with skill-count deltas. This is what the user reads to decide whether to confirm the PR.

If `X + Y + Z + W` does not equal `len(enabled) + len(disabled)`, the classification is inconsistent — stop and re-check Step 4 before moving on.

At the end of the run (after Step 8, or at any stop), prepend the header from SKILL.md → _Final output_:

```
Result:      PR opened | stopped before commit | blocked at Step N — <reason>
Evidence:    preindex exit <code> · build-catalog exit <code> · diff scope <ok|unexpected files> · PR <url|none>
Uncertainty: build-catalog checks structure only; <Z> failed repo(s) keep stale data; <inferred buckets, if any>
Decision:    <review and merge the PR | fix <failure> and re-run>
```

```
## Refresh summary — N repos processed

### ✓ Updated (X)
| Repo | Before | After | Δ |
|------|--------|-------|---|
| anthropics/skills | 14 | 15 | +1 |

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
| owner3/repo3 | disabled in skill-index-resources.json |
```
