/**
 * Category SEO helpers — static category pages, sitemap + llms.txt tokens.
 *
 * Pure, zero-dependency module imported by `scripts/build-catalog.ts`.
 * Asserted by `tests/e2e/build-verification.test.ts`.
 *
 * Single source of truth for category labels/descriptions. The website
 * runtime mirror (`website-src/src/lib/category-seo.js`, labels/URLs only)
 * must stay in sync — curated descriptions live here alone.
 */

export const SITE_BASE = "https://luongnv.com/asm";

export interface CategoryMeta {
  label: string;
  description: string;
}

/** Display labels + indexable intro copy per category slug. */
export const CATEGORY_META: Record<string, CategoryMeta> = {
  "ai-agents": {
    label: "AI Agents",
    description: "Skills for building and managing AI agents",
  },
  backend: {
    label: "Backend",
    description: "Server-side development skills",
  },
  coding: {
    label: "Coding",
    description: "General coding assistance and utilities",
  },
  design: {
    label: "Design",
    description: "UI/UX design and frontend styling",
  },
  devops: {
    label: "DevOps",
    description: "CI/CD, deployment, and infrastructure",
  },
  finance: {
    label: "Finance",
    description: "Financial tools and analysis",
  },
  frontend: {
    label: "Frontend",
    description: "Client-side web development",
  },
  git: {
    label: "Git",
    description: "Version control and repository management",
  },
  marketing: {
    label: "Marketing",
    description: "Content creation and SEO",
  },
  mobile: {
    label: "Mobile",
    description: "iOS and Android development",
  },
  productivity: {
    label: "Productivity",
    description: "Workflow automation and efficiency",
  },
  research: {
    label: "Research",
    description: "Information gathering and analysis",
  },
  security: {
    label: "Security",
    description: "Security auditing and hardening",
  },
  testing: {
    label: "Testing",
    description: "Test automation and QA",
  },
  writing: {
    label: "Writing",
    description: "Documentation and content writing",
  },
  general: {
    label: "General",
    description: "Miscellaneous utility skills",
  },
};

/** Label/description for a slug, with a title-case fallback for new categories. */
export function categoryMeta(slug: string): CategoryMeta {
  const known = CATEGORY_META[slug];
  if (known) return known;
  const label = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    label,
    description: `Open-source agent skills for ${label.toLowerCase()}`,
  };
}

/** Canonical URL of a static category page. */
export function categoryPageUrl(slug: string): string {
  return `${SITE_BASE}/categories/${slug}.html`;
}

/** SPA URL with the category pre-filtered (for "open in catalog" links). */
export function categoryAppUrl(slug: string): string {
  return `${SITE_BASE}/#/skills?cat=${encodeURIComponent(slug)}`;
}

export function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON-LD stringify: escape `<` so `</script>` can never break out of the block. */
export function jsonLd(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export interface CategoryPageSkill {
  id: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  overallScore?: number;
  grade?: string;
}

export interface CategoryPageInput {
  slug: string;
  skills: CategoryPageSkill[];
  totalRepos: number;
  lastmod: string;
}

/**
 * Full static HTML for one category page: unique title/description/H1,
 * self-canonical, and CollectionPage + ItemList + BreadcrumbList JSON-LD.
 * The visible list and the ItemList markup describe the same skills.
 */
export function renderCategoryPage(input: CategoryPageInput): string {
  const { label, description } = categoryMeta(input.slug);
  const url = categoryPageUrl(input.slug);
  const count = input.skills.length;
  const title = `${label} Skills (${count}) — asm skill catalog`;
  const metaDesc =
    `${description}. Browse ${count} free, open-source ${label} ` +
    `skills for AI coding agents — install any of them with a single command.`;

  const items = input.skills
    .map((s) => {
      const skillUrl = `${SITE_BASE}/#/skills/${encodeURIComponent(s.id)}`;
      const score =
        s.overallScore !== undefined
          ? ` · score ${escapeHtml(String(s.overallScore ?? ""))}/100 (grade ${escapeHtml(s.grade ?? "")})`
          : "";
      return (
        `      <li><a href="${skillUrl}">${escapeHtml(s.name)}</a>\n` +
        `        <span>${escapeHtml(s.owner)}/${escapeHtml(s.repo)}${score}</span><br>\n` +
        `        ${escapeHtml(s.description)}</li>`
      );
    })
    .join("\n");

  const listItems = input.skills
    .map(
      (s, i) => `      {
        "@type": "ListItem",
        "position": ${i + 1},
        "name": ${jsonLd(s.name)},
        "url": "${SITE_BASE}/#/skills/${encodeURIComponent(s.id)}"
      }`,
    )
    .join(",\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(metaDesc)}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(metaDesc)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${SITE_BASE}/assets/og-image.png" />
    <meta property="og:image:alt" content="agent-skill-manager (asm) — one tool to manage every AI agent's skills" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(metaDesc)}" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": "${url}",
        "url": "${url}",
        "name": ${jsonLd(`${label} Skills — asm skill catalog`)},
        "description": ${jsonLd(metaDesc)},
        "isPartOf": { "@id": "${SITE_BASE}/#webapp" },
        "mainEntity": {
          "@type": "ItemList",
          "numberOfItems": ${count},
          "itemListElement": [
${listItems}
          ]
        }
      }
    </script>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "${SITE_BASE}/" },
          { "@type": "ListItem", "position": 2, "name": "Skills", "item": "${SITE_BASE}/#/skills" },
          { "@type": "ListItem", "position": 3, "name": ${jsonLd(label)}, "item": "${url}" }
        ]
      }
    </script>
  </head>
  <body>
    <main style="max-width: 860px; margin: 0 auto; padding: 2rem 1.25rem; font-family: system-ui, sans-serif; line-height: 1.6;">
      <nav aria-label="Breadcrumb"><a href="${SITE_BASE}/">Home</a> / <a href="${SITE_BASE}/#/skills">Skills</a> / ${escapeHtml(label)}</nav>
      <h1>${escapeHtml(label)} Skills</h1>
      <p>${escapeHtml(description)}. This page lists all ${count} ${escapeHtml(label)} skills indexed from ${input.totalRepos} repositories (updated ${escapeHtml(input.lastmod)}). Every skill is free and open source — open one for the install command, or <a href="${categoryAppUrl(input.slug)}">filter the interactive catalog to ${escapeHtml(label)}</a>.</p>
      <ol>
${items}
      </ol>
    </main>
  </body>
</html>
`;
}

/** Sitemap `<url>` blocks for every category — no hash fragments. */
export function renderSitemapCategoryUrls(
  slugs: string[],
  lastmod: string,
): string {
  return slugs
    .map(
      (slug) =>
        `  <url>\n` +
        `    <loc>${categoryPageUrl(slug)}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.9</priority>\n` +
        `  </url>`,
    )
    .join("\n");
}

/** llms.txt category section — every category links to its indexable page. */
export function renderLlmsCategoryLines(slugs: string[]): string {
  return slugs
    .map((slug) => {
      const { label, description } = categoryMeta(slug);
      return `- [${label}](${categoryPageUrl(slug)}): ${description}`;
    })
    .join("\n");
}
