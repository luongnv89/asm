#!/usr/bin/env node
/**
 * Build script for the ASM Skill Catalog website.
 * Merges all data/skill-index/*.json files into a single website/catalog.json,
 * auto-categorizes skills by keyword matching, and copies static assets.
 *
 * Zero external dependencies — runs under Node 18+.
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "./minisearch-options";
import {
  repoBundlesForIndex,
  type RepoBundleManifest,
} from "../src/repo-bundles";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexDir = join(root, "data", "skill-index");
const resourcesPath = join(root, "data", "skill-index-resources.json");
const outDir = join(root, "website");
const assetsOutDir = join(outDir, "assets");
const skillsDetailDir = join(outDir, "skills");

// ─── Category Taxonomy ───────────────────────────────────────────────────────

const CATEGORIES: Record<string, string[]> = {
  "ai-agents": [
    "agent",
    "llm",
    "claude",
    "gpt",
    "prompt",
    "openai",
    "anthropic",
    "model",
    "skill-creator",
    "mcp",
    "orchestrat",
  ],
  security: [
    "security",
    "auth",
    "oauth",
    "jwt",
    "ssl",
    "vulnerab",
    "audit",
    "pentest",
    "owasp",
    "encrypt",
    "threat",
    "cso",
  ],
  devops: [
    "docker",
    "kubernetes",
    "ci/cd",
    "ci-cd",
    "deploy",
    "pipeline",
    "terraform",
    "ansible",
    "github action",
    "pre-commit",
    "devops",
  ],
  frontend: [
    "ui",
    "ux",
    "css",
    "html",
    "react",
    "vue",
    "svelte",
    "frontend",
    "component",
    "layout",
    "landing page",
    "web artifact",
    "design system",
  ],
  design: [
    "design",
    "visual",
    "algorithmic art",
    "generative art",
    "canvas",
    "color",
    "logo",
    "brand",
    "theme",
    "figma",
    "typography",
    "illustration",
  ],
  backend: [
    "api",
    "rest",
    "graphql",
    "database",
    "sql",
    "postgres",
    "redis",
    "server",
    "backend",
    "microservice",
  ],
  testing: [
    "test",
    "spec",
    "e2e",
    "unit test",
    "coverage",
    "mock",
    "qa",
    "benchmark",
    "playwright",
  ],
  coding: [
    "code review",
    "refactor",
    "debug",
    "lint",
    "typescript",
    "python",
    "javascript",
    "rust",
    "golang",
    "build",
    "cli",
    "optimizer",
  ],
  writing: [
    "write",
    "blog",
    "article",
    "documentation",
    "docs",
    "draft",
    "content",
    "copy",
    "proposal",
    "readme",
    "changelog",
  ],
  mobile: [
    "ios",
    "android",
    "mobile",
    "xcode",
    "swift",
    "kotlin",
    "flutter",
    "app store",
    "testflight",
    "asc",
  ],
  finance: [
    "finance",
    "trading",
    "stock",
    "crypto",
    "payment",
    "billing",
    "fintech",
    "invest",
    "revenue",
  ],
  marketing: [
    "seo",
    "aso",
    "marketing",
    "analytics",
    "growth",
    "conversion",
    "affiliate",
    "campaign",
    "social media",
    "reddit",
    "twitter",
  ],
  git: ["git", "commit", "branch", "pull request", "pr review", "merge"],
  productivity: [
    "workflow",
    "automation",
    "task",
    "schedule",
    "pdf",
    "xlsx",
    "docx",
    "pptx",
    "spreadsheet",
    "presentation",
  ],
  research: [
    "research",
    "scholar",
    "paper",
    "academic",
    "peer review",
    "investigation",
  ],
};

// Keywords shorter than 4 chars use word-boundary matching to avoid false positives
function matchesKeyword(text: string, kw: string): boolean {
  if (kw.length <= 3) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(text);
  }
  return text.includes(kw);
}

function categorizeSkill(name: string, description: string): string[] {
  const text = `${name ?? ""} ${description ?? ""}`.toLowerCase();
  const matched: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    for (const kw of keywords) {
      if (matchesKeyword(text, kw)) {
        matched.push(category);
        break;
      }
    }
  }

  return matched.length > 0 ? matched : ["general"];
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface SkillEvalSummary {
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  categories: Array<{ id: string; name: string; score: number; max: number }>;
  evaluatedAt: string;
  evaluatedVersion?: string;
}

interface IndexedSkill {
  name: string;
  description: string;
  version: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  installUrl: string;
  relPath: string;
  verified?: boolean;
  featured?: boolean;
  tokenCount?: number;
  evalSummary?: SkillEvalSummary;
}

interface RepoIndex {
  repoUrl: string;
  owner: string;
  repo: string;
  updatedAt: string;
  skillCount: number;
  skills: IndexedSkill[];
  bundles?: RepoBundleManifest[];
}

interface CatalogSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  installUrl: string;
  skillUrl: string;
  owner: string;
  repo: string;
  categories: string[];
  verified: boolean;
  /**
   * Pin-to-top flag for featured skills. Sort modes in the website respect
   * this by placing featured skills before everything else, regardless of
   * the active sort (name, grade, tokens, relevance).
   */
  featured?: boolean;
  /**
   * Estimated token count for SKILL.md content (`words + spaces`).
   * Surfaced in the website card and modal so users can gauge context cost.
   */
  tokenCount?: number;
  /**
   * Slim eval summary captured at index time. Surfaced in the modal.
   */
  evalSummary?: SkillEvalSummary;
}

