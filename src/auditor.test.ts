import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  detectDuplicates,
  sortInstancesForKeep,
  reasonLabel,
  formatAuditReport,
  formatAuditReportJSON,
} from "./auditor";
import type { SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/home/user/.claude/skills/test-skill";
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

describe("detectDuplicates", () => {
  it("returns empty report for empty input", () => {
    const report = detectDuplicates([]);
    expect(report.totalSkills).toBe(0);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.totalDuplicateInstances).toBe(0);
    expect(report.scannedAt).toBeTruthy();
  });

  it("returns no duplicates for unique skills", () => {
    const skills = [
      makeSkill({ dirName: "skill-a", name: "Skill A", path: "/a" }),
      makeSkill({ dirName: "skill-b", name: "Skill B", path: "/b" }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.totalSkills).toBe(2);
  });

  it("returns no duplicates for single skill", () => {
    const report = detectDuplicates([makeSkill()]);
    expect(report.duplicateGroups).toHaveLength(0);
  });

  it("detects same dirName at different locations", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.claude/skills/code-review",
        location: "global-claude",
        provider: "claude",
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.codex/skills/code-review",
        location: "global-codex",
        provider: "codex",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0].key).toBe("code-review");
    expect(report.duplicateGroups[0].reason).toBe("same-dirName");
    expect(report.duplicateGroups[0].instances).toHaveLength(2);
    expect(report.totalDuplicateInstances).toBe(2);
  });

  it("does not flag same dirName at same location as duplicate", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        path: "/home/user/.claude/skills/code-review",
        location: "global-claude",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(0);
  });

  it("detects same frontmatter name with different dirName", () => {
    const skills = [
      makeSkill({
        dirName: "code-review-v1",
        name: "Code Review",
        path: "/home/user/.claude/skills/code-review-v1",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "code-review-v2",
        name: "Code Review",
        path: "/home/user/.claude/skills/code-review-v2",
        location: "global-claude",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0].key).toBe("Code Review");
    expect(report.duplicateGroups[0].reason).toBe("same-frontmatterName");
    expect(report.duplicateGroups[0].instances).toHaveLength(2);
  });

  it("detects three copies of same dirName", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/home/user/.claude/skills/deploy",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/home/user/.codex/skills/deploy",
        location: "global-codex",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/project/.claude/skills/deploy",
        location: "project-claude",
        scope: "project",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0].instances).toHaveLength(3);
    expect(report.totalDuplicateInstances).toBe(3);
  });

  it("does not double-report skills covered by dirName rule under name rule", () => {
    // Same dirName AND same name — should only appear once as same-dirName
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.claude/skills/code-review",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.codex/skills/code-review",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0].reason).toBe("same-dirName");
  });

  it("sorts groups: same-dirName before same-frontmatterName", () => {
    const skills = [
      // same-frontmatterName group
      makeSkill({
        dirName: "review-a",
        name: "Review Tool",
        path: "/a",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "review-b",
        name: "Review Tool",
        path: "/b",
        location: "global-claude",
      }),
      // same-dirName group
      makeSkill({
        dirName: "deploy",
        name: "deploy",
        path: "/c",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        name: "deploy",
        path: "/d",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(2);
    expect(report.duplicateGroups[0].reason).toBe("same-dirName");
    expect(report.duplicateGroups[1].reason).toBe("same-frontmatterName");
  });

  it("handles mixed duplicates correctly", () => {
    const skills = [
      // dirName group
      makeSkill({
        dirName: "lint",
        name: "Linter",
        path: "/claude/lint",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "lint",
        name: "Linter",
        path: "/codex/lint",
        location: "global-codex",
      }),
      // name group (different dirNames, same name)
      makeSkill({
        dirName: "format-v1",
        name: "Formatter",
        path: "/claude/format-v1",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "format-v2",
        name: "Formatter",
        path: "/claude/format-v2",
        location: "global-claude",
      }),
      // unique skill
      makeSkill({
        dirName: "unique",
        name: "Unique",
        path: "/claude/unique",
        location: "global-claude",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(2);
    expect(report.totalSkills).toBe(5);
    expect(report.totalDuplicateInstances).toBe(4);
  });

  it("produces valid scannedAt timestamp", () => {
    const report = detectDuplicates([]);
    const date = new Date(report.scannedAt);
    expect(date.getTime()).not.toBeNaN();
  });

  it("does not flag symlink and its target as duplicates", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.agents/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-custom",
        provider: "custom",
        isSymlink: false,
        symlinkTarget: null,
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.claude/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-claude",
        provider: "claude",
        isSymlink: true,
        symlinkTarget: "../../.agents/skills/code-review",
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(0);
  });

  it("keeps the non-symlink entry when deduplicating by realPath", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.claude/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-claude",
        provider: "claude",
        isSymlink: true,
        symlinkTarget: "../../.agents/skills/code-review",
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.agents/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-custom",
        provider: "custom",
        isSymlink: false,
        symlinkTarget: null,
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.totalSkills).toBe(2);
  });

  it("still detects true duplicates when symlinks are present", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.agents/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-custom",
        provider: "custom",
        isSymlink: false,
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.claude/skills/code-review",
        realPath: "/home/user/.agents/skills/code-review",
        location: "global-claude",
        provider: "claude",
        isSymlink: true,
        symlinkTarget: "../../.agents/skills/code-review",
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        path: "/home/user/.codex/skills/code-review",
        realPath: "/home/user/.codex/skills/code-review",
        location: "global-codex",
        provider: "codex",
        isSymlink: false,
      }),
    ];
    const report = detectDuplicates(skills);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0].reason).toBe("same-dirName");
    expect(report.duplicateGroups[0].instances).toHaveLength(2);
  });
});

