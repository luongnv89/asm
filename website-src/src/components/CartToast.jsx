import { useEffect } from "react";
import { ShoppingCart } from "lucide-react";
import { useBundleCart } from "../hooks/useBundleCart.jsx";

const AUTO_HIDE_MS = 3200;

/**
 * "Added to cart" confirmation. Sits bottom-right, offers a one-click
 * "View cart", and hides itself after a few seconds. `role="status"`
 * makes it a polite live region for screen readers.
 */
export default function CartToast({ onOpenCart }) {
  const { notice, dismissNotice } = useBundleCart();

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(dismissNotice, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);

  if (!notice) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shop shop-toast fixed bottom-4 right-4 z-40 max-w-[min(92vw,360px)] flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 shadow-2xl"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--brand)] text-[var(--brand)]"
        aria-hidden="true"
      >
        <ShoppingCart className="h-4 w-4" />
      </span>
      <p className="shop-mono min-w-0 flex-1 text-xs text-[var(--fg)] break-words">
        {notice.text}
      </p>
      <button
        type="button"
        onClick={() => {
          dismissNotice();
          onOpenCart?.();
        }}
        className="shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg-dim)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
      >
        View cart
      </button>
    </div>
  );
}
