import { useMemo, useState } from "react";

const MAX_VISIBLE_TAGS = 20;

/** Searchable, keyboard-accessible AND-filter for catalog skill tags. */
export default function TagFilter({ counts, activeTags, onChange }) {
  const [query, setQuery] = useState("");

  const tags = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const ordered = Object.entries(counts || {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const matching = normalizedQuery
      ? ordered.filter(([tag]) => tag.includes(normalizedQuery))
      : ordered;
    const active = ordered.filter(([tag]) => activeTags.has(tag));
    const inactive = matching.filter(([tag]) => !activeTags.has(tag));
    return [...active, ...inactive].slice(0, MAX_VISIBLE_TAGS);
  }, [activeTags, counts, query]);

  if (Object.keys(counts || {}).length === 0) return null;

  return (
    <div
      className="flex flex-col gap-1.5 border border-[var(--border)] rounded-md px-2 py-1.5"
      role="group"
      aria-label="Filter by tags"
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="catalog-tag-filter"
          className="text-xs font-medium text-[var(--fg-dim)]"
        >
          Tags
          {activeTags.size > 0 && (
            <span className="ml-1.5 text-[10px] text-[var(--brand)]">
              {activeTags.size} selected
            </span>
          )}
        </label>
        <input
          id="catalog-tag-filter"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find tags…"
          className="w-28 px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--fg)] text-[11px]"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {tags.map(([tag, count]) => {
          const selected = activeTags.has(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                const next = new Set(activeTags);
                if (selected) next.delete(tag);
                else next.add(tag);
                onChange(next);
              }}
              className={
                "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition-colors " +
                (selected
                  ? "border-[var(--brand)] text-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_12%,transparent)]"
                  : "border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]")
              }
            >
              {tag}
              <span
                aria-hidden="true"
                className="text-[10px] text-[var(--fg-muted)]"
              >
                {count}
              </span>
            </button>
          );
        })}
        {tags.length === 0 && (
          <span className="text-[11px] text-[var(--fg-muted)]">
            No matching tags
          </span>
        )}
      </div>
      <span className="sr-only">Selected tags use AND matching.</span>
    </div>
  );
}