describe("sortInstancesForKeep", () => {
  it("sorts global before project", () => {
    const instances = [
      makeSkill({ scope: "project", path: "/project/a" }),
      makeSkill({ scope: "global", path: "/global/a" }),
    ];
    const sorted = sortInstancesForKeep(instances);
    expect(sorted[0].scope).toBe("global");
    expect(sorted[1].scope).toBe("project");
  });

  it("sorts by provider label within same scope", () => {
    const instances = [
      makeSkill({ providerLabel: "Codex", path: "/codex/a" }),
      makeSkill({ providerLabel: "Claude Code", path: "/claude/a" }),
    ];
    const sorted = sortInstancesForKeep(instances);
    expect(sorted[0].providerLabel).toBe("Claude Code");
    expect(sorted[1].providerLabel).toBe("Codex");
  });

  it("sorts by path as tiebreaker", () => {
    const instances = [
      makeSkill({ path: "/z/skill" }),
      makeSkill({ path: "/a/skill" }),
    ];
    const sorted = sortInstancesForKeep(instances);
    expect(sorted[0].path).toBe("/a/skill");
    expect(sorted[1].path).toBe("/z/skill");
  });

  it("does not mutate the original array", () => {
    const instances = [
      makeSkill({ scope: "project", path: "/b" }),
      makeSkill({ scope: "global", path: "/a" }),
    ];
    const originalFirst = instances[0];
    sortInstancesForKeep(instances);
    expect(instances[0]).toBe(originalFirst);
  });
});

// ─── reasonLabel ──────────────────────────────────────────────────────────

describe("reasonLabel", () => {
  it("returns 'same dirName' for same-dirName", () => {
    expect(reasonLabel("same-dirName")).toBe("same dirName");
  });

  it("returns 'same name' for same-frontmatterName", () => {
    expect(reasonLabel("same-frontmatterName")).toBe("same name");
  });
});

// ─── formatAuditReport ──────────────────────────────────────────────────────

describe("formatAuditReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  it("returns green message when no duplicates", () => {
    const report = detectDuplicates([]);
    const output = formatAuditReport(report);
    expect(output).toContain("No duplicate skills found.");
  });

  it("shows duplicate group header with count", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/claude/deploy",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/codex/deploy",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    const output = formatAuditReport(report);
    expect(output).toContain("1 duplicate group(s)");
    expect(output).toContain("2 total instances");
  });

  it("shows group key and reason", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/claude/deploy",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/codex/deploy",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    const output = formatAuditReport(report);
    expect(output).toContain('"deploy"');
    expect(output).toContain("same dirName");
  });

  it("marks first sorted instance with [keep]", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/codex/deploy",
        location: "global-codex",
        providerLabel: "Codex",
        scope: "project",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/claude/deploy",
        location: "global-claude",
        providerLabel: "Claude Code",
        scope: "global",
      }),
    ];
    const report = detectDuplicates(skills);
    const output = formatAuditReport(report);
    expect(output).toContain("[keep]");
  });

  it("shows asm audit instruction", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/claude/deploy",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/codex/deploy",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    const output = formatAuditReport(report);
    expect(output).toContain("asm audit -y");
  });
});

// ─── formatAuditReportJSON ──────────────────────────────────────────────────

describe("formatAuditReportJSON", () => {
  it("returns valid JSON", () => {
    const report = detectDuplicates([]);
    const output = formatAuditReportJSON(report);
    const parsed = JSON.parse(output);
    expect(parsed.totalSkills).toBe(0);
    expect(parsed.duplicateGroups).toHaveLength(0);
  });

  it("includes all report fields", () => {
    const skills = [
      makeSkill({
        dirName: "deploy",
        path: "/claude/deploy",
        location: "global-claude",
      }),
      makeSkill({
        dirName: "deploy",
        path: "/codex/deploy",
        location: "global-codex",
      }),
    ];
    const report = detectDuplicates(skills);
    const output = formatAuditReportJSON(report);
    const parsed = JSON.parse(output);
    expect(parsed.scannedAt).toBeTruthy();
    expect(parsed.totalSkills).toBe(2);
    expect(parsed.duplicateGroups).toHaveLength(1);
    expect(parsed.totalDuplicateInstances).toBe(2);
  });
});
