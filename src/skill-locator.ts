/**
 * Locate installed skills beyond the current project (issue #735).
 *
 * `locateSkills` always scans every enabled provider's global skill dir
 * (e.g. `~/.claude/skills`, `~/.agents/skills`) plus global custom paths.
 * Only when the caller passes an explicit `root` does it also walk that
 * directory tree — bounded by depth, never following symlinks, and pruning
 * dependency/build/dot directories — looking for project-level provider dirs
 * such as `<project>/.claude/skills`. Nothing is walked implicitly.
 *
 * Results are NOT deduplicated by skill name: the same skill installed in two
 * projects yields two results, each carrying where it lives.
 */
import { readdir, realpath, stat } from "fs/promises";
import type { Dirent } from "fs";
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
import { resolveProviderPath } from "./config";
import { debug } from "./logger";
import {
  createScanEntryScheduler,
  scanDirectory,
  type ScanLocation,
} from "./scanner";
import type { AppConfig, ProviderConfig, SkillInfo } from "./utils/types";

/** How many levels below `root` a project root may sit (root itself = 0). */
export const DEFAULT_MAX_DEPTH = 5;

/** Directory names never descended into during the walk (dot-dirs too). */
const PRUNED_DIR_NAMES = new Set([
  "node_modules",
  "Library",
  "dist",
  "build",
  "vendor",
]);

/** Directories read concurrently per walk level. */
const WALK_CONCURRENCY = 32;

export interface LocatedSkill {
  skill: SkillInfo;
  /** Project directory that holds the skill; `null` for global installs. */
  projectRoot: string | null;
}

export interface LocateOptions {
  /** Directory to walk for project-local installs. Omit for global only. */
  root?: string;
  /** Override for `DEFAULT_MAX_DEPTH`. */
  maxDepth?: number;
}

interface ProjectSuffix {
  provider: ProviderConfig;
  segments: string[];
}

interface ProjectSkillDir {
  dir: string;
  projectRoot: string;
  provider: ProviderConfig;
}

async function realpathOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Relative provider `project` templates, keyed by their first segment. */
function projectSuffixesByFirstSegment(
  config: AppConfig,
): Map<string, ProjectSuffix[]> {
  const byFirst = new Map<string, ProjectSuffix[]>();
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    const template = provider.project;
    if (!template || template.startsWith("~") || isAbsolute(template)) {
      continue;
    }
    const segments = template
      .split(/[\\/]+/)
      .filter((s) => s.length > 0 && s !== ".");
    if (segments.length === 0 || segments.includes("..")) continue;
    const list = byFirst.get(segments[0]) ?? [];
    list.push({ provider, segments });
    byFirst.set(segments[0], list);
  }
  return byFirst;
}

/**
 * Bounded breadth-first walk from `root` collecting project-level provider
 * skill dirs. A provider dir is checked at every visited directory (its
 * full suffix is `stat`ed, so a symlinked `.claude/skills` still counts),
 * but the walk itself only descends real, non-dot, non-pruned directories.
 * Unreadable directories are skipped.
 */
export async function findProjectSkillDirs(
  root: string,
  config: AppConfig,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): Promise<ProjectSkillDir[]> {
  const suffixes = projectSuffixesByFirstSegment(config);
  const found: ProjectSkillDir[] = [];
  let level = [resolve(root)];

  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += WALK_CONCURRENCY) {
      await Promise.all(
        level.slice(i, i + WALK_CONCURRENCY).map(async (dir) => {
          let entries: Dirent[];
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code ?? String(err);
            debug(`locate: skipping unreadable ${dir} (${code})`);
            return;
          }
          for (const entry of entries) {
            for (const { provider, segments } of suffixes.get(entry.name) ??
              []) {
              const candidate = join(dir, ...segments);
              if (await isDirectory(candidate)) {
                found.push({ dir: candidate, projectRoot: dir, provider });
              }
            }
            if (
              depth < maxDepth &&
              entry.isDirectory() &&
              !entry.name.startsWith(".") &&
              !PRUNED_DIR_NAMES.has(entry.name)
            ) {
              next.push(join(dir, entry.name));
            }
          }
        }),
      );
    }
    level = next;
  }

  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

function globalScanLocations(config: AppConfig): ScanLocation[] {
  const locations: ScanLocation[] = [];
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    locations.push({
      dir: resolveProviderPath(provider.global),
      location: `global-${provider.name}`,
      scope: "global",
      providerName: provider.name,
      providerLabel: provider.label,
    });
  }
  for (const custom of config.customPaths) {
    if (custom.scope !== "global") continue;
    locations.push({
      dir: resolveProviderPath(custom.path),
      location: "global-custom",
      scope: "global",
      providerName: "custom",
      providerLabel: custom.label,
    });
  }
  return locations;
}

/**
 * Find installed skills in every global provider dir and, when `opts.root`
 * is given, in project-level provider dirs under that root.
 */
export async function locateSkills(
  config: AppConfig,
  opts: LocateOptions = {},
): Promise<LocatedSkill[]> {
  const targets: Array<{ loc: ScanLocation; projectRoot: string | null }> = [];
  const seenDirs = new Set<string>();

  for (const loc of globalScanLocations(config)) {
    seenDirs.add(await realpathOrResolved(loc.dir));
    targets.push({ loc, projectRoot: null });
  }

  if (opts.root) {
    const homeReal = await realpathOrResolved(homedir());
    const projectDirs = await findProjectSkillDirs(
      opts.root,
      config,
      opts.maxDepth,
    );
    for (const { dir, projectRoot, provider } of projectDirs) {
      const dirReal = await realpathOrResolved(dir);
      if (seenDirs.has(dirReal)) continue;
      seenDirs.add(dirReal);
      // A provider dir directly under the home directory is that provider's
      // global location, not a project install.
      const isHome = (await realpathOrResolved(projectRoot)) === homeReal;
      targets.push({
        loc: {
          dir,
          location: `${isHome ? "global" : "project"}-${provider.name}`,
          scope: isHome ? "global" : "project",
          providerName: provider.name,
          providerLabel: provider.label,
        },
        projectRoot: isHome ? null : projectRoot,
      });
    }
  }

  const scheduler = createScanEntryScheduler();
  const scanned = await Promise.all(
    targets.map(async ({ loc, projectRoot }) =>
      (await scanDirectory(loc, scheduler)).map((skill) => ({
        skill,
        projectRoot,
      })),
    ),
  );

  const seenPaths = new Set<string>();
  const results: LocatedSkill[] = [];
  for (const located of scanned.flat()) {
    if (seenPaths.has(located.skill.path)) continue;
    seenPaths.add(located.skill.path);
    results.push(located);
  }
  debug(`locate: found ${results.length} installed skill(s)`);
  return results;
}
