import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { csvToSet, setToCsv } from "../lib/utils.js";
import { emptyFacetState } from "../lib/facets.js";
import { defaultSort } from "../lib/filter-sort.js";

const FACET_KEYS = ["license", "grade", "source", "usesTools"];

/**
 * React Router's `useSearchParams` keeps the URL query string in sync with
 * state. We mirror the full catalog filter state into the URL so links are
 * deep-shareable — same behaviour the legacy UI got from
 * `history.replaceState` + `URLSearchParams`.
 *
 * Returns a stable state object + helpers. Each setter updates the URL
 * (which triggers a re-render through useSearchParams).
 */
export function useCatalogState() {
  const [params, setParams] = useSearchParams();
  // Debounce tokens for search input are owned by the page; this hook
  // only reflects URL state so bookmarking works on any rendered snapshot.

  // Track raw search input separately from the URL so typing feels snappy
  // and we don't thrash the history on every keystroke. The page commits
  // via setSearchQuery() after a short debounce.
  const [searchDraft, setSearchDraft] = useState(() => params.get("q") || "");

  const state = useMemo(() => {
    const searchQuery = params.get("q") || "";
    const facets = emptyFacetState();
    facets.license = csvToSet(params.get("license"));
    facets.grade = csvToSet(params.get("grade"));
    facets.source = csvToSet(params.get("source"));
    facets.usesTools = csvToSet(params.get("tools"));
    // Backwards-compat: migrate old `?verified=1` into source facet.
    if (params.get("verified") === "1") facets.source.add("verified");
    return {
      searchQuery,
      activeCategories: csvToSet(params.get("cat")),
      activeRepo: params.get("repo") || "all",
      activeFacets: facets,
      sort: params.get("sort") || defaultSort(searchQuery),
      page: parseInt(params.get("page"), 10) || 1,
    };
  }, [params]);

  const update = useCallback(
    (patcher) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const incoming =
            typeof patcher === "function" ? patcher(next) : patcher;
          if (incoming && incoming !== next) {
            // patcher returned a replacement
            return incoming;
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setSearchQuery = useCallback(
    (q) => {
      update((next) => {
        if (q) next.set("q", q);
        else next.delete("q");
        // When search toggles on, reset sort to relevance (matches legacy).
        if (q && !next.get("sort")) next.set("sort", "relevance");
        else if (!q && next.get("sort") === "relevance") next.delete("sort");
        next.delete("page");
      });
    },
    [update],
  );

  const setActiveCategories = useCallback(
    (cats) => {
      update((next) => {
        if (cats.size > 0) next.set("cat", setToCsv(cats));
        else next.delete("cat");
        next.delete("page");
      });
    },
    [update],
  );

  const setActiveRepo = useCallback(
    (repo) => {
      update((next) => {
        if (repo && repo !== "all") next.set("repo", repo);
        else next.delete("repo");
        next.delete("page");
      });
    },
    [update],
  );

  const setFacet = useCallback(
    (key, values) => {
      if (!FACET_KEYS.includes(key)) return;
      const paramKey = key === "usesTools" ? "tools" : key;
      update((next) => {
        if (values.size > 0) next.set(paramKey, setToCsv(values));
        else next.delete(paramKey);
        next.delete("page");
      });
    },
    [update],
  );

  const setSort = useCallback(
    (sort) => {
      update((next) => {
        const q = next.get("q") || "";
        const def = defaultSort(q);
        if (sort && sort !== def) next.set("sort", sort);
        else next.delete("sort");
        next.delete("page");
      });
    },
    [update],
  );

  const setPage = useCallback(
    (page) => {
      update((next) => {
        if (page && page > 1) next.set("page", String(page));
        else next.delete("page");
      });
    },
    [update],
  );

  const clearAll = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
    setSearchDraft("");
  }, [setParams]);

  return {
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
  };
}
