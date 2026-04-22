import { createContext, useContext, useEffect, useState } from "react";
import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";

const CatalogContext = createContext({
  loading: true,
  error: null,
  catalog: null,
  miniSearch: null,
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
        const idxMeta = JSON.parse(idxText);
        if (
          catalog.generatedAt &&
          idxMeta.generatedAt &&
          catalog.generatedAt !== idxMeta.generatedAt
        ) {
          throw new Error("catalog build mismatch — reload the page");
        }
        const miniSearch = MiniSearch.loadJSON(idxText, MINISEARCH_OPTIONS);
        if (cancelled) return;
        setState({ loading: false, error: null, catalog, miniSearch });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          catalog: null,
          miniSearch: null,
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
