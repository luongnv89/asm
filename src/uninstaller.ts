import {
  rm,
  readFile,
  writeFile,
  access,
  lstat,
  symlink,
  readdir,
} from "fs/promises";
import { join, resolve, dirname, relative } from "path";
import { homedir } from "os";
import { resolveProviderPath } from "./config";
import type {
  SkillInfo,
  RemovalPlan,
  RemovalOptions,
  RelocationInfo,
  AppConfig,
  Scope,
} from "./utils/types";

const HOME = homedir();

export function buildRemovalPlan(
  skill: SkillInfo,
  config: AppConfig,
): RemovalPlan {
  const plan: RemovalPlan = {
    directories: [],
    ruleFiles: [],
    agentsBlocks: [],
  };

  // The skill directory itself
  plan.directories.push({
    path: skill.originalPath,
    isSymlink: skill.isSymlink,
  });

  const name = skill.dirName;

  // Check for tool-specific rule files (project scope only)
  if (skill.scope === "project") {
    plan.ruleFiles.push(
      resolve(".cursor", "rules", `${name}.mdc`),
      resolve(".windsurf", "rules", `${name}.md`),
      resolve(".github", "instructions", `${name}.instructions.md`),
    );
    plan.agentsBlocks.push({ file: resolve("AGENTS.md"), skillName: name });
  }

  if (skill.scope === "global") {
    // Check AGENTS.md for all enabled providers with global paths
    for (const provider of config.providers) {
      if (!provider.enabled) continue;
      const globalDir = resolveProviderPath(provider.global);
      const agentsMdPath = join(dirname(globalDir), "AGENTS.md");
      plan.agentsBlocks.push({ file: agentsMdPath, skillName: name });
    }
    // Also check ~/.codex/AGENTS.md explicitly (common location)
    const codexAgentsMd = join(HOME, ".codex", "AGENTS.md");
    const alreadyIncluded = plan.agentsBlocks.some(
      (b) => b.file === codexAgentsMd,
    );
    if (!alreadyIncluded) {
      plan.agentsBlocks.push({ file: codexAgentsMd, skillName: name });
    }
  }

  return plan;
}

export function buildFullRemovalPlan(
  dirName: string,
  allSkills: SkillInfo[],
  config: AppConfig,
  options?: RemovalOptions,
): RemovalPlan {
  let matching = allSkills.filter((s) => s.dirName === dirName);
  if (options?.providerFilter) {
    matching = matching.filter((s) => s.provider === options.providerFilter);
  }
  if (options?.scopeFilter) {
    matching = matching.filter((s) => s.scope === options.scopeFilter);
  }
  if (matching.length === 0) {
    return { directories: [], ruleFiles: [], agentsBlocks: [] };
  }

  const combined: RemovalPlan = {
    directories: [],
    ruleFiles: [],
    agentsBlocks: [],
  };

  const seenDirs = new Set<string>();
  const seenRules = new Set<string>();
  const seenBlocks = new Set<string>();

  for (const skill of matching) {
    const plan = buildRemovalPlan(skill, config);

    for (const dir of plan.directories) {
      if (!seenDirs.has(dir.path)) {
        seenDirs.add(dir.path);
        combined.directories.push(dir);
      }
    }

    for (const rule of plan.ruleFiles) {
      if (!seenRules.has(rule)) {
        seenRules.add(rule);
        combined.ruleFiles.push(rule);
      }
    }

    for (const block of plan.agentsBlocks) {
      const key = `${block.file}::${block.skillName}`;
      if (!seenBlocks.has(key)) {
        seenBlocks.add(key);
        combined.agentsBlocks.push(block);
      }
    }
  }

  return combined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeAgentsMdBlock(
  filePath: string,
  skillName: string,
): Promise<void> {
  if (!(await fileExists(filePath))) return;

  let content = await readFile(filePath, "utf-8");

  // Try both new and old marker formats for backward compatibility
  for (const prefix of ["agent-skill-manager", "skill-manager", "pskills"]) {
    const startMarker = `<!-- ${prefix}: ${skillName} -->`;
    const endMarker = `<!-- /${prefix}: ${skillName} -->`;

    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) continue;

    let removeStart = startIdx;
    if (removeStart > 0 && content[removeStart - 1] === "\n") {
      removeStart--;
    }

    const removeEnd = endIdx + endMarker.length;
    let actualEnd = removeEnd;
    if (actualEnd < content.length && content[actualEnd] === "\n") {
      actualEnd++;
    }

    content = content.slice(0, removeStart) + content.slice(actualEnd);
  }

  await writeFile(filePath, content, "utf-8");
}

