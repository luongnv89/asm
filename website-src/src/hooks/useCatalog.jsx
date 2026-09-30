import { createContext, useContext, useEffect, useState } from "react";
import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";

const CatalogContext = createContext({
  loading: true,
  error: null,
  catalog: null,
  miniSearch: null,
  searchError: null,
});

/**
 * Load the slim catalog + prebuilt search index in parallel, hydrate
 * MiniSearch, and publish them via context. Per-skill detail files are
 * lazily fetched by the detail view — we only fetch the ~5 MB shared
 * payload once here.
 *
 * The legacy UI's safety guard against build skew (`catalog.generatedAt`
 * vs `idxMeta.generatedAt`) is preserved — a mismatched pairing would
 * silently map every hit to the wrong row because hit.id is an array
 * index into catalog.skills.
 */
export function CatalogProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    catalog: null,
    miniSearch: null,
    searchError: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [skillsRes, idxRes] = await Promise.all([
          fetch("skills.min.json"),
          fetch("search.idx.json"),
        ]);
        if (!skillsRes.ok)
          throw new Error("skills.min.json HTTP " + skillsRes.status);
        if (!idxRes.ok)
          throw new Error("search.idx.json HTTP " + idxRes.status);
        const [catalog, idxText] = await Promise.all([
          skillsRes.json(),
          idxRes.text(),
        ]);
        const parsedIndex = JSON.parse(idxText);
        if (
          catalog.generatedAt &&
          parsedIndex.generatedAt &&
          catalog.generatedAt !== parsedIndex.generatedAt
        ) {
          throw new Error(
            "Catalog and search index are from different builds. Clear your browser cache and reload the page.",
          );
        }
        let miniSearch;
        try {
          miniSearch = MiniSearch.loadJS(parsedIndex, MINISEARCH_OPTIONS);
        } catch {
          // Catalog loaded but MiniSearch failed to initialize
          // (e.g. corrupted index). Show catalog without search.
          if (cancelled) return;
          setState({
            loading: false,
            error: null,
            catalog,
            miniSearch: null,
            searchError:
              "Search index failed to load. The catalog is still available without search.",
          });
          return;
        }
        if (cancelled) return;
        setState({ loading: false, error: null, catalog, miniSearch });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          catalog: null,
          miniSearch: null,
          searchError: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog() {
  return useContext(CatalogContext);
}
