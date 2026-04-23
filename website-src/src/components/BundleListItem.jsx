import { memo } from "react";
import { Link } from "react-router-dom";
import { Badge } from "./ui/badge.jsx";
import { cn } from "../lib/cn.js";

/**
 * Compact sidebar row for a bundle. Click navigates to
 * `/bundles/:name`, preserving `location.search` so any list-level
 * query (reserved for future filters) survives. `active` flips the
 * selected visual.
 */
function BundleListItem({ bundle, active, locationSearch }) {
  const skillCount = (bundle.skills || []).length;
  const tags = bundle.tags || [];
  return (
    <Link
      to={{
        pathname: `/bundles/${encodeURIComponent(bundle.name)}`,
        search: locationSearch,
      }}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative block rounded-md border px-3 py-2 transition-colors",
        active
          ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]"
          : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--brand)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--brand)]"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-sm font-semibold break-words",
            active ? "text-[var(--brand)]" : "text-[var(--fg)]",
          )}
        >
          {bundle.name}
        </span>
        <span className="text-[10px] text-[var(--fg-muted)] whitespace-nowrap shrink-0">
          {skillCount} skill{skillCount === 1 ? "" : "s"}
        </span>
      </div>
      {bundle.description && (
        <p className="mt-1 text-xs text-[var(--fg-dim)] line-clamp-2 leading-snug">
          {bundle.description}
        </p>
      )}
      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {tags.slice(0, 3).map((t) => (
            <Badge key={t} tone="cat">
              {t}
            </Badge>
          ))}
          {tags.length > 3 && <Badge tone="default">+{tags.length - 3}</Badge>}
        </div>
      )}
    </Link>
  );
}

export default memo(BundleListItem);