interface CatalogRepo {
  owner: string;
  repo: string;
  repoUrl: string;
  description: string;
  maintainer: string;
  skillCount: number;
  /** GitHub star count (best-effort, 0 on failure). */
  stars?: number;
}

interface Catalog {
  generatedAt: string;
  version: string;
  totalSkills: number;
  totalRepos: number;
  stars: number;
  categories: string[];
  repos: CatalogRepo[];
  skills: CatalogSkill[];
}

// ─── Build ───────────────────────────────────────────────────────────────────

// Load repo metadata from resources file
const resourcesMap = new Map<
  string,
  { description: string; maintainer: string }
>();
if (existsSync(resourcesPath)) {
  const resources = JSON.parse(readFileSync(resourcesPath, "utf-8"));
  for (const r of resources.repos) {
    resourcesMap.set(`${r.owner}/${r.repo}`, {
      description: r.description,
      maintainer: r.maintainer,
    });
  }
}

// Read all index files
const files = readdirSync(indexDir).filter((f) => f.endsWith(".json"));
const repos: CatalogRepo[] = [];
const repoDerivedBundles: Bundle[] = [];
const skillMap = new Map<string, CatalogSkill>();
const categorySet = new Set<string>();

for (const file of files) {
  const filePath = join(indexDir, file);
  let repoIndex: RepoIndex;
  try {
    repoIndex = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.warn(`Skipping ${file}: invalid JSON — ${e}`);
    continue;
  }

  if (!repoIndex.skills || repoIndex.skills.length === 0) continue;

  const key = `${repoIndex.owner}/${repoIndex.repo}`;
  const meta = resourcesMap.get(key);

  repos.push({
    owner: repoIndex.owner,
    repo: repoIndex.repo,
    repoUrl: repoIndex.repoUrl,
    description: meta?.description || "",
    maintainer: meta?.maintainer || "",
    skillCount: repoIndex.skills.length,
  });

  repoDerivedBundles.push(
    ...repoBundlesForIndex(repoIndex as any).map((bundle) => ({
      ...bundle,
      tags: bundle.tags || [],
      skills: bundle.skills.map((skill) => ({
        name: skill.name,
        installUrl: skill.installUrl,
        description: skill.description || "",
      })),
    })),
  );

  for (const skill of repoIndex.skills) {
    // Include relPath so plugin-bundle repos that ship the same skill name at
    // multiple install paths (each with a distinct installUrl) are preserved
    // as separate targets instead of collapsed into the first occurrence.
    const id = `${repoIndex.owner}/${repoIndex.repo}::${skill.relPath}::${skill.name}`;
    if (skillMap.has(id)) {
      console.warn(`Duplicate skill id: ${id} — skipping`);
      continue;
    }

    const categories = categorizeSkill(skill.name, skill.description);
    for (const c of categories) categorySet.add(c);

    // Build SKILL.md URL from installUrl (format: github:owner/repo:relPath)
    const relPath = skill.installUrl.split(":").slice(2).join(":") || "";
    const skillUrl = relPath
      ? `https://github.com/${repoIndex.owner}/${repoIndex.repo}/blob/main/${relPath}/SKILL.md`
      : `https://github.com/${repoIndex.owner}/${repoIndex.repo}/blob/main/SKILL.md`;

    skillMap.set(id, {
      id,
      name: skill.name,
      description: skill.description ?? "",
      version: skill.version,
      license: skill.license,
      creator: skill.creator,
      compatibility: skill.compatibility,
      allowedTools: skill.allowedTools || [],
      installUrl: skill.installUrl,
      skillUrl,
      owner: repoIndex.owner,
      repo: repoIndex.repo,
      categories,
      verified: skill.verified === true,
      featured: skill.featured === true ? true : undefined,
      tokenCount:
        typeof skill.tokenCount === "number" ? skill.tokenCount : undefined,
      evalSummary: skill.evalSummary,
    });
  }
}

