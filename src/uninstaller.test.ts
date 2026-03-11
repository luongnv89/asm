import { describe, expect, it } from "bun:test";
import { buildRemovalPlan, buildFullRemovalPlan } from "./uninstaller";
import type { SkillInfo, AppConfig } from "./utils/types";
import { homedir } from "os";
import { resolve } from "path";

const HOME = homedir();

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    providers: [
      {
        name: "claude",
        label: "Claude Code",
        global: "~/.claude/skills",
        project: ".claude/skills",
        enabled: true,
      },
      {
        name: "codex",
        label: "Codex",
        global: "~/.codex/skills",
        project: ".codex/skills",
        enabled: true,
      },
    ],
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    dirName: "test-skill",
    path: `${HOME}/.claude/skills/test-skill`,
    originalPath: `${HOME}/.claude/skills/test-skill`,
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

describe("buildRemovalPlan", () => {
  it("includes the skill directory for global skill", () => {
    const skill = makeSkill();
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    expect(plan.directories).toHaveLength(1);
    expect(plan.directories[0].path).toBe(skill.originalPath);
    expect(plan.directories[0].isSymlink).toBe(false);
  });

  it("marks symlink directory correctly", () => {
    const skill = makeSkill({ isSymlink: true });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    expect(plan.directories[0].isSymlink).toBe(true);
  });

  it("generates rule files for project-scoped skill", () => {
    const skill = makeSkill({
      scope: "project",
      dirName: "my-skill",
      originalPath: ".claude/skills/my-skill",
    });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    expect(plan.ruleFiles).toHaveLength(3);
    expect(plan.ruleFiles).toContain(
      resolve(".cursor", "rules", "my-skill.mdc"),
    );
    expect(plan.ruleFiles).toContain(
      resolve(".windsurf", "rules", "my-skill.md"),
    );
    expect(plan.ruleFiles).toContain(
      resolve(".github", "instructions", "my-skill.instructions.md"),
    );
  });

  it("does not generate rule files for global-scoped skill", () => {
    const skill = makeSkill({ scope: "global" });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);
    expect(plan.ruleFiles).toHaveLength(0);
  });

  it("adds AGENTS.md blocks for project-scoped skill", () => {
    const skill = makeSkill({
      scope: "project",
      dirName: "test-skill",
      originalPath: ".claude/skills/test-skill",
    });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    expect(plan.agentsBlocks).toHaveLength(1);
    expect(plan.agentsBlocks[0].file).toBe(resolve("AGENTS.md"));
    expect(plan.agentsBlocks[0].skillName).toBe("test-skill");
  });

  it("adds AGENTS.md blocks for all enabled providers on global skill", () => {
    const skill = makeSkill({ scope: "global" });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    // 2 enabled providers + possibly codex AGENTS.md dedup
    expect(plan.agentsBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("skips disabled providers in global AGENTS.md blocks", () => {
    const skill = makeSkill({ scope: "global" });
    const config = makeConfig({
      providers: [
        {
          name: "claude",
          label: "Claude Code",
          global: "~/.claude/skills",
          project: ".claude/skills",
          enabled: true,
        },
        {
          name: "codex",
          label: "Codex",
          global: "~/.codex/skills",
          project: ".codex/skills",
          enabled: false,
        },
      ],
    });
    const plan = buildRemovalPlan(skill, config);

    // Only claude provider enabled + codex AGENTS.md fallback
    const claudeBlock = plan.agentsBlocks.find((b) =>
      b.file.includes(".claude"),
    );
    expect(claudeBlock).toBeDefined();
  });

  it("avoids duplicate codex AGENTS.md entry", () => {
    const skill = makeSkill({ scope: "global" });
    const config = makeConfig();
    const plan = buildRemovalPlan(skill, config);

    const codexBlocks = plan.agentsBlocks.filter((b) =>
      b.file.includes(".codex"),
    );
    // Should not have duplicates for the same file+skillName
    const unique = new Set(codexBlocks.map((b) => b.file));
    expect(codexBlocks.length).toBe(unique.size);
  });
});

describe("buildFullRemovalPlan", () => {
  it("returns empty plan when no matching skills", () => {
    const config = makeConfig();
    const plan = buildFullRemovalPlan("nonexistent", [], config);
    expect(plan.directories).toHaveLength(0);
    expect(plan.ruleFiles).toHaveLength(0);
    expect(plan.agentsBlocks).toHaveLength(0);
  });

  it("combines plans for multiple matching skills (same dirName)", () => {
    const config = makeConfig();
    const skills = [
      makeSkill({
        dirName: "shared-skill",
        scope: "global",
        originalPath: `${HOME}/.claude/skills/shared-skill`,
      }),
      makeSkill({
        dirName: "shared-skill",
        scope: "project",
        originalPath: ".codex/skills/shared-skill",
      }),
    ];

    const plan = buildFullRemovalPlan("shared-skill", skills, config);
    expect(plan.directories).toHaveLength(2);
  });

  it("deduplicates directories with the same path", () => {
    const config = makeConfig();
    const samePath = `${HOME}/.claude/skills/dup-skill`;
    const skills = [
      makeSkill({
        dirName: "dup-skill",
        originalPath: samePath,
        scope: "global",
      }),
      makeSkill({
        dirName: "dup-skill",
        originalPath: samePath,
        scope: "global",
      }),
    ];

    const plan = buildFullRemovalPlan("dup-skill", skills, config);
    expect(plan.directories).toHaveLength(1);
  });

  it("deduplicates rule files", () => {
    const config = makeConfig();
    const skills = [
      makeSkill({
        dirName: "dup-skill",
        scope: "project",
        originalPath: ".claude/skills/dup-skill",
      }),
      makeSkill({
        dirName: "dup-skill",
        scope: "project",
        originalPath: ".codex/skills/dup-skill",
      }),
    ];

    const plan = buildFullRemovalPlan("dup-skill", skills, config);
    // Rule files are resolved identically for project skills with same dirName
    const uniqueRules = new Set(plan.ruleFiles);
    expect(plan.ruleFiles.length).toBe(uniqueRules.size);
  });

  it("deduplicates AGENTS.md blocks with same file+skillName", () => {
    const config = makeConfig();
    const skills = [
      makeSkill({
        dirName: "dup-skill",
        scope: "project",
        originalPath: ".claude/skills/dup-skill",
      }),
      makeSkill({
        dirName: "dup-skill",
        scope: "project",
        originalPath: ".codex/skills/dup-skill",
      }),
    ];

    const plan = buildFullRemovalPlan("dup-skill", skills, config);
    const blockKeys = plan.agentsBlocks.map((b) => `${b.file}::${b.skillName}`);
    const uniqueKeys = new Set(blockKeys);
    expect(blockKeys.length).toBe(uniqueKeys.size);
  });

  it("ignores skills with different dirName", () => {
    const config = makeConfig();
    const skills = [
      makeSkill({ dirName: "target-skill", scope: "global" }),
      makeSkill({ dirName: "other-skill", scope: "global" }),
    ];

    const plan = buildFullRemovalPlan("target-skill", skills, config);
    expect(plan.directories).toHaveLength(1);
    expect(plan.directories[0].path).toContain("test-skill"); // from makeSkill default originalPath
  });
});
