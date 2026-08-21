# EPIC: Website Catalog — Bugs, UX & Performance Fixes

**Status:** Open  
**Created:** 2025-01-XX  
**Area:** `website-src/` (static registry site on GitHub Pages)  
**Parent:** Static Registry Website (TODOS.md Item 5)

---

## Summary

The static registry website (`website-src/`) powers the searchable skill catalog at the core of the agent-skill-manager ecosystem. After a thorough code audit, **32 issues** were surfaced across critical bugs, major UX/performance problems, and minor polish items. This epic tracks all fixes in a phased, prioritized order.

---

## Issue Inventory

### 🔴 Critical (3) — Broken at runtime

| # | Issue | File:Line | Category |
|---|-------|-----------|----------|
| C1 | Missing `decodeURIComponent` usage — no import, causes `ReferenceError` on bundle URL navigation | `website-src/src/pages/BundlesPage.jsx:10` | Bug |
| C2 | Import path mismatch — `CopyButton` imported without `.jsx` extension, may fail on strict bundler | `website-src/src/pages/ProfilePage.jsx:3` | Bug |
| C3 | Catalog build mismatch error message is cryptic — doesn't tell user what to do beyond "reload" | `website-src/src/hooks/useCatalog.jsx:47` | UX |

### 🟠 Major (7) — Broken behavior or significant performance

| # | Issue | File:Line | Category |
|---|-------|-----------|----------|
| M1 | StatsPage loading state never resolves if any `.json` fetch fails (`.catch(() => null)` swallows error, `setLoading` only in `.then`) | `website-src/src/pages/StatsPage.jsx:50-54` | Bug |
| M2 | ProfilePage error handling swallows all errors — `catch` sets `loading=false` but doesn't surface error, shows "Loading profile..." forever | `website-src/src/pages/ProfilePage.jsx:42` | Bug |
| M3 | No in-memory cache for per-skill detail fetches — every skill navigation fires a new `fetch()` | `website-src/src/components/SkillDetail.jsx:38` | Performance |
| M4 | `anyFilterActive` doesn't check sort state — "Clear all" button doesn't appear when sort is changed | `website-src/src/lib/filter-sort.js:135` | Bug |
| M5 | `useCatalogState` page param is read but never used — dead pagination code adds URL params with no effect | `website-src/src/hooks/useCatalogState.js:37` | Code Quality |
| M6 | Category tabs recompute counts on every render — O(n) iteration over 7,000+ skills per filter change | `website-src/src/components/CategoryTabs.jsx:18` | Performance |
| M7 | Search pipeline silently degrades if MiniSearch fails to initialize — no user-visible indication | `website-src/src/pages/CatalogPage.jsx:74-87` | UX |

### 🟡 Minor (17) — Polish, accessibility, code quality

