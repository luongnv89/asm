import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  readlink,
  lstat,
  symlink,
} from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
import {
  parseSource,
  isLocalPath,
  parseLocalSource,
  resolveSubpath,
  sanitizeName,
  checkGitAvailable,
  validateSkill,
  discoverSkills,
  scanForWarnings,
  resolveProvider,
  executeInstallAllProviders,
  buildInstallPlan,
  checkConflict,
  isAuthError,
  findDuplicateInstallNames,
  buildRepoUrl,
  checkNpxAvailable,
} from "./installer";
import type { AppConfig, ProviderConfig } from "./utils/types";

// ─── parseSource tests ─────────────────────────────────────────────────────

describe("parseSource", () => {
  test("valid source without ref", () => {
    const result = parseSource("github:alice/my-skill");
    expect(result.owner).toBe("alice");
    expect(result.repo).toBe("my-skill");
    expect(result.ref).toBeNull();
    expect(result.cloneUrl).toBe("https://github.com/alice/my-skill.git");
    expect(result.sshCloneUrl).toBe("git@github.com:alice/my-skill.git");
  });

  test("valid source with ref", () => {
    const result = parseSource("github:alice/my-skill#develop");
    expect(result.owner).toBe("alice");
    expect(result.repo).toBe("my-skill");
    expect(result.ref).toBe("develop");
  });

  test("valid source with tag ref", () => {
    const result = parseSource("github:alice/my-skill#v1.2.0");
    expect(result.ref).toBe("v1.2.0");
  });

  test("valid source with slashes in ref", () => {
    const result = parseSource("github:alice/my-skill#feature/new-thing");
    expect(result.ref).toBe("feature/new-thing");
  });

  test("owner with hyphens and underscores", () => {
    const result = parseSource("github:my-org_team/skill-repo");
    expect(result.owner).toBe("my-org_team");
    expect(result.repo).toBe("skill-repo");
  });

  test("repo with dots", () => {
    const result = parseSource("github:user/my.skill.repo");
    expect(result.repo).toBe("my.skill.repo");
  });

  // HTTPS URL normalization tests
  test("accepts https://github.com/owner/repo", () => {
    const result = parseSource("https://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBeNull();
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.sshCloneUrl).toBe("git@github.com:owner/repo.git");
  });

  test("accepts https://github.com/owner/repo.git", () => {
    const result = parseSource("https://github.com/owner/repo.git");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBeNull();
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  test("accepts https://github.com/owner/repo/tree/branch-name", () => {
    const result = parseSource(
      "https://github.com/owner/repo/tree/branch-name",
    );
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBe("branch-name");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  test("accepts http://github.com/owner/repo", () => {
    const result = parseSource("http://github.com/owner/repo");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBeNull();
  });

  test("accepts https URL with nested branch path in /tree/", () => {
    const result = parseSource(
      "https://github.com/owner/repo/tree/feature/new-thing",
    );
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBe("feature/new-thing");
  });

  test("accepts https URL with trailing slash", () => {
    const result = parseSource("https://github.com/owner/repo/");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.ref).toBeNull();
  });

  // Rejection tests
  test("rejects missing github prefix", () => {
    expect(() => parseSource("alice/my-skill")).toThrow(
      "Invalid source format",
    );
  });

  test("rejects missing repo", () => {
    expect(() => parseSource("github:alice")).toThrow("github:owner/repo");
  });

  test("rejects empty owner", () => {
    expect(() => parseSource("github:/my-skill")).toThrow(
      "owner cannot be empty",
    );
  });

  test("rejects empty repo", () => {
    expect(() => parseSource("github:alice/")).toThrow("repo cannot be empty");
  });

  test("rejects invalid characters in owner", () => {
    expect(() => parseSource("github:al ice/my-skill")).toThrow(
      "invalid characters",
    );
  });

  test("rejects invalid characters in owner (@)", () => {
    expect(() => parseSource("github:al@ce/my-skill")).toThrow(
      "invalid characters",
    );
  });

  test("rejects invalid characters in repo", () => {
    expect(() => parseSource("github:alice/my skill")).toThrow(
      "invalid characters",
    );
  });

  test("rejects empty ref after #", () => {
    expect(() => parseSource("github:alice/my-skill#")).toThrow(
      "ref cannot be empty",
    );
  });

  // Subpath tests (github: shorthand with #ref:subpath)
  test("parses github shorthand with ref:subpath", () => {
    const result = parseSource("github:user/skills#main:skills/agent-config");
    expect(result.owner).toBe("user");
    expect(result.repo).toBe("skills");
    expect(result.ref).toBe("main");
    expect(result.subpath).toBe("skills/agent-config");
  });

  test("parses github shorthand with ref:subpath single segment", () => {
    const result = parseSource("github:user/skills#main:my-skill");
    expect(result.ref).toBe("main");
    expect(result.subpath).toBe("my-skill");
  });

  test("parses github shorthand with ref but no subpath", () => {
    const result = parseSource("github:user/skills#main");
    expect(result.ref).toBe("main");
    expect(result.subpath).toBeNull();
  });

  test("parses github shorthand with subpath but no ref", () => {
    const result = parseSource(
      "github:anthropics/skills:skills/slack-gif-creator",
    );
    expect(result.owner).toBe("anthropics");
    expect(result.repo).toBe("skills");
    expect(result.ref).toBeNull();
    expect(result.subpath).toBe("skills/slack-gif-creator");
  });

  test("rejects empty ref before colon in shorthand", () => {
    expect(() => parseSource("github:user/repo#:subpath")).toThrow(
      "ref cannot be empty",
    );
  });

  test("subpath is null for trailing colon with no path", () => {
    const result = parseSource("github:user/repo#main:");
    expect(result.ref).toBe("main");
    expect(result.subpath).toBeNull();
  });

  test("subpath is null when not specified", () => {
    const result = parseSource("github:alice/my-skill");
    expect(result.subpath).toBeNull();
  });

  test("HTTPS URL with tree path stores full path as ref (needs async resolution)", () => {
    const result = parseSource(
      "https://github.com/user/skills/tree/main/skills/agent-config",
    );
    // Before resolveSubpath(), the entire tree path is stored as ref
    expect(result.ref).toBe("main/skills/agent-config");
    expect(result.subpath).toBeNull();
  });

  test("existing github shorthand with slashed ref still works", () => {
    const result = parseSource("github:alice/repo#feature/new-thing");
    expect(result.ref).toBe("feature/new-thing");
    expect(result.subpath).toBeNull();
  });
});

// ─── duplicate install name tests ──────────────────────────────────────────

describe("findDuplicateInstallNames", () => {
  test("detects duplicates by final path segment", () => {
    const duplicates = findDuplicateInstallNames([
      "skills/leboncoin-seller",
      ".claude/skills/leboncoin-seller",
      "skills/agent-config",
    ]);
    expect(duplicates).toEqual([
      {
        name: "leboncoin-seller",
        paths: ["skills/leboncoin-seller", ".claude/skills/leboncoin-seller"],
      },
    ]);
  });

  test("returns empty when no duplicates", () => {
    const duplicates = findDuplicateInstallNames([
      "skills/leboncoin-seller",
      "skills/agent-config",
    ]);
    expect(duplicates).toEqual([]);
  });
});

// ─── resolveSubpath tests ─────────────────────────────────────────────────

describe("resolveSubpath", () => {
  test("returns source unchanged when subpath already set", async () => {
    const source = {
      owner: "user",
      repo: "skills",
      ref: "main",
      subpath: "already/set",
      cloneUrl: "https://github.com/user/skills.git",
      sshCloneUrl: "git@github.com:user/skills.git",
    };
    const result = await resolveSubpath(source);
    expect(result.subpath).toBe("already/set");
    expect(result.ref).toBe("main");
  });

  test("returns source unchanged when ref has no slash", async () => {
    const source = {
      owner: "user",
      repo: "skills",
      ref: "main",
      subpath: null,
      cloneUrl: "https://github.com/user/skills.git",
      sshCloneUrl: "git@github.com:user/skills.git",
    };
    const result = await resolveSubpath(source);
    expect(result.ref).toBe("main");
    expect(result.subpath).toBeNull();
  });

  test("returns source unchanged when ref is null", async () => {
    const source = {
      owner: "user",
      repo: "skills",
      ref: null,
      subpath: null,
      cloneUrl: "https://github.com/user/skills.git",
      sshCloneUrl: "git@github.com:user/skills.git",
    };
    const result = await resolveSubpath(source);
    expect(result.ref).toBeNull();
    expect(result.subpath).toBeNull();
  });
});

// ─── isAuthError tests ────────────────────────────────────────────────────

describe("isAuthError", () => {
  test("detects 'Authentication failed'", () => {
    const err = {
      stderr:
        "fatal: Authentication failed for 'https://github.com/user/repo.git'",
    };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 'Repository not found'", () => {
    const err = {
      stderr: "remote: Repository not found.\nfatal: repository not found",
    };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 'could not read Username'", () => {
    const err = {
      stderr:
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 403 error", () => {
    const err = { stderr: "The requested URL returned error: 403" };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 401 error", () => {
    const err = { stderr: "The requested URL returned error: 401" };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 'terminal prompts disabled'", () => {
    const err = { stderr: "fatal: terminal prompts disabled" };
    expect(isAuthError(err)).toBe(true);
  });

  test("detects 'Permission denied'", () => {
    const err = { stderr: "Permission denied (publickey)." };
    expect(isAuthError(err)).toBe(true);
  });

  test("does not match timeout (err.killed)", () => {
    const err = {
      killed: true,
      message: "Clone timed out",
      stderr: "repository not found",
    };
    expect(isAuthError(err)).toBe(false);
  });

  test("does not match invalid ref", () => {
    const err = {
      stderr: "fatal: Remote branch 'v99' not found in upstream origin",
    };
    expect(isAuthError(err)).toBe(false);
  });

  test("does not match generic network error", () => {
    const err = {
      stderr: "fatal: unable to access: Could not resolve host: github.com",
    };
    expect(isAuthError(err)).toBe(false);
  });

  test("handles missing stderr gracefully", () => {
    const err = { message: "some error" };
    expect(isAuthError(err)).toBe(false);
  });
});

// ─── sanitizeName tests ────────────────────────────────────────────────────

describe("sanitizeName", () => {
  test("valid name passes through", () => {
    expect(sanitizeName("code-review-skill")).toBe("code-review-skill");
  });

  test("valid name with dots and underscores", () => {
    expect(sanitizeName("my_skill.v2")).toBe("my_skill.v2");
  });

  test("valid single character name", () => {
    expect(sanitizeName("x")).toBe("x");
  });

  test("rejects path traversal (..)", () => {
    expect(() => sanitizeName("..")).toThrow("unsafe characters");
    expect(() => sanitizeName("foo/../bar")).toThrow("unsafe characters");
  });

  test("rejects forward slash", () => {
    expect(() => sanitizeName("foo/bar")).toThrow("unsafe characters");
  });

  test("rejects backslash", () => {
    expect(() => sanitizeName("foo\\bar")).toThrow("unsafe characters");
  });

  test("rejects null bytes", () => {
    expect(() => sanitizeName("foo\0bar")).toThrow("unsafe characters");
  });

  test("rejects leading dot", () => {
    expect(() => sanitizeName(".hidden-skill")).toThrow(
      "must not start with a dot",
    );
  });

  test("rejects empty name", () => {
    expect(() => sanitizeName("")).toThrow("cannot be empty");
  });

  test("rejects name exceeding length limit", () => {
    const longName = "a".repeat(129);
    expect(() => sanitizeName(longName)).toThrow("maximum length of 128");
  });

  test("accepts name at exactly 128 characters", () => {
    const name = "a".repeat(128);
    expect(sanitizeName(name)).toBe(name);
  });
});

// ─── checkGitAvailable tests ───────────────────────────────────────────────

describe("checkGitAvailable", () => {
  test("succeeds when git is available", async () => {
    // git should be available on CI and dev machines
    await expect(checkGitAvailable()).resolves.toBeUndefined();
  });
});

// ─── validateSkill tests ───────────────────────────────────────────────────

describe("validateSkill", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-validate-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("valid SKILL.md with frontmatter", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---

# Test Skill

Instructions here.
`,
    );

    const result = await validateSkill(tempDir);
    expect(result.name).toBe("test-skill");
    expect(result.version).toBe("1.0.0");
    expect(result.description).toBe("A test skill");
  });

  test("SKILL.md with missing optional fields uses defaults", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: minimal-skill
---

# Minimal
`,
    );

    const result = await validateSkill(tempDir);
    expect(result.name).toBe("minimal-skill");
    expect(result.version).toBe("0.0.0");
    expect(result.description).toBe("");
  });

  test("SKILL.md without frontmatter uses directory name", async () => {
    await writeFile(join(tempDir, "SKILL.md"), "# Just content\n");

    const result = await validateSkill(tempDir);
    // name falls back to directory name
    expect(result.version).toBe("0.0.0");
    expect(result.description).toBe("");
  });

  test("throws when SKILL.md is missing", async () => {
    await expect(validateSkill(tempDir)).rejects.toThrow("SKILL.md not found");
  });
});

// ─── discoverSkills tests ──────────────────────────────────────────────────

describe("discoverSkills", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-discover-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("discovers skills in subdirectories", async () => {
    // Create multi-skill repo structure
    await mkdir(join(tempDir, "skills", "code-review"), { recursive: true });
    await mkdir(join(tempDir, "skills", "auto-push"), { recursive: true });
    await writeFile(
      join(tempDir, "skills", "code-review", "SKILL.md"),
      "---\nname: code-review\nversion: 1.0.0\ndescription: Review code\n---\n# Code Review\n",
    );
    await writeFile(
      join(tempDir, "skills", "auto-push", "SKILL.md"),
      "---\nname: auto-push\nversion: 0.5.0\n---\n# Auto Push\n",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(2);
    expect(discovered.map((s) => s.name).sort()).toEqual([
      "auto-push",
      "code-review",
    ]);
    expect(discovered.find((s) => s.name === "code-review")?.relPath).toBe(
      "skills/code-review",
    );
    expect(discovered.find((s) => s.name === "code-review")?.version).toBe(
      "1.0.0",
    );
  });

  test("discovers skills at first level subdirectories", async () => {
    await mkdir(join(tempDir, "my-skill"), { recursive: true });
    await writeFile(
      join(tempDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\nversion: 2.0.0\n---\n# My Skill\n",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(1);
    expect(discovered[0].relPath).toBe("my-skill");
  });

  test("returns empty array when no skills found", async () => {
    await mkdir(join(tempDir, "empty-dir"), { recursive: true });
    await writeFile(join(tempDir, "empty-dir", "README.md"), "# Not a skill\n");

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(0);
  });

  test("skips .git directory", async () => {
    await mkdir(join(tempDir, ".git", "hooks"), { recursive: true });
    await writeFile(
      join(tempDir, ".git", "hooks", "SKILL.md"),
      "---\nname: fake\n---\n",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(0);
  });

  test("does not recurse deeper than 5 levels", async () => {
    // 6 levels deep should be skipped
    await mkdir(join(tempDir, "a", "b", "c", "d", "e", "f"), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, "a", "b", "c", "d", "e", "f", "SKILL.md"),
      "---\nname: too-deep\n---\n",
    );
    // 5 levels deep should work (covers plugin-nested layouts like
    // plugins/<group>/skills/<skill>/SKILL.md)
    await mkdir(join(tempDir, "plugins", "group", "skills", "my-skill"), {
      recursive: true,
    });
    await writeFile(
      join(tempDir, "plugins", "group", "skills", "my-skill", "SKILL.md"),
      "---\nname: plugin-skill\n---\n",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.map((s) => s.name)).toEqual(["plugin-skill"]);
  });

  test("stops recursing into directories that have SKILL.md", async () => {
    // Parent has SKILL.md, child also has SKILL.md — should find parent only
    await mkdir(join(tempDir, "parent", "child"), { recursive: true });
    await writeFile(
      join(tempDir, "parent", "SKILL.md"),
      "---\nname: parent-skill\n---\n",
    );
    await writeFile(
      join(tempDir, "parent", "child", "SKILL.md"),
      "---\nname: child-skill\n---\n",
    );

    const discovered = await discoverSkills(tempDir);
    // Parent has SKILL.md so it's found; child is NOT recursed into
    expect(discovered.length).toBe(1);
    expect(discovered[0].name).toBe("parent-skill");
  });
});

// ─── scanForWarnings tests ─────────────────────────────────────────────────

describe("scanForWarnings", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-scan-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("detects shell command patterns", async () => {
    await writeFile(join(tempDir, "SKILL.md"), "Run this: bash script.sh\n");

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.some((w) => w.category === "Shell commands")).toBe(true);
  });

  test("detects eval patterns", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      "Use eval() to run dynamic code\n",
    );

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.some((w) => w.category === "Code execution")).toBe(true);
  });

  test("detects credential patterns", async () => {
    await writeFile(join(tempDir, "config.txt"), "API_KEY = sk-1234567890\n");

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.some((w) => w.category === "Credentials")).toBe(true);
  });

  test("detects external URL patterns", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      "Visit https://example.com for docs\n",
    );

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.some((w) => w.category === "External URLs")).toBe(true);
  });

  test("returns no warnings for clean content", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: clean-skill
version: 1.0.0
---

# Clean Skill

This is a clean skill with no suspicious patterns.
`,
    );

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.length).toBe(0);
  });

  test("skips .git directory", async () => {
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await writeFile(join(tempDir, ".git", "config"), "API_KEY = secret\n");
    await writeFile(join(tempDir, "SKILL.md"), "# Clean\n");

    const warnings = await scanForWarnings(tempDir);
    expect(warnings.every((w) => !w.file.startsWith(".git"))).toBe(true);
  });
});

// ─── resolveProvider tests ─────────────────────────────────────────────────

describe("resolveProvider", () => {
  const makeConfig = (providers: ProviderConfig[]): AppConfig => ({
    version: 1,
    providers,
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
  });

  const claude: ProviderConfig = {
    name: "claude",
    label: "Claude Code",
    global: "~/.claude/skills",
    project: ".claude/skills",
    enabled: true,
  };

  const codex: ProviderConfig = {
    name: "codex",
    label: "Codex",
    global: "~/.codex/skills",
    project: ".codex/skills",
    enabled: true,
  };

  const disabledProvider: ProviderConfig = {
    name: "disabled",
    label: "Disabled",
    global: "~/.disabled/skills",
    project: ".disabled/skills",
    enabled: false,
  };

  test("selects provider by flag name", async () => {
    const config = makeConfig([claude, codex]);
    const result = await resolveProvider(config, "claude", false);
    expect(result.provider.name).toBe("claude");
    expect(result.allProviders).toBeNull();
  });

  test("rejects unknown provider", async () => {
    const config = makeConfig([claude]);
    await expect(resolveProvider(config, "unknown", false)).rejects.toThrow(
      "Unknown provider",
    );
  });

  test("rejects disabled provider", async () => {
    const config = makeConfig([claude, disabledProvider]);
    await expect(resolveProvider(config, "disabled", false)).rejects.toThrow(
      "disabled",
    );
  });

  test("auto-selects single enabled provider", async () => {
    const config = makeConfig([claude, disabledProvider]);
    const result = await resolveProvider(config, null, false);
    expect(result.provider.name).toBe("claude");
    expect(result.allProviders).toBeNull();
  });

  test("errors in non-TTY without provider flag when multiple providers", async () => {
    const config = makeConfig([claude, codex]);
    await expect(resolveProvider(config, null, false)).rejects.toThrow(
      "--tool (or --provider) is required",
    );
  });

  test("selects all providers with 'all' flag", async () => {
    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const config = makeConfig([claude, codex, agents]);
    const result = await resolveProvider(config, "all", false);
    expect(result.provider.name).toBe("agents");
    expect(result.allProviders).toHaveLength(3);
    expect(result.allProviders!.map((p) => p.name)).toEqual([
      "claude",
      "codex",
      "agents",
    ]);
  });

  test("selects first enabled as primary when 'all' and no agents provider", async () => {
    const config = makeConfig([claude, codex]);
    const result = await resolveProvider(config, "all", false);
    expect(result.provider.name).toBe("claude");
    expect(result.allProviders).toHaveLength(2);
  });

  test("interactive picker: single selection returns single provider", async () => {
    const { checkboxPicker } = await import("./utils/checkbox-picker");
    const pickerMock = vi.spyOn(
      { checkboxPicker },
      "checkboxPicker",
    ).mockResolvedValue([1]);
    // Re-mock the module so resolveProvider sees it
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerMock,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config = makeConfig([claude, codex]);
    const result = await resolveProvider(config, null, true);
    expect(result.provider.name).toBe("codex");
    expect(result.allProviders).toBeNull();

    pickerMock.mockRestore();
  });

  test("interactive picker: multiple selections returns multi-provider mode", async () => {
    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const pickerFn = vi.fn(() => Promise.resolve([0, 2]));
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config = makeConfig([claude, codex, agents]);
    const result = await resolveProvider(config, null, true);
    expect(result.provider.name).toBe("agents"); // agents is primary
    expect(result.allProviders).toHaveLength(2);
    expect(result.allProviders!.map((p) => p.name)).toEqual([
      "claude",
      "agents",
    ]);
  });

  test("interactive picker: empty selection throws error", async () => {
    const pickerFn = vi.fn(() => Promise.resolve([]));
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));

    const config = makeConfig([claude, codex]);
    await expect(resolveProvider(config, null, true)).rejects.toThrow(
      "No tools selected",
    );
  });

  test("interactive picker: no saved tools defaults agents to checked", async () => {
    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    let capturedItems: unknown[] = [];
    const pickerFn = vi.fn((opts: { items: unknown[] }) => {
      capturedItems = opts.items;
      return Promise.resolve([1]); // select agents
    });
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config = makeConfig([claude, agents, codex]);
    await resolveProvider(config, null, true);

    expect(capturedItems).toHaveLength(3);
    expect((capturedItems[0] as { checked: boolean }).checked).toBe(false);
    expect((capturedItems[1] as { checked: boolean }).checked).toBe(true);
    expect((capturedItems[2] as { checked: boolean }).checked).toBe(false);
  });

  test("interactive picker: saved tools override default checked state", async () => {
    let capturedItems: unknown[] = [];
    const pickerFn = vi.fn((opts: { items: unknown[] }) => {
      capturedItems = opts.items;
      return Promise.resolve([0, 1]); // select claude and codex
    });
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const config: AppConfig = {
      version: 1,
      providers: [claude, codex, agents],
      customPaths: [],
      preferences: {
        defaultScope: "both",
        defaultSort: "name",
        selectedTools: ["claude", "codex"],
      },
    };
    await resolveProvider(config, null, true);

    expect(capturedItems).toHaveLength(3);
    // claude and codex pre-checked from saved selection, agents not
    expect((capturedItems[0] as { checked: boolean }).checked).toBe(true);
    expect((capturedItems[1] as { checked: boolean }).checked).toBe(true);
    expect((capturedItems[2] as { checked: boolean }).checked).toBe(false);
  });

  test("interactive picker: persists selected tool names after selection", async () => {
    let savedNames: string[] = [];
    const pickerFn = vi.fn(() => Promise.resolve([0, 2]));
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn((names: string[]) => {
      savedNames = names;
      return Promise.resolve();
    });
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const config = makeConfig([claude, codex, agents]);
    await resolveProvider(config, null, true);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(savedNames).toEqual(["claude", "agents"]);
  });

  test("interactive picker: empty saved tools array falls back to agents default", async () => {
    let capturedItems: unknown[] = [];
    const agents: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const pickerFn = vi.fn((opts: { items: unknown[] }) => {
      capturedItems = opts.items;
      return Promise.resolve([1]); // select agents
    });
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config: AppConfig = {
      version: 1,
      providers: [claude, agents, codex],
      customPaths: [],
      preferences: {
        defaultScope: "both",
        defaultSort: "name",
        selectedTools: [], // empty array — should fall back to agents default
      },
    };
    await resolveProvider(config, null, true);

    expect(capturedItems).toHaveLength(3);
    // Falls back to agents default
    expect((capturedItems[0] as { checked: boolean }).checked).toBe(false);
    expect((capturedItems[1] as { checked: boolean }).checked).toBe(true);
    expect((capturedItems[2] as { checked: boolean }).checked).toBe(false);
  });

  test("interactive picker: all items default to deselected when no agents and no saved", async () => {
    let capturedItems: unknown[] = [];
    const pickerFn = vi.fn((opts: { items: unknown[] }) => {
      capturedItems = opts.items;
      return Promise.resolve([0]);
    });
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config = makeConfig([claude, codex, disabledProvider]);
    await resolveProvider(config, null, true);

    expect(capturedItems).toHaveLength(3);
    expect((capturedItems[0] as { checked: boolean }).checked).toBe(false);
    expect((capturedItems[1] as { checked: boolean }).checked).toBe(false);
    expect((capturedItems[2] as { checked: boolean }).checked).toBe(false);
  });

  test("interactive picker: all providers disabled shows picker with nothing pre-checked", async () => {
    const allDisabled: ProviderConfig[] = [
      { ...claude, enabled: false },
      { ...codex, enabled: false },
    ];
    let capturedItems: unknown[] = [];
    const pickerFn = vi.fn((opts: { items: unknown[] }) => {
      capturedItems = opts.items;
      return Promise.resolve([0]); // user selects first
    });
    vi.doMock("./utils/checkbox-picker", () => ({
      checkboxPicker: pickerFn,
    }));
    const saveMock = vi.fn(() => Promise.resolve());
    vi.doMock("./config", () => ({
      saveSelectedTools: saveMock,
    }));

    const config = makeConfig(allDisabled);
    const result = await resolveProvider(config, null, true);
    expect(result.provider.name).toBe("claude");
    expect(capturedItems).toHaveLength(2);
    expect((capturedItems[0] as { checked: boolean }).checked).toBe(false);
    expect((capturedItems[1] as { checked: boolean }).checked).toBe(false);
  });

  test("explicit --tool flag does not trigger save or use saved tools", async () => {
    const config: AppConfig = {
      version: 1,
      providers: [claude, codex],
      customPaths: [],
      preferences: {
        defaultScope: "both",
        defaultSort: "name",
        selectedTools: ["codex"],
      },
    };
    // Explicit provider flag — should not touch saved tools, no picker shown
    const result = await resolveProvider(config, "claude", false);
    expect(result.provider.name).toBe("claude");
    expect(result.allProviders).toBeNull();
  });
});

// ─── executeInstallAllProviders tests ────────────────────────────────────────

describe("executeInstallAllProviders", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-allproviders-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function setupSourceAndPlan() {
    // Create source skill directory with SKILL.md
    const sourceDir = join(tempDir, "source", "my-skill");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: my-skill\nversion: 1.0.0\ndescription: Test skill\n---\n# My Skill\n",
    );

    // Primary install target (agents provider)
    const primaryDir = join(tempDir, "providers", "agents", "skills");
    const targetDir = join(primaryDir, "my-skill");
    await mkdir(primaryDir, { recursive: true });

    const plan: import("./utils/types").InstallPlan = {
      source: {
        owner: "user",
        repo: "my-skill",
        ref: null,
        subpath: null,
        cloneUrl: "https://github.com/user/my-skill.git",
        sshCloneUrl: "git@github.com:user/my-skill.git",
      },
      tempDir: join(tempDir, "source"),
      sourceDir,
      targetDir,
      skillName: "my-skill",
      force: false,
      providerName: "agents",
      providerLabel: "Agents",
      scope: "global",
    };

    const providers: ProviderConfig[] = [
      {
        name: "claude",
        label: "Claude Code",
        global: join(tempDir, "providers", "claude", "skills"),
        project: ".claude/skills",
        enabled: true,
      },
      {
        name: "codex",
        label: "Codex",
        global: join(tempDir, "providers", "codex", "skills"),
        project: ".codex/skills",
        enabled: true,
      },
      {
        name: "agents",
        label: "Agents",
        global: join(tempDir, "providers", "agents", "skills"),
        project: ".agents/skills",
        enabled: true,
      },
    ];

    return { plan, providers };
  }

  test("creates relative symlinks in non-primary providers", async () => {
    const { plan, providers } = await setupSourceAndPlan();
    const result = await executeInstallAllProviders(plan, providers);

    expect(result.success).toBe(true);

    // Check symlinks exist in claude and codex provider dirs
    for (const name of ["claude", "codex"]) {
      const linkPath = join(tempDir, "providers", name, "skills", "my-skill");
      const stats = await lstat(linkPath);
      expect(stats.isSymbolicLink()).toBe(true);

      // Verify symlink is relative, not absolute
      const target = await readlink(linkPath);
      expect(target.startsWith("/")).toBe(false);

      // Verify relative path resolves correctly
      const providerDir = join(tempDir, "providers", name, "skills");
      const expectedRel = relative(providerDir, plan.targetDir);
      expect(target).toBe(expectedRel);
    }
  });

  test("replaces existing symlinks", async () => {
    const { plan, providers } = await setupSourceAndPlan();

    // Pre-create a stale symlink in the claude provider dir
    const claudeDir = join(tempDir, "providers", "claude", "skills");
    await mkdir(claudeDir, { recursive: true });
    await symlink(
      "/nonexistent/old-target",
      join(claudeDir, "my-skill"),
      "dir",
    );

    const result = await executeInstallAllProviders(plan, providers);
    expect(result.success).toBe(true);

    // Symlink should now point to the primary install, not the old target
    const target = await readlink(join(claudeDir, "my-skill"));
    const expectedRel = relative(claudeDir, plan.targetDir);
    expect(target).toBe(expectedRel);
  });

  test("skips existing real directories instead of deleting them", async () => {
    const { plan, providers } = await setupSourceAndPlan();

    // Pre-create a real directory (not a symlink) in the codex provider dir
    const codexSkillDir = join(
      tempDir,
      "providers",
      "codex",
      "skills",
      "my-skill",
    );
    await mkdir(codexSkillDir, { recursive: true });
    await writeFile(join(codexSkillDir, "important-file.txt"), "do not delete");

    const result = await executeInstallAllProviders(plan, providers);
    expect(result.success).toBe(true);

    // Real directory should still exist untouched
    const stats = await lstat(codexSkillDir);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isDirectory()).toBe(true);

    // Claude provider should still get a symlink
    const claudeLink = join(
      tempDir,
      "providers",
      "claude",
      "skills",
      "my-skill",
    );
    const claudeStats = await lstat(claudeLink);
    expect(claudeStats.isSymbolicLink()).toBe(true);
  });

  test("result provider string contains 'All' with all provider labels", async () => {
    const { plan, providers } = await setupSourceAndPlan();
    const result = await executeInstallAllProviders(plan, providers);

    expect(result.provider).toBe("All (Claude Code, Codex, Agents)");
  });
});

// ─── Conflict detection tests ──────────────────────────────────────────────

describe("checkConflict", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-conflict-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("no conflict when directory does not exist", async () => {
    await expect(
      checkConflict(join(tempDir, "nonexistent"), false),
    ).resolves.toBeUndefined();
  });

  test("throws when directory exists without force", async () => {
    const existing = join(tempDir, "existing");
    await mkdir(existing);
    await expect(checkConflict(existing, false)).rejects.toThrow("--force");
  });

  test("allows overwrite with force", async () => {
    const existing = join(tempDir, "existing");
    await mkdir(existing);
    await expect(checkConflict(existing, true)).resolves.toBeUndefined();
  });
});

// ─── Installer verbose output tests ──────────────────────────────────────

import { setVerbose } from "./logger";

describe("installer verbose output", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setVerbose(false);
    stderrSpy.mockRestore();
  });

  test("parseSource emits debug when verbose", () => {
    setVerbose(true);
    parseSource("github:alice/my-skill#v1.0");
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("[verbose]");
    expect(output).toContain("install: parsed source");
    expect(output).toContain("owner=alice");
    expect(output).toContain("repo=my-skill");
  });

  test("parseSource is silent when not verbose", () => {
    setVerbose(false);
    parseSource("github:alice/my-skill");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  test("checkGitAvailable emits debug when verbose", async () => {
    setVerbose(true);
    await checkGitAvailable();
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("install: git available");
  });

  test("checkConflict emits debug when verbose", async () => {
    setVerbose(true);
    const tempDir = await mkdtemp(join(tmpdir(), "asm-test-verbose-"));
    try {
      await checkConflict(join(tempDir, "nonexistent"), false);
      const output = stderrSpy.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .join("\n");
      expect(output).toContain("install: target");
      expect(output).toContain("no conflict");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ─── isLocalPath tests ──────────────────────────────────────────────────────

describe("isLocalPath", () => {
  test("detects absolute paths", () => {
    expect(isLocalPath("/absolute/path/to/skill")).toBe(true);
    expect(isLocalPath("/home/user/skills/my-skill")).toBe(true);
    expect(isLocalPath("C:\\Users\\foo\\skill")).toBe(true);
    expect(isLocalPath("C:/Users/foo/skill")).toBe(true);
    expect(isLocalPath("D:\\projects\\my-skill")).toBe(true);
  });

  test("detects relative paths with ./ or .\\", () => {
    expect(isLocalPath("./my-skill")).toBe(true);
    expect(isLocalPath(".\\my-skill")).toBe(true);
    expect(isLocalPath("./relative/path/to/skill")).toBe(true);
  });

  test("detects parent-relative paths with ../ or ..\\", () => {
    expect(isLocalPath("../sibling/skill")).toBe(true);
    expect(isLocalPath("..\\sibling\\skill")).toBe(true);
    expect(isLocalPath("../my-skill")).toBe(true);
  });

  test("detects tilde paths", () => {
    expect(isLocalPath("~/skills/my-skill")).toBe(true);
    expect(isLocalPath("~\\skills\\my-skill")).toBe(true);
    expect(isLocalPath("~")).toBe(true);
  });

  test("does not match ~user syntax (unsupported shell expansion)", () => {
    expect(isLocalPath("~user/skills")).toBe(false);
  });

  test("detects bare dot and double dot", () => {
    expect(isLocalPath(".")).toBe(true);
    expect(isLocalPath("..")).toBe(true);
  });

  test("does not match GitHub source formats", () => {
    expect(isLocalPath("github:owner/repo")).toBe(false);
    expect(isLocalPath("https://github.com/owner/repo")).toBe(false);
  });

  test("does not match bare repo names", () => {
    expect(isLocalPath("alice/my-skill")).toBe(false);
    expect(isLocalPath("my-skill")).toBe(false);
  });
});

// ─── parseLocalSource tests ─────────────────────────────────────────────────

describe("parseLocalSource", () => {
  test("parses absolute path", () => {
    const result = parseLocalSource("/home/user/my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBe("/home/user/my-skill");
    expect(result.owner).toBe("local");
    expect(result.repo).toBe("my-skill");
    expect(result.ref).toBeNull();
    expect(result.subpath).toBeNull();
    expect(result.cloneUrl).toBe("");
    expect(result.sshCloneUrl).toBe("");
  });

  test("parses relative path", () => {
    const result = parseLocalSource("./my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBeTruthy();
    // Should resolve to an absolute path
    expect(result.localPath!.startsWith("/")).toBe(true);
    expect(result.repo).toBe("my-skill");
  });

  test("parses parent-relative path", () => {
    const result = parseLocalSource("../sibling-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath!.startsWith("/")).toBe(true);
    expect(result.repo).toBe("sibling-skill");
  });

  test("parses tilde path", () => {
    const result = parseLocalSource("~/skills/my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath!.startsWith("/")).toBe(true);
    expect(result.repo).toBe("my-skill");
    // Should NOT contain tilde in resolved path
    expect(result.localPath).not.toContain("~");
  });

  test("parses tilde-backslash path", () => {
    const result = parseLocalSource("~\\skills\\my-skill");
    expect(result.isLocal).toBe(true);
    // Should NOT contain tilde in resolved path
    expect(result.localPath).not.toContain("~");
  });
});

// ─── parseSource local path integration tests ──────────────────────────────

describe("parseSource with local paths", () => {
  test("detects and parses absolute path (Linux)", () => {
    const result = parseSource("/home/user/skills/my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBeTruthy();
  });

  test("detects and parses absolute path (Windows)", () => {
    const result = parseSource("C:\\Users\\emre\\skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBeTruthy();
  });

  test("detects and parses relative backslash path", () => {
    const result = parseSource(".\\my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBeTruthy();
  });

  test("detects and parses parent-relative backslash path", () => {
    const result = parseSource("..\\my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).toBeTruthy();
  });

  test("detects and parses relative slash path", () => {
    const result = parseSource("./my-skill");
    expect(result.isLocal).toBe(true);
  });

  test("detects and parses tilde path", () => {
    const result = parseSource("~/my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).not.toContain("~");
  });

  test("detects and parses tilde-backslash path", () => {
    const result = parseSource("~\\my-skill");
    expect(result.isLocal).toBe(true);
    expect(result.localPath).not.toContain("~");
  });

  test("does not interfere with github: prefix", () => {
    const result = parseSource("github:alice/my-skill");
    expect(result.isLocal).toBeUndefined();
    expect(result.owner).toBe("alice");
  });

  test("does not interfere with HTTPS URLs", () => {
    const result = parseSource("https://github.com/owner/repo");
    expect(result.isLocal).toBeUndefined();
    expect(result.owner).toBe("owner");
  });
});

// ─── buildRepoUrl tests ────────────────────────────────────────────────────

describe("buildRepoUrl", () => {
  test("builds basic GitHub URL from owner/repo", () => {
    const source = parseSource("github:alice/my-skill");
    const url = buildRepoUrl(source);
    expect(url).toBe("https://github.com/alice/my-skill");
  });

  test("builds URL with ref", () => {
    const source = parseSource("github:alice/my-skill#develop");
    const url = buildRepoUrl(source);
    expect(url).toBe("https://github.com/alice/my-skill/tree/develop");
  });

  test("builds URL with ref and subpath", () => {
    const source = parseSource("github:alice/skills#main:skills/agent-config");
    const url = buildRepoUrl(source);
    expect(url).toBe(
      "https://github.com/alice/skills/tree/main/skills/agent-config",
    );
  });

  test("returns local path for local source", () => {
    const source = parseSource("/home/user/skills/my-skill");
    const url = buildRepoUrl(source);
    expect(url).toBe("/home/user/skills/my-skill");
  });
});

// ─── buildInstallPlan scope tests ────────────────────────────────────────────

describe("buildInstallPlan", () => {
  const source = {
    owner: "user",
    repo: "my-skill",
    ref: null,
    subpath: null,
    cloneUrl: "https://github.com/user/my-skill.git",
    sshCloneUrl: "git@github.com:user/my-skill.git",
  };
  const provider: ProviderConfig = {
    name: "claude",
    label: "Claude Code",
    global: "~/.claude/skills",
    project: ".claude/skills",
    enabled: true,
  };

  test("uses provider.global path when scope is global", () => {
    const plan = buildInstallPlan(
      source,
      "/tmp/source",
      "/tmp/source/skill",
      "my-skill",
      provider,
      false,
      "global",
    );
    expect(plan.scope).toBe("global");
    expect(plan.targetDir).toContain(".claude/skills/my-skill");
    expect(plan.targetDir).not.toMatch(/^\.\//);
  });

  test("uses provider.project path when scope is project", () => {
    const plan = buildInstallPlan(
      source,
      "/tmp/source",
      "/tmp/source/skill",
      "my-skill",
      provider,
      false,
      "project",
    );
    expect(plan.scope).toBe("project");
    expect(plan.targetDir).toContain(".claude/skills/my-skill");
  });

  test("defaults to global scope when scope is omitted", () => {
    const plan = buildInstallPlan(
      source,
      "/tmp/source",
      "/tmp/source/skill",
      "my-skill",
      provider,
      false,
    );
    expect(plan.scope).toBe("global");
  });
});

// ─── buildInstallPlan extended scope tests ───────────────────────────────────

describe("buildInstallPlan scope - target directory resolution", () => {
  const source = {
    owner: "user",
    repo: "my-skill",
    ref: null,
    subpath: null,
    cloneUrl: "https://github.com/user/my-skill.git",
    sshCloneUrl: "git@github.com:user/my-skill.git",
  };

  test("global scope resolves to absolute path from provider.global", () => {
    const provider: ProviderConfig = {
      name: "claude",
      label: "Claude Code",
      global: "~/.claude/skills",
      project: ".claude/skills",
      enabled: true,
    };
    const plan = buildInstallPlan(
      source,
      "/tmp/src",
      "/tmp/src/skill",
      "my-skill",
      provider,
      false,
      "global",
    );
    // Global path should resolve ~ to homedir, resulting in an absolute path
    expect(plan.targetDir.startsWith("/")).toBe(true);
    expect(plan.targetDir).toContain("my-skill");
  });

  test("project scope resolves to path from provider.project", () => {
    const provider: ProviderConfig = {
      name: "claude",
      label: "Claude Code",
      global: "~/.claude/skills",
      project: ".claude/skills",
      enabled: true,
    };
    const plan = buildInstallPlan(
      source,
      "/tmp/src",
      "/tmp/src/skill",
      "my-skill",
      provider,
      false,
      "project",
    );
    expect(plan.targetDir).toContain(".claude/skills/my-skill");
  });

  test("force flag is preserved in plan", () => {
    const provider: ProviderConfig = {
      name: "claude",
      label: "Claude Code",
      global: "~/.claude/skills",
      project: ".claude/skills",
      enabled: true,
    };
    const plan = buildInstallPlan(
      source,
      "/tmp/src",
      "/tmp/src/skill",
      "my-skill",
      provider,
      true,
      "project",
    );
    expect(plan.force).toBe(true);
    expect(plan.scope).toBe("project");
  });

  test("plan preserves all source fields", () => {
    const sourceWithRef = {
      ...source,
      ref: "v2.0",
      subpath: "skills/foo",
    };
    const provider: ProviderConfig = {
      name: "agents",
      label: "Agents",
      global: "~/.agents/skills",
      project: ".agents/skills",
      enabled: true,
    };
    const plan = buildInstallPlan(
      sourceWithRef,
      "/tmp/src",
      "/tmp/src/skill",
      "foo",
      provider,
      false,
      "global",
    );
    expect(plan.source.ref).toBe("v2.0");
    expect(plan.source.subpath).toBe("skills/foo");
    expect(plan.skillName).toBe("foo");
    expect(plan.providerName).toBe("agents");
    expect(plan.providerLabel).toBe("Agents");
  });
});

// ─── executeInstallAllProviders scope tests ─────────────────────────────────

describe("executeInstallAllProviders with project scope", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-scope-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("uses project paths for symlinks when scope is project", async () => {
    // Create source skill
    const sourceDir = join(tempDir, "source", "my-skill");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: my-skill\nversion: 1.0.0\ndescription: Test\n---\n# Skill\n",
    );

    // Primary install target using project path
    const primaryDir = join(tempDir, "project-agents-skills");
    const targetDir = join(primaryDir, "my-skill");
    await mkdir(primaryDir, { recursive: true });

    const plan: import("./utils/types").InstallPlan = {
      source: {
        owner: "user",
        repo: "my-skill",
        ref: null,
        subpath: null,
        cloneUrl: "https://github.com/user/my-skill.git",
        sshCloneUrl: "git@github.com:user/my-skill.git",
      },
      tempDir: join(tempDir, "source"),
      sourceDir,
      targetDir,
      skillName: "my-skill",
      force: false,
      providerName: "agents",
      providerLabel: "Agents",
      scope: "project",
    };

    const providers: ProviderConfig[] = [
      {
        name: "claude",
        label: "Claude Code",
        global: join(tempDir, "global-claude-skills"),
        project: join(tempDir, "project-claude-skills"),
        enabled: true,
      },
      {
        name: "agents",
        label: "Agents",
        global: join(tempDir, "global-agents-skills"),
        project: join(tempDir, "project-agents-skills"),
        enabled: true,
      },
    ];

    const result = await executeInstallAllProviders(plan, providers);
    expect(result.success).toBe(true);

    // Symlink should be in the PROJECT path of the claude provider, not global
    const linkPath = join(tempDir, "project-claude-skills", "my-skill");
    const stats = await lstat(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);

    const target = await readlink(linkPath);
    expect(target.startsWith("/")).toBe(false); // relative symlink
  });
});

// ─── checkNpxAvailable tests ────────────────────────────────────────────────

describe("checkNpxAvailable", () => {
  test("does not throw when npx is available", async () => {
    // npx should be available in the test environment since bun/node is present
    await expect(checkNpxAvailable()).resolves.toBeUndefined();
  });
});