export function findRelocationTarget(
  skillInstances: SkillInfo[],
  removedProvider: string,
): { path: string; provider: string } | null {
  const remaining = skillInstances.filter(
    (s) => s.provider !== removedProvider,
  );
  if (remaining.length === 0) return null;

  const realFolder = remaining.find((s) => !s.isSymlink);
  if (realFolder) {
    return { path: realFolder.originalPath, provider: realFolder.provider };
  }

  return { path: remaining[0].originalPath, provider: remaining[0].provider };
}

export function buildRelocationInfo(
  plan: RemovalPlan,
  skillInstances: SkillInfo[],
  removedProvider: string,
): RelocationInfo | null {
  const hasRealFolder = plan.directories.some((d) => !d.isSymlink);
  if (!hasRealFolder) return null;

  const remaining = skillInstances.filter(
    (s) => s.provider !== removedProvider,
  );
  if (remaining.length === 0) return null;

  const target = findRelocationTarget(skillInstances, removedProvider);
  if (!target) return null;

  const realDir = plan.directories.find((d) => !d.isSymlink);
  return {
    needed: true,
    fromProvider: removedProvider,
    fromPath: realDir?.path || "",
    toProvider: target.provider,
    toPath: target.path,
  };
}

export async function cleanEmptyParentDirs(paths: string[]): Promise<string[]> {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    const parent = dirname(p);
    if (seen.has(parent)) continue;
    seen.add(parent);

    try {
      const entries = await readdir(parent);
      const filtered = entries.filter(
        (e) => e !== ".DS_Store" && e !== ".gitkeep",
      );
      if (filtered.length === 0) {
        await rm(parent, { recursive: true, force: true });
        cleaned.push(parent);
      }
    } catch {
      // directory doesn't exist or can't be read — skip
    }
  }

  return cleaned;
}

export async function executeRemoval(
  plan: RemovalPlan,
  symlinkTo?: string,
): Promise<string[]> {
  const log: string[] = [];

  // Remove directories/symlinks
  for (const dir of plan.directories) {
    try {
      if (dir.isSymlink) {
        await rm(dir.path);
        log.push(`Removed symlink: ${dir.path}`);
      } else {
        await rm(dir.path, { recursive: true, force: true });
        log.push(`Removed directory: ${dir.path}`);
      }

      // Replace with symlink to kept instance (for duplicate removal)
      if (symlinkTo && resolve(dir.path) !== resolve(symlinkTo)) {
        const parentDir = dirname(dir.path);
        const relTarget = relative(parentDir, symlinkTo);
        await symlink(relTarget, dir.path, "dir");
        log.push(`Created symlink: ${dir.path} -> ${relTarget}`);
      }
    } catch (err: any) {
      log.push(`Failed to remove ${dir.path}: ${err.message}`);
    }
  }

  // Clean up empty parent directories
  const removedDirs = plan.directories.map((d) => d.path);
  const emptyDirs = await cleanEmptyParentDirs(removedDirs);
  for (const dir of emptyDirs) {
    log.push(`Removed empty parent directory: ${dir}`);
  }

  // Remove rule files
  for (const ruleFile of plan.ruleFiles) {
    if (await fileExists(ruleFile)) {
      try {
        await rm(ruleFile);
        log.push(`Removed rule file: ${ruleFile}`);
      } catch (err: any) {
        log.push(`Failed to remove ${ruleFile}: ${err.message}`);
      }
    }
  }

  // Remove AGENTS.md blocks
  for (const block of plan.agentsBlocks) {
    try {
      await removeAgentsMdBlock(block.file, block.skillName);
      log.push(`Cleaned AGENTS.md block in: ${block.file}`);
    } catch (err: any) {
      log.push(`Failed to clean AGENTS.md block: ${err.message}`);
    }
  }

  return log;
}

export async function getExistingTargets(plan: RemovalPlan): Promise<string[]> {
  const existing: string[] = [];

  for (const dir of plan.directories) {
    if (await fileExists(dir.path)) {
      const lstats = await lstat(dir.path);
      const type = lstats.isSymbolicLink() ? "symlink" : "directory";
      existing.push(`${dir.path} (${type})`);
    }
  }

  for (const ruleFile of plan.ruleFiles) {
    if (await fileExists(ruleFile)) {
      existing.push(ruleFile);
    }
  }

  for (const block of plan.agentsBlocks) {
    if (await fileExists(block.file)) {
      const content = await readFile(block.file, "utf-8");
      // Check both new and old marker formats
      if (
        content.includes(`<!-- agent-skill-manager: ${block.skillName} -->`) ||
        content.includes(`<!-- skill-manager: ${block.skillName} -->`) ||
        content.includes(`<!-- pskills: ${block.skillName} -->`)
      ) {
        existing.push(`${block.file} (AGENTS.md block)`);
      }
    }
  }

  return existing;
}
