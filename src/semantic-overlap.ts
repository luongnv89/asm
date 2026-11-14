/**
 * Semantic overlap detection for indexed skills.
 *
 * Detects skills that do substantially the same job — even when they have
 * different names — by comparing descriptions and SKILL.md bodies using
 * token-based similarity (no external embedding service required).
 *
 * This is distinct from the within-repo dedupe (`skill-dedupe.ts`) which
 * collapses same-name duplicates across directories. Semantic overlap finds
 * *different-name* skills that cover the same ground.
 *
 * Issue #495.
 */

import { tokenize } from "./skill-index";
import type { IndexedSkill } from "./utils/types";

// ─── Similarity types ──────────────────────────────────────────────────────

/**
 * A pair of skills that overlap, with a similarity score.
 *
 * `score` is a 0..1 number where 1 means identical descriptions.
 */
export interface OverlapPair {
  skillA: IndexedSkill;
  skillB: IndexedSkill;
  repoA: { owner: string; repo: string };
  repoB: { owner: string; repo: string };
  score: number;
  /** Human-readable reason for the overlap. */
  reason: string;
}

/**
 * A ranked group of overlapping skills.
 *
 * The group is formed by merging all pairs whose score exceeds the threshold.
 */
export interface OverlapGroup {
  /** The skills in this group. */
  skills: Array<{
    skill: IndexedSkill;
    repo: { owner: string; repo: string };
  }>;
  /** Best pairwise score within the group. */
  maxScore: number;
  /** Count of overlapping pairs in this group. */
  pairCount: number;
}

/**
 * Result of checking a candidate skill against the indexed set.
 */
export interface CandidateCheckResult {
  /** The candidate skill (name + description only). */
  candidate: { name: string; description: string };
  /** Overlapping indexed skills, ranked by similarity. */
  overlaps: Array<{
    skill: IndexedSkill;
    repo: { owner: string; repo: string };
    score: number;
    reason: string;
  }>;
  /** Whether any overlap exceeds the high-confidence threshold. */
  hasHighConfidenceOverlap: boolean;
}

// ─── Thresholds ────────────────────────────────────────────────────────────

/**
 * Minimum similarity score to report an overlap.
 *
 * 0.55 — roughly "more than half the description tokens match" — is a
 * pragmatic starting point. Adjust after reviewing real-world results.
 */
export const MIN_OVERLAP_SCORE = 0.55;

/**
 * High-confidence threshold for candidate checks.
 * Above this, the candidate is likely redundant.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

// ─── Token similarity ──────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two token sets.
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Returns 0 when both sets are empty.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersectionSize = sharedTokenCount(a, b);
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const t of a) {
    if (b.has(t)) count++;
  }
  return count;
}

/** Token sets for one skill, computed once and reused across comparisons. */
interface SkillTokens {
  name: Set<string>;
  description: Set<string>;
}

function skillTokens(skill: {
  name: string;
  description: string;
}): SkillTokens {
  return {
    name: tokenize(skill.name),
    description: tokenize(skill.description),
  };
}

/**
 * Weighted similarity from pre-tokenized skills. Combines description
 * similarity (weight 0.6) and name similarity (weight 0.4).
 */
function similarityFromTokens(a: SkillTokens, b: SkillTokens): number {
  const descSim = jaccardSimilarity(a.description, b.description);
  // Name similarity — bonus for similar names (different names can still
  // describe the same thing, but a name match boosts confidence).
  const nameSim = jaccardSimilarity(a.name, b.name);
  // Weighted combination: description is the stronger signal.
  return 0.6 * descSim + 0.4 * nameSim;
}

/**
 * Compute a weighted similarity score between two skills.
 *
 * Combines description similarity (weight 0.6) and name similarity (weight 0.4).
 * Name similarity uses the same token-based Jaccard on the skill name.
 */
export function computeSimilarity(
  skillA: IndexedSkill,
  skillB: IndexedSkill,
): number {
  return similarityFromTokens(skillTokens(skillA), skillTokens(skillB));
}

/**
 * Generate a human-readable reason for the overlap from pre-tokenized
 * descriptions.
 */
function overlapReason(
  descTokensA: Set<string>,
  descTokensB: Set<string>,
  score: number,
): string {
  const commonCount = sharedTokenCount(descTokensA, descTokensB);
  const totalTokens = descTokensA.size + descTokensB.size - commonCount;

  if (score >= HIGH_CONFIDENCE_THRESHOLD) {
    return `Very similar descriptions (${commonCount}/${totalTokens} shared tokens)`;
  }
  if (score >= MIN_OVERLAP_SCORE) {
    return `Similar descriptions (${commonCount}/${totalTokens} shared tokens)`;
  }
  return `Some overlapping concepts (${commonCount}/${totalTokens} shared tokens)`;
}

// ─── Overlap detection ─────────────────────────────────────────────────────

/**
 * Find all overlapping skill pairs in the index.
 *
 * @param skills — list of indexed skills with repo metadata
 * @param threshold — minimum similarity score (default: MIN_OVERLAP_SCORE)
 * @returns all pairs exceeding the threshold, sorted by score descending
 */
export function findOverlapPairs(
  skills: Array<{ skill: IndexedSkill; repo: { owner: string; repo: string } }>,
  threshold: number = MIN_OVERLAP_SCORE,
): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  // Tokenize each skill once: the pairwise loop is O(n²), so re-tokenizing
  // inside it dominated `asm index overlap` (issue #790).
  const tokens = skills.map((s) => skillTokens(s.skill));

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const score = similarityFromTokens(tokens[i], tokens[j]);
      if (score >= threshold) {
        pairs.push({
          skillA: skills[i].skill,
          skillB: skills[j].skill,
          repoA: skills[i].repo,
          repoB: skills[j].repo,
          score,
          reason: overlapReason(
            tokens[i].description,
            tokens[j].description,
            score,
          ),
        });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  return pairs;
}