const skills = Array.from(skillMap.values());

// Recompute skillCount per repo from the actual deduplicated skill entries so
// that repos with true duplicates report the correct count (pre-dedup input
// count is stale once any entry is skipped by the duplicate guard above).
const actualSkillCountByRepo = new Map<string, number>();
for (const skill of skills) {
  const key = `${skill.owner}/${skill.repo}`;
  actualSkillCountByRepo.set(key, (actualSkillCountByRepo.get(key) ?? 0) + 1);
}
for (const r of repos) {
  const key = `${r.owner}/${r.repo}`;
  r.skillCount = actualSkillCountByRepo.get(key) ?? 0;
}

// Sort skills alphabetically by name
skills.sort((a, b) => a.name.localeCompare(b.name));

// Sort categories alphabetically, but put "general" last
const categories = Array.from(categorySet).sort((a, b) => {
  if (a === "general") return 1;
  if (b === "general") return -1;
  return a.localeCompare(b);
});

// ─── Fetch GitHub star counts for every unique repo ──────────────────────────
// Parallel fetch (best-effort) so the catalog shows how popular each source
// repo is — a trust signal on the catalog page.

async function fetchStars(owner: string, repo: string): Promise<number> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
      });
      if (res.status === 403 || res.status === 429) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
        continue;
      }
      if (!res.ok) return 0;
      const data = (await res.json()) as { stargazers_count?: number };
      return data.stargazers_count ?? 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// Collect unique (owner, repo) pairs
const uniqueRepos = new Map<string, { owner: string; repo: string }>();
for (const r of repos) {
  const key = r.owner + "/" + r.repo;
  if (!uniqueRepos.has(key))
    uniqueRepos.set(key, { owner: r.owner, repo: r.repo });
}

// Fetch stars with bounded concurrency (best-effort, keeps well under rate
// limits); map back by key
const starsByRepo = new Map<string, number>();
const repoEntries = Array.from(uniqueRepos.values());
const STAR_FETCH_CONCURRENCY = 8;
for (let i = 0; i < repoEntries.length; i += STAR_FETCH_CONCURRENCY) {
  const batch = repoEntries.slice(i, i + STAR_FETCH_CONCURRENCY);
  await Promise.all(
    batch.map(async (r) => {
      const stars = await fetchStars(r.owner, r.repo);
      starsByRepo.set(r.owner + "/" + r.repo, stars);
    }),
  );
}

