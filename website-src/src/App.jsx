import { useCallback, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import BundleBuilderDialog from "./components/BundleBuilderDialog.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import CatalogPage from "./pages/CatalogPage.jsx";
import BundlesPage from "./pages/BundlesPage.jsx";
import DocsPage from "./pages/DocsPage.jsx";
import ChangelogPage from "./pages/ChangelogPage.jsx";
import { CatalogProvider } from "./hooks/useCatalog.jsx";
import { BundleCartProvider } from "./hooks/useBundleCart.jsx";

/**
 * Root application shell.
 *
 * HashRouter is used because the site deploys to a subpath (`/asm/` on
 * GitHub Pages) and the legacy UI already used hash navigation — switching
 * to HashRouter preserves external deep links and avoids the need for
 * server-side rewrites.
 *
 * Routing: `/` renders the marketing `LandingPage`; the catalog now
 * lives at `/skills` and `/skills/:id` (both render `CatalogPage`) —
 * the catalog is always a two-pane layout, and the `:id` in the URL
 * simply selects which skill shows in the detail pane. Same pattern
 * for `/bundles` and `/bundles/:name`.
 *
 * Legacy deep links: the catalog used to live at `/`, so older shared
 * URLs carry filter query params on the root (e.g. `#/?q=code-review`).
 * `LegacyCatalogRedirect` forwards any root visit that carries those
 * params to `/skills`, preserving the query string so the filters still
 * apply. `/skills/:id` links were already that shape and keep working.
 *
 * Bundle builder (#238): dialog state lives at the app shell so the
 * header cart button (any route) can open it. The `BundleCartProvider`
 * wraps everything so skill-level cart state is shared across pages.
 */
export default function App() {
  const [bundleBuilderOpen, setBundleBuilderOpen] = useState(false);
  // Stable references so the dialog's mount effect (which listens on
  // `onClose` in its dep array) doesn't re-fire on every App render and
  // yank focus away from the form the user is typing into.
  const openBuilder = useCallback(() => setBundleBuilderOpen(true), []);
  const closeBuilder = useCallback(() => setBundleBuilderOpen(false), []);
  return (
    <CatalogProvider>
      <BundleCartProvider>
        <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
          <Header onOpenBundleBuilder={openBuilder} />
          <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6">
            <Routes>
              <Route path="/" element={<LegacyCatalogRedirect />} />
              <Route path="/skills" element={<CatalogPage />} />
              <Route path="/skills/:id" element={<CatalogPage />} />
              <Route path="/bundles" element={<BundlesPage />} />
              <Route path="/bundles/:name" element={<BundlesPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
          <BundleBuilderDialog
            open={bundleBuilderOpen}
            onClose={closeBuilder}
          />
        </div>
      </BundleCartProvider>
    </CatalogProvider>
  );
}

/**
 * Root route. The catalog used to live here, so a root visit that still
 * carries any catalog filter param (search `?q=`, category `?cat=`, repo
 * `?repo=`, the facet params `?license=`/`?grade=`/`?source=`/`?tools=`,
 * the legacy `?verified=`, `?sort=`, or `?page=`) is an old shared link —
 * forward it to `/skills` with the query string intact. A bare root visit
 * shows the new landing page. Keep this list in sync with the params read
 * by `useCatalogState`.
 */
const CATALOG_PARAMS = [
  "q",
  "cat",
  "repo",
  "license",
  "grade",
  "source",
  "tools",
  "verified",
  "sort",
  "page",
];

function LegacyCatalogRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const isLegacyCatalogLink = CATALOG_PARAMS.some((k) => params.has(k));
  if (isLegacyCatalogLink) {
    return (
      <Navigate to={{ pathname: "/skills", search: location.search }} replace />
    );
  }
  return <LandingPage />;
}
