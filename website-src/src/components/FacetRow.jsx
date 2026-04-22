import { useState } from "react";
import { FACET_DEFS } from "../lib/facets.js";

/**
 * Collapsible per-facet pill groups. Port of the legacy `#facet-row`.
 * Groups with at least one active value auto-expand on mount so the
 * applied filter is always visible without an extra click.
 */
export default function FacetRow({ counts, activeFacets, onToggle }) {
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {};
    for (const def of FACET_DEFS) {
      initial[def.key] = activeFacets[def.key].size > 0;
    }
    return initial;
  });

  const flip = (key) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Additional filters"
    >
      {FACET_DEFS.map((def) => {
        const facetCounts = counts[def.key] || {};
        const seen = new Set(
          Object.keys(facetCounts).filter((v) => facetCounts[v] > 0),
        );
        const order = def.order.filter((v) => seen.has(v));
        for (const v of seen) if (!order.includes(v)) order.push(v);
        if (!order.length) return null;

        const activeSet = activeFacets[def.key];
        const activeCount = activeSet.size;
        const expanded = openGroups[def.key];

        return (
          <div
            key={def.key}
            className="flex flex-col gap-1.5 border border-[var(--border)] rounded-md px-2 py-1.5"
          >
            <button
              type="button"
              onClick={() => flip(def.key)}
              aria-expanded={expanded}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-dim)] hover:text-[var(--fg)]"
            >
              {def.label}
              {activeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] bg-[var(--brand)] text-[var(--bg)] font-semibold">
                  {activeCount}
                </span>
              )}
              <span aria-hidden="true" className="text-[10px]">
                {expanded ? "▲" : "▼"}
              </span>
            </button>
            {expanded && (
              <div className="flex flex-wrap gap-1">
                {order.map((v) => {
                  const on = activeSet.has(v);
                  const display = (def.display && def.display[v]) || v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        const next = new Set(activeSet);
                        if (on) next.delete(v);
                        else next.add(v);
                        onToggle(def.key, next);
                      }}
                      aria-pressed={on}
                      className={
                        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition-colors " +
                        (on
                          ? "border-[var(--brand)] text-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_12%,transparent)]"
                          : "border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]")
                      }
                    >
                      {display}
                      <span className="text-[10px] text-[var(--fg-muted)]">
                        {facetCounts[v] || 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
