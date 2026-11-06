import { access, lstat, mkdir, readdir, readFile, rm, stat } from "fs/promises";
import type { Stats } from "fs";
import { join } from "path";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { createDirSymlink } from "./utils/fs";

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
  // Check path exists and is a directory. Use `stat` (not `lstat`) so a
  // symlink that points at a directory is treated as a directory — this is
  // important when relinking an already-installed/symlinked skill. A broken
  // symlink throws ENOENT and falls into the "does not exist" branch.
  let stats;
  try {
    stats = await stat(absPath);
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

/**
 * Create a directory symlink at `targetDir/name` pointing at `sourcePath`.
 *
 * This is the install-side primitive: with `force` it removes whatever sits
 * at the target (including a real directory) before recreating the link.
 * `asm install` relies on that when it re-links across tools.
 *
 * `asm link` uses {@link createLinkSafely} instead — see its contract.
 */
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

  // Ensure the parent directory exists before creating the symlink
  await mkdir(targetDir, { recursive: true });

  // Create symlink (a junction on Windows — see createDirSymlink)
  await createDirSymlink(sourcePath, targetPath);
}

/**
 * Create a directory symlink at `targetDir/name` pointing at `sourcePath`,
 * following the same overwrite contract as `asm activate`
 * (`activateLibrarySkill` in `src/library-core.ts`):
 *
 * - An existing target fails unless `force` is set — even when the existing
 *   link already points at the same source.
 * - With `force`, only symlinks are replaced. A dangling symlink counts as a
 *   symlink and is replaced; a real file or directory is refused and left
 *   untouched, so `--force` can never destroy user data.
 *
 * `lstat` (not `access`) is used so a dangling symlink is detected as an
 * existing target instead of being treated as free space.
 */
export async function createLinkSafely(
  sourcePath: string,
  targetDir: string,
  name: string,
  force: boolean,
): Promise<void> {
  const targetPath = join(targetDir, name);

  let existing: Stats | null = null;
  try {
    existing = await lstat(targetPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }

  if (existing) {
    if (!force) {
      throw new Error(
        `Target already exists: ${targetPath}. Use --force to overwrite.`,
      );
    }
    if (!existing.isSymbolicLink()) {
      throw new Error(
        `Refusing to overwrite non-symlink target: ${targetPath}.`,
      );
    }
    // Remove the link only — never the directory it points at.
    await rm(targetPath, { force: true });
  }

  await mkdir(targetDir, { recursive: true });
  await createDirSymlink(sourcePath, targetPath);
}

/**
 * Scan immediate subdirectories of `absPath` for SKILL.md files.
 * Returns an array of linkable skills found. Only checks one level deep.
 */
export async function discoverLinkableSkills(
  absPath: string,
): Promise<LinkableSkill[]> {
  // Verify path exists and is a directory. Follow symlinks (see
  // validateLinkSource) so directory-symlinks work as link targets.
  let stats;
  try {
    stats = await stat(absPath);
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
