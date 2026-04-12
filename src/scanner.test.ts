import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, symlink, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  searchSkills,
  sortSkills,
  scanAllSkills,
  scanPluginMarketplaces,
  compareSemver,
  countFiles,
} from "./scanner";
import { setVerbose } from "./logger";
import { getDefaultConfig } from "./config";
import type { SkillInfo } from "./utils/types";

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
    path: "/home/user/.claude/skills/test-skill",
    originalPath: "/home/user/.claude/skills/test-skill",
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/home/user/.claude/skills/test-skill",
    fileCount: 3,
    effort: undefined,
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

  it("filters by effort field", () => {
    const skillsWithEffort = [
      makeSkill({ name: "easy-task", effort: "low" }),
      makeSkill({ name: "hard-task", effort: "high" }),
      makeSkill({ name: "no-effort", effort: undefined }),
    ];
    const result = searchSkills(skillsWithEffort, "low");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("easy-task");
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

describe("compareSemver", () => {
  it("sorts 0.9.0 before 0.10.0", () => {
    expect(compareSemver("0.9.0", "0.10.0")).toBeLessThan(0);
  });

  it("sorts 1.2.3 before 1.2.10", () => {
    expect(compareSemver("1.2.3", "1.2.10")).toBeLessThan(0);
  });

  it("treats 1.0 as equal to 1.0.0", () => {
    expect(compareSemver("1.0", "1.0.0")).toBe(0);
  });

  it("falls back to localeCompare for non-numeric segments", () => {
    const result = compareSemver("1.0.0", "unknown");
    expect(typeof result).toBe("number");
  });

  it("sorts 0.0.0 before 1.0.0", () => {
    expect(compareSemver("0.0.0", "1.0.0")).toBeLessThan(0);
  });

  it("stable sort for equal versions via sortSkills", () => {
    const skills = [
      makeSkill({ name: "aaa", version: "1.0.0" }),
      makeSkill({ name: "bbb", version: "1.0.0" }),
    ];
    const result = sortSkills(skills, "version");
    expect(result.map((s) => s.name)).toEqual(["aaa", "bbb"]);
  });

  it("sorts version list with two-digit segments correctly", () => {
    const skills = [
      makeSkill({ name: "b", version: "0.10.0" }),
      makeSkill({ name: "a", version: "0.9.0" }),
      makeSkill({ name: "c", version: "0.2.0" }),
    ];
    const result = sortSkills(skills, "version");
    expect(result.map((s) => s.version)).toEqual(["0.2.0", "0.9.0", "0.10.0"]);
  });
});

describe("scanner verbose output", () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setVerbose(false);
    stderrSpy.mockRestore();
  });

  it("emits debug lines when verbose is enabled", async () => {
    setVerbose(true);
    const config = getDefaultConfig();
    await scanAllSkills(config, "global");
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("[verbose]");
    expect(output).toContain("scanning:");
  });

  it("emits no debug lines when verbose is disabled", async () => {
    setVerbose(false);
    const config = getDefaultConfig();
    await scanAllSkills(config, "global");
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).not.toContain("[verbose]");
  });
});

// ─── countFiles ─────────────────────────────────────────────────────────────

describe("countFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scanner-count-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("counts files in a flat directory", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await writeFile(join(tempDir, "b.txt"), "b");
    const count = await countFiles(tempDir);
    expect(count).toBe(2);
  });

  it("counts files recursively", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await mkdir(join(tempDir, "sub"));
    await writeFile(join(tempDir, "sub", "b.txt"), "b");
    await writeFile(join(tempDir, "sub", "c.txt"), "c");
    const count = await countFiles(tempDir);
    // readdir({ recursive: true }) returns all entries including subdirectory names
    // 4 entries: a.txt, sub, sub/b.txt, sub/c.txt
    expect(count).toBe(4);
  });

  it("returns 0 for non-existent directory", async () => {
    const count = await countFiles("/tmp/nonexistent-scanner-dir-xyz");
    expect(count).toBe(0);
  });

  it("returns 0 for empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);
    const count = await countFiles(emptyDir);
    expect(count).toBe(0);
  });
});

// ─── scanAllSkills with custom paths ────────────────────────────────────────

