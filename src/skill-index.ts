import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getIndexDir, getBundledIndexDir } from "./config";
import type { RepoIndex, IndexedSkill } from "./utils/types";
import { matchesInvocabilityFilters } from "./utils/frontmatter";

// ─── Memoization (issue #461) ──────────────────────────────────────────────

let _cachedIndices: RepoIndex[] | null = null;
let _cachedTotal: number | undefined = undefined;
let _readFileCount = 0;

/** Reset memoization (for tests). */
export function _resetMemo(): void {
  _cachedIndices = null;
  _cachedTotal = undefined;
  _readFileCount = 0;
}

/** Number of times `readFile` has been called (for test assertions). */
export function _getReadFileCount(): number {
  return _readFileCount;
}

export interface SearchResult {
  skill: IndexedSkill;
  repo: { owner: string; repo: string };
  score: number;
}

export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().split(/[\s\-_.,;:()[\]{}"']+/);
  for (const word of words) {
    if (word.length >= 2) {
      tokens.add(word);
    }
  }
  return tokens;
}

const SCORE_NAME_EXACT = 10;
const SCORE_NAME_PARTIAL = 5;
const SCORE_DESC_EXACT = 3;
const SCORE_DESC_PARTIAL = 1;

function calculateScore(query: string, skill: IndexedSkill): number {
  const queryTokens = tokenize(query);
  const nameTokens = tokenize(skill.name);
  const descTokens = tokenize(skill.description);

  let score = 0;

  for (const qt of queryTokens) {
    if (nameTokens.has(qt)) {
      score += SCORE_NAME_EXACT;
    }
    if (descTokens.has(qt)) {
      score += SCORE_DESC_EXACT;
    }
    if (skill.name.toLowerCase().includes(qt)) {
      score += SCORE_NAME_PARTIAL;
    }
    if (skill.description.toLowerCase().includes(qt)) {
      score += SCORE_DESC_PARTIAL;
    }
  }

  return score;
}

/**
 * Read all index JSON files from a directory, returning a map keyed by
 * "owner/repo" so callers can merge/dedupe across directories.
 */
async function loadIndicesFromDir(
  dir: string,
): Promise<Map<string, RepoIndex>> {
  const indices = new Map<string, RepoIndex>();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return indices;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    try {
      _readFileCount++;
      const content = await readFile(filePath, "utf-8");
      const index = JSON.parse(content) as RepoIndex;
      // Backfill license/creator/verified for indices created before these fields existed
      for (const skill of index.skills) {
        const s = skill as Partial<IndexedSkill> & Record<string, unknown>;
        if (!("license" in s) || s.license === undefined) s.license = "";
        if (!("creator" in s) || s.creator === undefined) s.creator = "";
        if (!("compatibility" in s) || s.compatibility === undefined)
          s.compatibility = "";
        if (!("allowedTools" in s) || s.allowedTools === undefined)
          s.allowedTools = [];
        if (!("verified" in s) || s.verified === undefined) s.verified = false;
      }
      indices.set(`${index.owner}/${index.repo}`, index);
    } catch {
      // Skip invalid files
    }
  }

  return indices;
}

/**
 * Load all indices from both bundled (shipped with npm) and user (runtime)
 * directories. User indices take precedence over bundled ones for the same
 * owner/repo — this way `asm index ingest` can refresh bundled data.
 *
 * Results are memoized within a process so the ~21 MB / 57-file corpus is
 * read and parsed only once (issue #461).
 */
export async function loadAllIndices(): Promise<RepoIndex[]> {
  if (_cachedIndices !== null) return _cachedIndices;

  const bundled = await loadIndicesFromDir(getBundledIndexDir());
  const user = await loadIndicesFromDir(getIndexDir());

  // Merge: user overrides bundled for same owner/repo
  const merged = new Map(bundled);
  for (const [key, index] of user) {
    merged.set(key, index);
  }

  _cachedIndices = Array.from(merged.values());
  // Pre-compute the total so getTotalSkillCount() is instant on warm calls.
  _cachedTotal = _cachedIndices.reduce((s, idx) => s + idx.skillCount, 0);
  return _cachedIndices;
}

