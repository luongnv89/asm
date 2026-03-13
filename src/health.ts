import { readFile } from "fs/promises";
import { join } from "path";
import type { SkillInfo, SkillWarning } from "./utils/types";

const HIGH_FILE_COUNT_THRESHOLD = 500;

function hasBody(content: string): boolean {
  const lines = content.split("\n");
  let inFrontmatter = false;
  let closedFrontmatter = false;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        closedFrontmatter = true;
        continue;
      }
    }
    if (closedFrontmatter && line.trim().length > 0) {
      return true;
    }
  }
  return false;
}

export async function checkHealth(skill: SkillInfo): Promise<SkillWarning[]> {
  const warnings: SkillWarning[] = [];

  if (!skill.description || skill.description.trim() === "") {
    warnings.push({
      category: "missing-description",
      message: "Skill has no description in SKILL.md frontmatter",
    });
  }

  if (!skill.version || skill.version === "0.0.0") {
    warnings.push({
      category: "missing-version",
      message:
        "Skill has no version (or default 0.0.0) in SKILL.md frontmatter",
    });
  }

  // Check for empty body
  try {
    const skillMdPath = join(skill.path, "SKILL.md");
    const content = await readFile(skillMdPath, "utf-8");
    if (!hasBody(content)) {
      warnings.push({
        category: "empty-body",
        message: "SKILL.md contains only frontmatter with no body content",
      });
    }
  } catch {
    // Can't read SKILL.md — skip body check
  }

  const fileCount = skill.fileCount;
  if (fileCount !== undefined && fileCount > HIGH_FILE_COUNT_THRESHOLD) {
    warnings.push({
      category: "high-file-count",
      message: `Skill has ${fileCount} files (threshold: ${HIGH_FILE_COUNT_THRESHOLD})`,
    });
  }

  return warnings;
}
