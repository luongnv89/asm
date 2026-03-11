import { rm, readFile, writeFile, access, lstat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import type { SkillInfo, RemovalPlan } from "./utils/types";

const HOME = homedir();

export function buildRemovalPlan(skill: SkillInfo): RemovalPlan {
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

  // Check for tool-specific rule files based on scope
  if (skill.scope === "project" || skill.location === "project-claude" || skill.location === "project-agents") {
    plan.ruleFiles.push(
      resolve(".cursor", "rules", `${name}.mdc`),
      resolve(".windsurf", "rules", `${name}.md`),
      resolve(".github", "instructions", `${name}.instructions.md`),
    );
    plan.agentsBlocks.push(
      { file: resolve("AGENTS.md"), skillName: name },
    );
  }

  if (skill.scope === "global") {
    plan.agentsBlocks.push(
      { file: join(HOME, ".codex", "AGENTS.md"), skillName: name },
    );
  }

  return plan;
}

export function buildFullRemovalPlan(dirName: string, allSkills: SkillInfo[]): RemovalPlan {
  const matching = allSkills.filter((s) => s.dirName === dirName);
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
    const plan = buildRemovalPlan(skill);

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

async function removeAgentsMdBlock(filePath: string, skillName: string): Promise<void> {
  if (!(await fileExists(filePath))) return;

  const content = await readFile(filePath, "utf-8");
  const startMarker = `<!-- pskills: ${skillName} -->`;
  const endMarker = `<!-- /pskills: ${skillName} -->`;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) return;

  // Remove from just before the start marker to just after the end marker
  let removeStart = startIdx;
  // Include the preceding newline if present
  if (removeStart > 0 && content[removeStart - 1] === "\n") {
    removeStart--;
  }

  const removeEnd = endIdx + endMarker.length;
  // Include the trailing newline if present
  let actualEnd = removeEnd;
  if (actualEnd < content.length && content[actualEnd] === "\n") {
    actualEnd++;
  }

  const newContent = content.slice(0, removeStart) + content.slice(actualEnd);
  await writeFile(filePath, newContent, "utf-8");
}

export async function executeRemoval(plan: RemovalPlan): Promise<string[]> {
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
    } catch (err: any) {
      log.push(`Failed to remove ${dir.path}: ${err.message}`);
    }
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
      if (content.includes(`<!-- pskills: ${block.skillName} -->`)) {
        existing.push(`${block.file} (AGENTS.md block)`);
      }
    }
  }

  return existing;
}
