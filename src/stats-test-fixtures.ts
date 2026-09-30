// Shared fixtures for the stats test files — split from stats.test.ts (#677).
import type { SkillInfo, AuditReport, RepoIndex } from "./utils/types";

export function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/tmp/test-skill";
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path,
    originalPath: path,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: path,
    fileCount: 3,
    effort: undefined,
    ...overrides,
  };
}

export function emptyAuditReport(): AuditReport {
  return {
    scannedAt: new Date().toISOString(),
    totalSkills: 0,
    duplicateGroups: [],
    totalDuplicateInstances: 0,
  };
}

export function makeRepoIndex(overrides: Partial<RepoIndex> = {}): RepoIndex {
  return {
    repoUrl: "https://github.com/test/repo",
    owner: "test",
    repo: "repo",
    updatedAt: new Date().toISOString(),
    skillCount: 0,
    skills: [],
    ...overrides,
  };
}
