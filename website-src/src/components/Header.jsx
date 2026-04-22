import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";

function applyTheme(next) {
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("asm-theme", next);
}

/**
 * Top navigation bar. Port of the legacy `<header class="site-header">`
 * limited to the surfaces in scope for #229 (Skills + Bundles). Docs,
 * Registry, Best Practices, Changelog, and Thanks pages are out of
 * scope for this refactor (tracked separately) and intentionally
 * omitted from the React shell.
 */
export default function Header() {
  const [theme, setTheme] = useState(() =>
    typeof document === "undefined"
      ? "dark"
      : document.documentElement.getAttribute("data-theme") || "dark",
  );

  useEffect(() => {
    // Guard against environments that don't implement matchMedia (older
    // test runners, server-side pre-render). The OS-preference sync is
    // a nice-to-have, not a correctness requirement.
    const mq =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    if (!mq) return;
    const handler = (e) => {
      if (localStorage.getItem("asm-theme")) return;
      const next = e.matches ? "dark" : "light";
      applyTheme(next);
      setTheme(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const linkClass = ({ isActive }) =>
    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
    (isActive
      ? "bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] text-[var(--brand)]"
      : "text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)]");

  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg-card)]">
      <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-[var(--fg)] text-lg"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="w-5 h-5"
            style={{ color: "var(--brand)" }}
            aria-hidden="true"
          >
            <rect
              x="1"
              y="1"
              width="14"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M5 8l2 2 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>asm</span>
          <span className="text-[var(--fg-muted)] font-normal">catalog</span>
        </Link>
        <nav className="flex items-center gap-1 ml-4">
          <NavLink to="/" end className={linkClass}>
            Skills
          </NavLink>
          <NavLink to="/bundles" className={linkClass}>
            Bundles
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle light/dark theme"
            aria-pressed={theme === "light"}
            className="px-2 py-1.5 rounded-md text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.002 8.002 0 1010.586 10.586z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.22 1.78a1 1 0 011.41 0l.71.71a1 1 0 11-1.41 1.41l-.71-.71a1 1 0 010-1.41zM18 9a1 1 0 110 2h-1a1 1 0 110-2h1zM3 9a1 1 0 110 2H2a1 1 0 110-2h1zm13.93 5.51a1 1 0 01-.02 1.41l-.71.71a1 1 0 11-1.41-1.41l.71-.71a1 1 0 011.43-.01zM4.78 14.51a1 1 0 010 1.41l-.71.71a1 1 0 11-1.41-1.41l.71-.71a1 1 0 011.41 0zM10 16a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm0-12a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            )}
          </button>
          <a
            className="text-[var(--fg-dim)] hover:text-[var(--fg)] text-sm px-2 py-1.5"
            href="https://github.com/luongnv89/agent-skill-manager"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
