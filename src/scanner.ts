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
import { estimateTokenCount } from "./utils/token-count";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import type {
  SkillInfo,
  Scope,
  SortBy,
  AppConfig,
  CodexPluginManifest,
} from "./utils/types";

const PLUGIN_MARKETPLACES_DIR = join(
  homedir(),
  ".claude",
  "plugins",
  "marketplaces",
);

const CODEX_PLUGIN_CACHE_DIR = join(homedir(), ".codex", "plugins", "cache");
const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
const AGENTS_PLUGINS_MARKETPLACE_PATH = join(
  homedir(),
  ".agents",
  "plugins",
  "marketplace.json",
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
      tokenCount: estimateTokenCount(content),
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
        tokenCount: estimateTokenCount(content),
      });
    }
  }

  debug(`scan: found ${skills.length} plugin marketplace skill(s)`);
  return skills;
}

/**
 * Parse a subset of TOML key=value lines to extract plugin enabled/disabled state.
 * Only handles simple `key = true/false` and `key = "string"` entries — this is
 * intentionally minimal to avoid a TOML parser dependency.
 */
function parseTomlEnabledMap(toml: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  let currentPlugin: string | null = null;

  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();

    // Section header: [plugins.plugin-name] or [[plugins]]
    const sectionMatch = line.match(/^\[plugins\.([^\]]+)\]$/);
    if (sectionMatch) {
      currentPlugin = sectionMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }
    // Any other section header resets the current plugin context
    if (line.startsWith("[")) {
      currentPlugin = null;
      continue;
    }

    if (currentPlugin && line.startsWith("enabled")) {
      const valMatch = line.match(/^enabled\s*=\s*(true|false)/i);
      if (valMatch) {
        result.set(currentPlugin, valMatch[1].toLowerCase() === "true");
      }
    }
  }

  return result;
}

/**
 * Load the Codex plugin enabled/disabled map from `~/.codex/config.toml`.
 * Returns an empty map if the file doesn't exist or cannot be parsed.
 */
async function loadCodexEnabledMap(
  configPath?: string,
): Promise<Map<string, boolean>> {
  const path = configPath ?? CODEX_CONFIG_PATH;
  try {
    const raw = await readFile(path, "utf-8");
    return parseTomlEnabledMap(raw);
  } catch {
    debug(`codex: config.toml not found at ${path}, skipping enabled check`);
    return new Map();
  }
}

/**
 * Scan the Codex plugin cache at `~/.codex/plugins/cache/` to discover
 * installed Codex plugins.
 *
 * Cache layout:
 *   {marketplace}/{plugin}/{version}/.codex-plugin/plugin.json
 *
 * Each versioned plugin directory containing `.codex-plugin/plugin.json`
 * is registered as a SkillInfo entry. The highest version directory is
 * used when multiple versions are present.
 */
export async function scanCodexPluginCache(
  cacheBaseDir?: string,
  configPath?: string,
): Promise<SkillInfo[]> {
  const cacheDir = cacheBaseDir ?? CODEX_PLUGIN_CACHE_DIR;
  const skills: SkillInfo[] = [];

  debug(`codex: checking plugin cache at ${cacheDir}`);

  let marketplaces: string[];
  try {
    marketplaces = await readdir(cacheDir);
  } catch {
    debug(`codex: plugin cache dir not found, skipping`);
    return skills;
  }

  const enabledMap = await loadCodexEnabledMap(configPath);

  for (const marketplace of marketplaces) {
    const marketplacePath = join(cacheDir, marketplace);

    let mStat;
    try {
      mStat = await stat(marketplacePath);
    } catch {
      continue;
    }
    if (!mStat.isDirectory()) continue;

    let plugins: string[];
    try {
      plugins = await readdir(marketplacePath);
    } catch {
      continue;
    }

    for (const pluginName of plugins) {
      const pluginPath = join(marketplacePath, pluginName);

      let pStat;
      try {
        pStat = await stat(pluginPath);
      } catch {
        continue;
      }
      if (!pStat.isDirectory()) continue;

      // Find all version directories and pick the lexicographically last one
      let versions: string[];
      try {
        versions = await readdir(pluginPath);
      } catch {
        continue;
      }

      const versionDirs = (
        await Promise.all(
          versions.map(async (v) => {
            try {
              const s = await stat(join(pluginPath, v));
              return s.isDirectory() ? v : null;
            } catch {
              return null;
            }
          }),
        )
      ).filter((v): v is string => v !== null);

      if (versionDirs.length === 0) continue;

      // Use the highest semver version
      const selectedVersion = versionDirs.sort(compareSemver).at(-1)!;
      const versionDir = join(pluginPath, selectedVersion);

      const manifestPath = join(versionDir, ".codex-plugin", "plugin.json");
      let manifest: CodexPluginManifest;
      try {
        const raw = await readFile(manifestPath, "utf-8");
        manifest = JSON.parse(raw) as CodexPluginManifest;
      } catch {
        debug(`codex: no valid plugin.json at ${manifestPath}, skipping`);
        continue;
      }

      const resolvedPath = resolve(versionDir);
      let resolvedRealPath: string;
      try {
        resolvedRealPath = await realpath(versionDir);
      } catch {
        resolvedRealPath = resolvedPath;
      }

      const skillName =
        manifest.interface?.displayName || manifest.name || pluginName;
      const version = manifest.version || selectedVersion;
      const description = (manifest.description || "")
        .replace(/\s*\n\s*/g, " ")
        .trim();

      const enabled = enabledMap.has(pluginName)
        ? enabledMap.get(pluginName)!
        : true; // default to enabled if not in config

      skills.push({
        name: skillName,
        version,
        description,
        creator: "",
        license: "",
        compatibility: "",
        allowedTools: [],
        dirName: pluginName,
        path: resolvedPath,
        originalPath: versionDir,
        location: `global-codex-plugin-${marketplace}`,
        scope: "global",
        provider: "codex-plugin",
        providerLabel: `Codex Plugin (${marketplace})`,
        isSymlink: false,
        symlinkTarget: null,
        realPath: resolvedRealPath,
        marketplace,
        codexPlugin: {
          category: manifest.interface?.category,
          hasMcpConfig:
            manifest.mcp != null && Object.keys(manifest.mcp).length > 0,
          pluginName,
          pluginVersion: selectedVersion,
          enabled,
        },
      });
    }
  }

  debug(`codex: found ${skills.length} plugin(s) in cache`);
  return skills;
}

