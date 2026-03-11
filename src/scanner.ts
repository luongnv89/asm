import { readdir, stat, lstat, readlink, readFile } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { parseFrontmatter } from "./utils/frontmatter";
import type { SkillInfo, Scope, SortBy } from "./utils/types";

const HOME = homedir();

interface ScanLocation {
  dir: string;
  location: SkillInfo["location"];
  scope: SkillInfo["scope"];
}

function getScanLocations(scope: Scope): ScanLocation[] {
  const locations: ScanLocation[] = [];

  if (scope === "global" || scope === "both") {
    locations.push(
      { dir: join(HOME, ".claude", "skills"), location: "global-claude", scope: "global" },
      { dir: join(HOME, ".agents", "skills"), location: "global-agents", scope: "global" },
    );
  }

  if (scope === "project" || scope === "both") {
    locations.push(
      { dir: resolve(".claude", "skills"), location: "project-claude", scope: "project" },
      { dir: resolve(".agents", "skills"), location: "project-agents", scope: "project" },
    );
  }

  return locations;
}

async function countFiles(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true } as any);
    return entries.length;
  } catch {
    return 0;
  }
}

async function scanDirectory(loc: ScanLocation): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  let entries: string[];
  try {
    entries = await readdir(loc.dir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const entryPath = join(loc.dir, entry);

    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = join(entryPath, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
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

    const fileCount = await countFiles(entryPath);

    skills.push({
      name: fm.name || entry,
      version: fm.version || "0.0.0",
      description: fm.description || "",
      dirName: entry,
      path: resolve(entryPath),
      originalPath: entryPath,
      location: loc.location,
      scope: loc.scope,
      isSymlink,
      symlinkTarget,
      fileCount,
    });
  }

  return skills;
}

export async function scanAllSkills(scope: Scope): Promise<SkillInfo[]> {
  const locations = getScanLocations(scope);
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
      s.location.toLowerCase().includes(q),
  );
}

export function sortSkills(skills: SkillInfo[], by: SortBy): SkillInfo[] {
  const sorted = [...skills];
  switch (by) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "version":
      sorted.sort((a, b) => a.version.localeCompare(b.version));
      break;
    case "location":
      sorted.sort((a, b) => a.location.localeCompare(b.location));
      break;
  }
  return sorted;
}
