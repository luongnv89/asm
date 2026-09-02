import { useCallback, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import CartToast from "./components/CartToast.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import CatalogPage from "./pages/CatalogPage.jsx";
import BundlesPage from "./pages/BundlesPage.jsx";
import DocsPage from "./pages/DocsPage.jsx";
import ChangelogPage from "./pages/ChangelogPage.jsx";
import StatsPage from "./pages/StatsPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
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
 * Routing: `/` renders the marketing `LandingPage`; the catalog lives
 * at `/skills` (storefront grid) and `/skills/:id` (product page), both
 * rendered by `CatalogPage`. Same pattern for `/bundles` and
 * `/bundles/:name`.
 *
 * Legacy deep links: the catalog used to live at `/`, so older shared
 * URLs carry filter query params on the root (e.g. `#/?q=code-review`).
 * `LegacyCatalogRedirect` forwards any root visit that carries those
 * params to `/skills`, preserving the query string so the filters still
 * apply. `/skills/:id` links were already that shape and keep working.
 *
 * Cart (#238): drawer state lives at the app shell so the header cart
 * button and the "added to cart" toast (any route) can open it. The
 * `BundleCartProvider` wraps everything so cart state is shared.
 */
export default function App() {
  const [cartOpen, setCartOpen] = useState(false);
  // Stable references so the drawer's mount effect (which listens on
  // `onClose` in its dep array) doesn't re-fire on every App render and
  // yank focus away from the form the user is typing into.
  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  return (
    <CatalogProvider>
      <BundleCartProvider>
        <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
          <Header onOpenBundleBuilder={openCart} />
          <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6">
            <Routes>
              <Route path="/" element={<LegacyCatalogRedirect />} />
              <Route path="/skills" element={<CatalogPage />} />
              <Route path="/skills/:id" element={<CatalogPage />} />
              <Route path="/bundles" element={<BundlesPage />} />
              <Route path="/bundles/:name" element={<BundlesPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/changelog" element={<ChangelogPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/profile/:owner" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
          <CartDrawer open={cartOpen} onClose={closeCart} />
          {!cartOpen && <CartToast onOpenCart={openCart} />}
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
