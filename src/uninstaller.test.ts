import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  buildRemovalPlan,
  buildFullRemovalPlan,
  executeRemoval,
  getExistingTargets,
} from "./uninstaller";
import type { SkillInfo, AppConfig, RemovalPlan } from "./utils/types";
import { homedir, tmpdir } from "os";
import { resolve, join, relative } from "path";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readlink,
  lstat,
  realpath,
  rm,
  symlink,
} from "fs/promises";

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
    creator: "",
    dirName: "test-skill",
    path: `${HOME}/.claude/skills/test-skill`,
    originalPath: `${HOME}/.claude/skills/test-skill`,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: `${HOME}/.claude/skills/test-skill`,
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

describe("executeRemoval with symlinkTo", () => {
  it("creates symlink to kept instance after removing directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-test-"));
    try {
      const keptDir = join(base, "provider-a", "my-skill");
      const dupDir = join(base, "provider-b", "my-skill");
      await mkdir(keptDir, { recursive: true });
      await mkdir(dupDir, { recursive: true });
      await writeFile(join(keptDir, "SKILL.md"), "kept");
      await writeFile(join(dupDir, "SKILL.md"), "dup");

      const plan: RemovalPlan = {
        directories: [{ path: dupDir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const log = await executeRemoval(plan, keptDir);

      // dupDir should now be a symlink
      const stats = await lstat(dupDir);
      expect(stats.isSymbolicLink()).toBe(true);

      // Should point to the kept directory via relative path
      const target = await readlink(dupDir);
      const expectedRel = relative(join(base, "provider-b"), keptDir);
      expect(target).toBe(expectedRel);

      // Should resolve to the kept directory
      const resolved = await realpath(dupDir);
      const expectedReal = await realpath(keptDir);
      expect(resolved).toBe(expectedReal);

      expect(log).toContain(`Removed directory: ${dupDir}`);
      expect(log.some((l) => l.startsWith("Created symlink:"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("re-points existing symlink to kept instance", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-test-"));
    try {
      const keptDir = join(base, "kept");
      const oldTarget = join(base, "old");
      const dupLink = join(base, "dup-link");
      await mkdir(keptDir, { recursive: true });
      await mkdir(oldTarget, { recursive: true });
      await symlink(oldTarget, dupLink, "dir");

      const plan: RemovalPlan = {
        directories: [{ path: dupLink, isSymlink: true }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const log = await executeRemoval(plan, keptDir);

      const stats = await lstat(dupLink);
      expect(stats.isSymbolicLink()).toBe(true);
      const resolved = await realpath(dupLink);
      const expectedReal = await realpath(keptDir);
      expect(resolved).toBe(expectedReal);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("does NOT create symlink when symlinkTo is not provided", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-test-"));
    try {
      const dupDir = join(base, "my-skill");
      await mkdir(dupDir, { recursive: true });

      const plan: RemovalPlan = {
        directories: [{ path: dupDir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      await executeRemoval(plan);

      // dupDir should not exist at all
      try {
        await lstat(dupDir);
        throw new Error("should not exist");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

// ─── executeRemoval with rule files and AGENTS.md ────────────────────────────

describe("executeRemoval with rule files", () => {
  it("removes existing rule files", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-uninstall-rules-"));
    try {
      const ruleFile = join(base, "my-skill.mdc");
      await writeFile(ruleFile, "rule content");

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [ruleFile],
        agentsBlocks: [],
      };

      const log = await executeRemoval(plan);
      expect(log.some((l) => l.includes("Removed rule file"))).toBe(true);

      try {
        await lstat(ruleFile);
        throw new Error("should not exist");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("skips non-existent rule files without error", async () => {
    const plan: RemovalPlan = {
      directories: [],
      ruleFiles: ["/tmp/nonexistent-rule-xyz.mdc"],
      agentsBlocks: [],
    };

    const log = await executeRemoval(plan);
    // No "Removed rule file" entry since file doesn't exist
    expect(log.every((l) => !l.includes("Removed rule file"))).toBe(true);
  });
});

describe("executeRemoval with AGENTS.md blocks", () => {
  it("removes a skill block from AGENTS.md", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-agents-md-"));
    try {
      const agentsMdPath = join(base, "AGENTS.md");
      const content = [
        "# Agents",
        "",
        "<!-- agent-skill-manager: my-skill -->",
        "Some skill content here",
        "<!-- /agent-skill-manager: my-skill -->",
        "",
        "Other content",
      ].join("\n");
      await writeFile(agentsMdPath, content, "utf-8");

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [],
        agentsBlocks: [{ file: agentsMdPath, skillName: "my-skill" }],
      };

      await executeRemoval(plan);

      const { readFile } = await import("fs/promises");
      const updated = await readFile(agentsMdPath, "utf-8");
      expect(updated).not.toContain("agent-skill-manager: my-skill");
      expect(updated).toContain("Other content");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("removes old marker format (pskills) blocks", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-agents-md-old-"));
    try {
      const agentsMdPath = join(base, "AGENTS.md");
      const content = [
        "# Agents",
        "",
        "<!-- pskills: old-skill -->",
        "Old skill content",
        "<!-- /pskills: old-skill -->",
        "",
        "Keep this",
      ].join("\n");
      await writeFile(agentsMdPath, content, "utf-8");

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [],
        agentsBlocks: [{ file: agentsMdPath, skillName: "old-skill" }],
      };

      await executeRemoval(plan);

      const { readFile } = await import("fs/promises");
      const updated = await readFile(agentsMdPath, "utf-8");
      expect(updated).not.toContain("pskills: old-skill");
      expect(updated).toContain("Keep this");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("handles non-existent AGENTS.md gracefully", async () => {
    const plan: RemovalPlan = {
      directories: [],
      ruleFiles: [],
      agentsBlocks: [
        {
          file: "/tmp/nonexistent-agents-md-xyz/AGENTS.md",
          skillName: "test",
        },
      ],
    };

    const log = await executeRemoval(plan);
    // Should not throw; no "Failed" entries in the log
    expect(log.every((l) => !l.includes("Failed"))).toBe(true);
  });
});

// ─── getExistingTargets ─────────────────────────────────────────────────────

describe("getExistingTargets", () => {
  it("returns existing directories with type label", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-existing-"));
    try {
      const dir = join(base, "my-skill");
      await mkdir(dir);

      const plan: RemovalPlan = {
        directories: [{ path: dir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const targets = await getExistingTargets(plan);
      expect(
        targets.some((t) => t.includes(dir) && t.includes("directory")),
      ).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("identifies symlinks with type label", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-existing-sym-"));
    try {
      const realDir = join(base, "real");
      const linkDir = join(base, "link");
      await mkdir(realDir);
      await symlink(realDir, linkDir, "dir");

      const plan: RemovalPlan = {
        directories: [{ path: linkDir, isSymlink: true }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const targets = await getExistingTargets(plan);
      expect(
        targets.some((t) => t.includes(linkDir) && t.includes("symlink")),
      ).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("returns existing rule files", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-existing-rules-"));
    try {
      const ruleFile = join(base, "skill.mdc");
      await writeFile(ruleFile, "content");

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [ruleFile],
        agentsBlocks: [],
      };

      const targets = await getExistingTargets(plan);
      expect(targets).toContain(ruleFile);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("skips non-existent directories and files", async () => {
    const plan: RemovalPlan = {
      directories: [{ path: "/tmp/nonexistent-dir-xyz", isSymlink: false }],
      ruleFiles: ["/tmp/nonexistent-rule-xyz.mdc"],
      agentsBlocks: [],
    };

    const targets = await getExistingTargets(plan);
    expect(targets).toHaveLength(0);
  });

  it("detects AGENTS.md blocks with agent-skill-manager markers", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-targets-agents-"));
    try {
      const agentsMd = join(base, "AGENTS.md");
      await writeFile(
        agentsMd,
        "# Agents\n<!-- agent-skill-manager: my-skill -->\nContent\n<!-- /agent-skill-manager: my-skill -->\n",
      );

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [],
        agentsBlocks: [{ file: agentsMd, skillName: "my-skill" }],
      };

      const targets = await getExistingTargets(plan);
      expect(targets.some((t) => t.includes("AGENTS.md block"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("detects AGENTS.md blocks with old pskills markers", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-targets-pskills-"));
    try {
      const agentsMd = join(base, "AGENTS.md");
      await writeFile(
        agentsMd,
        "# Agents\n<!-- pskills: old-skill -->\nOld\n<!-- /pskills: old-skill -->\n",
      );

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [],
        agentsBlocks: [{ file: agentsMd, skillName: "old-skill" }],
      };

      const targets = await getExistingTargets(plan);
      expect(targets.some((t) => t.includes("AGENTS.md block"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
