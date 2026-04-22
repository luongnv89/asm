import { useEffect, useState } from "react";
import CopyButton from "../components/CopyButton.jsx";
import { Card } from "../components/ui/card.jsx";
import { Badge } from "../components/ui/badge.jsx";

/**
 * Bundles view. Fetches `bundles.json` once on mount and renders the
 * curated skill collections — same data contract as the legacy
 * `renderBundlesPage()` function.
 */
export default function BundlesPage() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    bundles: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("bundles.json");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (cancelled) return;
        setState({ loading: false, error: null, bundles: data.bundles || [] });
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

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--fg)]">
          Pre-defined Bundles
        </h1>
        <p className="text-sm text-[var(--fg-dim)] mt-1">
          Curated skill collections for common workflows and domains. Install an
          entire bundle with a single command to get started fast.
        </p>
        <p className="text-sm text-[var(--fg-dim)] mt-1">
          Install a bundle:{" "}
          <code className="px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--brand)]">
            asm bundle install &lt;name&gt;
          </code>
        </p>
      </header>
      {state.bundles.length === 0 ? (
        <p className="text-sm text-[var(--fg-dim)]">No bundles found.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.bundles.map((b) => (
            <BundleCard key={b.name} bundle={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BundleCard({ bundle }) {
  const skills = bundle.skills || [];
  const tags = bundle.tags || [];
  const installCmd = "asm bundle install " + (bundle.name || "");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--fg)]">
          {bundle.name}
        </h2>
        <p className="text-xs text-[var(--fg-dim)] mt-1 leading-relaxed">
          {bundle.description}
        </p>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <Badge key={t} tone="cat">
              {t}
            </Badge>
          ))}
        </div>
      )}
      <div>
        <div className="text-xs font-medium text-[var(--fg-dim)] mb-1">
          {skills.length} skill{skills.length === 1 ? "" : "s"} included
        </div>
        <ul className="flex flex-col gap-1">
          {skills.map((sk) => (
            <li
              key={sk.name}
              className="text-xs flex flex-col gap-0.5 p-1.5 rounded bg-[var(--bg-input)] border border-[var(--border)]"
            >
              <span className="font-mono text-[var(--fg)]">{sk.name}</span>
              <span className="text-[var(--fg-dim)]">{sk.description}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        <code className="flex-1 truncate text-[11px] text-[var(--fg-dim)] font-mono">
          {installCmd}
        </code>
        <CopyButton text={installCmd} size="sm" />
      </div>
      <div className="text-[10px] text-[var(--fg-muted)] flex gap-2">
        <span>■ {skills.length} skills</span>
        {bundle.author && <span>by {bundle.author}</span>}
      </div>
    </Card>
  );
}