/** Schema for a marketplace.json entry */
interface CodexMarketplaceEntry {
  name: string;
  source?: string;
  version?: string;
  description?: string;
}

/** Schema for a marketplace.json file */
interface CodexMarketplaceFile {
  plugins?: CodexMarketplaceEntry[];
  skills?: CodexMarketplaceEntry[];
}

/**
 * Read Codex marketplace.json files from the user-level and repo-level
 * `.agents/plugins/` paths. These files list available (not necessarily
 * installed) plugins. This function returns the union of entries from all
 * discovered files, deduplicating by name.
 *
 * Note: This is a catalog utility for commands like `asm search` or
 * `asm install` — it is not wired into `scanAllSkills()` because
 * marketplace entries lack filesystem paths required by `SkillInfo`.
 *
 * Paths checked:
 *   - `~/.agents/plugins/marketplace.json`
 *   - `$CWD/.agents/plugins/marketplace.json`
 */
export async function readCodexMarketplaceFiles(
  userMarketplacePath?: string,
  repoMarketplacePath?: string,
): Promise<CodexMarketplaceEntry[]> {
  const userPath = userMarketplacePath ?? AGENTS_PLUGINS_MARKETPLACE_PATH;
  const repoPath =
    repoMarketplacePath ??
    join(process.cwd(), ".agents", "plugins", "marketplace.json");

  const allEntries: CodexMarketplaceEntry[] = [];
  const seenNames = new Set<string>();

  for (const filePath of [userPath, repoPath]) {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      debug(`codex: marketplace.json not found at ${filePath}, skipping`);
      continue;
    }

    let data: CodexMarketplaceFile;
    try {
      data = JSON.parse(raw) as CodexMarketplaceFile;
    } catch {
      debug(`codex: invalid JSON in ${filePath}, skipping`);
      continue;
    }

    const entries = [...(data.plugins ?? []), ...(data.skills ?? [])];
    for (const entry of entries) {
      if (entry.name && !seenNames.has(entry.name)) {
        seenNames.add(entry.name);
        allEntries.push(entry);
      }
    }
  }

  debug(`codex: read ${allEntries.length} marketplace entry(ies)`);
  return allEntries;
}

export async function scanAllSkills(
  config: AppConfig,
  scope: Scope,
  pluginBaseDir?: string,
  codexCacheDir?: string,
): Promise<SkillInfo[]> {
  const locations = buildScanLocations(config, scope);
  const isGlobal = scope === "global" || scope === "both";

  const [providerResults, pluginSkills, codexPluginSkills] = await Promise.all([
    Promise.all(locations.map(scanDirectory)),
    isGlobal
      ? scanPluginMarketplaces(pluginBaseDir)
      : Promise.resolve([] as SkillInfo[]),
    isGlobal
      ? scanCodexPluginCache(codexCacheDir)
      : Promise.resolve([] as SkillInfo[]),
  ]);
  const skills = providerResults.flat();

  // Deduplicate by realPath: provider results win, then Claude plugin results, then Codex plugin results
  const seenRealPaths = new Set(skills.map((s) => s.realPath));
  const seenNames = new Set(skills.map((s) => s.name.toLowerCase()));

  for (const ps of pluginSkills) {
    if (
      !seenRealPaths.has(ps.realPath) &&
      !seenNames.has(ps.name.toLowerCase())
    ) {
      skills.push(ps);
      seenRealPaths.add(ps.realPath);
      seenNames.add(ps.name.toLowerCase());
    }
  }

  for (const cp of codexPluginSkills) {
    // Deduplicate by realPath first, then by name across providers
    if (
      !seenRealPaths.has(cp.realPath) &&
      !seenNames.has(cp.name.toLowerCase())
    ) {
      skills.push(cp);
      seenRealPaths.add(cp.realPath);
      seenNames.add(cp.name.toLowerCase());
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
