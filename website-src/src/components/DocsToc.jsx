import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "../lib/cn.js";

/**
 * In-page nav for /docs. HashRouter owns the URL hash (`#/docs`), so
 * fragment links like `#getting-started` would leave the docs route.
 * Section targets live on `?s=` instead.
 */
export const DOC_NAV = [
  { id: "getting-started", label: "Getting Started" },
  { id: "cli-reference", label: "CLI Reference" },
  { id: "discovery", label: "Discovery" },
  { id: "install-github", label: "Install from GitHub" },
  { id: "install-local", label: "Install from files" },
  { id: "library", label: "Local library" },
  { id: "skill-md", label: "SKILL.md" },
  { id: "tools", label: "Agent tools" },
  { id: "config", label: "Configuration" },
  { id: "creating", label: "Creating skills" },
  { id: "eval", label: "Evaluating" },
  { id: "updating", label: "Updating" },
  { id: "backup", label: "Backup & restore" },
  { id: "bundles", label: "Bundles" },
  { id: "index", label: "Skill index" },
  { id: "audit", label: "Auditing" },
  { id: "uninstall", label: "Uninstalling" },
  { id: "disable", label: "Disabling" },
  { id: "stats", label: "Stats" },
  { id: "doctor", label: "Doctor" },
  { id: "registry", label: "Registry" },
  { id: "tui", label: "TUI shortcuts" },
];

function scrollToSection(id, { smooth } = { smooth: true }) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({
    behavior: smooth ? "smooth" : "auto",
    block: "start",
  });
}

export default function DocsToc() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [deepLink] = useState(() => searchParams.get("s"));
  const [activeId, setActiveId] = useState(() =>
    DOC_NAV.some((item) => item.id === deepLink) ? deepLink : DOC_NAV[0].id,
  );

  useEffect(() => {
    if (deepLink && DOC_NAV.some((item) => item.id === deepLink)) {
      scrollToSection(deepLink, { smooth: false });
    }
  }, [deepLink]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;

    const nodes = DOC_NAV.map((item) =>
      document.getElementById(item.id),
    ).filter(Boolean);
    if (nodes.length === 0) return undefined;

    const visible = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target.id, entry.isIntersecting);
        }
        const firstVisible = DOC_NAV.find((item) => visible.get(item.id));
        if (firstVisible) setActiveId(firstVisible.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 0.25] },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const goTo = (id) => {
    setActiveId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("s", id);
        return next;
      },
      { replace: true },
    );
    scrollToSection(id, { smooth: true });
  };

  return (
    <>
      <nav
        aria-label="On this page"
        className="lg:hidden sticky top-0 z-20 -mx-4 sm:-mx-6 mb-4 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur"
      >
        <div className="flex gap-1 overflow-x-auto px-4 sm:px-6 py-2">
          {DOC_NAV.map((item) => (
            <TocButton
              key={item.id}
              item={item}
              active={item.id === activeId}
              onClick={() => goTo(item.id)}
              compact
            />
          ))}
        </div>
      </nav>

      <nav
        aria-label="On this page"
        className="hidden lg:block w-52 xl:w-56 shrink-0"
      >
        <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)] mb-2 px-2">
            On this page
          </p>
          <ul className="flex flex-col gap-0.5 border-l border-[var(--border)]">
            {DOC_NAV.map((item) => (
              <li key={item.id}>
                <TocButton
                  item={item}
                  active={item.id === activeId}
                  onClick={() => goTo(item.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}

function TocButton({ item, active, onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "text-left text-xs transition-colors",
        compact
          ? "shrink-0 rounded-full border px-2.5 py-1 whitespace-nowrap"
          : "block w-full rounded-r-md px-2.5 py-1 -ml-px border-l-2",
        active
          ? compact
            ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] text-[var(--brand)]"
            : "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)] font-medium"
          : compact
            ? "border-[var(--border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--fg-muted)]"
            : "border-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {item.label}
    </button>
  );
}