| # | Issue | File:Line | Category |
|---|-------|-----------|----------|
| m1 | Empty state uses sparkle emoji — may not render consistently across platforms | `website-src/src/pages/CatalogPage.jsx:216` | Styling |
| m2 | Search box placeholder text inconsistency — default `"Search skills, tags, descriptions…"` vs overridden `"Search skills…"` | `website-src/src/components/SearchBox.jsx:54` | UX |
| m3 | Sort dropdown always shows all 5 options regardless of search state — no visual indication of contextually appropriate sort | `website-src/src/pages/CatalogPage.jsx:201-206` | UX |
| m4 | Facet author list has no truncation — 35+ repos create overflowing pills | `website-src/src/components/FacetRow.jsx:43` | Styling |
| m5 | No keyboard shortcut (e.g., `/` or `Ctrl+K`) to focus the search box | `website-src/src/pages/CatalogPage.jsx:148` | Accessibility |
| m6 | `formatStars` function duplicated in 3 files — `SkillListItem.jsx`, `SkillDetail.jsx`, `Header.jsx` | Multiple | Code Quality |
| m7 | Bundle search query is local state, not synced to URL — refresh loses filter | `website-src/src/pages/BundlesPage.jsx:33` | UX |
| m8 | No skeleton loading for catalog list — just text "Loading skill catalog..." | `website-src/src/pages/CatalogPage.jsx:134` | UX |
| m9 | `Badge` component receives `variant="secondary"` but only accepts `tone` prop — prop silently ignored | `website-src/src/components/ui/badge.jsx:30` + `StatsPage.jsx:175` | Bug |
| m10 | `CategoryPieChart` has hardcoded 10-color array — colors repeat for >10 categories | `website-src/src/components/CategoryPieChart.jsx:8` | UX |
| m11 | `SidebarDrawer` body scroll lock doesn't restore on unmount if `open` is still true | `website-src/src/components/SidebarDrawer.jsx:30` | Bug |
| m12 | Missing `lang` attribute on `<html>` tag | `website-src/index.html` | Accessibility |
| m13 | `SkillListItem` handles `categories` undefined but `computeFacetCounts` has inconsistent fallbacks | `website-src/src/components/SkillListItem.jsx:90` | Code Quality |
| m14 | Search debouncing uses fixed 150ms — could be tuned for 7,000+ skill catalog | `website-src/src/components/SearchBox.jsx:18` | Performance |
| m15 | `highlightMatches` regex compiled per-call — 40 compilations per render with 20 visible rows | `website-src/src/lib/utils.js:114` | Performance |
| m16 | `build-catalog.ts` star fetching has no overall timeout — hangs indefinitely on total API outage | `scripts/build-catalog.ts:245` | Robustness |
| m17 | `minisearch-options.js` comment says "MUST stay in sync" but test only checks structure, not content parity | `website-src/src/__tests__/minisearch-options.test.js:1` | Code Quality |

### ⚪ Architectural / Design (5)

| # | Issue | File:Line | Category |
|---|-------|-----------|----------|
| A1 | No caching strategy for live GitHub star fetch in Header — no local TTL cache | `website-src/src/components/Header.jsx:15` | Performance |
| A2 | No service worker for offline support — 5MB+ assets re-downloaded every visit | All | Feature |
| A3 | CSS custom properties (`--brand`, `--bg`, etc.) not documented | `website-src/src/index.css` | Documentation |
| A4 | `catalog.json` is written by build script but never consumed by React frontend — wasted output | `scripts/build-catalog.ts:311` | Performance |
| A5 | Slug collision detection throws with non-actionable error message | `scripts/build-catalog.ts:333` | Robustness |

---

## Phased Implementation Plan

### Phase 1 — Blockers (fix what's broken)
*These issues cause runtime errors or broken user flows. Fix first.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **C1** — Missing `decodeURIComponent` import in BundlesPage | 5 min | Causes immediate crash on bundle URL navigation |
| 2 | **C2** — Import path mismatch in ProfilePage | 5 min | May fail on strict bundler builds |
| 3 | **M1** — StatsPage loading state never resolves | 10 min | Users see "Loading statistics..." forever |
| 4 | **M2** — ProfilePage error handling swallows errors | 10 min | Users see "Loading profile..." forever |
| 5 | **C3** — Improve catalog build mismatch error message | 5 min | User-facing error text improvement |

**Expected PR:** `fix/phase1-blockers`

---

### Phase 2 — Bug Fixes & Data Integrity
*These are real bugs that affect correctness but don't crash the app.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **M4** — `anyFilterActive` doesn't check sort state | 10 min | "Clear all" button missing when sort is changed |
| 2 | **m9** — `Badge` receives undefined `variant` prop | 5 min | Silent prop mismatch |
| 3 | **m11** — SidebarDrawer scroll lock doesn't restore on unmount | 10 min | Body stays locked after navigation |
| 4 | **M5** — Remove dead pagination code from `useCatalogState` | 15 min | Dead code cleanup, simplifies state |
| 5 | **M7** — Add MiniSearch initialization failure indicator | 15 min | Silent degradation is confusing |

**Expected PR:** `fix/phase2-bugs`

---

