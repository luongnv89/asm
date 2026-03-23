import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { getIndexDir, getBundledIndexDir } from "./config";
import type { RepoIndex, IndexedSkill } from "./utils/types";

export interface SearchResult {
  skill: IndexedSkill;
  repo: { owner: string; repo: string };
  score: number;
}

function tokenize(text: string): Set<string> {
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
      const content = await readFile(filePath, "utf-8");
      const index = JSON.parse(content) as RepoIndex;
      // Backfill license/creator for indices created before these fields existed
      for (const skill of index.skills) {
        if (!("license" in skill)) (skill as any).license = "";
        if (!("creator" in skill)) (skill as any).creator = "";
        if (!("compatibility" in skill)) (skill as any).compatibility = "";
        if (!("allowedTools" in skill)) (skill as any).allowedTools = [];
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
 */
export async function loadAllIndices(): Promise<RepoIndex[]> {
  const bundled = await loadIndicesFromDir(getBundledIndexDir());
  const user = await loadIndicesFromDir(getIndexDir());

  // Merge: user overrides bundled for same owner/repo
  const merged = new Map(bundled);
  for (const [key, index] of user) {
    merged.set(key, index);
  }

  return Array.from(merged.values());
}

export interface SearchFilters {
  has?: string[];
  missing?: string[];
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

export async function getTotalSkillCount(): Promise<number> {
  const indices = await loadAllIndices();
  return indices.reduce((sum, idx) => sum + idx.skillCount, 0);
}
