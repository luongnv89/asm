import { useEffect } from "react";
import { cn } from "../lib/cn.js";

/**
 * Responsive sidebar container.
 *
 * - On wide viewports (lg+): the sidebar is a sticky left column,
 *   always visible, ignoring `open`.
 * - On narrow viewports (<lg): the sidebar collapses to an
 *   off-canvas drawer that slides in from the left when `open` is
 *   true, with a scrim that closes on click.
 *
 * Built with plain Tailwind + a small amount of local state from
 * the parent page — avoids pulling in `@radix-ui/react-dialog` for
 * a single drawer surface.
 *
 * Props:
 *   - open: boolean — whether the mobile drawer is visible
 *   - onClose: () => void — close handler for the scrim/Esc
 *   - children: the sidebar content (search, filters, list)
 *   - ariaLabel: accessible label for the drawer on mobile
 */
export default function SidebarDrawer({
  open,
  onClose,
  children,
  ariaLabel = "Sidebar",
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    // Prevent body scroll while the drawer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <>
      {/* Mobile scrim — only renders when open */}
      {open && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}
      <aside
        aria-label={ariaLabel}
        className={cn(
          // Mobile: off-canvas drawer
          "fixed inset-y-0 left-0 z-50 w-[min(88vw,360px)] overflow-y-auto",
          "bg-[var(--bg)] border-r border-[var(--border)] shadow-xl",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static column, no transform, part of flex layout
          "lg:static lg:translate-x-0 lg:z-auto lg:shadow-none",
          "lg:w-[340px] xl:w-[380px] lg:shrink-0",
          "lg:border-r lg:bg-transparent",
          "lg:max-h-[calc(100vh-var(--header-offset,5rem))]",
        )}
      >
        <div className="p-3 lg:p-0 lg:pr-4 h-full">{children}</div>
      </aside>
    </>
  );
}
