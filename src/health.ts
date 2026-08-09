import { readFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
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

function extractRawFrontmatter(content: string): string | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (start === -1) {
        start = i + 1;
      } else {
        return lines.slice(start, i).join("\n");
      }
    }
  }
  return null;
}

function validateYamlFrontmatter(content: string): string | null {
  const raw = extractRawFrontmatter(content);
  if (raw === null) return null;
  try {
    parseYaml(raw);
    return null;
  } catch (err: any) {
    return err.message || "invalid YAML";
  }
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

  // Check SKILL.md content, reusing the scanner's read when available.
  try {
    const content =
      skill._skillMdContent !== undefined
        ? skill._skillMdContent
        : await readFile(join(skill.path, "SKILL.md"), "utf-8");
    if (!hasBody(content)) {
      warnings.push({
        category: "empty-body",
        message: "SKILL.md contains only frontmatter with no body content",
      });
    }

    const yamlError = validateYamlFrontmatter(content);
    if (yamlError) {
      warnings.push({
        category: "invalid-yaml",
        message: `SKILL.md has invalid YAML frontmatter: ${yamlError}`,
      });
    }
  } catch {
    // Can't read SKILL.md — skip content checks
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
