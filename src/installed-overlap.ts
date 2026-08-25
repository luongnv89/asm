/**
 * Semantic overlap detection for installed skills (issue #566).
 *
 * Surfaces installed skills that do substantially the same job even when
 * their names differ — the near-duplicates the exact-match duplicate check
 * (`src/auditor.ts`) cannot see. Similarity compares each skill's name and
 * frontmatter description with common boilerplate down-weighted twice:
 *
 *  1. A static stopword list drops filler that carries no topic signal
 *     ("use this skill to", "provides", "helps", …).
 *  2. Corpus inverse document frequency down-weights terms that appear in
 *     most of the installed set's descriptions, so distinctive terms decide
 *     the score.
 *
 * Scoring is token-based Jaccard — no external embedding service, fully
 * offline and deterministic. Read-only by construction: the report never
 * removes, disables, or suggests auto-removal for anything.
 *
 * This is distinct from `semantic-overlap.ts`, which ranks overlaps in the
 * indexed catalog (#495); this module works on locally installed SkillInfo
 * entries (#566).
 */

import { tokenize } from "./skill-index";
import { ansi, shortenPath } from "./formatter";
import { normalizeSkillKey } from "./auditor";
import type {
  InstalledOverlapPair,
  InstalledOverlapReport,
  OverlapSide,
  SkillInfo,
} from "./utils/types";

// ─── Thresholds ─────────────────────────────────────────────────────────────

/**
 * Minimum combined similarity to report a pair.
 *
 * Calibrated against realistic installed sets: paraphrased same-job
 * descriptions land around 0.40+, skills that merely share a domain stay
 * below 0.15, so 0.35 separates them with margin on both sides.
 */
export const DEFAULT_OVERLAP_THRESHOLD = 0.35;

/** Above this, the pair very likely covers the same ground. */
export const HIGH_CONFIDENCE_OVERLAP_THRESHOLD = 0.55;

// ─── Boilerplate ────────────────────────────────────────────────────────────

/**
 * Filler and skill-domain boilerplate stripped before scoring. These tokens
 * appear in nearly every skill description ("Use this skill to…") and would
 * otherwise make unrelated skills look alike.
 */
const BOILERPLATE_TOKENS = new Set([
  // English function words
  "the", "a", "an", "and", "or", "but", "nor", "for", "to", "of", "in", "on",
  "at", "by", "with", "from", "into", "onto", "about", "over", "under",
  "across", "between", "through", "during", "before", "after", "above",
  "below", "up", "down", "out", "off", "again", "as", "is", "are", "was",
  "were", "be", "been", "being", "am", "do", "does", "did", "doing", "have",
  "has", "had", "will", "would", "shall", "should", "can", "could", "may",
  "might", "must", "not", "no", "yes", "if", "then", "than", "so", "such",
  "that", "this", "these", "those", "it", "its", "they", "them", "their",
  "there", "here", "when", "while", "where", "which", "who", "whom", "whose",
  "what", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "others", "some", "only", "own", "same", "too", "very", "just",
  "also", "you", "your", "yours", "we", "our", "ours", "us",
  // Skill-domain boilerplate
  "skill", "skills", "agent", "agents", "ai", "claude", "code", "coding",
  "llm", "llms", "assistant", "assistants", "use", "uses", "using", "used",
  "user", "users", "provide", "provides", "provided", "providing", "help",
  "helps", "helping", "support", "supports", "supported", "supporting",
  "enable", "enables", "enabling", "allow", "allows", "allowing", "lets",
  "make", "makes", "making", "get", "gets", "getting", "give", "gives",
  "work", "works", "working", "tool", "tools", "based", "via", "per",
  "new", "like", "want", "needs", "need", "including", "include", "includes",
  "various", "multiple", "different", "specific", "without", "within",
]);

/**
 * Topic tokens for a description: boilerplate removed.
 */
function descriptionTokens(description: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(description)) {
    if (!BOILERPLATE_TOKENS.has(t)) tokens.add(t);
  }
  return tokens;
}

/** Identity tokens for a name: boilerplate removed. */
function nameTokens(name: string): Set<string> {
  const tokens = new Set<string>();
  for (const t of tokenize(name)) {
    if (!BOILERPLATE_TOKENS.has(t)) tokens.add(t);
  }
  return tokens;
}

// ─── Weighted similarity ────────────────────────────────────────────────────

/**
 * Inverse document frequency for every token in the compared set.
 *
 * `weight(t) = 1 + ln(N / df(t))` — a term in every description weighs 1,
 * a term unique to one skill weighs `1 + ln(N)`. With fewer than two
 * corpora every df equals N, so all weights collapse to 1 and scoring
 * degrades to unweighted overlap instead of failing.
 */