/** Read only the `skillCount` integer from a single index file. */
async function readSkillCountFromFile(
  filePath: string,
): Promise<number | null> {
  try {
    _readFileCount++;
    const content = await readFile(filePath, "utf-8");
    // Extract the skillCount value from the JSON without full parsing.
    // The field appears as "skillCount":<number> at the top level.
    const m = content.match(/"skillCount"\s*:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Load the `skillCount` from every index JSON in a directory.
 * Reads only the integer field — no full JSON parse (issue #462).
 */
async function loadSkillCountsFromDir(dir: string): Promise<number> {
  let total = 0;
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return total;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const count = await readSkillCountFromFile(join(dir, file));
    if (count !== null) total += count;
  }
  return total;
}

/**
 * Return the total number of skills across all indices.
 * Uses the memoized corpus data (issue #461) and a lightweight
 * per-file read for cold starts (issue #462).
 */
export async function getTotalSkillCount(): Promise<number> {
  // Warm path — cached from loadAllIndices()
  if (_cachedTotal !== undefined) return _cachedTotal;

  // Cold path — read only skillCount from each file (no full parse)
  const bundled = await loadSkillCountsFromDir(getBundledIndexDir());
  const user = await loadSkillCountsFromDir(getIndexDir());
  const total = bundled + user;

  // Cache for subsequent calls
  _cachedTotal = total;
  return total;
}

export interface SearchFilters {
  has?: string[];
  missing?: string[];
  modelInvocable?: boolean;
  userInvocable?: boolean;
}

const FILTERABLE_FIELDS = ["license", "creator", "version"] as const;
type FilterableField = (typeof FILTERABLE_FIELDS)[number];

function isFilterableField(field: string): field is FilterableField {
  return (FILTERABLE_FIELDS as readonly string[]).includes(field);
}

function getFilterableValue(
  skill: IndexedSkill,
  field: FilterableField,
): string {
  return skill[field] || "";
}

function matchesFilters(skill: IndexedSkill, filters: SearchFilters): boolean {
  if (!matchesInvocabilityFilters(skill, filters)) return false;
  if (filters.has) {
    for (const field of filters.has) {
      if (!isFilterableField(field)) continue;
      if (!getFilterableValue(skill, field)) return false;
    }
  }
  if (filters.missing) {
    for (const field of filters.missing) {
      if (!isFilterableField(field)) continue;
      if (getFilterableValue(skill, field)) return false;
    }
  }
  return true;
}

export function getMissingMetadataFields(skill: IndexedSkill): string[] {
  const missing: string[] = [];
  if (!skill.license) missing.push("license");
  if (!skill.creator) missing.push("creator");
  if (!skill.version || skill.version === "0.0.0") missing.push("version");
  return missing;
}

export async function searchSkills(
  query: string,
  limit: number = 20,
  filters?: SearchFilters,
): Promise<SearchResult[]> {
  const indices = await loadAllIndices();
  const results: SearchResult[] = [];

  const isFilterOnly = !query && filters;

  for (const index of indices) {
    for (const skill of index.skills) {
      if (filters && !matchesFilters(skill, filters)) continue;
      const score = isFilterOnly ? 1 : calculateScore(query, skill);
      if (score > 0) {
        results.push({
          skill,
          repo: { owner: index.owner, repo: index.repo },
          score,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export async function getAllIndexedSkills(): Promise<
  Array<{ skill: IndexedSkill; repo: { owner: string; repo: string } }>
> {
  const indices = await loadAllIndices();
  const allSkills: Array<{
    skill: IndexedSkill;
    repo: { owner: string; repo: string };
  }> = [];

  for (const index of indices) {
    for (const skill of index.skills) {
      allSkills.push({
        skill,
        repo: { owner: index.owner, repo: index.repo },
      });
    }
  }

  return allSkills;
}

// ─── Exact-name resolution (issue #422) ────────────────────────────────────

export interface IndexedSkillMatch {
  skill: IndexedSkill;
  repo: { owner: string; repo: string };
}

/**
 * Outcome of resolving an exact skill name against the indexed catalog.
 *
 * `searchSkills` is fuzzy and limit-capped, so it can rank an unrelated skill
 * first — it can never be the resolution primitive for a command that has to
 * deliver *the* named skill. This is that primitive: exact, case-insensitive
 * name equality, with cross-repo collisions surfaced rather than guessed.
 */
export type IndexedNameResolution =
  | { status: "found"; match: IndexedSkillMatch }
  | { status: "none" }
  | { status: "ambiguous"; matches: IndexedSkillMatch[] };

/**
 * Resolve a skill name to a single catalog entry.
 *
 * @param name    Exact skill name (compared case-insensitively).
 * @param catalog Optional pre-loaded catalog. Injecting it keeps callers and
 *                tests off the ambient user index directory.
 */
export async function resolveIndexedSkillByName(
  name: string,
  catalog?: IndexedSkillMatch[],
): Promise<IndexedNameResolution> {
  const target = name.trim().toLowerCase();
  if (!target) return { status: "none" };

  const all = catalog ?? (await getAllIndexedSkills());
  const matches = all.filter((e) => e.skill.name.toLowerCase() === target);
  if (matches.length === 0) return { status: "none" };

  // Collapse entries that point at the same repo + path: the same skill listed
  // twice is not a collision the user has to disambiguate.
  const seen = new Set<string>();
  const unique: IndexedSkillMatch[] = [];
  for (const m of matches) {
    const key = `${m.repo.owner}/${m.repo.repo}:${m.skill.relPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
  }

  if (unique.length === 1) return { status: "found", match: unique[0] };
  return { status: "ambiguous", matches: unique };
}
