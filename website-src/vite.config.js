import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the React site (issue #229).
 *
 * - `base: "./"` — emit relative asset URLs so the built bundle works
 *   under any subpath (GitHub Pages serves at /asm/, local file:// also
 *   works). All references (`<script src="./assets/...">`, catalog
 *   `fetch("skills.min.json")`) are resolved relative to the HTML page.
 * - `build.outDir` is the legacy `website/` tree — the React bundle
 *   shares its directory with the data JSONs produced by
 *   `scripts/build-catalog.ts`, so relative fetches Just Work.
 * - `emptyOutDir: false` — CRITICAL. The data JSONs
 *   (`catalog.json`, `skills.min.json`, `search.idx.json`,
 *   `bundles.json`, `skills/*.json`) live in `website/`; wiping it
 *   would delete them. We only overwrite what Vite produces.
 */
export default defineConfig(({ command }) => ({
  root: here,
  base: "./",
  plugins: [react()],
  // Dev server serves the built catalog JSONs (catalog.json, skills.min.json,
  // search.idx.json, bundles.json, skills/*.json) from the sibling `website/`
  // directory so `npm run dev:site` works after a one-time `npm run
  // build:website`. For production builds we disable `publicDir` entirely —
  // outDir already IS `website/`, and a publicDir copy would try to
  // re-overwrite the catalog JSONs (and every single `skills/*.json`) on
  // every Vite build.
  publicDir: command === "serve" ? resolve(here, "../website") : false,
  build: {
    outDir: resolve(here, "../website"),
    emptyOutDir: false,
    sourcemap: false,
    assetsDir: "assets",
    rollupOptions: {
      // Use `app.html` as the Vite entry so its build output is
      // `website/app.html` — this coexists with the legacy
      // `website/index.html` during the transition. A later commit
      // renames `app.html` to `index.html` once the React app reaches
      // feature parity.
      input: resolve(here, "app.html"),
    },
  },
  server: {
    port: 5173,
    open: "/app.html",
  },
}));
