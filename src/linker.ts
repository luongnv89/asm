import { access, lstat, readdir, readFile, rm, symlink } from "fs/promises";
import { join } from "path";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";

export interface LinkableSkill {
  /** Absolute path to the skill directory */
  absPath: string;
  /** Directory name (basename) */
  dirName: string;
  /** Skill name from SKILL.md frontmatter */
  name: string;
  /** Skill version from SKILL.md frontmatter */
  version: string;
}

export async function validateLinkSource(
  absPath: string,
): Promise<{ name: string; version: string }> {
  // Check path exists and is a directory
  let stats;
  try {
    stats = await lstat(absPath);
  } catch {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }

  // Check for SKILL.md
  const skillMdPath = join(absPath, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error(`No SKILL.md found in ${absPath}`);
  }

  // Parse frontmatter
  const fm = parseFrontmatter(content);
  if (!fm.name) {
    throw new Error(
      `Invalid SKILL.md in ${absPath}: missing "name" in frontmatter`,
    );
  }

  return {
    name: fm.name,
    version: resolveVersion(fm),
  };
}

export async function createLink(
  sourcePath: string,
  targetDir: string,
  name: string,
  force: boolean,
): Promise<void> {
  const targetPath = join(targetDir, name);

  // Check if target already exists
  let exists = false;
  try {
    await access(targetPath);
    exists = true;
  } catch {
    // doesn't exist — good
  }

  if (exists) {
    if (!force) {
      throw new Error(
        `Target already exists: ${targetPath}. Use --force to overwrite.`,
      );
    }
    // Remove existing
    await rm(targetPath, { recursive: true, force: true });
  }

  // Create symlink
  await symlink(sourcePath, targetPath, "dir");
}

/**
 * Scan immediate subdirectories of `absPath` for SKILL.md files.
 * Returns an array of linkable skills found. Only checks one level deep.
 */
export async function discoverLinkableSkills(
  absPath: string,
): Promise<LinkableSkill[]> {
  // Verify path exists and is a directory
  let stats;
  try {
    stats = await lstat(absPath);
  } catch {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${absPath}`);
  }

  const entries = await readdir(absPath);
  const skills: LinkableSkill[] = [];

  for (const entry of entries) {
    // Skip hidden directories and node_modules
    if (entry.startsWith(".") || entry === "node_modules") continue;

    const fullPath = join(absPath, entry);
    try {
      const s = await lstat(fullPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = join(fullPath, "SKILL.md");
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm.name) {
        skills.push({
          absPath: fullPath,
          dirName: entry,
          name: fm.name,
          version: resolveVersion(fm),
        });
      }
    } catch {
      // No SKILL.md or invalid — skip
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}
