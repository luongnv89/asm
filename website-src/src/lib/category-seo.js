/**
 * Category SEO runtime helpers.
 *
 * Labels/URLs-only mirror of `scripts/category-seo.ts` (the build-time
 * single source of truth, which also owns the curated descriptions).
 * Keep the slug→label map in sync with `CATEGORY_META` there.
 */

export const SITE_BASE = "https://luongnv.com/asm";

export const CATEGORY_LABELS = {
  "ai-agents": "AI Agents",
  backend: "Backend",
  coding: "Coding",
  design: "Design",
  devops: "DevOps",
  finance: "Finance",
  frontend: "Frontend",
  git: "Git",
  marketing: "Marketing",
  mobile: "Mobile",
  productivity: "Productivity",
  research: "Research",
  security: "Security",
  testing: "Testing",
  writing: "Writing",
  general: "General",
};

export function categoryLabel(slug) {
  const known = CATEGORY_LABELS[slug];
  if (known) return known;
  return String(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Canonical URL of the indexable static page for a category. */
export function categoryPageUrl(slug) {
  return `${SITE_BASE}/categories/${slug}.html`;
}
