import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Shop-style pagination: Prev · 1 … 4 [5] 6 … 42 · Next.
 * Always shows the first and last page, plus a window around the
 * current page. Renders nothing for a single page.
 */
export default function Pagination({ page, pageCount, onChange }) {
  if (!pageCount || pageCount <= 1) return null;

  const items = buildWindow(page, pageCount);

  return (
    <nav className="shop-pages" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {items.map((it, i) =>
        it === "gap" ? (
          <span key={`gap-${i}`} className="gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={it === page ? "page" : undefined}
            aria-label={`Page ${it}`}
          >
            {it}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

export function buildWindow(page, pageCount) {
  const pages = new Set([1, pageCount]);
  for (let p = page - 1; p <= page + 1; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("gap");
    out.push(sorted[i]);
  }
  return out;
}