// Attach star counts to the CatalogRepo entries and compute the ASM repo stars
let asmStars = 0;
for (const r of repos) {
  const key = r.owner + "/" + r.repo;
  r.stars = starsByRepo.get(key) ?? 0;
  if (r.owner === "luongnv89" && r.repo === "asm") asmStars = r.stars;
}

// Fetch GitHub star count (best-effort, defaults to 0 on failure)
let stars = asmStars;

// Read version from package.json
const pkgJsonPath = join(root, "package.json");
const pkgVersion =
  JSON.parse(readFileSync(pkgJsonPath, "utf-8")).version || "0.0.0";

const catalog: Catalog = {
  generatedAt: new Date().toISOString(),
  version: pkgVersion,
  totalSkills: skills.length,
  totalRepos: repos.length,
  stars,
  categories,
  repos: repos.sort((a, b) => b.skillCount - a.skillCount),
  skills,
};

// ─── Output ──────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
mkdirSync(assetsOutDir, { recursive: true });

writeFileSync(join(outDir, "catalog.json"), JSON.stringify(catalog), "utf-8");

// ─── Split artifacts (issue #214) ────────────────────────────────────────────
// Emit three browser-facing artifacts so visitors download only what they need:
//
//   1. website/skills.min.json   — compact list (cards, filters, sorts)
//   2. website/search.idx.json   — MiniSearch index serialized with toJSON
//   3. website/skills/<slug>.json — one per skill, fetched on demand
//
// catalog.json stays the authoritative internal source (upstream tooling and
// tests still consume it); the split artifacts are derived deterministically.

// Filesystem-safe slug for each skill. IDs contain `/` and `::` so we hash
// them; 16 hex chars (64 bits) collision-free for 6.7K skills (~2.5e-9
// probability). The slug is embedded in every slim row so the frontend
// never has to recompute it. Defence-in-depth: track seen slugs and throw
// on collision so a silently-overwritten detail file can't ship.
const seenSlugs = new Map<string, string>();
function slugForId(id: string): string {
  const slug = createHash("sha1").update(id).digest("hex").slice(0, 16);
  const prior = seenSlugs.get(slug);
  if (prior !== undefined && prior !== id) {
    throw new Error(
      `Slug collision: SHA1(${id}) and SHA1(${prior}) both truncate to ${slug}. ` +
        `Widen slice in slugForId or disambiguate inputs.`,
    );
  }
  seenSlugs.set(slug, id);
  return slug;
}

interface SkillsMinRow {
  /** Original catalog id — kept so deep-linking and card `data-id` still work. */
  id: string;
  /** Relative path the browser fetches to hydrate the detail view. */
  detailPath: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  categories: string[];
  installUrl: string;
  license: string;
  version: string;
  verified: boolean;
  featured?: boolean;
  /** Derived flag — avoids shipping the full allowedTools array on the list. */
  hasTools: boolean;
  tokenCount?: number;
  /** Slimmed eval summary — only what the card badge needs. */
  evalSummary?: { overallScore: number; grade: "A" | "B" | "C" | "D" | "F" };
  /** GitHub star count for the source repo (0 when unknown). */
  stars?: number;
}

interface SkillsMin {
  generatedAt: string;
  version: string;
  totalSkills: number;
  totalRepos: number;
  stars: number;
  categories: string[];
  repos: CatalogRepo[];
  skills: SkillsMinRow[];
}

