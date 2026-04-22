import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header.jsx";
import Footer from "./components/Footer.jsx";
import CatalogPage from "./pages/CatalogPage.jsx";
import BundlesPage from "./pages/BundlesPage.jsx";
import SkillDetailPage from "./pages/SkillDetailPage.jsx";
import { CatalogProvider } from "./hooks/useCatalog.jsx";

/**
 * Root application shell.
 *
 * HashRouter is used because the site deploys to a subpath (`/asm/` on
 * GitHub Pages) and the legacy UI already used hash navigation — switching
 * to HashRouter preserves external deep links and avoids the need for
 * server-side rewrites.
 */
export default function App() {
  return (
    <CatalogProvider>
      <div className="min-h-screen flex flex-col bg-[var(--bg)] text-[var(--fg)]">
        <Header />
        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6">
          <Routes>
            <Route path="/" element={<CatalogPage />} />
            <Route path="/bundles" element={<BundlesPage />} />
            <Route path="/skills/:id" element={<SkillDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </CatalogProvider>
  );
}