### Phase 3 — Performance
*These improve perceived and actual performance.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **M3** — In-memory cache for per-skill detail fetches | 20 min | Eliminates redundant network requests |
| 2 | **M6** — Memoize category tab counts or pre-compute in build | 30 min | O(n) over 7,000 skills on every render |
| 3 | **m15** — Memoize `highlightMatches` regex compilation | 15 min | 40 regex compilations per render |
| 4 | **m14** — Tune search debounce from 150ms → 200ms | 5 min | Reduces re-renders during fast typing |
| 5 | **A1** — Local TTL cache for live GitHub star count | 20 min | Prevents rate-limit exhaustion |

**Expected PR:** `fix/phase3-performance`

---

### Phase 4 — UX Polish
*These improve the user experience but are not blockers.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **m8** — Skeleton loading for catalog list | 30 min | Better perceived performance |
| 2 | **m2** — Standardize search placeholder text | 5 min | Consistency fix |
| 3 | **m3** — Context-aware sort dropdown | 10 min | Better UX when search is active |
| 4 | **m7** — Sync bundle search to URL params | 10 min | Refresh preserves filter |
| 5 | **m4** — Truncate author facet list with "show more" | 15 min | Prevents overflow |
| 6 | **m10** — Extend `CategoryPieChart` color array | 10 min | Prevents color repetition |

**Expected PR:** `fix/phase4-ux-polish`

---

### Phase 5 — Accessibility & Code Quality
*These improve accessibility and maintainability.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **m12** — Add `lang="en"` to `<html>` tag | 2 min | Screen reader & SEO |
| 2 | **m5** — Keyboard shortcut to focus search box (`/` or `Ctrl+K`) | 15 min | Power user accessibility |
| 3 | **m1** — Replace sparkle emoji with SVG icon or text fallback | 5 min | Cross-platform consistency |
| 4 | **m6** — Extract `formatStars` to shared utility | 10 min | DRY, single source of truth |
| 5 | **m13** — Harmonize `categories` undefined handling | 10 min | Consistent null safety |
| 6 | **m17** — Add content-parity test for `minisearch-options.js` | 15 min | Prevents sync drift |

**Expected PR:** `fix/phase5-a11y-quality`

---

### Phase 6 — Architecture & Future Work
*These are larger architectural improvements, tracked but not urgent.*

| Order | Issue | Effort | Rationale |
|-------|-------|--------|-----------|
| 1 | **A3** — Document CSS custom properties | 20 min | Onboard new contributors |
| 2 | **A4** — Remove unused `catalog.json` from build output | 10 min | Reduce wasted output |
| 3 | **A5** — Improve slug collision error message | 10 min | Actionable build errors |
| 4 | **A2** — Service worker for offline support | 2-3 days | Large feature, deferred |

**Tracked separately** — these are architectural decisions that may warrant their own PRs or RFCs.

---

## Summary

| Phase | Issues | Est. Effort | Priority |
|-------|--------|-------------|----------|
| Phase 1 — Blockers | 5 | ~35 min | 🔴 Do now |
| Phase 2 — Bug Fixes | 5 | ~65 min | 🟠 Do next |
| Phase 3 — Performance | 5 | ~100 min | 🟡 When ready |
| Phase 4 — UX Polish | 6 | ~85 min | 🟡 When ready |
| Phase 5 — A11y & Quality | 6 | ~57 min | 🟢 Nice to have |
| Phase 6 — Architecture | 4 | 2-3 days | 📋 Deferred |
| **Total** | **32** | **~3.5 hours** | |

---

## Notes

- All issues were surfaced via code audit of `website-src/`, `scripts/`, and `website/` directories.
- No inline TODO/FIXME comments exist in the codebase — all issues were found through structural analysis.
- The website is auto-deployed to GitHub Pages via `.github/workflows/deploy-website.yml`.
- Each phase should be a separate PR for easier review and rollback.
- After Phase 2 fixes, run `npm run build:website` to verify no regressions before proceeding.