export function buildIdfWeights(
  tokenSets: Array<Set<string>>,
): Map<string, number> {
  const n = tokenSets.length;
  const df = new Map<string, number>();
  for (const tokens of tokenSets) {
    for (const t of tokens) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const weights = new Map<string, number>();
  for (const [token, count] of df) {
    weights.set(token, 1 + Math.log(n / count));
  }
  return weights;
}

/**
 * Weighted overlap coefficient (Szymkiewicz–Simpson): shared-token weight
 * over the smaller side's total weight.
 *
 * Chosen over Jaccard because installed-skill descriptions vary hugely in
 * length — a one-line description inside a long one is still the same job,
 * and Jaccard's union denominator would bury it. Returns 0 when either set
 * is empty or nothing is shared.
 */
function weightedOverlapCoefficient(
  a: Set<string>,
  b: Set<string>,
  weights: Map<string, number>,
): number {
  let intersectionWeight = 0;
  let weightA = 0;
  let weightB = 0;
  for (const t of a) {
    weightA += weights.get(t) ?? 1;
    if (b.has(t)) intersectionWeight += weights.get(t) ?? 1;
  }
  for (const t of b) {
    weightB += weights.get(t) ?? 1;
  }
  const smaller = Math.min(weightA, weightB);
  return smaller === 0 ? 0 : intersectionWeight / smaller;
}

/**
 * Combined name+description similarity from precomputed token sets.
 *
 * Single source of truth for the 0.6/0.4 description/name blend —
 * `computeInstalledOverlapScore` (string inputs) and the pairwise loop in
 * `detectSemanticOverlaps` (precomputed sets) must not drift apart.
 */
function combinedScore(
  descA: Set<string>,
  nameA: Set<string>,
  descB: Set<string>,
  nameB: Set<string>,
  weights: Map<string, number>,
): number {
  return (
    0.6 * weightedOverlapCoefficient(descA, descB, weights) +
    0.4 * weightedOverlapCoefficient(nameA, nameB, weights)
  );
}

/**
 * Combined name+description similarity between two skills.
 *
 * Mirrors `computeSimilarity` in `semantic-overlap.ts` (description 0.6,
 * name 0.4) but every token is discounted by corpus IDF so shared
 * boilerplate contributes almost nothing, and each side uses a weighted
 * overlap coefficient so short descriptions are not buried by their own
 * brevity.
 */
export function computeInstalledOverlapScore(
  aName: string,
  aDescription: string,
  bName: string,
  bDescription: string,
  weights: Map<string, number>,
): number {
  return combinedScore(
    descriptionTokens(aDescription),
    nameTokens(aName),
    descriptionTokens(bDescription),
    nameTokens(bName),
    weights,
  );
}

// ─── Reasons ────────────────────────────────────────────────────────────────

/**
 * Human-readable reason naming the most distinctive shared terms, so users
 * can judge the overlap instead of trusting a bare number.
 */
function overlapReason(
  tokensA: Set<string>,
  tokensB: Set<string>,
  weights: Map<string, number>,
  score: number,
  namesOverlap: boolean,
): string {
  const shared = [...tokensA]
    .filter((t) => tokensB.has(t))
    .sort(
      (x, y) =>
        (weights.get(y) ?? 1) - (weights.get(x) ?? 1) || x.localeCompare(y),
    );
  if (shared.length === 0) {
    // No distinctive description terms are shared, so this score is driven
    // by the name side — say so instead of claiming identical descriptions.
    return namesOverlap
      ? "Similar names — descriptions share no distinctive terms"
      : "Names and descriptions are near-identical";
  }
  const shown = shared.slice(0, 3).join(", ");
  const extra = shared.length > 3 ? ` +${shared.length - 3} more` : "";
  const label =
    score >= HIGH_CONFIDENCE_OVERLAP_THRESHOLD
      ? "Very similar"
      : "Substantially overlapping";
  return `${label} — shared terms: ${shown}${extra}`;
}

// ─── Comparison units ───────────────────────────────────────────────────────

/**
 * Collapse multi-provider installs of one physical copy to a single unit.
 * Same-realpath symlinks (the normal `asm install` layout across providers)
 * must never pair against themselves; the non-symlink row wins when both
 * forms appear, mirroring `detectDuplicates`.
 */
export function dedupeForComparison(skills: SkillInfo[]): SkillInfo[] {
  const byRealPath = new Map<string, SkillInfo>();
  for (const s of skills) {
    const existing = byRealPath.get(s.realPath);
    if (!existing) {
      byRealPath.set(s.realPath, s);
    } else if (existing.isSymlink && !s.isSymlink) {
      byRealPath.set(s.realPath, s);
    }
  }
  return [...byRealPath.values()];
}

function toSide(s: SkillInfo): OverlapSide {
  return {
    name: s.name,
    dirName: s.dirName,
    provider: s.provider,
    providerLabel: s.providerLabel || s.provider,
    scope: s.scope,
    path: s.path,
  };
}

/**
 * Same-normalized-name pairs are exact-duplicate territory — `asm audit
 * duplicates` reports them with removal support. Overlap only answers the
 * different-names question, so those pairs are skipped here.
 */
function isSameIdentity(a: SkillInfo, b: SkillInfo): boolean {
  return (
    normalizeSkillKey(a.dirName) === normalizeSkillKey(b.dirName) ||
    (Boolean(a.name) &&
      Boolean(b.name) &&
      normalizeSkillKey(a.name) === normalizeSkillKey(b.name))
  );
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Rank pairs of installed skills that do substantially the same job.
 *
 * @param skills — installed skills as produced by `scanAllSkills`
 * @param threshold — minimum similarity to report (default DEFAULT_OVERLAP_THRESHOLD)
 */
export function detectSemanticOverlaps(
  skills: SkillInfo[],
  threshold: number = DEFAULT_OVERLAP_THRESHOLD,
): InstalledOverlapReport {
  const compared = dedupeForComparison(skills);

  // Tokenize once per skill; the pairwise loop reuses these sets. Corpus
  // statistics come from descriptions — the one text every skill has.
  const descSets = compared.map((s) => descriptionTokens(s.description));
  const nameSets = compared.map((s) => nameTokens(s.name));
  const weights = buildIdfWeights(descSets);

  const pairs: InstalledOverlapPair[] = [];
  for (let i = 0; i < compared.length; i++) {
    for (let j = i + 1; j < compared.length; j++) {
      if (isSameIdentity(compared[i], compared[j])) continue;
      const score = combinedScore(
        descSets[i],
        nameSets[i],
        descSets[j],
        nameSets[j],
        weights,
      );
      if (score >= threshold) {
        const namesOverlap = [...nameSets[i]].some((t) =>
          nameSets[j].has(t),
        );
        pairs.push({
          a: toSide(compared[i]),
          b: toSide(compared[j]),
          score,
          highConfidence: score >= HIGH_CONFIDENCE_OVERLAP_THRESHOLD,
          reason: overlapReason(
            descSets[i],
            descSets[j],
            weights,
            score,
            namesOverlap,
          ),
        });
      }
    }
  }

  pairs.sort(
    (p, q) =>
      q.score - p.score ||
      p.a.name.localeCompare(q.a.name) ||
      p.b.name.localeCompare(q.b.name),
  );

  return {
    scannedAt: new Date().toISOString(),
    totalSkills: skills.length,
    comparedSkills: compared.length,
    pairs,
    highConfidenceCount: pairs.filter((p) => p.highConfidence).length,
  };
}

// ─── CLI formatters ─────────────────────────────────────────────────────────

/** Render the overlap report as CLI text. All output goes through `ansi`. */
export function formatOverlapReport(report: InstalledOverlapReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(ansi.blueBold("  Semantic Overlap Audit"));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");

  if (report.totalSkills === 0) {
    lines.push("  No installed skills.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  ${ansi.bold("Compared:")} ${report.comparedSkills} distinct skill(s)` +
      ansi.dim(` (from ${report.totalSkills} installed)`),
  );
  lines.push("");

  if (report.pairs.length === 0) {
    lines.push(ansi.green("No overlapping skills found."));
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    ansi.bold(
      `  Found ${report.pairs.length} overlapping pair(s) ` +
        `(${report.highConfidenceCount} high confidence):`,
    ),
  );
  lines.push("");

  for (const pair of report.pairs) {
    const pct = Math.round(pair.score * 100);
    lines.push(
      `  ${ansi.bold(`${pct}%`)} ${ansi.yellow(`"${pair.a.name}"`)} ` +
        `${ansi.dim("↔")} ${ansi.yellow(`"${pair.b.name}"`)}`,
    );
    lines.push(
      ansi.dim(
        `     ${pair.a.providerLabel} (${pair.a.scope})  ${shortenPath(pair.a.path)}`,
      ),
    );
    lines.push(
      ansi.dim(
        `     ${pair.b.providerLabel} (${pair.b.scope})  ${shortenPath(pair.b.path)}`,
      ),
    );
    if (pair.highConfidence) {
      lines.push(ansi.red("     ⚠ likely redundant — review before keeping both"));
    }
    lines.push(ansi.dim(`     ${pair.reason}`));
    lines.push("");
  }

  lines.push(
    ansi.dim(
      "  Nothing was changed. Review each pair before removing either skill.",
    ),
  );
  lines.push("");
  return lines.join("\n");
}

/** Render the overlap report as JSON. */
export function formatOverlapReportJSON(
  report: InstalledOverlapReport,
): string {
  return JSON.stringify(report, null, 2);
}
