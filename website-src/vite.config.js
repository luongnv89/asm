import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Inject live catalog counts into index.html at build time so the
 * meta/description/OpenGraph/Twitter tags carry numbers AI and search
 * crawlers can read without executing JS. Counts come from the catalog
 * JSON produced by `scripts/build-catalog.ts` (which runs first in
 * `npm run build:website`); for a standalone `build:site` the prior
 * build's copy is used. Placeholders: {{SKILL_COUNT}}, {{REPO_COUNT}},
 * {{CATEGORY_COUNT}}. Fails loud if the catalog is missing or any
 * placeholder survives — a raw `{{SKILL_COUNT}}` must never ship.
 */
function injectCatalogCounts() {
  const catalogPath = resolve(here, "../website/catalog.json");
  return {
    name: "inject-catalog-counts",
    transformIndexHtml(html) {
      let catalog;
      try {
        catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
      } catch (e) {
        throw new Error(
          `inject-catalog-counts: cannot read ${catalogPath}. ` +
            `Run \`npm run build:website\` (which builds the catalog first), ` +
            `or \`tsx scripts/build-catalog.ts\` before \`build:site\`. (${e.message})`,
        );
      }
      const replacements = {
        "{{SKILL_COUNT}}": String(catalog.totalSkills),
        "{{REPO_COUNT}}": String(catalog.totalRepos),
        "{{CATEGORY_COUNT}}": String((catalog.categories ?? []).length),
      };
      let out = html;
      for (const [token, value] of Object.entries(replacements)) {
        out = out.split(token).join(value);
      }
      const leftover = out.match(/\{\{[A-Z_]+\}\}/);
      if (leftover) {
        throw new Error(
          `inject-catalog-counts: unresolved placeholder ${leftover[0]} in index.html. ` +
            `Add it to the replacements map in vite.config.js.`,
        );
      }
      return out;
    },
  };
}

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
  plugins: [react(), injectCatalogCounts()],
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
  },
  server: {
    port: 5173,
  },
}));