// Build the slim rows in the same order as catalog.skills so the frontend can
// rely on deterministic ordering when the backing index drops out of sync.
const slimSkills: SkillsMinRow[] = skills.map((s) => {
  const slug = slugForId(s.id);
  const repoKey = s.owner + "/" + s.repo;
  const row: SkillsMinRow = {
    id: s.id,
    detailPath: `skills/${slug}.json`,
    name: s.name,
    description: s.description,
    owner: s.owner,
    repo: s.repo,
    categories: s.categories,
    installUrl: s.installUrl,
    license: s.license,
    version: s.version,
    verified: s.verified,
    hasTools: Array.isArray(s.allowedTools) && s.allowedTools.length > 0,
  };
  if (s.featured === true) row.featured = true;
  if (typeof s.tokenCount === "number") row.tokenCount = s.tokenCount;
  if (s.evalSummary) {
    row.evalSummary = {
      overallScore: s.evalSummary.overallScore,
      grade: s.evalSummary.grade,
    };
  }
  const repoStars = starsByRepo.get(repoKey);
  if (typeof repoStars === "number" && repoStars > 0) row.stars = repoStars;
  return row;
});

const skillsMin: SkillsMin = {
  generatedAt: catalog.generatedAt,
  version: catalog.version,
  totalSkills: catalog.totalSkills,
  totalRepos: catalog.totalRepos,
  stars: catalog.stars,
  categories: catalog.categories,
  repos: catalog.repos,
  skills: slimSkills,
};

writeFileSync(
  join(outDir, "skills.min.json"),
  JSON.stringify(skillsMin),
  "utf-8",
);

// MiniSearch options live in ./minisearch-options.ts so the build-verification
// test can import them and compare against the frontend's inline copy — see
// that file's doc comment for why we split it out.
//
// `id` is the row's position in skills.min.json.skills so the frontend can
// look the row up by array index instead of re-storing the full string ID
// twice in the serialized index — saves ~1.5 MB on search.idx.json.
const miniSearch = new MiniSearch(MINISEARCH_OPTIONS);
miniSearch.addAll(
  skills.map((s, i) => ({
    id: i,
    name: s.name,
    description: s.description,
    categoriesStr: (s.categories || []).join(" "),
  })),
);

// Embed generatedAt so the frontend can detect when skills.min.json and
// search.idx.json come from different builds (CDN/cache skew would otherwise
// silently map every hit to the wrong slim row). loadJS ignores unknown keys.
const miniSearchSerialized = {
  ...miniSearch.toJSON(),
  generatedAt: catalog.generatedAt,
};
writeFileSync(
  join(outDir, "search.idx.json"),
  JSON.stringify(miniSearchSerialized),
  "utf-8",
);

// Per-skill detail files. Clear the directory first so slugs that no longer
// correspond to a live skill don't linger across rebuilds.
if (existsSync(skillsDetailDir)) {
  rmSync(skillsDetailDir, { recursive: true, force: true });
}
mkdirSync(skillsDetailDir, { recursive: true });

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  installUrl: string;
  skillUrl: string;
  owner: string;
  repo: string;
  categories: string[];
  verified: boolean;
  featured?: boolean;
  tokenCount?: number;
  evalSummary?: SkillEvalSummary;
  /** GitHub star count for the source repo (0 when unknown). */
  stars?: number;
}

let detailFilesWritten = 0;
for (const s of skills) {
  const slug = slugForId(s.id);
  const detail: SkillDetail = {
    id: s.id,
    name: s.name,
    description: s.description,
    version: s.version,
    license: s.license,
    creator: s.creator,
    compatibility: s.compatibility,
    allowedTools: s.allowedTools,
    installUrl: s.installUrl,
    skillUrl: s.skillUrl,
    owner: s.owner,
    repo: s.repo,
    categories: s.categories,
    verified: s.verified,
  };
  if (s.featured === true) detail.featured = true;
  if (typeof s.tokenCount === "number") detail.tokenCount = s.tokenCount;
  if (s.evalSummary) detail.evalSummary = s.evalSummary;
  const repoStars = starsByRepo.get(s.owner + "/" + s.repo);
  if (typeof repoStars === "number" && repoStars > 0) detail.stars = repoStars;
  writeFileSync(
    join(skillsDetailDir, `${slug}.json`),
    JSON.stringify(detail),
    "utf-8",
  );
  detailFilesWritten++;
}

