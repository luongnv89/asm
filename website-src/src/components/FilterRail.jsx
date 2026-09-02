import { X } from "lucide-react";
import SearchBox from "./SearchBox.jsx";
import CategoryTabs from "./CategoryTabs.jsx";
import FacetRow from "./FacetRow.jsx";
import TagFilter from "./TagFilter.jsx";
import { Button } from "./ui/button.jsx";

/**
 * Left-hand filter rail for the skills storefront. On desktop it is a
 * sticky column beside the grid; on mobile the same content renders
 * inside `SidebarDrawer`. Sorting lives in the grid toolbar, not here,
 * so the rail is only about narrowing the set.
 */
export default function FilterRail({
  catalog,
  state,
  facetCounts,
  searchBoxRef,
  searchDraft,
  onDraftChange,
  onCommitSearch,
  onCategoriesChange,
  onRepoChange,
  onFacetToggle,
  hasFilters,
  onClearAll,
  onCloseDrawer,
}) {
  return (
    <div className="shop shop-rail">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="shop-label">Filter skills</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCloseDrawer}
          aria-label="Close filters"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="shop-rail-group">
        <SearchBox
          ref={searchBoxRef}
          draft={searchDraft}
          onDraftChange={onDraftChange}
          onCommit={onCommitSearch}
          placeholder="Search skills…"
        />
        <p className="shop-meta">
          Press{" "}
          <kbd className="rounded border border-[var(--border)] px-1">/</kbd> to
          search from anywhere.
        </p>
      </div>

      <div className="shop-rail-group">
        <div className="flex items-center justify-between">
          <span className="shop-label">Categories</span>
          {hasFilters && (
            <button
              type="button"
              onClick={onClearAll}
              className="shop-mono text-[11px] text-[var(--fg-dim)] hover:text-[var(--brand)]"
            >
              ✕ Clear all
            </button>
          )}
        </div>
        <CategoryTabs
          categories={catalog.categories}
          activeCategories={state.activeCategories}
          totalSkills={catalog.totalSkills}
          categoryCounts={catalog.categoryCounts}
          onChange={onCategoriesChange}
        />
      </div>

      {facetCounts && (
        <div className="shop-rail-group">
          <span className="shop-label">Refine</span>
          <FacetRow
            counts={facetCounts}
            activeFacets={state.activeFacets}
            onToggle={onFacetToggle}
          />
          <TagFilter
            counts={facetCounts.tags}
            activeTags={state.activeFacets.tags}
            onChange={(tags) => onFacetToggle("tags", tags)}
          />
        </div>
      )}

      <div className="shop-rail-group">
        <label htmlFor="shop-repo" className="shop-label">
          Repository
        </label>
        <select
          id="shop-repo"
          value={state.activeRepo}
          onChange={(e) => onRepoChange(e.target.value)}
          aria-label="Filter by repository"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-2 text-xs text-[var(--fg)]"
        >
          <option value="all">All repositories ({catalog.totalRepos})</option>
          {catalog.repos.map((r) => (
            <option key={r.owner + "/" + r.repo} value={r.owner + "/" + r.repo}>
              {r.owner}/{r.repo} ({r.skillCount})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
