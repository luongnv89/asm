import { licenseBucket, skillSource } from "./utils.js";

/**
 * Filter + search + sort pipeline. Ported 1:1 from `website/index.html`
 * so parity is exact. Return value is a freshly ordered array of slim
 * catalog rows.
 *
 * @param {object[]} skills Slim skill rows (from skills.min.json).
 * @param {object} state Current filter/search/sort state.
 * @param {string} state.searchQuery
 * @param {Set<string>} state.activeCategories
 * @param {string} state.activeRepo "all" or "owner/repo".
 * @param {Record<string, Set<string>>} state.activeFacets
 * @param {string} state.sort "relevance" | "name" | "grade" | "tokens-asc" | "tokens-desc".
 * @param {object | null} options Optional MiniSearch results.
 * @param {Map<string, number> | null} options.scoreById Score per skill id.
 */
export function applyFilters(skills, state, options = {}) {
  const scoreById = options.scoreById || null;
  let results = skills;

  if (state.activeCategories.size > 0) {
    results = results.filter((s) => {
      for (const c of s.categories)
        if (state.activeCategories.has(c)) return true;
      return false;
    });
  }

  if (state.activeRepo && state.activeRepo !== "all") {
    results = results.filter(
      (s) => s.owner + "/" + s.repo === state.activeRepo,
    );
  }

  if (state.activeFacets.license.size > 0) {
    results = results.filter((s) =>
      state.activeFacets.license.has(licenseBucket(s.license)),
    );
  }
  if (state.activeFacets.grade.size > 0) {
    results = results.filter(
      (s) => s.evalSummary && state.activeFacets.grade.has(s.evalSummary.grade),
    );
  }
  if (state.activeFacets.source.size > 0) {
    results = results.filter((s) =>
      state.activeFacets.source.has(skillSource(s)),
    );
  }
  if (state.activeFacets.usesTools.size > 0) {
    results = results.filter((s) => {
      const yes =
        s.hasTools === true || !!(s.allowedTools && s.allowedTools.length > 0);
      return (
        (yes && state.activeFacets.usesTools.has("yes")) ||
        (!yes && state.activeFacets.usesTools.has("no"))
      );
    });
  }

  // Featured skills pin to the top of every sort mode (including search
  // relevance). Returns -1/1 when featured differs, 0 otherwise so callers
  // can fall through to the real comparator as a tiebreaker.
  const featuredFirst = (a, b) => {
    const af = a.featured === true ? 1 : 0;
    const bf = b.featured === true ? 1 : 0;
    return bf - af;
  };

  let scored = null;
  if (state.searchQuery.trim() && scoreById) {
    scored = results
      .filter((s) => scoreById.has(s.id))
      .map((s) => ({ skill: s, score: scoreById.get(s.id) }))
      .sort((a, b) => {
        const f = featuredFirst(a.skill, b.skill);
        if (f !== 0) return f;
        return b.score - a.score;
      });
    results = scored.map((r) => r.skill);
  }

  const hasSearch = state.searchQuery && state.searchQuery.trim();
  const sortMode = state.sort || (hasSearch ? "relevance" : "name");

  if (sortMode === "name" || (sortMode === "relevance" && !scored)) {
    results = results.slice().sort((a, b) => {
      const f = featuredFirst(a, b);
      if (f !== 0) return f;
      return a.name.localeCompare(b.name);
    });
  } else if (sortMode === "grade") {
    const gradeRank = { A: 0, B: 1, C: 2, D: 3, F: 4 };
    results = results.slice().sort((a, b) => {
      const f = featuredFirst(a, b);
      if (f !== 0) return f;
      const ag = a.evalSummary ? (gradeRank[a.evalSummary.grade] ?? 99) : 99;
      const bg = b.evalSummary ? (gradeRank[b.evalSummary.grade] ?? 99) : 99;
      if (ag !== bg) return ag - bg;
      const as = a.evalSummary ? a.evalSummary.overallScore : -1;
      const bs = b.evalSummary ? b.evalSummary.overallScore : -1;
      if (as !== bs) return bs - as;
      return a.name.localeCompare(b.name);
    });
  } else if (sortMode === "tokens-asc") {
    results = results.slice().sort((a, b) => {
      const f = featuredFirst(a, b);
      if (f !== 0) return f;
      const at = typeof a.tokenCount === "number" ? a.tokenCount : Infinity;
      const bt = typeof b.tokenCount === "number" ? b.tokenCount : Infinity;
      if (at !== bt) return at - bt;
      return a.name.localeCompare(b.name);
    });
  } else if (sortMode === "tokens-desc") {
    results = results.slice().sort((a, b) => {
      const f = featuredFirst(a, b);
      if (f !== 0) return f;
      const at = typeof a.tokenCount === "number" ? a.tokenCount : -1;
      const bt = typeof b.tokenCount === "number" ? b.tokenCount : -1;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name);
    });
  }

  return results;
}

/**
 * Build the set of `owner/repo::name` keys that collide — i.e. the same
 * skill name exists at more than one install path within a single repo
 * (plugin-bundle layouts do this). Consumers use this to decide whether
 * to surface the distinguishing sub-path on a list row so two otherwise
 * identical-looking cards don't look like accidental duplicates
 * (issue #241).
 *
 * @param {object[]} skills Slim skill rows.
 * @returns {Set<string>}
 */
export function buildNameCollisionKeys(skills) {
  const counts = new Map();
  for (const s of skills) {
    const key = s.owner + "/" + s.repo + "::" + s.name;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const collisions = new Set();
  for (const [key, n] of counts) {
    if (n > 1) collisions.add(key);
  }
  return collisions;
}

export function anyFilterActive(state) {
  if (state.searchQuery && state.searchQuery.trim()) return true;
  if (state.activeCategories.size > 0) return true;
  if (state.activeRepo && state.activeRepo !== "all") return true;
  for (const k of Object.keys(state.activeFacets)) {
    if (state.activeFacets[k].size > 0) return true;
  }
  return false;
}

/**
 * Default sort depends on whether search is active. Preserves legacy UX:
 * no search → alphabetical; search active → relevance scoring.
 */
export function defaultSort(searchQuery) {
  return searchQuery && searchQuery.trim() ? "relevance" : "name";
}