// ─── Bundles ─────────────────────────────────────────────────────────────────

interface BundleSkill {
  id?: string;
  name: string;
  installUrl: string;
  description: string;
}

interface Bundle {
  version: number;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  tags: string[];
  skills: BundleSkill[];
}

interface BundlesData {
  generatedAt: string;
  totalBundles: number;
  bundles: Bundle[];
}

const bundlesDir = join(root, "data", "bundles");
const bundleFiles = existsSync(bundlesDir)
  ? readdirSync(bundlesDir).filter((f) => f.endsWith(".json"))
  : [];

const bundles: Bundle[] = [...repoDerivedBundles];
for (const file of bundleFiles.sort()) {
  const filePath = join(bundlesDir, file);
  try {
    const bundle: Bundle = JSON.parse(readFileSync(filePath, "utf-8"));
    bundles.push(bundle);
  } catch (e) {
    console.warn(`Skipping bundle ${file}: invalid JSON — ${e}`);
  }
}

const bundleMap = new Map<string, Bundle>();
for (const bundle of bundles) {
  if (!bundleMap.has(bundle.name)) bundleMap.set(bundle.name, bundle);
}
const skillIdByInstallUrl = new Map(
  skills.map((skill) => [skill.installUrl, skill.id]),
);
const uniqueBundles = Array.from(bundleMap.values())
  .map((bundle) => ({
    ...bundle,
    skills: bundle.skills.map((skill) => {
      const id = skillIdByInstallUrl.get(skill.installUrl);
      return id ? { ...skill, id } : skill;
    }),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const bundlesData: BundlesData = {
  generatedAt: new Date().toISOString(),
  totalBundles: uniqueBundles.length,
  bundles: uniqueBundles,
};

writeFileSync(
  join(outDir, "bundles.json"),
  JSON.stringify(bundlesData),
  "utf-8",
);

// Copy logo assets
const faviconSrc = join(root, "assets", "logo", "favicon.svg");
if (existsSync(faviconSrc)) {
  copyFileSync(faviconSrc, join(assetsOutDir, "favicon.svg"));
}
const logoMarkSrc = join(root, "assets", "logo", "logo-mark.svg");
if (existsSync(logoMarkSrc)) {
  copyFileSync(logoMarkSrc, join(assetsOutDir, "logo-mark.svg"));
}
// OG image for social cards. Shipped as a pre-rendered PNG (not the SVG
// template) because social unfurlers — Twitter/X, Facebook, LinkedIn, Slack,
// Discord — do not render SVG og:images. The PNG carries rounded catalog
// counts (e.g. "3,800+") which stay truthful as the catalog grows (monotonic,
// with a trailing "+"), and platforms cache OG images anyway, so a per-build
// "live" number would be frozen on first share regardless. Plain copy: the PNG
// has no tokens, so it is not part of the renderSeoTemplate token pipeline.
const ogImagePngSrc = join(root, "website-src", "assets", "og-image.png");
if (existsSync(ogImagePngSrc)) {
  copyFileSync(ogImagePngSrc, join(assetsOutDir, "og-image.png"));
}

// ─── SEO static files (llms.txt, sitemap.xml, robots.txt) ────────────────────
// These live as templates in website-src/ and are rendered into website/ with
// live catalog counts so AI crawlers and search engines read accurate numbers
// without executing JS. Keeping the templates source-controlled (rather than
// hand-editing the built website/ copies) means the counts can never drift out
// of sync with the catalog again. index.html counts are injected separately by
// the Vite `inject-catalog-counts` plugin during `build:site`.
const seoSrcDir = join(root, "website-src");
const seoTokens: Record<string, string> = {
  "{{SKILL_COUNT}}": String(catalog.totalSkills),
  "{{REPO_COUNT}}": String(catalog.totalRepos),
  "{{CATEGORY_COUNT}}": String(categories.length),
  // catalog.generatedAt is an ISO timestamp; sitemap <lastmod> wants YYYY-MM-DD.
  "{{LASTMOD}}": catalog.generatedAt.slice(0, 10),
};
// Each entry renders website-src/<from> → website/<to> with token substitution.
const seoTemplates: { from: string; to: string }[] = [
  { from: "llms.txt", to: "llms.txt" },
  { from: "sitemap.xml", to: "sitemap.xml" },
  { from: "robots.txt", to: "robots.txt" },
  { from: "assets/og-image.svg", to: "assets/og-image.svg" },
];
function renderSeoTemplate(from: string, to: string): void {
  const srcPath = join(seoSrcDir, from);
  if (!existsSync(srcPath)) {
    console.warn(`  SEO: template ${from} not found in website-src/, skipping`);
    return;
  }
  let content = readFileSync(srcPath, "utf-8");
  for (const [token, value] of Object.entries(seoTokens)) {
    content = content.split(token).join(value);
  }
  const leftover = content.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) {
    throw new Error(
      `SEO: unresolved placeholder ${leftover[0]} in ${from}. ` +
        `Add it to seoTokens in scripts/build-catalog.ts.`,
    );
  }
  writeFileSync(join(outDir, to), content, "utf-8");
}
for (const { from, to } of seoTemplates) {
  renderSeoTemplate(from, to);
}

// ─── Per-Repo and Per-Author Stats (issue #344) ─────────────────────────────

interface RepoStatsEntry {
  owner: string;
  repo: string;
  repoUrl: string;
  skillCount: number;
  categories: Record<string, number>;
  verifiedCount: number;
  totalTokens: number;
  avgEvalScore?: number;
}

interface AuthorStatsEntry {
  owner: string;
  totalSkills: number;
  repos: string[];
  categories: Record<string, number>;
  verifiedCount: number;
  totalTokens: number;
  avgEvalScore?: number;
  topSkills: Array<{ id: string; name: string; repo: string }>;
}

interface CategoryTopSkill {
  id: string;
  name: string;
  owner: string;
  repo: string;
  evalSummary: SkillEvalSummary;
}

interface IndexStatsEntry {
  totalRepos: number;
  totalSkills: number;
  totalAuthors: number;
  categoryDistribution: Record<string, number>;
  categoryTopSkills: Record<string, CategoryTopSkill[]>;
  verifiedCount: number;
  totalTokens: number;
  avgTokensPerSkill: number;
}

// Compute per-repo stats
const repoStats: RepoStatsEntry[] = repos
  .map((r) => {
    const repoSkills = skills.filter(
      (s) => s.owner === r.owner && s.repo === r.repo,
    );
    const catCounts: Record<string, number> = {};
    let verifiedCount = 0;
    let totalTokens = 0;
    let evalScoreSum = 0;
    let evalScoreCount = 0;

    for (const s of repoSkills) {
      for (const c of s.categories) {
        catCounts[c] = (catCounts[c] || 0) + 1;
      }
      if (s.verified) verifiedCount++;
      totalTokens += s.tokenCount ?? 0;
      if (s.evalSummary) {
        evalScoreSum += s.evalSummary.overallScore;
        evalScoreCount++;
      }
    }

    return {
      owner: r.owner,
      repo: r.repo,
      repoUrl: r.repoUrl,
      skillCount: r.skillCount,
      categories: catCounts,
      verifiedCount,
      totalTokens,
      avgEvalScore:
        evalScoreCount > 0
          ? Math.round(evalScoreSum / evalScoreCount)
          : undefined,
    };
  })
  .sort((a, b) => b.skillCount - a.skillCount);

// Compute per-author stats
const authorMap = new Map<string, AuthorStatsEntry>();
for (const r of repos) {
  let author = authorMap.get(r.owner);
  if (!author) {
    author = {
      owner: r.owner,
      totalSkills: 0,
      repos: [],
      categories: {},
      verifiedCount: 0,
      totalTokens: 0,
      topSkills: [],
    };
    authorMap.set(r.owner, author);
  }

  const repoSkills = skills.filter(
    (s) => s.owner === r.owner && s.repo === r.repo,
  );
  author.repos.push(`${r.owner}/${r.repo}`);

  for (const s of repoSkills) {
    author.totalSkills++;
    for (const c of s.categories) {
      author.categories[c] = (author.categories[c] || 0) + 1;
    }
    if (s.verified) author.verifiedCount++;
    author.totalTokens += s.tokenCount ?? 0;
    author.topSkills.push({
      id: s.id,
      name: s.name,
      repo: `${r.owner}/${r.repo}`,
    });
  }
}

const authorStats: AuthorStatsEntry[] = Array.from(authorMap.values())
  .map((a) => ({
    ...a,
    topSkills: a.topSkills
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 10),
  }))
  .sort((a, b) => b.totalSkills - a.totalSkills);

// Compute index-wide stats
const indexCatDist: Record<string, number> = {};
for (const s of skills) {
  for (const c of s.categories) {
    indexCatDist[c] = (indexCatDist[c] || 0) + 1;
  }
}
const categoryTopSkills: Record<string, CategoryTopSkill[]> = {};
for (const category of categories) {
  categoryTopSkills[category] = skills
    .filter((skill) => skill.categories.includes(category) && skill.evalSummary)
    .sort(
      (a, b) =>
        b.evalSummary!.overallScore - a.evalSummary!.overallScore ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 10)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      owner: skill.owner,
      repo: skill.repo,
      evalSummary: skill.evalSummary!,
    }));
}

