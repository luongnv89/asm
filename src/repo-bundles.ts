import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import type { BundleManifest, BundleSkillRef, IndexedSkill, RepoIndex } from "./utils/types";

export interface RepoBundleSource {
  owner: string;
  repo: string;
  repoUrl: string;
  relPath?: string;
}

export type RepoBundleManifest = BundleManifest & {
  sourceRepo: RepoBundleSource;
  inferred?: boolean;
  explicit?: boolean;
};

interface BundleGroup {
  id: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
}

const GROUPS: BundleGroup[] = [
  {
    id: "marketing",
    title: "Marketing Skills",
    description: "Marketing, growth, SEO, ASO, affiliate, sales, and conversion skills.",
    tags: ["marketing", "growth", "seo"],
    keywords: ["marketing", "growth", "seo", "aso", "affiliate", "sales", "copy", "copywriting", "conversion", "cro", "brand", "social", "campaign"],
  },
  {
    id: "writing",
    title: "Writing Skills",
    description: "Writing, editing, documentation, publishing, and content-production skills.",
    tags: ["writing", "content", "docs"],
    keywords: ["write", "writing", "writer", "blog", "article", "content", "docs", "documentation", "draft", "copy", "readme", "paper", "thesis", "proposal"],
  },
  {
    id: "research",
    title: "Research Skills",
    description: "Research, academic, literature-review, citation, paper, and analysis skills.",
    tags: ["research", "academic", "analysis"],
    keywords: ["research", "academic", "scholar", "paper", "literature", "citation", "review", "analysis", "summar", "evaluate", "verify"],
  },
  {
    id: "engineering",
    title: "Engineering Skills",
    description: "Coding, debugging, testing, architecture, review, and software engineering skills.",
    tags: ["engineering", "coding", "testing"],
    keywords: ["code", "coding", "debug", "test", "testing", "coverage", "review", "refactor", "architecture", "typescript", "python", "javascript", "build", "cli", "api"],
  },
  {
    id: "frontend-design",
    title: "Frontend & Design Skills",
    description: "Frontend, UI, UX, visual design, component, theme, and landing-page skills.",
    tags: ["frontend", "design", "ui"],
    keywords: ["frontend", "ui", "ux", "design", "component", "react", "css", "html", "figma", "theme", "landing", "layout", "visual", "brand", "logo"],
  },
  {
    id: "devops",
    title: "DevOps Skills",
    description: "Deployment, CI/CD, infrastructure, cloud, Docker, Kubernetes, and automation skills.",
    tags: ["devops", "infra", "automation"],
    keywords: ["devops", "deploy", "deployment", "ci", "cd", "pipeline", "docker", "kubernetes", "terraform", "ansible", "cloud", "infra", "infrastructure", "workflow", "release"],
  },
  {
    id: "data-ai",
    title: "Data & AI Skills",
    description: "Data, analytics, AI, model, prompt, agent, and automation skills.",
    tags: ["data", "ai", "agents"],
    keywords: ["data", "analytics", "analysis", "ai", "agent", "llm", "model", "prompt", "openai", "claude", "gemini", "automation", "dataset", "sql"],
  },
  {
    id: "product-business",
    title: "Product & Business Skills",
    description: "Product, strategy, PRD, planning, finance, resume, and business workflow skills.",
    tags: ["product", "business", "planning"],
    keywords: ["product", "prd", "strategy", "planning", "business", "finance", "resume", "career", "startup", "market", "competitor", "customer", "sales"],
  },
];