describe("scanAllSkills", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scanner-scan-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers skills with SKILL.md in provider directory", async () => {
    // Create a fake skill directory
    const skillDir = join(tempDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: My Skill\nversion: 1.0.0\ndescription: A test\n---\nBody",
    );

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test Provider",
          global: tempDir,
          project: "/tmp/nonexistent-project",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    const found = skills.find((s) => s.name === "My Skill");
    expect(found).toBeDefined();
    expect(found!.version).toBe("1.0.0");
    expect(found!.scope).toBe("global");
    expect(found!.provider).toBe("test");
    expect(found!.isSymlink).toBe(false);
  });

  it("skips entries without SKILL.md", async () => {
    const noSkillDir = join(tempDir, "not-a-skill");
    await mkdir(noSkillDir);
    await writeFile(join(noSkillDir, "README.md"), "Just a readme");

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: tempDir,
          project: "/tmp/nonexistent-proj",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    expect(skills.find((s) => s.dirName === "not-a-skill")).toBeUndefined();
  });

  it("skips files (non-directories) in scan location", async () => {
    await writeFile(join(tempDir, "just-a-file.txt"), "text");

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: tempDir,
          project: "/tmp/nonexistent-proj",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    expect(skills.find((s) => s.dirName === "just-a-file.txt")).toBeUndefined();
  });

  it("handles non-existent provider directory gracefully", async () => {
    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: "/tmp/nonexistent-scanner-global-xyz",
          project: "/tmp/nonexistent-scanner-project-xyz",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    expect(Array.isArray(skills)).toBe(true);
  });

  it("skips disabled providers", async () => {
    const skillDir = join(tempDir, "a-skill");
    await mkdir(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: Disabled\n---\n");

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "disabled",
          label: "Disabled",
          global: tempDir,
          project: "/tmp/nonexistent-proj",
          enabled: false,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    expect(skills.find((s) => s.provider === "disabled")).toBeUndefined();
  });

  it("detects symlink skills", async () => {
    // Create real skill dir
    const realDir = join(tempDir, "real-skill");
    await mkdir(realDir);
    await writeFile(
      join(realDir, "SKILL.md"),
      "---\nname: Linked Skill\nversion: 2.0.0\n---\n",
    );

    // Create a separate scan dir with symlink
    const scanDir = join(tempDir, "scan");
    await mkdir(scanDir);
    await symlink(realDir, join(scanDir, "linked-skill"), "dir");

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: scanDir,
          project: "/tmp/nonexistent-proj",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global");
    const found = skills.find((s) => s.dirName === "linked-skill");
    expect(found).toBeDefined();
    expect(found!.isSymlink).toBe(true);
    expect(found!.symlinkTarget).toBeTruthy();
  });

  it("scans custom paths", async () => {
    const customDir = join(tempDir, "custom");
    await mkdir(customDir);
    const skillDir = join(customDir, "custom-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Custom Skill\n---\n",
    );

    const config = {
      ...getDefaultConfig(),
      providers: [],
      customPaths: [
        { path: customDir, label: "My Custom", scope: "global" as const },
      ],
    };

    const skills = await scanAllSkills(config, "global");
    const found = skills.find((s) => s.name === "Custom Skill");
    expect(found).toBeDefined();
    expect(found!.provider).toBe("custom");
    expect(found!.providerLabel).toBe("My Custom");
  });
});

// ─── scanPluginMarketplaces ──────────────────────────────────────────────────

