import { useMemo } from "react";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { useCatalogState } from "../hooks/useCatalogState.js";
import {
  applyFilters,
  anyFilterActive,
  defaultSort,
} from "../lib/filter-sort.js";
import { computeFacetCounts } from "../lib/facets.js";
import SearchBox from "../components/SearchBox.jsx";
import CategoryTabs from "../components/CategoryTabs.jsx";
import FacetRow from "../components/FacetRow.jsx";
import SkillCard from "../components/SkillCard.jsx";
import Pagination from "../components/Pagination.jsx";

const PAGE_SIZE = 48;

/**
 * Main catalog view. Composes search + category tabs + facet filters +
 * repo select + sort select + card grid + pagination.
 *
 * The data contract (`skills.min.json` + `search.idx.json`) is consumed
 * unchanged; `scripts/build-catalog.ts` remains the sole producer.
 */
export default function CatalogPage() {
  const { loading, error, catalog, miniSearch } = useCatalog();
  const {
    state,
    searchDraft,
    setSearchDraft,
    setSearchQuery,
    setActiveCategories,
    setActiveRepo,
    setFacet,
    setSort,
    setPage,
    clearAll,
  } = useCatalogState();

  const searchResults = useMemo(() => {
    if (!catalog || !miniSearch || !state.searchQuery.trim()) {
      return { scoreById: null, terms: null };
    }
    const hits = miniSearch.search(state.searchQuery.trim());
    const scoreById = new Map();
    for (const h of hits) {
      // hit.id is an array index into catalog.skills (see build-catalog.ts).
      const row = catalog.skills[h.id];
      if (row) scoreById.set(row.id, h.score);
    }
    const seen = new Set();
    for (const h of hits) {
      if (!Array.isArray(h.terms)) continue;
      for (const t of h.terms) if (t) seen.add(String(t).toLowerCase());
    }
    return { scoreById, terms: Array.from(seen) };
  }, [catalog, miniSearch, state.searchQuery]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    return applyFilters(catalog.skills, state, {
      scoreById: searchResults.scoreById,
    });
  }, [catalog, state, searchResults.scoreById]);

  const facetCounts = useMemo(
    () => (catalog ? computeFacetCounts(catalog.skills) : null),
    [catalog],
  );

  if (error) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--warn)]">
          Catalog failed to load
        </h2>
        <p className="text-sm text-[var(--fg-dim)] mt-2">{error}</p>
      </div>
    );
  }

  if (loading || !catalog) {
    return (
      <div className="py-16 text-center text-[var(--fg-dim)]">
        Loading skill catalog…
      </div>
    );
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(state.page, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  const hasFilters = anyFilterActive(state);
  const sortValue = state.sort || defaultSort(state.searchQuery);

  return (
    <div className="flex flex-col gap-6">
      <section className="text-center py-4 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--fg)]">
          Find the perfect <span className="text-[var(--brand)]">skill</span>
        </h1>
        <p className="text-sm text-[var(--fg-dim)] mt-2">
          Browse and install agent skills for Claude Code, Codex, and more
        </p>
        <div className="flex justify-center gap-6 mt-4 text-sm text-[var(--fg-dim)]">
          <Stat label="skills" value={catalog.totalSkills.toLocaleString()} />
          <Stat label="repos" value={catalog.totalRepos} />
          <Stat label="categories" value={catalog.categories.length} />
        </div>
        <div className="max-w-2xl mx-auto mt-6">
          <SearchBox
            draft={searchDraft}
            onDraftChange={setSearchDraft}
            onCommit={setSearchQuery}
            placeholder="Search skills, tags, descriptions…"
          />
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <CategoryTabs
          categories={catalog.categories}
          activeCategories={state.activeCategories}
          totalSkills={catalog.totalSkills}
          skills={catalog.skills}
          onChange={setActiveCategories}
        />
        {facetCounts && (
          <FacetRow
            counts={facetCounts}
            activeFacets={state.activeFacets}
            onToggle={setFacet}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={state.activeRepo}
            onChange={(e) => setActiveRepo(e.target.value)}
            aria-label="Filter by repository"
            className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg)] text-xs"
          >
            <option value="all">All Repos ({catalog.totalRepos})</option>
            {catalog.repos.map((r) => (
              <option
                key={r.owner + "/" + r.repo}
                value={r.owner + "/" + r.repo}
              >
                {r.owner}/{r.repo} ({r.skillCount})
              </option>
            ))}
          </select>
          <select
            value={sortValue}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort skills"
            className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg)] text-xs"
          >
            <option value="relevance">Sort: relevance</option>
            <option value="name">Sort: name</option>
            <option value="grade">Sort: best score</option>
            <option value="tokens-asc">Sort: smallest first</option>
            <option value="tokens-desc">Sort: largest first</option>
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="px-3 py-1.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)] text-xs"
            >
              ✕ Clear all filters
            </button>
          )}
          <span className="ml-auto text-xs text-[var(--fg-muted)]">
            {hasFilters ? (
              <>
                Showing {total} of {catalog.totalSkills} skills
              </>
            ) : (
              <>{total} skills</>
            )}
          </span>
        </div>
      </div>

      {slice.length === 0 ? (
        <div className="py-12 text-center text-[var(--fg-dim)]">
          <div className="text-3xl mb-2">✨</div>
          <p>No skills match your search</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {slice.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              searchQuery={state.searchQuery}
              searchTerms={searchResults.terms}
            />
          ))}
        </div>
      )}

      <Pagination current={page} total={totalPages} onChange={setPage} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col items-center">
      <strong className="text-lg text-[var(--fg)]">{value}</strong>
      <span className="text-xs text-[var(--fg-muted)]">{label}</span>
    </div>
  );
}