const MIN_SKILLS_PER_INFERRED_BUNDLE = 2;
const MAX_SKILLS_PER_INFERRED_BUNDLE = 80;
const EXPLICIT_BUNDLE_FILES = [
  "asm-bundles.json",
  "asm.bundle.json",
  ".asm/bundles.json",
  ".asm/bundle.json",
];
const EXPLICIT_BUNDLE_DIRS = ["bundles", "data/bundles", ".asm/bundles"];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function repoScopedName(owner: string, repo: string, name: string): string {
  const ownerSlug = slugify(owner);
  const repoSlug = slugify(repo);
  const nameSlug = slugify(name);
  const prefix = `${ownerSlug}-${repoSlug}`;
  return nameSlug.startsWith(prefix) ? nameSlug : `${prefix}-${nameSlug}`;
}

function skillText(skill: IndexedSkill): string {
  return [skill.name, skill.description, skill.relPath, skill.installUrl]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesGroup(skill: IndexedSkill, group: BundleGroup): boolean {
  const text = skillText(skill);
  return group.keywords.some((keyword) => text.includes(keyword));
}

function toBundleSkillRef(skill: IndexedSkill): BundleSkillRef {
  return {
    name: skill.name,
    installUrl: skill.installUrl,
    description: skill.description || undefined,
    version: skill.version || undefined,
  };
}

function dedupeSkillRefs(skills: BundleSkillRef[]): BundleSkillRef[] {
  const seen = new Set<string>();
  const deduped: BundleSkillRef[] = [];
  for (const skill of skills) {
    const key = `${skill.installUrl || ""}\u0000${skill.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(skill);
  }
  return deduped;
}

function sortSkills(skills: BundleSkillRef[]): BundleSkillRef[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name));
}

export function inferRepoBundles(repoIndex: RepoIndex): RepoBundleManifest[] {
  const bundles: RepoBundleManifest[] = [];
  if (!repoIndex.skills || repoIndex.skills.length < MIN_SKILLS_PER_INFERRED_BUNDLE) {
    return bundles;
  }

  for (const group of GROUPS) {
    const matchingSkills = repoIndex.skills
      .filter((skill) => matchesGroup(skill, group))
      .slice(0, MAX_SKILLS_PER_INFERRED_BUNDLE);

    if (matchingSkills.length < MIN_SKILLS_PER_INFERRED_BUNDLE) continue;

    const name = repoScopedName(repoIndex.owner, repoIndex.repo, group.id);
    bundles.push({
      version: 1,
      name,
      description: `${group.description} Derived from ${repoIndex.owner}/${repoIndex.repo}.`,
      author: `ASM (${repoIndex.owner}/${repoIndex.repo})`,
      createdAt: repoIndex.updatedAt,
      tags: ["repo-derived", "inferred", ...group.tags, slugify(repoIndex.owner), slugify(repoIndex.repo)],
      skills: sortSkills(matchingSkills.map(toBundleSkillRef)),
      sourceRepo: {
        owner: repoIndex.owner,
        repo: repoIndex.repo,
        repoUrl: repoIndex.repoUrl,
      },
      inferred: true,
    });
  }

  return bundles;
}

function normalizeExplicitBundle(
  raw: unknown,
  repoIndex: Pick<RepoIndex, "owner" | "repo" | "repoUrl" | "updatedAt" | "skills">,
  relPath: string,
): RepoBundleManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, any>;
  const rawSkills = Array.isArray(obj.skills) ? obj.skills : [];
  if (rawSkills.length === 0) return null;

  const byName = new Map(repoIndex.skills.map((skill) => [skill.name, skill]));
  const skillRefs = dedupeSkillRefs(
    rawSkills
      .map((entry: unknown): BundleSkillRef | null => {
        if (typeof entry === "string") {
          const match = byName.get(entry);
          return match ? toBundleSkillRef(match) : null;
        }
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const skill = entry as Record<string, any>;
        const name = typeof skill.name === "string" ? skill.name : "";
        if (!name) return null;
        const match = byName.get(name);
        if (!match) return null;
        return {
          name: match.name,
          installUrl: match.installUrl,
          description:
            typeof skill.description === "string" && skill.description
              ? skill.description
              : match.description || undefined,
          version:
            typeof skill.version === "string" && skill.version
              ? skill.version
              : match.version || undefined,
        };
      })
      .filter((skill): skill is BundleSkillRef => skill !== null),
  );

  if (skillRefs.length === 0) return null;

  const baseName = typeof obj.name === "string" && obj.name ? obj.name : relPath.replace(/\.json$/, "");
  return {
    version: 1,
    name: repoScopedName(repoIndex.owner, repoIndex.repo, baseName),
    description:
      typeof obj.description === "string" && obj.description
        ? obj.description
        : `Bundle from ${repoIndex.owner}/${repoIndex.repo}.`,
    author:
      typeof obj.author === "string" && obj.author
        ? obj.author
        : `ASM (${repoIndex.owner}/${repoIndex.repo})`,
    createdAt:
      typeof obj.createdAt === "string" && obj.createdAt
        ? obj.createdAt
        : repoIndex.updatedAt,
    tags: Array.isArray(obj.tags)
      ? ["repo-derived", "explicit", ...obj.tags.filter((tag: unknown) => typeof tag === "string")]
      : ["repo-derived", "explicit"],
    skills: sortSkills(skillRefs),
    sourceRepo: {
      owner: repoIndex.owner,
      repo: repoIndex.repo,
      repoUrl: repoIndex.repoUrl,
      relPath,
    },
    explicit: true,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readBundleCandidates(repoRoot: string): Promise<Array<{ relPath: string; data: unknown }>> {
  const candidates: Array<{ relPath: string; data: unknown }> = [];

  for (const relPath of EXPLICIT_BUNDLE_FILES) {
    const absPath = join(repoRoot, relPath);
    if (!(await fileExists(absPath))) continue;
    try {
      candidates.push({ relPath, data: JSON.parse(await readFile(absPath, "utf-8")) });
    } catch {
      // Ignore malformed explicit bundle metadata. Indexing must remain best-effort.
    }
  }

  for (const relDir of EXPLICIT_BUNDLE_DIRS) {
    const absDir = join(repoRoot, relDir);
    if (!(await dirExists(absDir))) continue;
    let entries: string[] = [];
    try {
      entries = await readdir(absDir);
    } catch {
      continue;
    }
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const relPath = `${relDir}/${entry}`;
      try {
        candidates.push({ relPath, data: JSON.parse(await readFile(join(absDir, entry), "utf-8")) });
      } catch {
        // Ignore malformed explicit bundle metadata. Indexing must remain best-effort.
      }
    }
  }

  return candidates;
}

export async function discoverExplicitRepoBundles(
  repoRoot: string,
  repoIndex: Pick<RepoIndex, "owner" | "repo" | "repoUrl" | "updatedAt" | "skills">,
): Promise<RepoBundleManifest[]> {
  const bundles: RepoBundleManifest[] = [];
  const candidates = await readBundleCandidates(repoRoot);

  for (const candidate of candidates) {
    const data = candidate.data as any;
    const bundleInputs = Array.isArray(data?.bundles) ? data.bundles : [data];
    for (const input of bundleInputs) {
      const bundle = normalizeExplicitBundle(input, repoIndex, candidate.relPath);
      if (bundle) bundles.push(bundle);
    }
  }

  return mergeRepoBundles(bundles);
}

export function mergeRepoBundles(bundles: RepoBundleManifest[]): RepoBundleManifest[] {
  const byName = new Map<string, RepoBundleManifest>();
  for (const bundle of bundles) {
    const existing = byName.get(bundle.name);
    if (!existing || (bundle.explicit && !existing.explicit)) {
      byName.set(bundle.name, bundle);
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function repoBundlesForIndex(repoIndex: RepoIndex): RepoBundleManifest[] {
  const explicit = (repoIndex.bundles || []) as RepoBundleManifest[];
  const inferred = inferRepoBundles(repoIndex);
  return mergeRepoBundles([...explicit, ...inferred]);
}
