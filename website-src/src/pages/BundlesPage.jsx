import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import BundleCard from "../components/BundleCard.jsx";
import BundleDetail from "../components/BundleDetail.jsx";
import { Input } from "../components/ui/input.jsx";
import { Button } from "../components/ui/button.jsx";

/**
 * Bundles storefront. `/bundles` renders a searchable grid of curated
 * bundle cards ("collections" in shop terms); `/bundles/:name` renders
 * the bundle's product page with a breadcrumb back to the grid.
 *
 * Data contract: reads `bundles.json` identically to the legacy
 * `renderBundlesPage()`. No new fields are required.
 */
export default function BundlesPage() {
  const { name: encodedName } = useParams();
  const decodedName = useMemo(
    () => (encodedName ? globalThis.decodeURIComponent(encodedName) : null),
    [encodedName],
  );
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [state, setState] = useState({
    loading: true,
    error: null,
    bundles: [],
  });

  // Sync search query to URL params so it survives page refresh
  const [query, setQuery] = useState(() => searchParams.get("q") || "");

  const updateQuery = useCallback(
    (next) => {
      setQuery(next);
      if (next) {
        setSearchParams({ q: next });
      } else {
        setSearchParams({}, { replace: true });
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("bundles.json");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          bundles: data.bundles || [],
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          bundles: [],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.bundles;
    return state.bundles.filter((b) => {
      if (b.name?.toLowerCase().includes(q)) return true;
      if (b.description?.toLowerCase().includes(q)) return true;
      const tags = b.tags || [];
      for (const t of tags)
        if (String(t).toLowerCase().includes(q)) return true;
      return false;
    });
  }, [state.bundles, query]);

  const selected = useMemo(() => {
    if (!decodedName) return null;
    return state.bundles.find((b) => b.name === decodedName) || null;
  }, [state.bundles, decodedName]);

  const totalSkills = useMemo(
    () => state.bundles.reduce((n, b) => n + (b.skills || []).length, 0),
    [state.bundles],
  );

  if (state.error) {
    return (
      <div className="shop">
        <h1 className="shop-title">Bundles</h1>
        <p className="text-sm text-[var(--warn)] mt-3">
          ⚠ Could not load bundles: {state.error}
        </p>
      </div>
    );
  }

  if (state.loading) {
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
              className="h-56 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] animate-pulse"
            />
          ))}
          <span className="sr-only">Loading bundles…</span>
        </div>
      </div>
    );
  }

  /* ── Product page ─────────────────────────────────────────────── */
  if (decodedName) {
    const backTo = { pathname: "/bundles", search: location.search };
    return (
      <div className="shop flex flex-col gap-8">
        <nav className="shop-crumb" aria-label="Breadcrumb">
          <Link to={backTo}>Bundles</Link>
          <span aria-hidden="true">/</span>
          <span className="text-[var(--fg)]" aria-current="page">
            {decodedName}
          </span>
          <Link to={backTo} className="ml-auto inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to bundles
          </Link>
        </nav>
        {selected ? (
          <BundleDetail key={selected.name} bundle={selected} />
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
            <h1 className="shop-title !text-[32px]">Bundle not found</h1>
            <p className="text-sm text-[var(--fg-dim)] max-w-md">
              No bundle named &quot;{decodedName}&quot; exists.
            </p>
          </div>
        )}
      </div>
    );
  }

  /* ── Shop floor ───────────────────────────────────────────────── */
  return (
    <div className="shop flex flex-col gap-6">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-6">
        <div className="shop-kicker">
          <span className="dot" aria-hidden="true" />
          Pre-defined bundles · {state.bundles.length} sets ·{" "}
          {totalSkills.toLocaleString()} skills
        </div>
        <h1 className="shop-title">Bundles</h1>
        <p className="shop-lede">
          Curated sets of skills that install together with one command. Open a
          bundle to see what is inside, or add all of its skills to your cart
          and mix them with your own picks.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fg-muted)]"
          />
          <Input
            type="search"
            value={query}
            placeholder="Search bundles…"
            onChange={(e) => updateQuery(e.target.value)}
            aria-label="Search bundles"
            className="h-10 pl-10 pr-10"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              onClick={() => updateQuery("")}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <p className="shop-meta" aria-live="polite">
          {query
            ? `${filtered.length} of ${state.bundles.length} bundles`
            : `${state.bundles.length} bundles`}
        </p>
      </div>

      <section className="flex flex-col gap-4" aria-label="Bundle results">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-6 py-16 text-center">
            <p className="text-sm text-[var(--fg-dim)]">
              No bundles match your search.
            </p>
            <p className="shop-meta">Try a shorter or different word.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((b, i) => (
              <BundleCard
                key={b.name}
                bundle={b}
                index={i}
                locationSearch={location.search}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
