import type { SkillInfo, ExportManifest, ExportedSkill } from "./utils/types";

export function buildManifest(skills: SkillInfo[]): ExportManifest {
  const exportedSkills: ExportedSkill[] = skills.map((s) => ({
    name: s.name,
    version: s.version,
    dirName: s.dirName,
    provider: s.provider,
    scope: s.scope,
    path: s.path,
    isSymlink: s.isSymlink,
    symlinkTarget: s.symlinkTarget,
    effort: s.effort,
  }));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    skills: exportedSkills,
  };
}
