/**
 * Fuzzy relevance scoring for installed-skill search (issue #735).
 *
 * `scoreSkill` ranks a skill against a free-text query by combining:
 *   - a name component that tolerates partial names and typos, and
 *   - a description component that matches what the skill is *for*.
 *
 * Name tiers dominate the description so an exact name always outranks a
 * prefix, substring, or typo match: the description is capped below the gap
 * between the exact tier and the next one. The scorer is pure and has no
 * knowledge of where a skill is installed, so other search surfaces (e.g. the
 * intent-based search tracked in #103) can reuse it.
 */
import { levenshtein } from "./registry";
import { tokenize } from "./skill-index";

/** Results scoring below this are treated as non-matches. */
export const MIN_SCORE = 10;

const SCORE_NAME_EXACT = 100;
const SCORE_NAME_PREFIX = 70;
const SCORE_NAME_SUBSTRING = 60;
const SCORE_NAME_TYPO = 50;
const SCORE_NAME_TOKENS_MAX = 40;
const SCORE_DESC_MAX = 25;

const CREDIT_EXACT = 1;
const CREDIT_PREFIX = 0.8;
const CREDIT_TYPO = 0.6;
const CREDIT_STEM = 0.6;

/** Typo tolerance only applies to tokens at least this long. */
const MIN_TYPO_LENGTH = 4;
/** Stem matching ("reviewing" ~ "review") needs a shared prefix this long. */
const MIN_STEM_PREFIX = 4;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "skill",
  "skills",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

export interface ScorableSkill {
  name: string;
  description: string;
}

/** Lowercase and collapse whitespace/underscore/dot runs to `-`. */
function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s_.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function maxTypoDistance(token: string): number {
  return Math.max(1, Math.floor(token.length / 4));
}

function isTypo(a: string, b: string): boolean {
  if (a.length < MIN_TYPO_LENGTH) return false;
  return levenshtein(a, b) <= maxTypoDistance(a);
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

/** Query tokens with stopwords removed; falls back to all tokens. */
function meaningfulTokens(query: string): string[] {
  const all = [...tokenize(query)];
  const filtered = all.filter((t) => !STOPWORDS.has(t));
  return filtered.length > 0 ? filtered : all;
}

function nameTokenCredit(queryToken: string, nameTokens: string[]): number {
  let best = 0;
  for (const nt of nameTokens) {
    if (nt === queryToken) return CREDIT_EXACT;
    if (nt.startsWith(queryToken)) best = Math.max(best, CREDIT_PREFIX);
    else if (isTypo(queryToken, nt)) best = Math.max(best, CREDIT_TYPO);
  }
  return best;
}

function descTokenCredit(queryToken: string, descTokens: Set<string>): number {
  if (descTokens.has(queryToken)) return CREDIT_EXACT;
  if (queryToken.length < MIN_STEM_PREFIX) return 0;
  for (const dt of descTokens) {
    const shared = commonPrefixLength(queryToken, dt);
    const shorter = Math.min(queryToken.length, dt.length);
    if (shared >= MIN_STEM_PREFIX && shared >= shorter * 0.75) {
      return CREDIT_STEM;
    }
  }
  return 0;
}

/** Name-only relevance, 0..100. */
export function scoreName(query: string, name: string): number {
  const q = normalizeName(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;

  if (n === q) return SCORE_NAME_EXACT;
  if (q.length >= 2 && n.startsWith(q)) return SCORE_NAME_PREFIX;
  if (q.length >= 2 && n.includes(q)) return SCORE_NAME_SUBSTRING;
  if (isTypo(q, n)) return SCORE_NAME_TYPO;

  const queryTokens = meaningfulTokens(query);
  if (queryTokens.length === 0) return 0;
  const nameTokens = [...tokenize(name)];
  let credit = 0;
  for (const qt of queryTokens) credit += nameTokenCredit(qt, nameTokens);
  return (SCORE_NAME_TOKENS_MAX * credit) / queryTokens.length;
}

/** Description-only relevance, 0..SCORE_DESC_MAX. */
export function scoreDescription(query: string, description: string): number {
  const queryTokens = meaningfulTokens(query);
  if (queryTokens.length === 0 || !description) return 0;
  const descTokens = tokenize(description);
  let credit = 0;
  for (const qt of queryTokens) credit += descTokenCredit(qt, descTokens);
  return (SCORE_DESC_MAX * credit) / queryTokens.length;
}

/**
 * Relevance of `skill` to `query`. Higher is better; scores below
 * `MIN_SCORE` should be treated as no match. Rounded to an integer.
 */
export function scoreSkill(query: string, skill: ScorableSkill): number {
  return Math.round(
    scoreName(query, skill.name) + scoreDescription(query, skill.description),
  );
}
