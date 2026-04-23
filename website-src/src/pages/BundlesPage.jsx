import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Menu, X } from "lucide-react";
import BundleListItem from "../components/BundleListItem.jsx";
import BundleDetail from "../components/BundleDetail.jsx";
import SidebarDrawer from "../components/SidebarDrawer.jsx";
import { Input } from "../components/ui/input.jsx";
import { Button } from "../components/ui/button.jsx";

/**
 * Two-pane bundles view (#228). Sidebar lists bundles (filterable by
 * a simple name/description/tag search); main pane renders the
 * selected bundle's detail.
 *
 * Both `/bundles` and `/bundles/:name` render this component; the
 * presence of `:name` via `useParams` decides whether the empty
 * state or the detail panel is shown.
 *
 * Data contract: reads `bundles.json` identically to the legacy
 * `renderBundlesPage()`. No new fields are required.
 */
export default function BundlesPage() {
  const { name: encodedName } = useParams();
  const decodedName = useMemo(
    () => (encodedName ? decodeURIComponent(encodedName) : null),
    [encodedName],
  );
  const location = useLocation();

  const [state, setState] = useState({
    loading: true,
    error: null,
    bundles: [],
  });
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  if (state.error) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-[var(--fg)] mb-2">
          Pre-defined Bundles
        </h1>
        <p className="text-sm text-[var(--warn)]">
          ⚠ Could not load bundles: {state.error}
        </p>
      </div>
    );
  }

  if (state.loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-[var(--fg)] mb-2">
          Pre-defined Bundles
        </h1>
        <p className="text-sm text-[var(--fg-dim)]">Loading bundles…</p>
      </div>
    );
  }

  const sidebarContent = (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="text-sm font-semibold text-[var(--fg)]">
          Filter bundles
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
      <div>
        <h2 className="text-xs uppercase tracking-wide text-[var(--fg-muted)] mb-1.5">
          Bundles
        </h2>
        <Input
          type="search"
          value={query}
          placeholder="Search bundles…"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search bundles"
          className="h-9"
        />
      </div>
      <div
        className="flex items-center justify-between text-[11px] text-[var(--fg-muted)] px-1"
        aria-live="polite"
      >
        <span>
          {query
            ? `${filtered.length} of ${state.bundles.length} bundles`
            : `${state.bundles.length} bundles`}
        </span>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-1 -mr-1"
        role="list"
        aria-label="Bundle results"
      >
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--fg-dim)]">
            No bundles match your search.
          </p>
        ) : (
          filtered.map((b) => (
            <BundleListItem
              key={b.name}
              bundle={b}
              active={b.name === decodedName}
              locationSearch={location.search}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 lg:gap-6 min-h-[calc(100vh-9rem)]">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDrawerOpen(true)}
          className="gap-1.5"
          aria-label="Open bundle list"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Bundles
          <span className="text-[10px] text-[var(--fg-muted)]">
            ({filtered.length})
          </span>
        </Button>
        {decodedName && (
          <Link
            to={{ pathname: "/bundles", search: location.search }}
            className="text-xs text-[var(--fg-dim)] hover:text-[var(--brand)]"
          >
            ← Clear selection
          </Link>
        )}
      </div>

      <SidebarDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ariaLabel="Bundle list"
      >
        {sidebarContent}
      </SidebarDrawer>

      <section className="flex-1 min-w-0" aria-label="Bundle detail">
        {selected ? (
          <BundleDetail key={selected.name} bundle={selected} />
        ) : decodedName ? (
          <BundlesEmptyState
            title="Bundle not found"
            body={`No bundle named "${decodedName}" exists.`}
          />
        ) : (
          <BundlesEmptyState
            title="Pre-defined Bundles"
            body={
              state.bundles.length > 0
                ? "Pick a bundle from the sidebar to see its included skills and the install command."
                : "No bundles are available."
            }
            hint={
              <p className="text-sm text-[var(--fg-dim)]">
                Install a bundle:{" "}
                <code className="px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--brand)]">
                  asm bundle install &lt;name&gt;
                </code>
              </p>
            }
          />
        )}
      </section>
    </div>
  );
}

function BundlesEmptyState({ title, body, hint }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 gap-3">
      <h1 className="text-2xl sm:text-3xl font-semibold text-[var(--fg)]">
        {title}
      </h1>
      <p className="text-sm text-[var(--fg-dim)] max-w-md">{body}</p>
      {hint}
    </div>
  );
}
