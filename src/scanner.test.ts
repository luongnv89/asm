import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, symlink, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  searchSkills,
  sortSkills,
  scanAllSkills,
  scanPluginMarketplaces,
  scanCodexPluginCache,
  readCodexMarketplaceFiles,
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
    // Issue #188: scanner populates tokenCount for installed skills.
    expect(typeof found!.tokenCount).toBe("number");
    expect(found!.tokenCount!).toBeGreaterThan(0);
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

// ─── scanCodexPluginCache ───────────────────────────────────────────────────

describe("scanCodexPluginCache", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scanner-codex-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function makeCodexPlugin(
    cacheDir: string,
    marketplace: string,
    pluginName: string,
    version: string,
    manifest: object,
  ): Promise<string> {
    const pluginDir = join(
      cacheDir,
      marketplace,
      pluginName,
      version,
      ".codex-plugin",
    );
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify(manifest),
      "utf-8",
    );
    return join(cacheDir, marketplace, pluginName, version);
  }

  it("returns empty array when cache dir does not exist", async () => {
    const skills = await scanCodexPluginCache(
      "/tmp/nonexistent-codex-cache-xyz",
    );
    expect(skills).toEqual([]);
  });

  it("discovers a basic Codex plugin from cache", async () => {
    await makeCodexPlugin(tempDir, "official", "my-plugin", "1.0.0", {
      name: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    const s = skills[0];
    expect(s.name).toBe("my-plugin");
    expect(s.version).toBe("1.0.0");
    expect(s.description).toBe("A test plugin");
    expect(s.provider).toBe("codex-plugin");
    expect(s.providerLabel).toBe("Codex Plugin (official)");
    expect(s.scope).toBe("global");
    expect(s.marketplace).toBe("official");
    expect(s.dirName).toBe("my-plugin");
    expect(s.isSymlink).toBe(false);
    expect(s.symlinkTarget).toBeNull();
  });

  it("uses displayName from interface when available", async () => {
    await makeCodexPlugin(tempDir, "official", "my-plugin", "1.0.0", {
      name: "my-plugin",
      version: "1.0.0",
      interface: { displayName: "My Pretty Plugin", category: "utilities" },
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("My Pretty Plugin");
    expect(skills[0].codexPlugin?.category).toBe("utilities");
  });

  it("uses dirName as fallback when plugin.json has no name", async () => {
    await makeCodexPlugin(tempDir, "official", "unnamed-plugin", "0.1.0", {});

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("unnamed-plugin");
  });

  it("picks the highest version when multiple versions are present", async () => {
    await makeCodexPlugin(tempDir, "official", "versioned", "1.0.0", {
      name: "versioned",
      version: "1.0.0",
      description: "old",
    });
    await makeCodexPlugin(tempDir, "official", "versioned", "2.0.0", {
      name: "versioned",
      version: "2.0.0",
      description: "new",
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].version).toBe("2.0.0");
    expect(skills[0].description).toBe("new");
  });

  it("picks highest version by semver (not lexicographic) when versions like 2.0.0 and 10.0.0 exist", async () => {
    await makeCodexPlugin(tempDir, "official", "semver-plugin", "1.0.0", {
      name: "semver-plugin",
      version: "1.0.0",
      description: "v1",
    });
    await makeCodexPlugin(tempDir, "official", "semver-plugin", "2.0.0", {
      name: "semver-plugin",
      version: "2.0.0",
      description: "v2",
    });
    await makeCodexPlugin(tempDir, "official", "semver-plugin", "10.0.0", {
      name: "semver-plugin",
      version: "10.0.0",
      description: "v10",
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].version).toBe("10.0.0");
    expect(skills[0].description).toBe("v10");
  });

  it("discovers plugins from multiple marketplaces", async () => {
    await makeCodexPlugin(tempDir, "official", "plugin-a", "1.0.0", {
      name: "plugin-a",
    });
    await makeCodexPlugin(tempDir, "community", "plugin-b", "1.0.0", {
      name: "plugin-b",
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["plugin-a", "plugin-b"]);
    const marketplaces = skills.map((s) => s.marketplace).sort();
    expect(marketplaces).toEqual(["community", "official"]);
  });

  it("skips plugin directories without .codex-plugin/plugin.json", async () => {
    const pluginDir = join(tempDir, "official", "bad-plugin", "1.0.0");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "README.md"), "no manifest");

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(0);
  });

  it("skips plugin directories with invalid JSON in plugin.json", async () => {
    const manifestDir = join(
      tempDir,
      "official",
      "broken-plugin",
      "1.0.0",
      ".codex-plugin",
    );
    await mkdir(manifestDir, { recursive: true });
    await writeFile(join(manifestDir, "plugin.json"), "not valid json");

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(0);
  });

  it("sets location to global-codex-plugin-{marketplace}", async () => {
    await makeCodexPlugin(tempDir, "my-mkt", "p", "1.0.0", { name: "p" });
    const skills = await scanCodexPluginCache(tempDir);
    expect(skills[0].location).toBe("global-codex-plugin-my-mkt");
  });

  it("detects hasMcpConfig when mcp field is present", async () => {
    await makeCodexPlugin(tempDir, "official", "mcp-plugin", "1.0.0", {
      name: "mcp-plugin",
      mcp: { servers: { myServer: { command: "npx", args: ["mcp-server"] } } },
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills[0].codexPlugin?.hasMcpConfig).toBe(true);
  });

  it("sets hasMcpConfig=false when mcp field is absent", async () => {
    await makeCodexPlugin(tempDir, "official", "no-mcp", "1.0.0", {
      name: "no-mcp",
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills[0].codexPlugin?.hasMcpConfig).toBe(false);
  });

  it("sets hasMcpConfig=false when mcp field is null", async () => {
    await makeCodexPlugin(tempDir, "official", "null-mcp", "1.0.0", {
      name: "null-mcp",
      mcp: null,
    });

    const skills = await scanCodexPluginCache(tempDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].codexPlugin?.hasMcpConfig).toBe(false);
  });

  it("reads enabled status from config.toml", async () => {
    await makeCodexPlugin(tempDir, "official", "disabled-plugin", "1.0.0", {
      name: "disabled-plugin",
    });

    const configPath = join(tempDir, "config.toml");
    await writeFile(
      configPath,
      [
        "[plugins.disabled-plugin]",
        "enabled = false",
        "",
        "[plugins.other-plugin]",
        "enabled = true",
      ].join("\n"),
    );

    const skills = await scanCodexPluginCache(tempDir, configPath);
    expect(skills[0].codexPlugin?.enabled).toBe(false);
  });

  it("reads enabled status from config.toml with quoted plugin names", async () => {
    await makeCodexPlugin(tempDir, "official", "quoted-plugin", "1.0.0", {
      name: "quoted-plugin",
    });

    const configPath = join(tempDir, "config.toml");
    await writeFile(
      configPath,
      ['[plugins."quoted-plugin"]', "enabled = false"].join("\n"),
    );

    const skills = await scanCodexPluginCache(tempDir, configPath);
    expect(skills[0].codexPlugin?.enabled).toBe(false);
  });

  it("reads enabled status from config.toml with single-quoted plugin names", async () => {
    await makeCodexPlugin(tempDir, "official", "sq-plugin", "1.0.0", {
      name: "sq-plugin",
    });

    const configPath = join(tempDir, "config.toml");
    await writeFile(configPath, "[plugins.'sq-plugin']\nenabled = false\n");

    const skills = await scanCodexPluginCache(tempDir, configPath);
    expect(skills[0].codexPlugin?.enabled).toBe(false);
  });

  it("defaults to enabled=true when plugin not in config.toml", async () => {
    await makeCodexPlugin(tempDir, "official", "unknown-plugin", "1.0.0", {
      name: "unknown-plugin",
    });

    const configPath = join(tempDir, "config.toml");
    await writeFile(configPath, "[plugins.other]\nenabled = true\n");

    const skills = await scanCodexPluginCache(tempDir, configPath);
    expect(skills[0].codexPlugin?.enabled).toBe(true);
  });

  it("defaults to enabled=true when config.toml does not exist", async () => {
    await makeCodexPlugin(tempDir, "official", "some-plugin", "1.0.0", {
      name: "some-plugin",
    });

    const skills = await scanCodexPluginCache(
      tempDir,
      "/tmp/nonexistent-codex-config.toml",
    );
    expect(skills[0].codexPlugin?.enabled).toBe(true);
  });

  it("scanAllSkills includes Codex plugin skills for global scope", async () => {
    await makeCodexPlugin(tempDir, "official", "codex-p", "1.0.0", {
      name: "codex-p",
      version: "1.0.0",
      description: "A Codex plugin",
    });

    const config = { ...getDefaultConfig(), providers: [], customPaths: [] };
    const skills = await scanAllSkills(config, "global", undefined, tempDir);
    const found = skills.find((s) => s.name === "codex-p");
    expect(found).toBeDefined();
    expect(found!.provider).toBe("codex-plugin");
    expect(found!.scope).toBe("global");
  });

  it("scanAllSkills excludes Codex plugin skills for project-only scope", async () => {
    await makeCodexPlugin(tempDir, "official", "codex-proj", "1.0.0", {
      name: "codex-proj",
    });

    const config = { ...getDefaultConfig(), providers: [], customPaths: [] };
    const skills = await scanAllSkills(config, "project", undefined, tempDir);
    expect(skills.filter((s) => s.provider === "codex-plugin")).toHaveLength(0);
  });

  it("scanAllSkills deduplicates Codex plugin by name against provider skills", async () => {
    // Provider skill with same name
    const providerDir = join(tempDir, "provider");
    const skillDir = join(providerDir, "my-codex-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-codex-skill\nversion: 1.0.0\n---\n",
    );

    // Codex plugin cache with same display name
    const cacheDir = join(tempDir, "cache");
    await makeCodexPlugin(cacheDir, "official", "my-codex-skill", "1.0.0", {
      name: "my-codex-skill",
      version: "1.0.0",
    });

    const config = {
      ...getDefaultConfig(),
      providers: [
        {
          name: "test",
          label: "Test",
          global: providerDir,
          project: "/tmp/nonexistent-proj",
          enabled: true,
        },
      ],
      customPaths: [],
    };

    const skills = await scanAllSkills(config, "global", undefined, cacheDir);
    const matches = skills.filter(
      (s) => s.name.toLowerCase() === "my-codex-skill",
    );
    expect(matches).toHaveLength(1);
    // Provider wins
    expect(matches[0].provider).toBe("test");
  });

  it("scanAllSkills includes Codex plugins for both scope", async () => {
    await makeCodexPlugin(tempDir, "official", "both-plugin", "1.0.0", {
      name: "both-plugin",
    });

    const config = { ...getDefaultConfig(), providers: [], customPaths: [] };
    const skills = await scanAllSkills(config, "both", undefined, tempDir);
    expect(skills.find((s) => s.name === "both-plugin")).toBeDefined();
  });
});

// ─── readCodexMarketplaceFiles ───────────────────────────────────────────────

describe("readCodexMarketplaceFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "scanner-codex-mkt-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when neither marketplace file exists", async () => {
    const entries = await readCodexMarketplaceFiles(
      "/tmp/nonexistent-user-mkt.json",
      "/tmp/nonexistent-repo-mkt.json",
    );
    expect(entries).toEqual([]);
  });

  it("reads plugins from user-level marketplace.json", async () => {
    const filePath = join(tempDir, "marketplace.json");
    await writeFile(
      filePath,
      JSON.stringify({
        plugins: [
          {
            name: "plugin-a",
            source: "github:user/plugin-a",
            version: "1.0.0",
          },
          { name: "plugin-b", description: "Another plugin" },
        ],
      }),
    );

    const entries = await readCodexMarketplaceFiles(
      filePath,
      "/tmp/nonexistent-repo.json",
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("plugin-a");
    expect(entries[1].name).toBe("plugin-b");
  });

  it("reads skills array from marketplace.json", async () => {
    const filePath = join(tempDir, "marketplace.json");
    await writeFile(
      filePath,
      JSON.stringify({
        skills: [{ name: "skill-a" }, { name: "skill-b" }],
      }),
    );

    const entries = await readCodexMarketplaceFiles(
      filePath,
      "/tmp/nonexistent-repo.json",
    );
    expect(entries).toHaveLength(2);
  });

  it("merges plugins and skills arrays from same file", async () => {
    const filePath = join(tempDir, "marketplace.json");
    await writeFile(
      filePath,
      JSON.stringify({
        plugins: [{ name: "plugin-x" }],
        skills: [{ name: "skill-x" }],
      }),
    );

    const entries = await readCodexMarketplaceFiles(
      filePath,
      "/tmp/nonexistent-repo.json",
    );
    expect(entries).toHaveLength(2);
  });

  it("deduplicates entries with same name across files", async () => {
    const userPath = join(tempDir, "user-marketplace.json");
    const repoPath = join(tempDir, "repo-marketplace.json");

    await writeFile(
      userPath,
      JSON.stringify({
        plugins: [{ name: "shared-plugin", version: "1.0.0" }],
      }),
    );
    await writeFile(
      repoPath,
      JSON.stringify({
        plugins: [
          { name: "shared-plugin", version: "2.0.0" },
          { name: "unique-plugin" },
        ],
      }),
    );

    const entries = await readCodexMarketplaceFiles(userPath, repoPath);
    const names = entries.map((e) => e.name);
    expect(names.filter((n) => n === "shared-plugin")).toHaveLength(1);
    expect(names).toContain("unique-plugin");
    expect(entries).toHaveLength(2);
  });

  it("skips files with invalid JSON", async () => {
    const badPath = join(tempDir, "bad.json");
    await writeFile(badPath, "not valid json");

    const entries = await readCodexMarketplaceFiles(
      badPath,
      "/tmp/nonexistent-repo.json",
    );
    expect(entries).toEqual([]);
  });

  it("reads from both user and repo files", async () => {
    const userPath = join(tempDir, "user.json");
    const repoPath = join(tempDir, "repo.json");
    await writeFile(
      userPath,
      JSON.stringify({ plugins: [{ name: "user-only" }] }),
    );
    await writeFile(
      repoPath,
      JSON.stringify({ plugins: [{ name: "repo-only" }] }),
    );

    const entries = await readCodexMarketplaceFiles(userPath, repoPath);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "repo-only",
      "user-only",
    ]);
  });
});
