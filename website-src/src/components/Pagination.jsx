function getPaginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push("...", total);
  } else if (current >= total - 3) {
    pages.push(1, "...");
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1, "...", current - 1, current, current + 1, "...", total);
  }
  return pages;
}

/**
 * Paginator ported 1:1 from the legacy `renderPagination` function.
 * Shown only when there's more than one page.
 */
export default function Pagination({ current, total, onChange }) {
  if (total <= 1) return null;
  const pages = getPaginationRange(current, total);
  const btnCls =
    "min-w-[32px] h-8 px-2 rounded text-xs font-medium border border-[var(--border)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap mt-6">
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
        className={
          btnCls +
          " text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]"
        }
        aria-label="Previous page"
      >
        «
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span
            key={`e-${i}`}
            className="px-2 text-xs text-[var(--fg-muted)] select-none"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === current ? "page" : undefined}
            className={
              btnCls +
              (p === current
                ? " bg-[var(--brand)] text-[var(--bg)] border-[var(--brand)]"
                : " text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]")
            }
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
        className={
          btnCls +
          " text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--brand)]"
        }
        aria-label="Next page"
      >
        »
      </button>
    </div>
  );
}
