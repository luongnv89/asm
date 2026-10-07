import { readFile } from "fs/promises";
import { join } from "path";
import type { LibrarySkillInfo } from "./library-core";
import {
  parseFrontmatter,
  resolveModelInvocable,
  resolveUserInvocable,
} from "./utils/frontmatter";
import { estimateTokenCount } from "./utils/token-count";
import type { Scope, SkillInfo } from "./utils/types";

/**
 * Library ghosts: skills present in the ASM library but not installed in the
 * listed scope. The library is the SSOT inventory — ghosts are the set
 * difference between the library and the scope's installed names.
 *
 * The lock file only carries provenance metadata, so each ghost's display
 * fields (description, creator, effort, token count) are enriched from the
 * library copy's SKILL.md. Entries whose library directory is missing are
 * skipped — there is nothing to link.
 */
export async function buildGhostSkills(
  library: LibrarySkillInfo[],
  installed: SkillInfo[],
  scope: Scope,
): Promise<SkillInfo[]> {
  if (scope === "both") return [];
  const installedNames = new Set(
    installed.map((s) => s.dirName.toLowerCase()),
  );
  const candidates = library.filter(
    (lib) =>
      !lib.missing && !installedNames.has(lib.dirName.toLowerCase()),
  );

  return Promise.all(
    candidates.map(async (lib): Promise<SkillInfo> => {
      let frontmatter: Record<string, string> = {};
      let content = "";
      try {
        content = await readFile(
          join(lib.libraryPath, "SKILL.md"),
          "utf-8",
        );
        frontmatter = parseFrontmatter(content);
      } catch {
        // Unreadable SKILL.md — keep lock metadata, blank display fields.
      }

      return {
        name: lib.name,
        version: lib.version,
        description: (frontmatter.description || "")
          .replace(/\s*\n\s*/g, " ")
          .trim(),
        creator: frontmatter["metadata.creator"] || "",
        license: (frontmatter.license || "").trim(),
        compatibility: (frontmatter.compatibility || "").trim(),
        allowedTools: [],
        modelInvocable: content
          ? resolveModelInvocable(frontmatter)
          : undefined,
        userInvocable: content
          ? resolveUserInvocable(frontmatter)
          : undefined,
        effort: frontmatter.effort || frontmatter["metadata.effort"],
        dirName: lib.dirName,
        path: lib.libraryPath,
        originalPath: lib.libraryPath,
        location: "library",
        scope,
        provider: "library",
        providerLabel: "Library",
        isSymlink: false,
        symlinkTarget: null,
        realPath: lib.libraryPath,
        tokenCount: content ? estimateTokenCount(content) : undefined,
        isGhost: true,
      };
    }),
  );
}
