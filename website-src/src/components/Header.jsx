import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useCatalog } from "../hooks/useCatalog.jsx";

function applyTheme(next) {
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("asm-theme", next);
}

/**
 * Top navigation bar. Skills + Bundles route internally; Docs and
 * Changelog link out to the repo README and CHANGELOG since those
 * pages don't have React equivalents yet. Version + star count come
 * from the loaded catalog.
 */
const REPO_URL = "https://github.com/luongnv89/asm";

function formatStars(n) {
  if (typeof n !== "number" || n <= 0) return null;
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export default function Header() {
  const { catalog } = useCatalog();
  const version = catalog?.version;
  const stars = formatStars(catalog?.stars);
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
          <img
            src="./assets/logo-mark.svg"
            alt=""
            aria-hidden="true"
            className="w-7 h-7"
          />
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
          <NavLink to="/docs" className={linkClass}>
            Docs
          </NavLink>
          <NavLink to="/changelog" className={linkClass}>
            Changelog
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {version && (
            <span
              className="hidden sm:inline-block font-mono text-[11px] text-[var(--fg-muted)] px-2 py-0.5 border border-[var(--border)] rounded-md"
              title="asm version"
            >
              v{version}
            </span>
          )}
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
            className="flex items-center gap-1.5 text-[var(--fg-dim)] hover:text-[var(--brand)] hover:border-[var(--brand)] text-sm px-2.5 py-1 border border-[var(--border)] rounded-md transition-colors"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {stars && (
              <span className="font-mono text-[11px] text-[var(--brand)]">
                ★ {stars}
              </span>
            )}
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}
