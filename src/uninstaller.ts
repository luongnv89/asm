import {
  rm,
  readFile,
  writeFile,
  access,
  lstat,
  symlink,
  rename,
  readdir,
  mkdir,
  unlink,
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
  const allMatching = allSkills.filter((s) => s.dirName === dirName);
  let matching = allMatching;
  if (options?.providerFilter) {
    matching = matching.filter((s) => s.provider === options.providerFilter);
  }
  if (options?.scopeFilter) {
    matching = matching.filter((s) => s.scope === options.scopeFilter);
  }
  if (matching.length === 0) {
    return { directories: [], ruleFiles: [], agentsBlocks: [] };
  }

  // Providers (per scope) that still have surviving instances after the
  // filter — their AGENTS.md must NOT be touched.
  const survivingKeys = new Set(
    allMatching
      .filter((s) => !matching.includes(s))
      .map((s) => `${s.provider}::${s.scope}`),
  );

  // Map an AGENTS.md path to the (provider, scope) it belongs to, so we
  // can decide whether the block is safe to strip.
  function classifyAgentsMd(
    file: string,
  ): { provider: string; scope: Scope } | null {
    // Project-scope AGENTS.md is at <cwd>/AGENTS.md
    if (file === resolve("AGENTS.md")) {
      // Belongs to whichever project provider the matching set covers.
      // For project scope, any surviving project instance keeps it alive.
      const projectSurvivor = Array.from(survivingKeys).find((k) =>
        k.endsWith("::project"),
      );
      if (projectSurvivor) {
        return { provider: projectSurvivor.split("::")[0], scope: "project" };
      }
      return null;
    }
    // Global AGENTS.md is at <providerGlobalDir>/../AGENTS.md
    for (const provider of config.providers) {
      const globalDir = resolveProviderPath(provider.global);
      const agentsMdPath = join(dirname(globalDir), "AGENTS.md");
      if (file === agentsMdPath) {
        return { provider: provider.name, scope: "global" };
      }
    }
    // Explicit codex fallback (~/.codex/AGENTS.md)
    if (file === join(HOME, ".codex", "AGENTS.md")) {
      return { provider: "codex", scope: "global" };
    }
    return null;
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
      if (seenBlocks.has(key)) continue;

      const classified = classifyAgentsMd(block.file);
      if (classified) {
        const survivorKey = `${classified.provider}::${classified.scope}`;
        if (survivingKeys.has(survivorKey)) continue;
      }

      seenBlocks.add(key);
      combined.agentsBlocks.push(block);
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
  let modified = false;

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
    modified = true;
  }

  if (!modified) return;
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
  const repointPaths = remaining
    .map((s) => s.originalPath)
    .filter((p) => p !== target.path);

  // If the relocation target is itself a real folder, the kept provider
  // already has the content — don't rename (that would destroy it). But
  // surviving symlinks may still point at the about-to-be-removed real
  // folder; without repointing they become dangling. Emit a repoint-only
  // plan when there's at least one symlink to fix; otherwise skip.
  const targetInstance = remaining.find((s) => s.originalPath === target.path);
  if (targetInstance && !targetInstance.isSymlink) {
    if (repointPaths.length === 0) return null;
    return {
      needed: true,
      fromProvider: removedProvider,
      fromPath: realDir?.path || "",
      toProvider: target.provider,
      toPath: target.path,
      repointPaths,
      repointOnly: true,
    };
  }

  return {
    needed: true,
    fromProvider: removedProvider,
    fromPath: realDir?.path || "",
    toProvider: target.provider,
    toPath: target.path,
    repointPaths,
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
      // .DS_Store is OS noise (macOS Finder); a checked-in .gitkeep is a
      // deliberate placeholder and must keep the directory alive.
      const filtered = entries.filter((e) => e !== ".DS_Store");
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
  relocation?: RelocationInfo,
): Promise<string[]> {
  const log: string[] = [];

  // When a relocation is requested, physically move the real folder to
  // the kept provider's slot BEFORE removing the source directory. This
  // is the only safe order: a delete-then-symlink-to-sibling sequence
  // would orphan the original symlink at the target slot and lose data
  // when symlinks were the surviving instances.
  //
  // In repoint-only mode, the target already holds a real folder — skip
  // the rename and only repoint surviving symlinks so they don't dangle
  // when the removed provider's real folder gets deleted below.
  if (relocation?.needed) {
    if (!relocation.repointOnly) {
      try {
        const targetParent = dirname(relocation.toPath);
        await mkdir(targetParent, { recursive: true });

        // The target slot is currently a symlink (or stale entry) pointing
        // back at fromPath. Unlink it so rename has a clean destination.
        try {
          await unlink(relocation.toPath);
        } catch (err: any) {
          if (err.code !== "ENOENT") {
            // Best-effort: if it's a non-empty dir we can't move over, fall
            // back to a full remove so rename can proceed.
            await rm(relocation.toPath, { recursive: true, force: true });
          }
        }

        try {
          await rename(relocation.fromPath, relocation.toPath);
        } catch (err: any) {
          if (err.code === "EXDEV") {
            // Cross-device rename — fall back to recursive copy + remove.
            // Rare on a single-user machine but possible when ~/.claude and
            // ~/.codex live on different mounts (NFS, encrypted volumes).
            const { cp } = await import("fs/promises");
            await cp(relocation.fromPath, relocation.toPath, {
              recursive: true,
              preserveTimestamps: true,
            });
            await rm(relocation.fromPath, { recursive: true, force: true });
          } else {
            throw err;
          }
        }
        log.push(
          `Relocated real folder: ${relocation.fromPath} -> ${relocation.toPath}`,
        );
      } catch (err: any) {
        log.push(`Failed to relocate real folder: ${err.message}`);
      }
    }

    // Re-point any other surviving symlinks at the new canonical path.
    // Each repoint is isolated so one failure doesn't abort the rest;
    // failures log the from/to so the user can recreate the symlink.
    for (const repointPath of relocation.repointPaths || []) {
      const parentDir = dirname(repointPath);
      const relTarget = relative(parentDir, relocation.toPath);
      try {
        try {
          await unlink(repointPath);
        } catch (err: any) {
          if (err.code !== "ENOENT") {
            await rm(repointPath, { recursive: true, force: true });
          }
        }
        await mkdir(parentDir, { recursive: true });
        await symlink(relTarget, repointPath, "dir");
        log.push(`Repointed symlink: ${repointPath} -> ${relTarget}`);
      } catch (err: any) {
        log.push(
          `Failed to repoint symlink ${repointPath} -> ${relTarget}: ${err.message}. To fix manually: ln -sfn ${relocation.toPath} ${repointPath}`,
        );
      }
    }
  }

  // Remove directories/symlinks. When a relocation just moved fromPath
  // away, skip removing it here — rename already consumed the entry. In
  // repoint-only mode no rename happened, so the source still needs to
  // be removed below.
  for (const dir of plan.directories) {
    try {
      if (
        relocation?.needed &&
        !relocation.repointOnly &&
        resolve(dir.path) === resolve(relocation.fromPath)
      ) {
        continue;
      }

      if (dir.isSymlink) {
        await rm(dir.path);
        log.push(`Removed symlink: ${dir.path}`);
      } else {
        await rm(dir.path, { recursive: true, force: true });
        log.push(`Removed directory: ${dir.path}`);
      }

      // Replace with symlink to kept instance (for duplicate removal).
      // Not used in the relocation flow — relocation already handled it.
      if (
        !relocation?.needed &&
        symlinkTo &&
        resolve(dir.path) !== resolve(symlinkTo)
      ) {
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
