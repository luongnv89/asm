import { memo } from "react";
import { Link } from "react-router-dom";
import { Layers, ShoppingCart } from "lucide-react";
import { Badge } from "./ui/badge.jsx";
import { useBundleCart } from "../hooks/useBundleCart.jsx";

/**
 * Product card for a curated bundle. Same anatomy as `SkillCard` so the
 * two storefronts feel like one shop: tile, title link (stretched over
 * the card), description, tags, and an "Add all to cart" footer.
 */
function BundleCard({ bundle, index = 0, locationSearch }) {
  const { addMany } = useBundleCart();
  const skills = bundle.skills || [];
  const tags = bundle.tags || [];
  const skillCount = skills.length;

  const handleAddAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
    addMany(skills, bundle.name);
  };

  return (
    <article className="shop-card shop-reveal" style={{ "--i": index }}>
      <div className="shop-tile" data-tone={index % 4}>
        <span className="shop-initial" aria-hidden="true">
          {(bundle.name || "?").charAt(0)}
        </span>
        <span className="shop-sticker" title="Skills in this bundle">
          <Layers className="h-3 w-3 self-center" aria-hidden="true" />
          {skillCount}
          <small>{skillCount === 1 ? "skill" : "skills"}</small>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3">
        <h3 className="shop-name leading-snug">
          <Link
            to={{
              pathname: `/bundles/${encodeURIComponent(bundle.name)}`,
              search: locationSearch,
            }}
            className="shop-link"
          >
            {bundle.name}
          </Link>
        </h3>
        {bundle.author && (
          <div className="shop-meta truncate">by {bundle.author}</div>
        )}
        {bundle.description && (
          <p className="shop-desc line-clamp-3">{bundle.description}</p>
        )}
        {tags.length > 0 && (
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
            {tags.slice(0, 3).map((t) => (
              <Badge key={t} tone="cat">
                {t}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge tone="default">+{tags.length - 3}</Badge>
            )}
          </div>
        )}
      </div>
      <footer className="shop-above border-t border-[var(--border)] px-3.5 py-2.5">
        <button
          type="button"
          onClick={handleAddAll}
          disabled={skillCount === 0}
          aria-label={`Add all ${skillCount} skills from ${bundle.name} to cart`}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-3 text-xs font-medium text-[var(--fg)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
        >
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          Add all to cart
        </button>
      </footer>
    </article>
  );
}

export default memo(BundleCard);
