import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildRemovalPlan,
  buildFullRemovalPlan,
  executeRemoval,
  getExistingTargets,
  findRelocationTarget,
  buildRelocationInfo,
  cleanEmptyParentDirs,
} from "./uninstaller";
import type {
  SkillInfo,
  AppConfig,
  RemovalPlan,
  RelocationInfo,
} from "./utils/types";
import { homedir, tmpdir } from "os";
import { resolve, join, relative, dirname } from "path";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readlink,
  lstat,
  realpath,
  rm,
  symlink,
  readdir,
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
    license: "",
    compatibility: "",
    allowedTools: [],
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
    effort: undefined,
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

  it("does not rewrite AGENTS.md when no marker for the skill is present", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-agents-md-mtime-"));
    try {
      const agentsMdPath = join(base, "AGENTS.md");
      const content = [
        "# Agents",
        "",
        "<!-- agent-skill-manager: other-skill -->",
        "Block for a different skill",
        "<!-- /agent-skill-manager: other-skill -->",
        "",
      ].join("\n");
      await writeFile(agentsMdPath, content, "utf-8");
      const beforeMtime = (await lstat(agentsMdPath)).mtimeMs;

      // Wait briefly so any rewrite would produce a measurably newer mtime
      await new Promise((r) => setTimeout(r, 20));

      const plan: RemovalPlan = {
        directories: [],
        ruleFiles: [],
        agentsBlocks: [{ file: agentsMdPath, skillName: "missing-skill" }],
      };

      await executeRemoval(plan);

      const afterMtime = (await lstat(agentsMdPath)).mtimeMs;
      expect(afterMtime).toBe(beforeMtime);

      // Content is byte-for-byte unchanged
      const { readFile } = await import("fs/promises");
      const after = await readFile(agentsMdPath, "utf-8");
      expect(after).toBe(content);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
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

// ─── buildFullRemovalPlan with filtering ──────────────────────────────────────

describe("buildFullRemovalPlan with options", () => {
  it("filters by provider when providerFilter is set", () => {
    const config = makeConfig();
    const skills: SkillInfo[] = [
      makeSkill({
        dirName: "my-skill",
        provider: "claude",
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        dirName: "my-skill",
        provider: "codex",
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const plan = buildFullRemovalPlan("my-skill", skills, config, {
      providerFilter: "claude",
    });
    expect(plan.directories).toHaveLength(1);
    expect(plan.directories[0].path).toContain(".claude");
  });

  it("filters by scope when scopeFilter is set", () => {
    const config = makeConfig();
    const skills: SkillInfo[] = [
      makeSkill({
        dirName: "my-skill",
        scope: "global",
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        dirName: "my-skill",
        scope: "project",
        originalPath: ".claude/skills/my-skill",
      }),
    ];

    const plan = buildFullRemovalPlan("my-skill", skills, config, {
      scopeFilter: "global",
    });
    expect(plan.directories).toHaveLength(1);
    expect(plan.directories[0].path).toContain(HOME);
  });

  it("returns empty plan when no skills match filters", () => {
    const config = makeConfig();
    const skills: SkillInfo[] = [
      makeSkill({
        dirName: "my-skill",
        provider: "claude",
      }),
    ];

    const plan = buildFullRemovalPlan("my-skill", skills, config, {
      providerFilter: "codex",
    });
    expect(plan.directories).toHaveLength(0);
  });
});

// ─── findRelocationTarget ─────────────────────────────────────────────────

describe("findRelocationTarget", () => {
  it("returns null when no remaining instances", () => {
    const instances = [makeSkill({ provider: "claude" })];
    expect(findRelocationTarget(instances, "claude")).toBeNull();
  });

  it("prefers a real folder over symlinks", () => {
    const instances: SkillInfo[] = [
      makeSkill({
        provider: "claude",
        isSymlink: false,
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        provider: "codex",
        isSymlink: true,
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const result = findRelocationTarget(instances, "claude");
    expect(result).not.toBeNull();
    expect(result!.path).toBe(`${HOME}/.codex/skills/my-skill`);
  });

  it("falls back to symlink when no real folder remains", () => {
    const instances: SkillInfo[] = [
      makeSkill({
        provider: "claude",
        isSymlink: true,
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        provider: "codex",
        isSymlink: true,
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const result = findRelocationTarget(instances, "claude");
    expect(result).not.toBeNull();
    expect(result!.path).toBe(`${HOME}/.codex/skills/my-skill`);
  });
});

// ─── buildRelocationInfo ──────────────────────────────────────────────────

describe("buildRelocationInfo", () => {
  it("returns null when no real folder in plan", () => {
    const plan: RemovalPlan = {
      directories: [{ path: "/some/symlink", isSymlink: true }],
      ruleFiles: [],
      agentsBlocks: [],
    };
    const instances = [makeSkill({ provider: "claude" })];

    expect(buildRelocationInfo(plan, instances, "claude")).toBeNull();
  });

  it("returns RelocationInfo when real folder is being removed", () => {
    const plan: RemovalPlan = {
      directories: [
        { path: `${HOME}/.claude/skills/my-skill`, isSymlink: false },
      ],
      ruleFiles: [],
      agentsBlocks: [],
    };
    const instances: SkillInfo[] = [
      makeSkill({
        provider: "claude",
        isSymlink: false,
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        provider: "codex",
        isSymlink: true,
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const info = buildRelocationInfo(plan, instances, "claude");
    expect(info).not.toBeNull();
    expect(info!.needed).toBe(true);
    expect(info!.fromProvider).toBe("claude");
    expect(info!.toProvider).toBe("codex");
  });

  it("returns null when no remaining providers", () => {
    const plan: RemovalPlan = {
      directories: [
        { path: `${HOME}/.claude/skills/my-skill`, isSymlink: false },
      ],
      ruleFiles: [],
      agentsBlocks: [],
    };
    const instances = [
      makeSkill({
        provider: "claude",
        isSymlink: false,
      }),
    ];

    expect(buildRelocationInfo(plan, instances, "claude")).toBeNull();
  });

  it("returns null when the relocation target is itself a real folder and no symlinks survive", () => {
    // Two-real-folders topology with no other symlinks. No relocation
    // needed and no symlinks to repoint — the standard removal path
    // safely handles this.
    const plan: RemovalPlan = {
      directories: [
        { path: `${HOME}/.claude/skills/my-skill`, isSymlink: false },
      ],
      ruleFiles: [],
      agentsBlocks: [],
    };
    const instances: SkillInfo[] = [
      makeSkill({
        provider: "claude",
        isSymlink: false,
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        provider: "codex",
        isSymlink: false,
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    expect(buildRelocationInfo(plan, instances, "claude")).toBeNull();
  });

  it("returns repoint-only RelocationInfo when target is a real folder but symlinks survive", () => {
    // Three providers: claude (real, being removed) + codex (real, kept)
    // + agents (symlink pointing at claude's folder). Without repointing,
    // the agents symlink would dangle after claude's folder is deleted.
    const plan: RemovalPlan = {
      directories: [
        { path: `${HOME}/.claude/skills/my-skill`, isSymlink: false },
      ],
      ruleFiles: [],
      agentsBlocks: [],
    };
    const instances: SkillInfo[] = [
      makeSkill({
        provider: "claude",
        isSymlink: false,
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        provider: "codex",
        isSymlink: false,
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
      makeSkill({
        provider: "agents",
        isSymlink: true,
        originalPath: `${HOME}/.agents/skills/my-skill`,
      }),
    ];

    const info = buildRelocationInfo(plan, instances, "claude");
    expect(info).not.toBeNull();
    expect(info!.repointOnly).toBe(true);
    expect(info!.toPath).toBe(`${HOME}/.codex/skills/my-skill`);
    expect(info!.repointPaths).toEqual([`${HOME}/.agents/skills/my-skill`]);
  });
});

// ─── cleanEmptyParentDirs ────────────────────────────────────────────────

describe("cleanEmptyParentDirs", () => {
  it("removes empty parent directories", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-cleanup-"));
    try {
      const skillDir = join(base, "skills", "my-skill");
      await mkdir(skillDir, { recursive: true });

      // Simulate: the skill dir was already removed
      await rm(skillDir, { recursive: true, force: true });

      const cleaned = await cleanEmptyParentDirs([skillDir]);
      expect(cleaned).toContain(join(base, "skills"));

      const exists = await readdir(join(base, "skills")).then(
        () => true,
        () => false,
      );
      expect(exists).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("does not remove directories with other entries", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-cleanup-"));
    try {
      const skillDir = join(base, "skills", "my-skill");
      const otherFile = join(base, "skills", "other-skill");
      await mkdir(skillDir, { recursive: true });
      await mkdir(otherFile, { recursive: true });

      await rm(skillDir, { recursive: true, force: true });

      const cleaned = await cleanEmptyParentDirs([skillDir]);
      expect(cleaned).not.toContain(join(base, "skills"));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("skips .DS_Store entries when checking emptiness", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-cleanup-"));
    try {
      const skillDir = join(base, "skills", "my-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(base, "skills", ".DS_Store"), "");

      // Simulate: the skill dir was already removed
      await rm(skillDir, { recursive: true, force: true });

      const cleaned = await cleanEmptyParentDirs([skillDir]);
      expect(cleaned).toContain(join(base, "skills"));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("preserves directories containing .gitkeep", async () => {
    // A checked-in .gitkeep is a deliberate placeholder — removing the
    // last skill must not silently wipe it.
    const base = await mkdtemp(join(tmpdir(), "asm-cleanup-gitkeep-"));
    try {
      const skillDir = join(base, "skills", "my-skill");
      const gitkeep = join(base, "skills", ".gitkeep");
      await mkdir(skillDir, { recursive: true });
      await writeFile(gitkeep, "");

      await rm(skillDir, { recursive: true, force: true });

      const cleaned = await cleanEmptyParentDirs([skillDir]);
      expect(cleaned).not.toContain(join(base, "skills"));

      // The .gitkeep itself must still exist
      const stats = await lstat(gitkeep);
      expect(stats.isFile()).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("handles non-existent directories gracefully", async () => {
    const cleaned = await cleanEmptyParentDirs(["/tmp/nonexistent-xyz"]);
    expect(cleaned).toHaveLength(0);
  });
});

// ─── executeRemoval with real-folder relocation (real install topology) ─────

describe("executeRemoval with relocation", () => {
  it("renames real folder to kept slot and preserves content", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-reloc-"));
    try {
      // Real install topology: one real folder + one symlink pointing to it
      const realDir = join(base, "claude", "skills", "my-skill");
      const linkDir = join(base, "codex", "skills", "my-skill");
      await mkdir(realDir, { recursive: true });
      await mkdir(dirname(linkDir), { recursive: true });
      await writeFile(join(realDir, "SKILL.md"), "real content");
      await symlink(realDir, linkDir, "dir");

      // Sanity: the symlink resolves to the real content
      const preResolve = await realpath(linkDir);
      expect(preResolve).toBe(await realpath(realDir));

      const plan: RemovalPlan = {
        directories: [{ path: realDir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const relocation: RelocationInfo = {
        needed: true,
        fromProvider: "claude",
        fromPath: realDir,
        toProvider: "codex",
        toPath: linkDir,
        repointPaths: [],
      };

      const log = await executeRemoval(plan, undefined, relocation);

      // The kept slot is now a real directory with the original content
      const targetStats = await lstat(linkDir);
      expect(targetStats.isSymbolicLink()).toBe(false);
      expect(targetStats.isDirectory()).toBe(true);
      const { readFile } = await import("fs/promises");
      const skillContent = await readFile(join(linkDir, "SKILL.md"), "utf-8");
      expect(skillContent).toBe("real content");

      // The original real-folder path is gone (no cycle, no leftover entry)
      try {
        await lstat(realDir);
        throw new Error("realDir should not exist");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }

      // Log mentions the relocation
      expect(log.some((l) => l.includes("Relocated real folder"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("repoints surviving symlinks at the new canonical path", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-reloc-multi-"));
    try {
      // Three providers: claude (real), codex (symlink), agents (symlink)
      const realDir = join(base, "claude", "skills", "my-skill");
      const linkA = join(base, "codex", "skills", "my-skill");
      const linkB = join(base, "agents", "skills", "my-skill");
      await mkdir(realDir, { recursive: true });
      await mkdir(dirname(linkA), { recursive: true });
      await mkdir(dirname(linkB), { recursive: true });
      await writeFile(join(realDir, "SKILL.md"), "shared content");
      await symlink(realDir, linkA, "dir");
      await symlink(realDir, linkB, "dir");

      const plan: RemovalPlan = {
        directories: [{ path: realDir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const relocation: RelocationInfo = {
        needed: true,
        fromProvider: "claude",
        fromPath: realDir,
        toProvider: "codex",
        toPath: linkA,
        repointPaths: [linkB],
      };

      await executeRemoval(plan, undefined, relocation);

      // linkA becomes the real folder
      const aStats = await lstat(linkA);
      expect(aStats.isSymbolicLink()).toBe(false);
      expect(aStats.isDirectory()).toBe(true);

      // linkB is still a symlink, now pointing at linkA — no cycle
      const bStats = await lstat(linkB);
      expect(bStats.isSymbolicLink()).toBe(true);
      const bResolved = await realpath(linkB);
      expect(bResolved).toBe(await realpath(linkA));

      // Content is intact and reachable from both surviving paths
      const { readFile } = await import("fs/promises");
      const fromA = await readFile(join(linkA, "SKILL.md"), "utf-8");
      const fromB = await readFile(join(linkB, "SKILL.md"), "utf-8");
      expect(fromA).toBe("shared content");
      expect(fromB).toBe("shared content");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("repoints surviving symlinks in repoint-only mode (two real folders + symlink)", async () => {
    // Two real folders (claude being removed, codex kept) + a third
    // symlink at agents/ pointing at claude's folder. Without repoint
    // the agents symlink would dangle when claude's folder is deleted.
    const base = await mkdtemp(join(tmpdir(), "asm-reloc-repoint-only-"));
    try {
      const claudeReal = join(base, "claude", "skills", "my-skill");
      const codexReal = join(base, "codex", "skills", "my-skill");
      const agentsLink = join(base, "agents", "skills", "my-skill");
      await mkdir(claudeReal, { recursive: true });
      await mkdir(codexReal, { recursive: true });
      await mkdir(dirname(agentsLink), { recursive: true });
      await writeFile(join(claudeReal, "SKILL.md"), "claude content");
      await writeFile(join(codexReal, "SKILL.md"), "codex content");
      await symlink(claudeReal, agentsLink, "dir");

      const plan: RemovalPlan = {
        directories: [{ path: claudeReal, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const relocation: RelocationInfo = {
        needed: true,
        fromProvider: "claude",
        fromPath: claudeReal,
        toProvider: "codex",
        toPath: codexReal,
        repointPaths: [agentsLink],
        repointOnly: true,
      };

      await executeRemoval(plan, undefined, relocation);

      // codex real folder is untouched — relocation did NOT rename over it
      const codexStats = await lstat(codexReal);
      expect(codexStats.isDirectory()).toBe(true);
      const { readFile } = await import("fs/promises");
      const codexContent = await readFile(join(codexReal, "SKILL.md"), "utf-8");
      expect(codexContent).toBe("codex content");

      // claude's real folder is gone (standard removal still runs)
      try {
        await lstat(claudeReal);
        throw new Error("claudeReal should not exist");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }

      // agents symlink no longer dangles — resolves to codex's real folder
      const agentsStats = await lstat(agentsLink);
      expect(agentsStats.isSymbolicLink()).toBe(true);
      const agentsResolved = await realpath(agentsLink);
      expect(agentsResolved).toBe(await realpath(codexReal));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("isolates per-symlink repoint failures and logs a rollback hint", async () => {
    const base = await mkdtemp(join(tmpdir(), "asm-reloc-partial-"));
    try {
      const realDir = join(base, "claude", "skills", "my-skill");
      const goodLink = join(base, "codex", "skills", "my-skill");
      // Place a regular file where the second symlink's PARENT should be,
      // so mkdir+symlink on its child will fail (ENOTDIR), simulating a
      // mid-loop repoint failure.
      const blockedParent = join(base, "agents", "skills");
      const blockedLink = join(blockedParent, "my-skill");
      await mkdir(realDir, { recursive: true });
      await mkdir(dirname(goodLink), { recursive: true });
      await mkdir(dirname(blockedParent), { recursive: true });
      await writeFile(blockedParent, "not a directory");
      await writeFile(join(realDir, "SKILL.md"), "content");
      await symlink(realDir, goodLink, "dir");

      const plan: RemovalPlan = {
        directories: [{ path: realDir, isSymlink: false }],
        ruleFiles: [],
        agentsBlocks: [],
      };

      const relocation: RelocationInfo = {
        needed: true,
        fromProvider: "claude",
        fromPath: realDir,
        toProvider: "codex",
        toPath: goodLink,
        repointPaths: [blockedLink],
      };

      const log = await executeRemoval(plan, undefined, relocation);

      // The good slot was relocated even though the other repoint failed
      const goodStats = await lstat(goodLink);
      expect(goodStats.isSymbolicLink()).toBe(false);
      expect(goodStats.isDirectory()).toBe(true);

      // Log mentions the failure and includes a manual-fix hint
      const failEntry = log.find((l) =>
        l.includes("Failed to repoint symlink"),
      );
      expect(failEntry).toBeDefined();
      expect(failEntry).toContain(blockedLink);
      expect(failEntry).toContain("ln -sfn");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

// ─── buildFullRemovalPlan: AGENTS.md filter regression ─────────────────────

describe("buildFullRemovalPlan AGENTS.md filtering", () => {
  it("does not strip codex AGENTS.md when --tool=claude and codex still has the skill", () => {
    const config = makeConfig();
    const skills: SkillInfo[] = [
      makeSkill({
        dirName: "my-skill",
        provider: "claude",
        scope: "global",
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        dirName: "my-skill",
        provider: "codex",
        scope: "global",
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const plan = buildFullRemovalPlan("my-skill", skills, config, {
      providerFilter: "claude",
    });

    // The codex AGENTS.md path must NOT appear — codex still has the skill
    const codexBlock = plan.agentsBlocks.find((b) => b.file.includes(".codex"));
    expect(codexBlock).toBeUndefined();

    // The claude AGENTS.md path SHOULD appear (claude is being uninstalled)
    const claudeBlock = plan.agentsBlocks.find((b) =>
      b.file.includes(".claude"),
    );
    expect(claudeBlock).toBeDefined();
  });

  it("strips all global AGENTS.md when no providerFilter (full removal)", () => {
    const config = makeConfig();
    const skills: SkillInfo[] = [
      makeSkill({
        dirName: "my-skill",
        provider: "claude",
        scope: "global",
        originalPath: `${HOME}/.claude/skills/my-skill`,
      }),
      makeSkill({
        dirName: "my-skill",
        provider: "codex",
        scope: "global",
        originalPath: `${HOME}/.codex/skills/my-skill`,
      }),
    ];

    const plan = buildFullRemovalPlan("my-skill", skills, config);

    // Both providers are being uninstalled — both AGENTS.md blocks should appear
    expect(plan.agentsBlocks.some((b) => b.file.includes(".claude"))).toBe(
      true,
    );
    expect(plan.agentsBlocks.some((b) => b.file.includes(".codex"))).toBe(true);
  });
});
