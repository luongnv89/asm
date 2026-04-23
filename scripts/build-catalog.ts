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

// Fetch GitHub star count (best-effort, defaults to 0 on failure)
let stars = 0;
try {
  const res = await fetch("https://api.github.com/repos/luongnv89/asm", {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (res.ok) {
    const data = (await res.json()) as { stargazers_count?: number };
    stars = data.stargazers_count ?? 0;
  }
} catch {
  // Non-critical — proceed with 0
}

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
  writeFileSync(
    join(skillsDetailDir, `${slug}.json`),
    JSON.stringify(detail),
    "utf-8",
  );
  detailFilesWritten++;
}

// ─── Bundles ─────────────────────────────────────────────────────────────────

interface BundleSkill {
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

const bundles: Bundle[] = [];
for (const file of bundleFiles.sort()) {
  const filePath = join(bundlesDir, file);
  try {
    const bundle: Bundle = JSON.parse(readFileSync(filePath, "utf-8"));
    bundles.push(bundle);
  } catch (e) {
    console.warn(`Skipping bundle ${file}: invalid JSON — ${e}`);
  }
}

const bundlesData: BundlesData = {
  generatedAt: new Date().toISOString(),
  totalBundles: bundles.length,
  bundles,
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

// ─── Stats ───────────────────────────────────────────────────────────────────

function kb(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

console.log(`Catalog built successfully:`);
console.log(`  Skills: ${skills.length}`);
console.log(`  Repos:  ${repos.length}`);
console.log(`  Categories: ${categories.join(", ")}`);
console.log(`  Bundles: ${bundles.length}`);
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
