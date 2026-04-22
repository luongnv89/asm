import { useMemo, useState } from "react";

const MAX_VISIBLE_CATS = 6;

/**
 * Multi-select category tabs, port of the legacy `#category-tabs` row.
 * - "All" toggles when the set is empty.
 * - Clicking a tab toggles it in/out of the active set.
 * - Up to `MAX_VISIBLE_CATS` are shown by default; the rest collapse
 *   behind a "+N more" toggle unless an active category lives in the
 *   overflow (then everything is shown).
 */
export default function CategoryTabs({
  categories = [],
  activeCategories,
  totalSkills,
  skills = [],
  onChange,
}) {
  const counts = useMemo(() => {
    const out = {};
    for (const s of skills)
      for (const c of s.categories || []) out[c] = (out[c] || 0) + 1;
    return out;
  }, [skills]);

  const activeInOverflow = useMemo(() => {
    for (const c of activeCategories) {
      const idx = categories.indexOf(c);
      if (idx >= MAX_VISIBLE_CATS) return true;
    }
    return false;
  }, [activeCategories, categories]);

  const [expanded, setExpanded] = useState(false);
  const showAll = expanded || activeInOverflow;

  const toggle = (cat) => {
    const next = new Set(activeCategories);
    if (cat === "all") {
      next.clear();
    } else if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    onChange(next);
  };

  return (
    <div
      className="flex flex-wrap gap-1.5 items-center"
      role="group"
      aria-label="Categories"
    >
      <CatButton
        active={activeCategories.size === 0}
        onClick={() => toggle("all")}
      >
        All <Count>{totalSkills}</Count>
      </CatButton>
      {categories.map((cat, i) => {
        if (!showAll && i >= MAX_VISIBLE_CATS) return null;
        const on = activeCategories.has(cat);
        return (
          <CatButton key={cat} active={on} onClick={() => toggle(cat)}>
            {cat} <Count>{counts[cat] || 0}</Count>
          </CatButton>
        );
      })}
      {categories.length > MAX_VISIBLE_CATS && !activeInOverflow && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="px-3 py-1 text-xs rounded-full border border-dashed border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)] transition-colors"
          aria-expanded={expanded}
        >
          {expanded
            ? "show less"
            : `+${categories.length - MAX_VISIBLE_CATS} more`}
        </button>
      )}
    </div>
  );
}

function CatButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-3 py-1 text-xs rounded-full border transition-colors " +
        (active
          ? "border-[var(--brand)] text-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_12%,transparent)]"
          : "border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]")
      }
    >
      {children}
    </button>
  );
}

function Count({ children }) {
  return (
    <span className="ml-1 text-[10px] text-[var(--fg-muted)] font-normal">
      {children}
    </span>
  );
}
