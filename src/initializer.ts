import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";

export function generateSkillMd(name: string): string {
  return `---
name: ${name}
version: 0.1.0
description: ""
---

# ${name}

Describe what this skill does here. This content will be loaded by the AI agent
as instructions for when and how to use this skill.

## When to Use

- Describe the trigger conditions for this skill

## Instructions

- Step-by-step instructions for the agent
`;
}

export async function scaffoldSkill(
  name: string,
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const skillMdPath = join(targetDir, "SKILL.md");
  const content = generateSkillMd(name);
  await writeFile(skillMdPath, content, "utf-8");
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
