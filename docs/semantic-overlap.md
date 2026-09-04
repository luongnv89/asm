# Semantic Overlap Detection

Detects skills that do substantially the same job — even when they have different
names — by comparing descriptions and SKILL.md bodies using token-based similarity
(Jaccard index).

## How it works

1. **Tokenization** — descriptions are split into 2+ character tokens (splitting
   on whitespace, hyphens, underscores, punctuation).
2. **Jaccard similarity** — for each pair of skills, the overlap of token sets is
   divided by the union size, giving a 0..1 score.
3. **Weighted combination** — description similarity (weight 0.6) and name similarity
   (weight 0.4) are combined.
4. **Thresholding** — pairs above `MIN_OVERLAP_SCORE` (0.55) are reported.
5. **Grouping** — overlapping skills are merged into clusters using union-find.

## Relationship to existing dedupe

| Feature         | `skill-dedupe.ts`                  | `semantic-overlap.ts`                 |
| --------------- | ---------------------------------- | ------------------------------------- |
| What it detects | Same name in different directories | Different names, similar descriptions |
| Scope           | Within a single repo               | Across the entire index               |
| Method          | Name equality                      | Token-based similarity                |
| Purpose         | Resolve install conflicts          | Surface redundancy for review         |

They are complementary, not competing: dedupe handles exact-name collisions,
semantic overlap handles near-duplicates with different names.

## Thresholds

- `MIN_OVERLAP_SCORE = 0.55` — minimum to report an overlap
- `HIGH_CONFIDENCE_THRESHOLD = 0.7` — candidate is likely redundant

These can be adjusted in the source or via the `--threshold` CLI flag.

## Performance

The algorithm is O(n²) on the number of skills compared. The CLI command caps
comparison at 500 skills to keep runtime reasonable.

## API

```typescript
import {
  findOverlapPairs,
  groupOverlaps,
  checkCandidateOverlap,
  computeSimilarity,
  MIN_OVERLAP_SCORE,
  HIGH_CONFIDENCE_THRESHOLD,
} from "./semantic-overlap";
```

### `findOverlapPairs(skills, threshold?)`

Returns all overlapping pairs above the threshold, sorted by score descending.

### `groupOverlaps(skills, threshold?)`

Groups overlapping skills into clusters using union-find.

### `checkCandidateOverlap(candidate, indexedSkills, threshold?)`

Checks a candidate skill against the indexed set. Returns overlaps and a
`hasHighConfidenceOverlap` flag.

### `computeSimilarity(skillA, skillB)`

Returns a 0..1 similarity score between two skills.

## CLI

```bash
# Find overlaps in the index
asm index overlap

# Custom threshold
asm index overlap --threshold 0.6

# JSON output
asm index overlap --json
```

## Issue

#495 — Detect semantic overlap between indexed skills
