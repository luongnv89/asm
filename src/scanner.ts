import {
  readdir,
  stat,
  lstat,
  readlink,
  readFile,
  realpath,
} from "fs/promises";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import {
  parseFrontmatter,
  resolveVersion,
  resolveAllowedTools,
} from "./utils/frontmatter";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import type { SkillInfo, Scope, SortBy, AppConfig } from "./utils/types";

const PLUGIN_MARKETPLACES_DIR = join(
  homedir(),
  ".claude",
  "plugins",
  "marketplaces",
);

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
      license: (fm.license || "").trim(),
      compatibility: (fm.compatibility || "").trim(),
      allowedTools: resolveAllowedTools(fm),
      effort: fm.effort || fm["metadata.effort"] || undefined,
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

/**
 * Recursively find all SKILL.md files under a directory, returning their
 * parent directory paths. Handles variable nesting depths used by different
 * plugin marketplaces.
 */
async function findSkillDirs(dir: string): Promise<string[]> {
  const skillDirs: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skillDirs;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);

    let entryStat;
    try {
      entryStat = await lstat(entryPath);
    } catch {
      continue;
    }

    // Skip symlinks to avoid cycles from malformed or malicious marketplaces
    if (entryStat.isSymbolicLink()) continue;

    if (entryStat.isDirectory()) {
      const skillMdPath = join(entryPath, "SKILL.md");
      try {
        await stat(skillMdPath);
        skillDirs.push(entryPath);
      } catch {
        // No SKILL.md here — recurse deeper
        const nested = await findSkillDirs(entryPath);
        skillDirs.push(...nested);
      }
    }
  }

  return skillDirs;
}

/**
 * Scan Claude plugin marketplaces under ~/.claude/plugins/marketplaces/.
 *
 * Marketplaces use variable-depth layouts:
 *   - User-installed: {marketplace}/skills/{skill}/SKILL.md
 *   - Official bundled: {marketplace}/plugins/{plugin}/skills/{skill}/SKILL.md
 *
 * Skills are attributed to their marketplace name (the directory directly
 * under ~/.claude/plugins/marketplaces/).
 */
export async function scanPluginMarketplaces(
  baseDir?: string,
): Promise<SkillInfo[]> {
  const marketplacesDir = baseDir ?? PLUGIN_MARKETPLACES_DIR;
  const skills: SkillInfo[] = [];

  debug(`scan: checking plugin marketplaces at ${marketplacesDir}`);

  let marketplaces: string[];
  try {
    marketplaces = await readdir(marketplacesDir);
  } catch {
    debug(`scan: plugin marketplaces dir not found, skipping`);
    return skills;
  }

  for (const marketplace of marketplaces) {
    const marketplacePath = join(marketplacesDir, marketplace);

    let mStat;
    try {
      mStat = await stat(marketplacePath);
    } catch {
      continue;
    }
    if (!mStat.isDirectory()) continue;

    debug(`scan: scanning marketplace "${marketplace}"`);

    const skillDirs = await findSkillDirs(marketplacePath);

    for (const skillDir of skillDirs) {
      const skillMdPath = join(skillDir, "SKILL.md");
      let content: string;
      try {
        content = await readFile(skillMdPath, "utf-8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      const entry = basename(skillDir);

      // findSkillDirs() skips symlinks, so marketplace skill dirs are always
      // real directories — isSymlink is always false here.
      const resolvedPath = resolve(skillDir);
      let resolvedRealPath: string;
      try {
        resolvedRealPath = await realpath(skillDir);
      } catch {
        resolvedRealPath = resolvedPath;
      }

      skills.push({
        name: fm.name || entry,
        version: resolveVersion(fm),
        description: (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
        creator: fm["metadata.creator"] || "",
        license: (fm.license || "").trim(),
        compatibility: (fm.compatibility || "").trim(),
        allowedTools: resolveAllowedTools(fm),
        effort: fm.effort || fm["metadata.effort"] || undefined,
        dirName: entry,
        path: resolvedPath,
        originalPath: skillDir,
        location: `global-plugin-${marketplace}`,
        scope: "global",
        provider: "plugin",
        providerLabel: `Plugin (${marketplace})`,
        isSymlink: false,
        symlinkTarget: null,
        realPath: resolvedRealPath,
        marketplace,
      });
    }
  }

  debug(`scan: found ${skills.length} plugin marketplace skill(s)`);
  return skills;
}

export async function scanAllSkills(
  config: AppConfig,
  scope: Scope,
  pluginBaseDir?: string,
): Promise<SkillInfo[]> {
  const locations = buildScanLocations(config, scope);
  const [providerResults, pluginSkills] = await Promise.all([
    Promise.all(locations.map(scanDirectory)),
    scope === "global" || scope === "both"
      ? scanPluginMarketplaces(pluginBaseDir)
      : Promise.resolve([] as SkillInfo[]),
  ]);
  const skills = providerResults.flat();

  // Deduplicate: skip plugin skills whose realPath already appears in provider results
  const seenRealPaths = new Set(skills.map((s) => s.realPath));
  for (const ps of pluginSkills) {
    if (!seenRealPaths.has(ps.realPath)) {
      skills.push(ps);
      seenRealPaths.add(ps.realPath);
    }
  }

  return skills;
}

export function searchSkills(skills: SkillInfo[], query: string): SkillInfo[] {
  if (!query.trim()) return skills;
  const q = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.creator.toLowerCase().includes(q) ||
      (s.effort && s.effort.toLowerCase().includes(q)) ||
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
