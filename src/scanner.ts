import {
  readdir,
  stat,
  lstat,
  readlink,
  readFile,
  realpath,
} from "fs/promises";
import { join, resolve } from "path";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import type { SkillInfo, Scope, SortBy, AppConfig } from "./utils/types";

interface ScanLocation {
  dir: string;
  location: string;
  scope: "global" | "project";
  providerName: string;
  providerLabel: string;
}

function buildScanLocations(config: AppConfig, scope: Scope): ScanLocation[] {
  const locations: ScanLocation[] = [];

  for (const provider of config.providers) {
    if (!provider.enabled) {
      debug(`scan: skipping disabled provider "${provider.name}"`);
      continue;
    }

    if (scope === "global" || scope === "both") {
      const dir = resolveProviderPath(provider.global);
      debug(`scan: adding location ${dir} (${provider.label}, global)`);
      locations.push({
        dir,
        location: `global-${provider.name}`,
        scope: "global",
        providerName: provider.name,
        providerLabel: provider.label,
      });
    }

    if (scope === "project" || scope === "both") {
      const dir = resolveProviderPath(provider.project);
      debug(`scan: adding location ${dir} (${provider.label}, project)`);
      locations.push({
        dir,
        location: `project-${provider.name}`,
        scope: "project",
        providerName: provider.name,
        providerLabel: provider.label,
      });
    }
  }

  for (const custom of config.customPaths) {
    if (scope === custom.scope || scope === "both") {
      const dir = resolveProviderPath(custom.path);
      debug(
        `scan: adding custom location ${dir} (${custom.label}, ${custom.scope})`,
      );
      locations.push({
        dir,
        location: `${custom.scope}-custom`,
        scope: custom.scope,
        providerName: "custom",
        providerLabel: custom.label,
      });
    }
  }

  return locations;
}

export async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true } as any);
    return entries.length;
  } catch {
    return 0;
  }
}

async function scanDirectory(loc: ScanLocation): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  debug(`scanning: ${loc.dir} (${loc.location})`);

  let entries: string[];
  try {
    entries = await readdir(loc.dir);
  } catch {
    debug(`scanning: ${loc.dir} — not found, skipping`);
    return skills;
  }

  for (const entry of entries) {
    const entryPath = join(loc.dir, entry);

    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) {
        debug(`  skip: "${entry}" — not a directory`);
        continue;
      }
    } catch {
      debug(`  skip: "${entry}" — stat failed`);
      continue;
    }

    const skillMdPath = join(entryPath, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
      debug(`  skip: "${entry}" — no SKILL.md`);
      continue;
    }

    const fm = parseFrontmatter(content);

    let isSymlink = false;
    let symlinkTarget: string | null = null;
    try {
      const lstats = await lstat(entryPath);
      if (lstats.isSymbolicLink()) {
        isSymlink = true;
        symlinkTarget = await readlink(entryPath);
      }
    } catch {
      // not a symlink
    }

    const resolvedPath = resolve(entryPath);
    let resolvedRealPath: string;
    try {
      resolvedRealPath = await realpath(entryPath);
    } catch {
      resolvedRealPath = resolvedPath;
    }

    skills.push({
      name: fm.name || entry,
      version: resolveVersion(fm),
      description: (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
      creator: fm["metadata.creator"] || "",
      dirName: entry,
      path: resolvedPath,
      originalPath: entryPath,
      location: loc.location,
      scope: loc.scope,
      provider: loc.providerName,
      providerLabel: loc.providerLabel,
      isSymlink,
      symlinkTarget,
      realPath: resolvedRealPath,
    });
  }

  debug(`found ${skills.length} skill(s) in ${loc.dir}`);
  return skills;
}

export async function scanAllSkills(
  config: AppConfig,
  scope: Scope,
): Promise<SkillInfo[]> {
  const locations = buildScanLocations(config, scope);
  const results = await Promise.all(locations.map(scanDirectory));
  return results.flat();
}

export function searchSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  if (!query.trim()) return skills;
  const q = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.creator.toLowerCase().includes(q) ||
      s.location.toLowerCase().includes(q) ||
      s.providerLabel.toLowerCase().includes(q),
  );
}

export function compareSemver(a: string, b: string): number {
  const partsA = a.split(".");
  const partsB = b.split(".");
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = parseInt(partsA[i] ?? "0", 10);
    const numB = parseInt(partsB[i] ?? "0", 10);

    if (isNaN(numA) || isNaN(numB)) {
      return a.localeCompare(b);
    }

    if (numA !== numB) return numA - numB;
  }

  return 0;
}

export function sortSkills(skills: SkillInfo[], by: SortBy): SkillInfo[] {
  const sorted = [...skills];
  switch (by) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "version":
      sorted.sort((a, b) => compareSemver(a.version, b.version));
      break;
    case "location":
      sorted.sort((a, b) => a.location.localeCompare(b.location));
      break;
  }
  return sorted;
}
