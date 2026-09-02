import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useCatalog } from "../hooks/useCatalog.jsx";
import { useCatalogState } from "../hooks/useCatalogState.js";
import {
  applyFilters,
  anyFilterActive,
  buildNameCollisionKeys,
  defaultSort,
} from "../lib/filter-sort.js";
import { computeFacetCounts } from "../lib/facets.js";
import { decodeSkillId } from "../lib/utils.js";
import FilterRail from "../components/FilterRail.jsx";
import SkillCard from "../components/SkillCard.jsx";
import SkillDetail from "../components/SkillDetail.jsx";
import SkillBuyBox from "../components/SkillBuyBox.jsx";
import SidebarDrawer from "../components/SidebarDrawer.jsx";
import Pagination from "../components/Pagination.jsx";
import { Button } from "../components/ui/button.jsx";

/** Cards per storefront page. */
export const PAGE_SIZE = 24;
/** Cards in the "related skills" shelf on a product page. */
const RELATED_LIMIT = 6;

/**
 * Skills storefront. `/skills` renders the shop floor — a filter rail
 * beside a paginated grid of product cards. `/skills/:id` renders the
 * product page for one skill (details + sticky buy box + a shelf of
 * related skills) with a breadcrumb back to the same filtered grid.
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

  const { loading, error, catalog, miniSearch, searchError } = useCatalog();
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchBoxRef = useRef(null);
  const gridTopRef = useRef(null);

  // Keyboard shortcut: "/" or Ctrl+K to focus search box
  useEffect(() => {
    function handler(e) {
      const tag = (e.target && e.target.tagName) || "";
      // Ignore if focused in an input/textarea/contenteditable
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (
        (e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        setDrawerOpen(true);
        searchBoxRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const searchResults = useMemo(() => {
    if (!catalog || !miniSearch || !state.searchQuery.trim()) {
      return { scoreById: null, terms: null };
    }
    // If MiniSearch failed to initialize, the above guard catches it.
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

  // A skill name may appear at multiple install paths within a single repo
  // (plugin-bundle layouts ship the same skill under several relPaths — see
  // build-catalog.ts and issue #241). The collision set lets `SkillCard`
  // surface the distinguishing sub-path on those cards only.
  const collisionKeys = useMemo(
    () => (catalog ? buildNameCollisionKeys(catalog.skills) : null),
    [catalog],
  );

  const selectedSkill = useMemo(() => {
    if (!catalog || !decodedId) return null;
    return catalog.skills.find((s) => s.id === decodedId) || null;
  }, [catalog, decodedId]);

  // "You might also like": skills sharing a category, best score first.
  const related = useMemo(() => {
    if (!catalog || !selectedSkill) return [];
    const cats = new Set(selectedSkill.categories || []);
    if (cats.size === 0) return [];
    const pool = catalog.skills.filter(
      (s) =>
        s.id !== selectedSkill.id &&
        (s.categories || []).some((c) => cats.has(c)),
    );
    pool.sort(
      (a, b) =>
        (b.evalSummary?.overallScore ?? -1) -
          (a.evalSummary?.overallScore ?? -1) || a.name.localeCompare(b.name),
    );
    return pool.slice(0, RELATED_LIMIT);
  }, [catalog, selectedSkill]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(state.page, pageCount);
  const pageItems = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const handlePage = useCallback(
    (next) => {
      setPage(next);
      const el = gridTopRef.current;
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [setPage],
  );

  if (error) {
    return (
      <div className="shop py-16 text-center">
        <h2 className="text-lg font-semibold text-[var(--warn)]">
          Catalog failed to load
        </h2>
        <p className="text-sm text-[var(--fg-dim)] mt-2">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 px-3 py-1.5 rounded border border-[var(--border)] bg-transparent text-[var(--fg)] hover:border-[var(--brand)] text-xs"
        >
          Reload page
        </button>
      </div>
    );
  }

  if (loading || !catalog) {
    return (
      <div className="shop flex flex-col gap-5">
        <div className="h-10 w-40 rounded bg-[var(--bg-input)] animate-pulse" />
        <div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          role="status"
          aria-label="Loading"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden"
            >
              <div className="h-24 bg-[var(--bg-input)] animate-pulse" />
              <div className="p-3.5 space-y-2">
                <div className="h-4 w-2/3 rounded bg-[var(--bg-input)] animate-pulse" />
                <div className="h-3 w-full rounded bg-[var(--bg-input)] animate-pulse" />
                <div className="h-3 w-4/5 rounded bg-[var(--bg-input)] animate-pulse" />
              </div>
            </div>
          ))}
          <span className="sr-only">Loading skill catalog…</span>
        </div>
      </div>
    );
  }

  /* ── Product page ─────────────────────────────────────────────── */
  if (decodedId) {
    const backTo = { pathname: "/skills", search: location.search };
    return (
      <div className="shop flex flex-col gap-8">
        <nav className="shop-crumb" aria-label="Breadcrumb">
          <Link to={backTo}>Skills</Link>
          {selectedSkill?.categories?.[0] && (
            <>
              <span aria-hidden="true">/</span>
              <Link
                to={{
                  pathname: "/skills",
                  search: `?cat=${encodeURIComponent(selectedSkill.categories[0])}`,
                }}
              >
                {selectedSkill.categories[0]}
              </Link>
            </>
          )}
          <span aria-hidden="true">/</span>
          <span className="text-[var(--fg)]" aria-current="page">
            {selectedSkill?.name || decodedId}
          </span>
          <Link to={backTo} className="ml-auto inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to results
          </Link>
        </nav>

        {selectedSkill ? (
          <>
            <div className="grid gap-8 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px] items-start">
              <SkillDetail key={selectedSkill.id} slim={selectedSkill} />
              <SkillBuyBox skill={selectedSkill} />
            </div>
            {related.length > 0 && (
              <section
                className="flex flex-col gap-4 border-t border-[var(--border)] pt-8"
                aria-label="Related skills"
              >
                <div>
                  <div className="shop-kicker">You might also like</div>
                  <h2 className="shop-title mt-1 !text-[28px]">
                    Related <em>skills</em>
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {related.map((s, i) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      index={i}
                      searchQuery=""
                      searchTerms={null}
                      locationSearch={location.search}
                      hasNameCollision={
                        !!collisionKeys &&
                        collisionKeys.has(
                          s.owner + "/" + s.repo + "::" + s.name,
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <EmptyState
            title="Skill not found"
            body={`No skill with id "${decodedId}" exists in the catalog.`}
          />
        )}
      </div>
    );
  }

  /* ── Shop floor ───────────────────────────────────────────────── */
  const hasFilters = anyFilterActive(state);
  const sortValue = state.sort || defaultSort(state.searchQuery);
  const activeFilterCount = countActiveFilters(state);
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="shop flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-6">
        <div className="shop-kicker">
          <span className="dot" aria-hidden="true" />
          Catalog · {catalog.totalRepos} repositories ·{" "}
          {catalog.categories.length} categories
        </div>
        <h1 className="shop-title">Skills</h1>
        <p className="shop-lede">
          Every skill here is free and open source. Open one for the details,
          add it to your cart, and check out as a bundle you can install with a
          single command.
        </p>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        <SidebarDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel="Skill filters"
          className="lg:w-[280px] xl:w-[300px] lg:border-r-0 lg:sticky lg:top-[5.25rem] lg:overflow-y-auto"
        >
          <FilterRail
            catalog={catalog}
            state={state}
            facetCounts={facetCounts}
            searchBoxRef={searchBoxRef}
            searchDraft={searchDraft}
            onDraftChange={setSearchDraft}
            onCommitSearch={setSearchQuery}
            onCategoriesChange={setActiveCategories}
            onRepoChange={setActiveRepo}
            onFacetToggle={setFacet}
            hasFilters={hasFilters}
            onClearAll={clearAll}
            onCloseDrawer={() => setDrawerOpen(false)}
          />
        </SidebarDrawer>

        <section
          className="flex-1 min-w-0 flex flex-col gap-4"
          aria-label="Skill results"
        >
          <div
            ref={gridTopRef}
            className="flex flex-wrap items-center gap-2 scroll-mt-24"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDrawerOpen(true)}
              className="gap-1.5 lg:hidden"
              aria-label="Open filters"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters
              {activeFilterCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] bg-[var(--brand)] text-[var(--bg)] font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            <p className="shop-meta" aria-live="polite">
              {total === 0
                ? "No skills"
                : `Showing ${first}–${last} of ${total.toLocaleString()} skills`}
              {hasFilters && total !== catalog.totalSkills && (
                <> · filtered from {catalog.totalSkills.toLocaleString()}</>
              )}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="shop-sort" className="shop-label">
                Sort
              </label>
              <select
                id="shop-sort"
                value={sortValue}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort skills"
                className="rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--fg)]"
              >
                <option value="relevance">Relevance</option>
                <option value="name">Name A–Z</option>
                <option value="grade">Best score</option>
                <option value="tokens-asc">Smallest first</option>
                <option value="tokens-desc">Largest first</option>
              </select>
            </div>
          </div>

          {searchError && (
            <div className="py-2 px-3 rounded-md bg-[var(--warn-bg)] border border-[var(--warn)] text-[var(--warn)] text-xs">
              ⚠ {searchError}
            </div>
          )}

          {pageItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] px-6 py-16 text-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="w-8 h-8 text-[var(--fg-muted)]"
                aria-hidden="true"
              >
                <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z" />
              </svg>
              <p className="text-sm text-[var(--fg-dim)]">
                No skills match your filters
              </p>
              <p className="shop-meta">
                Try a broader search or clear a filter.
              </p>
              {hasFilters && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearAll}
                >
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div
              key={`${page}-${state.sort}`}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              {pageItems.map((s, i) => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  index={i}
                  searchQuery={state.searchQuery}
                  searchTerms={searchResults.terms}
                  locationSearch={location.search}
                  hasNameCollision={
                    !!collisionKeys &&
                    collisionKeys.has(s.owner + "/" + s.repo + "::" + s.name)
                  }
                />
              ))}
            </div>
          )}

          <Pagination page={page} pageCount={pageCount} onChange={handlePage} />
        </section>
      </div>
    </div>
  );
}

function countActiveFilters(state) {
  let n = 0;
  if (state.searchQuery.trim()) n++;
  n += state.activeCategories.size;
  if (state.activeRepo && state.activeRepo !== "all") n++;
  for (const set of Object.values(state.activeFacets)) n += set.size;
  return n;
}

function EmptyState({ title, body }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
      <h1 className="shop-title !text-[32px]">{title}</h1>
      <p className="text-sm text-[var(--fg-dim)] max-w-md">{body}</p>
    </div>
  );
}