/**
 * Group overlapping pairs into clusters.
 *
 * Uses a simple union-find approach: skills that appear in overlapping pairs
 * are merged into groups. Only groups with 2+ skills are returned.
 *
 * @param pairs — pairs already computed by `findOverlapPairs(skills,
 *   threshold)`; pass them to avoid a second O(n²) comparison pass
 */
export function groupOverlaps(
  skills: Array<{ skill: IndexedSkill; repo: { owner: string; repo: string } }>,
  threshold: number = MIN_OVERLAP_SCORE,
  pairs: OverlapPair[] = findOverlapPairs(skills, threshold),
): OverlapGroup[] {
  if (pairs.length === 0) return [];

  // Union-find
  const parent = new Map<number, number>();
  const maxScore = new Map<number, number>();
  const pairCount = new Map<number, number>();

  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: number, b: number, score: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      // Same group — update max score and pair count
      const currentMax = maxScore.get(ra) ?? 0;
      maxScore.set(ra, Math.max(currentMax, score));
      pairCount.set(ra, (pairCount.get(ra) ?? 0) + 1);
      return;
    }
    // Merge smaller into larger
    if (ra !== rb) {
      parent.set(rb, ra);
      const newMax = Math.max(
        maxScore.get(ra) ?? 0,
        maxScore.get(rb) ?? 0,
        score,
      );
      maxScore.set(ra, newMax);
      pairCount.set(
        ra,
        (pairCount.get(ra) ?? 0) + (pairCount.get(rb) ?? 0) + 1,
      );
    }
  }

  // Initialize each skill as its own set
  for (let i = 0; i < skills.length; i++) {
    parent.set(i, i);
    maxScore.set(i, 0);
    pairCount.set(i, 0);
  }

  // Map (name, installUrl) to the first matching index once, instead of a
  // linear scan per pair — pairs can number in the tens of thousands.
  const indexByKey = new Map<string, Map<string, number>>();
  for (let i = skills.length - 1; i >= 0; i--) {
    const { name, installUrl } = skills[i].skill;
    let byUrl = indexByKey.get(name);
    if (!byUrl) indexByKey.set(name, (byUrl = new Map()));
    byUrl.set(installUrl, i);
  }
  const indexOf = (skill: IndexedSkill) =>
    indexByKey.get(skill.name)?.get(skill.installUrl) ?? -1;

  // Union skills that overlap
  for (const pair of pairs) {
    const i = indexOf(pair.skillA);
    const j = indexOf(pair.skillB);
    if (i >= 0 && j >= 0) {
      union(i, j, pair.score);
    }
  }

  // Collect groups
  const groupsMap = new Map<number, number[]>();
  for (let i = 0; i < skills.length; i++) {
    const root = find(i);
    if (!groupsMap.has(root)) groupsMap.set(root, []);
    groupsMap.get(root)!.push(i);
  }

  const groups: OverlapGroup[] = [];
  for (const [root, indices] of groupsMap) {
    if (indices.length < 2) continue;
    const maxScoreVal = maxScore.get(root) ?? 0;
    if (maxScoreVal < threshold) continue;
    const pairCountVal = pairCount.get(root) ?? 0;

    groups.push({
      skills: indices.map((i) => ({
        skill: skills[i].skill,
        repo: skills[i].repo,
      })),
      maxScore: maxScoreVal,
      pairCount: pairCountVal,
    });
  }

  // Sort groups by max score descending
  groups.sort((a, b) => b.maxScore - a.maxScore);
  return groups;
}

/**
 * Check a candidate skill against the indexed set for semantic overlap.
 *
 * @param candidate — the candidate skill (name + description)
 * @param indexedSkills — all indexed skills with repo metadata
 * @param threshold — minimum score to report (default: MIN_OVERLAP_SCORE)
 * @returns the candidate and all overlapping indexed skills
 */
export function checkCandidateOverlap(
  candidate: { name: string; description: string },
  indexedSkills: Array<{
    skill: IndexedSkill;
    repo: { owner: string; repo: string };
  }>,
  threshold: number = MIN_OVERLAP_SCORE,
): CandidateCheckResult {
  const overlaps: CandidateCheckResult["overlaps"] = [];
  const candidateTokens = skillTokens(candidate);

  for (const entry of indexedSkills) {
    const entryTokens = skillTokens(entry.skill);
    const score = similarityFromTokens(candidateTokens, entryTokens);
    if (score >= threshold) {
      overlaps.push({
        skill: entry.skill,
        repo: entry.repo,
        score,
        reason: overlapReason(
          candidateTokens.description,
          entryTokens.description,
          score,
        ),
      });
    }
  }

  overlaps.sort((a, b) => b.score - a.score);

  return {
    candidate: { name: candidate.name, description: candidate.description },
    overlaps,
    hasHighConfidenceOverlap: overlaps.some(
      (o) => o.score >= HIGH_CONFIDENCE_THRESHOLD,
    ),
  };
}

// ─── No-op similarity for testing ──────────────────────────────────────────

/**
 * Reset the tokenize function to a custom implementation (for tests).
 * Exported only for testing.
 */
export function _setTokenize(fn: (text: string) => Set<string>): void {
  // We can't override the imported function, but we can provide a wrapper.
  // Tests should use the public API which calls tokenize internally.
  void fn; // no-op; tests use the real tokenize
}