const indexStats: IndexStatsEntry = {
  totalRepos: repos.length,
  totalSkills: skills.length,
  totalAuthors: authorMap.size,
  categoryDistribution: indexCatDist,
  categoryTopSkills,
  verifiedCount: skills.filter((s) => s.verified).length,
  totalTokens: skills.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0),
  avgTokensPerSkill:
    skills.length > 0
      ? Math.round(
          skills.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0) /
            skills.length,
        )
      : 0,
};

// Write stats artifacts
writeFileSync(
  join(outDir, "repo-stats.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), stats: repoStats }),
  "utf-8",
);
writeFileSync(
  join(outDir, "author-stats.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), stats: authorStats }),
  "utf-8",
);
writeFileSync(
  join(outDir, "index-stats.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), stats: indexStats }),
  "utf-8",
);

// ─── Stats ───────────────────────────────────────────────────────────────────

function kb(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log(`Catalog built successfully:`);
console.log(`  Skills: ${skills.length}`);
console.log(`  Repos:  ${repos.length}`);
console.log(`  Categories: ${categories.join(", ")}`);
console.log(`  Bundles: ${uniqueBundles.length}`);
console.log(`  Split artifacts (issue #214):`);
console.log(
  `    catalog.json:     ${kb(statSync(join(outDir, "catalog.json")).size)}`,
);
console.log(
  `    skills.min.json:  ${kb(statSync(join(outDir, "skills.min.json")).size)}`,
);
console.log(
  `    search.idx.json:  ${kb(statSync(join(outDir, "search.idx.json")).size)}`,
);
console.log(`    skills/*.json:    ${detailFilesWritten} files`);
console.log(
  `  SEO: llms.txt, sitemap.xml, robots.txt, og-image.svg rendered (skills=${catalog.totalSkills}, repos=${catalog.totalRepos}, lastmod=${seoTokens["{{LASTMOD}}"]})`,
);

// Category distribution
const catCounts: Record<string, number> = {};
for (const s of skills) {
  for (const c of s.categories) {
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
}
for (const [cat, count] of Object.entries(catCounts).sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`    ${cat}: ${count}`);
}
