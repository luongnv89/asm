import { describe, expect, it } from "bun:test";
import { searchSkills, sortSkills } from "./scanner";
import type { SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    dirName: "test-skill",
    path: "/home/user/.claude/skills/test-skill",
    originalPath: "/home/user/.claude/skills/test-skill",
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    fileCount: 3,
    ...overrides,
  };
}

describe("searchSkills", () => {
  const skills = [
    makeSkill({ name: "code-review", description: "Reviews code quality" }),
    makeSkill({
      name: "test-runner",
      description: "Runs unit tests",
      providerLabel: "Codex",
    }),
    makeSkill({
      name: "deploy-helper",
      description: "Helps deploy apps",
      location: "project-agents",
    }),
  ];

  it("returns all skills for empty query", () => {
    expect(searchSkills(skills, "")).toHaveLength(3);
  });

  it("returns all skills for whitespace-only query", () => {
    expect(searchSkills(skills, "   ")).toHaveLength(3);
  });

  it("filters by skill name", () => {
    const result = searchSkills(skills, "code-review");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("code-review");
  });

  it("filters by description", () => {
    const result = searchSkills(skills, "unit tests");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-runner");
  });

  it("filters by provider label", () => {
    const result = searchSkills(skills, "codex");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-runner");
  });

  it("filters by location", () => {
    const result = searchSkills(skills, "project-agents");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("deploy-helper");
  });

  it("is case insensitive", () => {
    const result = searchSkills(skills, "CODE-REVIEW");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("code-review");
  });

  it("returns empty array when nothing matches", () => {
    expect(searchSkills(skills, "nonexistent")).toHaveLength(0);
  });

  it("matches partial strings", () => {
    const result = searchSkills(skills, "deploy");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("deploy-helper");
  });

  it("can match multiple skills", () => {
    const result = searchSkills(skills, "l"); // all three: review/deploy/heaper all contain "l" via labels or fields
    // "code-review" has "Claude Code" label, "test-runner" has "Codex", "deploy-helper" has "deploy" and "Helps"
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sortSkills", () => {
  const skills = [
    makeSkill({ name: "zeta", version: "3.0.0", location: "project-claude" }),
    makeSkill({ name: "alpha", version: "1.0.0", location: "global-agents" }),
    makeSkill({ name: "mid", version: "2.0.0", location: "global-claude" }),
  ];

  it("sorts by name", () => {
    const result = sortSkills(skills, "name");
    expect(result.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("sorts by version", () => {
    const result = sortSkills(skills, "version");
    expect(result.map((s) => s.version)).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
  });

  it("sorts by location", () => {
    const result = sortSkills(skills, "location");
    expect(result.map((s) => s.location)).toEqual([
      "global-agents",
      "global-claude",
      "project-claude",
    ]);
  });

  it("does not mutate the original array", () => {
    const original = [...skills];
    sortSkills(skills, "name");
    expect(skills[0].name).toBe(original[0].name);
  });

  it("handles empty array", () => {
    expect(sortSkills([], "name")).toEqual([]);
  });

  it("handles single element array", () => {
    const single = [makeSkill({ name: "only" })];
    const result = sortSkills(single, "name");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("only");
  });
});
