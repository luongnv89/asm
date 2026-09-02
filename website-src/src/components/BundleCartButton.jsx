import { ShoppingCart } from "lucide-react";
import { useBundleCart } from "../hooks/useBundleCart.jsx";

/**
 * Header cart button: shows the number of skills in the cart and opens
 * the cart drawer on click. Rendered in `Header.jsx` so it stays visible
 * on every route.
 */
export default function BundleCartButton({ onOpen }) {
  const { items } = useBundleCart();
  const count = items.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={
        count === 0
          ? "Open cart"
          : `Open cart (${count} ${count === 1 ? "skill" : "skills"})`
      }
      className="relative flex items-center gap-1.5 text-[var(--fg-dim)] hover:text-[var(--brand)] hover:border-[var(--brand)] text-sm px-2.5 py-1 border border-[var(--border)] rounded-md transition-colors"
      title="Cart"
    >
      <ShoppingCart className="w-4 h-4" aria-hidden="true" />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--brand)] text-[var(--bg)] font-mono text-[10px] font-semibold"
          data-testid="bundle-cart-count"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}
