/**
 * Library skills as SkillInfo — the shared loader behind library tag coverage.
 *
 * `scanAllSkills` only walks provider directories (see src/scanner.ts), so a
 * skill that lives solely in the ASM library (`<config>/library/skills`) is
 * invisible to `asm list`, `asm tag add`, and every tag aggregation. This
 * module reads the library lock file and each library copy's SKILL.md and
 * returns them as `SkillInfo` rows so those commands can treat library
 * skills exactly like installed ones.
 *
 * Deliberately not built on `buildGhostSkills` (src/ghost-skills.ts):
 *  - ghosts carry no tags — the whole point of this loader is tags;
 *  - ghosts return `[]` for scope "both", which is the default scope;
 *  - ghosts are a TUI display concept ("skill exists but is not installed"),
 *    not a data source for tag accounting.
 *
 * Keying: the tag state is keyed by `realPath` (see `skillTagKey`), and an
 * *activated* library skill is symlinked into the provider directory, so its
 * scanned `realPath` resolves to the same canonical directory as the library
 * copy. Both rows therefore share one tag record — an activated library skill
 * and its library copy are one skill, not two.
 */
import { readFile, realpath } from "fs/promises";
import { join } from "path";
import { listLibrarySkills } from "./library-core";
import { parseFrontmatter, resolveTags } from "./utils/frontmatter";
import type { SkillInfo } from "./utils/types";

/** How many library SKILL.md files are read concurrently. */
const LIBRARY_READ_CONCURRENCY = 16;

/**
 * A skill that exists in the ASM library.
 *
 * `libraryPath` is the canonical on-disk directory (symlinks resolved);
 * `realPath` carries the same value so library rows can be keyed with
 * `skillTagKey` and grouped with installed rows by canonical directory.
 */
export interface LibrarySkill extends SkillInfo {}

/**
 * Load every library skill that still exists on disk.
 *
 * Lock entries whose directory has disappeared are skipped: there is no
 * SKILL.md to read and nothing to tag. Rows are returned in the lock file's
 * order (name-sorted, as `listLibrarySkills` yields them).
 */
export async function loadLibrarySkills(): Promise<LibrarySkill[]> {
  const entries = await listLibrarySkills();
  const present = entries.filter((entry) => !entry.missing);

  const skills = await Promise.all(
    present.map(async (entry): Promise<LibrarySkill> => {
      let frontmatter: Record<string, string> = {};
      let content = "";
      try {
        content = await readFile(join(entry.libraryPath, "SKILL.md"), "utf-8");
        frontmatter = parseFrontmatter(content);
      } catch {
        // Unreadable SKILL.md — keep lock metadata, blank display fields.
      }

      // Resolve symlinks so an activated copy of this skill (symlinked into
      // a provider directory) collapses onto the same tag record.
      let canonicalPath = entry.libraryPath;
      try {
        canonicalPath = await realpath(entry.libraryPath);
      } catch {
        // Unresolvable directory — keep the recorded path.
      }

      return {
        name: frontmatter.name || entry.name,
        version: frontmatter["metadata.version"] || frontmatter.version || entry.version,
        description: (frontmatter.description || "")
          .replace(/\s*\n\s*/g, " ")
          .trim(),
        creator: frontmatter["metadata.creator"] || "",
        license: (frontmatter.license || "").trim(),
        compatibility: (frontmatter.compatibility || "").trim(),
        allowedTools: [],
        tags: resolveTags(frontmatter),
        dirName: entry.dirName,
        path: entry.libraryPath,
        originalPath: entry.libraryPath,
        location: "library",
        scope: "global",
        provider: "library",
        providerLabel: "Library",
        isSymlink: false,
        symlinkTarget: null,
        realPath: canonicalPath,
      };
    }),
  );

  return skills;
}

/**
 * Split library skills into the ones a scan already covers and the rest.
 *
 * A library skill that is activated into a provider is visible to
 * `scanAllSkills` under the same canonical path, so it must not be counted
 * twice. `coveredPaths` holds the `realPath` of every already-scanned skill.
 */
export function partitionLibrarySkills(
  library: LibrarySkill[],
  coveredPaths: Set<string>,
): { libraryOnly: LibrarySkill[]; alreadyScanned: LibrarySkill[] } {
  const libraryOnly: LibrarySkill[] = [];
  const alreadyScanned: LibrarySkill[] = [];
  for (const skill of library) {
    if (coveredPaths.has(skill.realPath)) alreadyScanned.push(skill);
    else libraryOnly.push(skill);
  }
  return { libraryOnly, alreadyScanned };
}
