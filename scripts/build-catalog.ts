#!/usr/bin/env bun
/**
 * Build script for the ASM Skill Catalog website.
 * Merges all data/skill-index/*.json files into a single website/catalog.json,
 * auto-categorizes skills by keyword matching, and copies static assets.
 *
 * Zero external dependencies — runs under Bun or Node 18+.
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexDir = join(root, "data", "skill-index");
const resourcesPath = join(root, "data", "skill-index-resources.json");
const outDir = join(root, "website");
const assetsOutDir = join(outDir, "assets");

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
    const id = `${repoIndex.owner}/${repoIndex.repo}::${skill.name}`;
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
    });
  }
}

const skills = Array.from(skillMap.values());

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

const catalog: Catalog = {
  generatedAt: new Date().toISOString(),
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

// Copy logo assets
const faviconSrc = join(root, "assets", "logo", "favicon.svg");
if (existsSync(faviconSrc)) {
  copyFileSync(faviconSrc, join(assetsOutDir, "favicon.svg"));
}

// ─── Stats ───────────────────────────────────────────────────────────────────

console.log(`Catalog built successfully:`);
console.log(`  Skills: ${skills.length}`);
console.log(`  Repos:  ${repos.length}`);
console.log(`  Categories: ${categories.join(", ")}`);

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
