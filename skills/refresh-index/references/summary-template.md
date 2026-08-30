# Step 7 — Four-bucket summary template

Render this markdown table grouped by bucket, with skill-count deltas. This is what the user reads to decide whether to confirm the PR.

If `X + Y + Z + W` does not equal `len(enabled) + len(disabled)`, the classification is inconsistent — stop and re-check Step 4 before moving on.

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
