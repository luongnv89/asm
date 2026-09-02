import { Check, ShoppingCart } from "lucide-react";
import { useBundleCart } from "../hooks/useBundleCart.jsx";
import { cn } from "../lib/cn.js";

/**
 * Toggle button that adds/removes a skill from the cart.
 *
 * Three sizes for the three places it appears:
 *   - `card`  — full-width small button in a product card footer.
 *   - `row`   — compact pill for skill rows inside a bundle page.
 *   - default — the large primary CTA in a product page buy box.
 *
 * Inside a product card the whole card is a stretched link, so the
 * handler stops propagation and prevents default to avoid navigating.
 */
export default function AddToCartButton({ skill, variant = "default" }) {
  const { add, remove, has } = useBundleCart();
  if (!skill || !skill.id || !skill.installUrl) return null;
  const inCart = has(skill.id);

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (inCart) remove(skill.id);
    else add(skill);
  };

  const ariaLabel = inCart
    ? `Remove ${skill.name} from cart`
    : `Add ${skill.name} to cart`;

  const filled =
    "bg-[var(--brand)] text-[var(--bg)] hover:bg-[var(--brand-dim)] border border-[var(--brand)]";
  const outline =
    "border border-[var(--border)] bg-transparent text-[var(--fg)] hover:border-[var(--brand)] hover:text-[var(--brand)]";

  const sizing =
    variant === "card"
      ? "h-8 w-full px-3 text-xs rounded-md"
      : variant === "row"
        ? "h-8 px-3 text-xs rounded-md"
        : "h-11 w-full px-4 text-sm rounded-lg";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      aria-pressed={inCart}
      title={inCart ? "In cart — click to remove" : "Add to cart"}
      className={cn(
        "shop-above inline-flex items-center justify-center gap-1.5 font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
        sizing,
        inCart ? filled : outline,
      )}
    >
      {inCart ? (
        <>
          <Check className="h-4 w-4" aria-hidden="true" />
          In cart
        </>
      ) : (
        <>
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          Add to cart
        </>
      )}
    </button>
  );
}
