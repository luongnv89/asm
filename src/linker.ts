import { access, lstat, readFile, rm, symlink } from "fs/promises";
import { join } from "path";
import { parseFrontmatter } from "./utils/frontmatter";

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
    version: fm.version || "0.0.0",
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
