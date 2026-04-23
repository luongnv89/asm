import { useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { List, useDynamicRowHeight } from "react-window";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { useCatalogState } from "../hooks/useCatalogState.js";
import {
  applyFilters,
  anyFilterActive,
  defaultSort,
} from "../lib/filter-sort.js";
import { computeFacetCounts } from "../lib/facets.js";
import { decodeSkillId } from "../lib/utils.js";
import SearchBox from "../components/SearchBox.jsx";
import CategoryTabs from "../components/CategoryTabs.jsx";
import FacetRow from "../components/FacetRow.jsx";
import SkillListItem from "../components/SkillListItem.jsx";
import SkillDetail from "../components/SkillDetail.jsx";
import SidebarDrawer from "../components/SidebarDrawer.jsx";
import { Button } from "../components/ui/button.jsx";

// Starting estimate only — actual row height is measured via
// `useDynamicRowHeight` so dense items (many badges, long owner/repo)
// don't get visually clipped or leave gaps.
const DEFAULT_ROW_HEIGHT = 128;

function SkillRow({
  index,
  style,
  skills,
  decodedId,
  searchQuery,
  searchTerms,
  locationSearch,
}) {
  const s = skills[index];
  return (
    <div style={style} className="pb-1.5">
      <SkillListItem
        skill={s}
        active={s.id === decodedId}
        searchQuery={searchQuery}
        searchTerms={searchTerms}
        locationSearch={locationSearch}
      />
    </div>
  );
}

/**
 * Two-pane catalog view (#228). Left sidebar holds search, filters,
 * sort, and the scrollable skill list. The right pane shows either
 * the selected skill's detail (when the URL is `/skills/:id`) or a
 * friendly empty state prompting the user to pick one.
 *
 * Both `/` and `/skills/:id` render this component so that:
 *   - direct deep-links to a skill still work (`:id` from useParams)
 *   - the sidebar is always present — the list is the home view
 *
 * The data contract (`skills.min.json` + `search.idx.json`) is
 * consumed unchanged; `scripts/build-catalog.ts` remains the sole
 * producer.
 */
export default function CatalogPage() {
  const { id: encodedId } = useParams();
  const decodedId = useMemo(
    () => (encodedId ? decodeSkillId(encodedId) : null),
    [encodedId],
  );
  const location = useLocation();

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
    clearAll,
  } = useCatalogState();

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Measure each rendered row so skill items with extra badges or a long
  // owner/repo line aren't clipped. `key` changes invalidate the cache
  // when the filtered list identity changes (search / filters applied).
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
  });

  const searchResults = useMemo(() => {
    if (!catalog || !miniSearch || !state.searchQuery.trim()) {
      return { scoreById: null, terms: null };
    }
    const hits = miniSearch.search(state.searchQuery.trim());
    const scoreById = new Map();
    for (const h of hits) {
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

  const selectedSkill = useMemo(() => {
    if (!catalog || !decodedId) return null;
    return catalog.skills.find((s) => s.id === decodedId) || null;
  }, [catalog, decodedId]);

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
  const hasFilters = anyFilterActive(state);
  const sortValue = state.sort || defaultSort(state.searchQuery);

  // When the user explicitly looked up a skill that was filtered out of
  // the current list (e.g. direct deep-link that doesn't match active
  // filters), we still render the detail in the main pane — the sidebar
  // just won't highlight anything.
  const deepLinkedButFiltered =
    decodedId && !filtered.some((s) => s.id === decodedId) && selectedSkill;

  const sidebarContent = (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="text-sm font-semibold text-[var(--fg)]">
          Filter skills
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <SearchBox
        draft={searchDraft}
        onDraftChange={setSearchDraft}
        onCommit={setSearchQuery}
        placeholder="Search skills…"
      />
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
          className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg)] text-xs flex-1 min-w-[140px]"
        >
          <option value="all">All Repos ({catalog.totalRepos})</option>
          {catalog.repos.map((r) => (
            <option key={r.owner + "/" + r.repo} value={r.owner + "/" + r.repo}>
              {r.owner}/{r.repo} ({r.skillCount})
            </option>
          ))}
        </select>
        <select
          value={sortValue}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort skills"
          className="px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg)] text-xs flex-1 min-w-[130px]"
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
            ✕ Clear all
          </button>
        )}
      </div>
      <div
        className="flex items-center justify-between text-[11px] text-[var(--fg-muted)] px-1"
        aria-live="polite"
      >
        <span>
          {hasFilters ? (
            <>
              {total} of {catalog.totalSkills} skills
            </>
          ) : (
            <>{total} skills</>
          )}
        </span>
      </div>
      <div
        className="flex-1 min-h-0 pr-1 -mr-1"
        role="list"
        aria-label="Skill results"
      >
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-[var(--fg-dim)] text-sm">
            <div className="text-2xl mb-1">✨</div>
            <p>No skills match your filters</p>
          </div>
        ) : (
          <List
            rowComponent={SkillRow}
            rowCount={filtered.length}
            rowHeight={rowHeight}
            overscanCount={4}
            rowProps={{
              skills: filtered,
              decodedId,
              searchQuery: state.searchQuery,
              searchTerms: searchResults.terms,
              locationSearch: location.search,
            }}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-6 min-h-[calc(100vh-9rem)]">
      {/* Mobile toolbar — visible only below lg */}
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDrawerOpen(true)}
          className="gap-1.5"
          aria-label="Open filter sidebar"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Browse
          <span className="text-[10px] text-[var(--fg-muted)]">({total})</span>
        </Button>
        {decodedId && (
          <Link
            to={{ pathname: "/", search: location.search }}
            className="text-xs text-[var(--fg-dim)] hover:text-[var(--brand)]"
          >
            ← Clear selection
          </Link>
        )}
      </div>

      <SidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ariaLabel="Skill filters and list"
      >
        {sidebarContent}
      </SidebarDrawer>

      <section
        className="flex-1 min-w-0 lg:max-w-none"
        aria-label="Skill detail"
      >
        {selectedSkill ? (
          <div className="flex flex-col gap-3">
            {deepLinkedButFiltered && (
              <p className="text-[11px] text-[var(--fg-muted)] px-1">
                This skill is hidden by your current filters.
              </p>
            )}
            <SkillDetail key={selectedSkill.id} slim={selectedSkill} />
          </div>
        ) : decodedId ? (
          <CatalogEmptyState
            title="Skill not found"
            body={`No skill with id "${decodedId}" exists in the catalog.`}
          />
        ) : (
          <CatalogEmptyState
            title="Select a skill"
            body={
              catalog.totalSkills > 0
                ? "Pick a skill from the sidebar to see its full description, eval score, and install command."
                : "Your catalog is empty."
            }
            stats={{
              skills: catalog.totalSkills,
              repos: catalog.totalRepos,
              categories: catalog.categories.length,
            }}
          />
        )}
      </section>
    </div>
  );
}

function CatalogEmptyState({ title, body, stats }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
      <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--fg)]">
        {title}
      </h1>
      <p className="text-sm text-[var(--fg-dim)] max-w-md">{body}</p>
      {stats && (
        <dl className="flex gap-6 mt-4 text-sm text-[var(--fg-dim)]">
          <Stat label="skills" value={stats.skills.toLocaleString()} />
          <Stat label="repos" value={stats.repos} />
          <Stat label="categories" value={stats.categories} />
        </dl>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col items-center">
      <dt className="sr-only">{label}</dt>
      <dd className="text-lg text-[var(--fg)] font-semibold">{value}</dd>
      <span className="text-xs text-[var(--fg-muted)]">{label}</span>
    </div>
  );
}