describe("scanPluginMarketplaces", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scanner-plugins-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when marketplaces dir does not exist", async () => {
    const skills = await scanPluginMarketplaces(
      "/tmp/nonexistent-marketplaces-xyz",
    );
    expect(skills).toEqual([]);
  });

  it("discovers user-installed marketplace skills (flat skills/ layout)", async () => {
    // ~/.claude/plugins/marketplaces/my-marketplace/skills/my-skill/SKILL.md
    const skillDir = join(tempDir, "my-marketplace", "skills", "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: My Skill\nversion: 1.2.0\ndescription: A user-installed skill\n---\nBody",
    );

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.name).toBe("My Skill");
    expect(skill.version).toBe("1.2.0");
    expect(skill.marketplace).toBe("my-marketplace");
    expect(skill.provider).toBe("plugin");
    expect(skill.providerLabel).toBe("Plugin (my-marketplace)");
    expect(skill.scope).toBe("global");
    expect(skill.location).toBe("global-plugin-my-marketplace");
    expect(skill.dirName).toBe("my-skill");
  });

  it("discovers official bundled plugin skills (plugins/.../skills/ layout)", async () => {
    // ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/my-plugin/skills/my-skill/SKILL.md
    const skillDir = join(
      tempDir,
      "claude-plugins-official",
      "plugins",
      "my-plugin",
      "skills",
      "my-skill",
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Bundled Skill\nversion: 2.0.0\ndescription: An official bundled skill\n---\nBody",
    );

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    const skill = skills[0];
    expect(skill.name).toBe("Bundled Skill");
    expect(skill.marketplace).toBe("claude-plugins-official");
    expect(skill.provider).toBe("plugin");
    expect(skill.dirName).toBe("my-skill");
  });

  it("discovers skills from multiple marketplaces", async () => {
    // Marketplace A with flat layout
    const skillA = join(tempDir, "marketplace-a", "skills", "skill-a");
    await mkdir(skillA, { recursive: true });
    await writeFile(join(skillA, "SKILL.md"), "---\nname: Skill A\n---\n");

    // Marketplace B with nested plugin layout
    const skillB = join(
      tempDir,
      "marketplace-b",
      "plugins",
      "plugin-b",
      "skills",
      "skill-b",
    );
    await mkdir(skillB, { recursive: true });
    await writeFile(join(skillB, "SKILL.md"), "---\nname: Skill B\n---\n");

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(2);

    const marketplaces = skills.map((s) => s.marketplace).sort();
    expect(marketplaces).toEqual(["marketplace-a", "marketplace-b"]);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["Skill A", "Skill B"]);
  });

  it("skips directories without SKILL.md", async () => {
    // A directory that is not a skill (no SKILL.md at any depth)
    const notASkill = join(tempDir, "some-marketplace", "just-a-dir");
    await mkdir(notASkill, { recursive: true });
    await writeFile(join(notASkill, "README.md"), "Not a skill");

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(0);
  });

  it("scanPluginMarketplaces returns correct metadata for a skill", async () => {
    // Verify the function itself returns the right fields for a basic skill
    const skillDir = join(
      tempDir,
      "test-marketplace",
      "skills",
      "plugin-skill",
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Plugin Skill\nversion: 0.1.0\n---\n",
    );

    const skills = await scanPluginMarketplaces(tempDir);
    const found = skills.find((s) => s.name === "Plugin Skill");
    expect(found).toBeDefined();
    expect(found!.marketplace).toBe("test-marketplace");
    expect(found!.provider).toBe("plugin");
  });

  it("scanAllSkills includes plugin skills for global scope via pluginBaseDir", async () => {
    // Verify the scanAllSkills integration path with an injected plugin base dir
    const skillDir = join(
      tempDir,
      "injected-marketplace",
      "skills",
      "injected-skill",
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Injected Skill\nversion: 1.0.0\n---\n",
    );

    const config = { ...getDefaultConfig(), providers: [], customPaths: [] };
    const skills = await scanAllSkills(config, "global", tempDir);
    const found = skills.find((s) => s.name === "Injected Skill");
    expect(found).toBeDefined();
    expect(found!.provider).toBe("plugin");
    expect(found!.marketplace).toBe("injected-marketplace");
    expect(found!.scope).toBe("global");
  });

  it("scanAllSkills excludes plugin skills for project-only scope", async () => {
    // Plugin skills are always global; they should not appear in project-scope scans
    const config = {
      ...getDefaultConfig(),
      providers: [],
      customPaths: [],
    };
    // pluginBaseDir is passed but scope=project means plugin scan is skipped entirely
    const skills = await scanAllSkills(config, "project", tempDir);
    const pluginSkills = skills.filter((s) => s.provider === "plugin");
    expect(pluginSkills).toHaveLength(0);
  });

  it("scanAllSkills deduplicates skills that appear in both provider and plugin paths", async () => {
    // Layout: pluginDir/mkt/skills/shared-skill/SKILL.md
    // - scanPluginMarketplaces(pluginDir) finds it as marketplace "mkt"
    // - a customPath pointing at pluginDir/mkt/skills also scans into
    //   shared-skill/ and resolves the same realPath
    // Both should resolve to the same realPath, so scanAllSkills must emit only one entry.
    const pluginDir = join(tempDir, "plugin-base");
    const skillsParent = join(pluginDir, "mkt", "skills");
    const sharedSkillDir = join(skillsParent, "shared-skill");
    await mkdir(sharedSkillDir, { recursive: true });
    await writeFile(
      join(sharedSkillDir, "SKILL.md"),
      "---\nname: Shared Skill\nversion: 1.0.0\n---\n",
    );

    // customPaths entry that scans skillsParent — scanDirectory finds shared-skill inside it
    const config = {
      ...getDefaultConfig(),
      providers: [],
      customPaths: [
        {
          path: skillsParent,
          label: "Custom",
          scope: "global" as const,
        },
      ],
    };

    const skills = await scanAllSkills(config, "global", pluginDir);

    // Exactly one entry for the shared skill — no duplicates
    const shared = skills.filter((s) => s.name === "Shared Skill");
    expect(shared).toHaveLength(1);
    // Provider (customPaths) entry wins — processed before plugin results
    expect(shared[0].provider).not.toBe("plugin");
  });

  // ── findSkillDirs safety ─────────────────────────────────────────────────

  it("skips symlinked directories inside a marketplace (cycle-safety fix)", async () => {
    // A symlink inside the marketplace dir must not be followed, even if it
    // points to a directory that contains a SKILL.md — this prevents infinite
    // recursion from symlink cycles created by malformed plugin installers.
    const realSkillDir = join(tempDir, "real-skill");
    await mkdir(realSkillDir, { recursive: true });
    await writeFile(
      join(realSkillDir, "SKILL.md"),
      "---\nname: Real Skill\n---\n",
    );

    const marketplaceDir = join(tempDir, "mkt");
    await mkdir(marketplaceDir, { recursive: true });

    // Symlink inside the marketplace pointing at the real skill dir
    const symlinkPath = join(marketplaceDir, "linked-skill");
    await symlink(realSkillDir, symlinkPath);

    const skills = await scanPluginMarketplaces(tempDir);
    // The symlinked entry is skipped — result must be empty
    expect(skills).toHaveLength(0);
  });

  it("skips non-directory entries at the marketplace level", async () => {
    // Files sitting directly in the marketplaces dir must not cause errors
    const marketplacesDir = tempDir;
    await writeFile(join(marketplacesDir, "not-a-dir.txt"), "stray file");

    // Also add a real marketplace so we know the scan ran
    const skillDir = join(marketplacesDir, "real-mkt", "skills", "skill-a");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: Skill A\n---\n");

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].marketplace).toBe("real-mkt");
  });

  it("discovers multiple skills in the same marketplace", async () => {
    const mkt = join(tempDir, "my-mkt", "skills");
    for (const name of ["alpha", "beta", "gamma"]) {
      const d = join(mkt, name);
      await mkdir(d, { recursive: true });
      await writeFile(
        join(d, "SKILL.md"),
        `---\nname: ${name}\nversion: 0.1.0\n---\n`,
      );
    }

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(3);
    expect(skills.every((s) => s.marketplace === "my-mkt")).toBe(true);
    expect(skills.map((s) => s.name).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("falls back to dirName when SKILL.md has no name field", async () => {
    const skillDir = join(tempDir, "mkt", "skills", "my-unnamed-skill");
    await mkdir(skillDir, { recursive: true });
    // Frontmatter omits 'name' entirely
    await writeFile(join(skillDir, "SKILL.md"), "---\nversion: 1.0.0\n---\n");

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-unnamed-skill");
    expect(skills[0].dirName).toBe("my-unnamed-skill");
  });

  it("parses rich frontmatter fields from SKILL.md", async () => {
    const skillDir = join(tempDir, "mkt", "skills", "rich-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Rich Skill",
        "version: 3.1.4",
        "description: Does many things",
        "metadata:",
        "  creator: Test Author",
        "license: MIT",
        "compatibility: Claude 3+",
        "effort: medium",
        "allowed-tools: Bash, Read",
        "---",
        "Body content",
      ].join("\n"),
    );

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    const s = skills[0];
    expect(s.version).toBe("3.1.4");
    expect(s.description).toBe("Does many things");
    expect(s.creator).toBe("Test Author");
    expect(s.license).toBe("MIT");
    expect(s.compatibility).toBe("Claude 3+");
    expect(s.effort).toBe("medium");
    expect(s.allowedTools).toContain("Bash");
    expect(s.allowedTools).toContain("Read");
  });

  it("sets isSymlink=false and symlinkTarget=null for all marketplace skills", async () => {
    const skillDir = join(tempDir, "mkt", "skills", "plain-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Plain Skill\n---\n",
    );

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].isSymlink).toBe(false);
    expect(skills[0].symlinkTarget).toBeNull();
  });

  it("returns empty array for an empty marketplace directory", async () => {
    // Marketplace dir exists but has no skill subdirectories at any depth
    await mkdir(join(tempDir, "empty-mkt"), { recursive: true });

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(0);
  });

  it("scanAllSkills includes plugin skills for both scope", async () => {
    const skillDir = join(tempDir, "mkt", "skills", "both-scope-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: Both Scope Skill\nversion: 1.0.0\n---\n",
    );

    const config = { ...getDefaultConfig(), providers: [], customPaths: [] };
    const skills = await scanAllSkills(config, "both", tempDir);
    const found = skills.find((s) => s.name === "Both Scope Skill");
    expect(found).toBeDefined();
    expect(found!.provider).toBe("plugin");
    expect(found!.scope).toBe("global");
  });

  it("path and originalPath are set correctly for a marketplace skill", async () => {
    const skillDir = join(tempDir, "mkt", "skills", "path-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: Path Skill\n---\n");

    // On macOS /tmp is a symlink to /private/tmp — resolve via realpath
    const canonicalSkillDir = await realpath(skillDir);

    const skills = await scanPluginMarketplaces(tempDir);
    expect(skills).toHaveLength(1);
    const s = skills[0];
    // originalPath is the raw path as walked (not resolved)
    expect(s.originalPath).toBe(skillDir);
    // realPath is the canonical filesystem path (resolves /tmp symlinks on macOS)
    expect(s.realPath).toBe(canonicalSkillDir);
    // path uses resolve() which normalises but does not follow OS-level symlinks
    expect(s.path).toBe(skillDir);
  });
});
