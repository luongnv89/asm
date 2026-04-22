import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseSkillMetadata,
  generateManifest,
  mapVerdict,
  formatPublishMachine,
  formatFallbackInstructions,
  checkIsGitRepo,
  getHeadCommit,
  getRemoteOrigin,
  checkGhCli,
  stripControlChars,
  escapeMarkdown,
  sanitizeForMarkdown,
} from "./publisher";
import type { GenerateManifestOptions } from "./publisher";
import type { PublishResult } from "./utils/types";
import type { SecurityAuditReport } from "./utils/types";

import { spawnSyncArgv } from "./utils/test-spawn";
// ─── Helpers ───────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "publisher-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeSkillMd(fields: Record<string, string>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("# Test Skill");
  return lines.join("\n");
}

function makeDummySecurityReport(): SecurityAuditReport {
  return {
    scannedAt: "2026-01-01T00:00:00.000Z",
    skillName: "test-skill",
    skillPath: "/tmp/test",
    source: null,
    codeScans: [],
    permissions: [],
    totalFiles: 1,
    totalLines: 10,
    verdict: "safe",
    verdictReason: "No issues found",
  };
}

function makeDummyPublishResult(
  overrides: Partial<PublishResult> = {},
): PublishResult {
  return {
    success: true,
    manifest: {
      name: "test-skill",
      author: "testuser",
      description: "A test skill",
      repository: "https://github.com/testuser/test-skill",
      commit: "a".repeat(40),
      security_verdict: "pass",
      published_at: "2026-01-01T00:00:00.000Z",
    },
    prUrl: "https://github.com/luongnv89/asm-registry/pull/1",
    error: null,
    securityVerdict: "pass",
    securityReport: makeDummySecurityReport(),
    ...overrides,
  };
}

// ─── parseSkillMetadata ─────────────────────────────────────────────────────

describe("parseSkillMetadata", () => {
  test("parses valid SKILL.md", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      makeSkillMd({
        name: "my-skill",
        description: "A useful skill for testing",
        version: "1.2.3",
        license: "MIT",
        creator: "testuser",
      }),
    );

    const meta = await parseSkillMetadata(tempDir);
    expect(meta.name).toBe("my-skill");
    expect(meta.description).toBe("A useful skill for testing");
    expect(meta.version).toBe("1.2.3");
    expect(meta.license).toBe("MIT");
    expect(meta.creator).toBe("testuser");
    expect(meta.tags).toEqual([]);
  });

  test("throws when SKILL.md is missing", async () => {
    await expect(parseSkillMetadata(tempDir)).rejects.toThrow("No SKILL.md");
  });

  test("throws when name is missing", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      makeSkillMd({ description: "no name" }),
    );
    await expect(parseSkillMetadata(tempDir)).rejects.toThrow(
      "missing required field: name",
    );
  });

  test("throws when description is missing", async () => {
    await writeFile(join(tempDir, "SKILL.md"), makeSkillMd({ name: "test" }));
    await expect(parseSkillMetadata(tempDir)).rejects.toThrow(
      "missing required field: description",
    );
  });

  test("defaults version to 0.0.0 when missing", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      makeSkillMd({ name: "test", description: "test skill" }),
    );
    const meta = await parseSkillMetadata(tempDir);
    expect(meta.version).toBe("0.0.0");
  });

  test("defaults license to MIT when missing", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      makeSkillMd({ name: "test", description: "test skill" }),
    );
    const meta = await parseSkillMetadata(tempDir);
    expect(meta.license).toBe("MIT");
  });

  test("parses metadata.version from nested metadata block", async () => {
    const content = [
      "---",
      "name: nested-version",
      "description: test",
      "metadata:",
      "  version: 2.0.0",
      "---",
    ].join("\n");
    await writeFile(join(tempDir, "SKILL.md"), content);
    const meta = await parseSkillMetadata(tempDir);
    expect(meta.version).toBe("2.0.0");
  });
});

// ─── mapVerdict ─────────────────────────────────────────────────────────────

describe("mapVerdict", () => {
  test("maps safe to pass", () => {
    expect(mapVerdict("safe")).toBe("pass");
  });

  test("maps caution to pass", () => {
    expect(mapVerdict("caution")).toBe("pass");
  });

  test("maps warning to warning", () => {
    expect(mapVerdict("warning")).toBe("warning");
  });

  test("maps dangerous to dangerous", () => {
    expect(mapVerdict("dangerous")).toBe("dangerous");
  });
});

// ─── generateManifest ───────────────────────────────────────────────────────

describe("generateManifest", () => {
  const baseOpts: GenerateManifestOptions = {
    metadata: {
      name: "my-skill",
      description: "A skill for testing",
      version: "1.0.0",
      license: "MIT",
      creator: "testuser",
      tags: ["testing", "automation"],
    },
    author: "testuser",
    commit: "a".repeat(40),
    repository: "https://github.com/testuser/my-skill",
    securityVerdict: "pass",
  };

  test("generates valid manifest with all fields", () => {
    const manifest = generateManifest(baseOpts);

    expect(manifest.name).toBe("my-skill");
    expect(manifest.author).toBe("testuser");
    expect(manifest.description).toBe("A skill for testing");
    expect(manifest.repository).toBe("https://github.com/testuser/my-skill");
    expect(manifest.commit).toBe("a".repeat(40));
    expect(manifest.security_verdict).toBe("pass");
    expect(manifest.published_at).toBeTruthy();
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.tags).toEqual(["testing", "automation"]);
  });

  test("omits version when 0.0.0", () => {
    const opts = {
      ...baseOpts,
      metadata: { ...baseOpts.metadata, version: "0.0.0" },
    };
    const manifest = generateManifest(opts);
    expect(manifest.version).toBeUndefined();
  });

  test("omits tags when empty", () => {
    const opts = {
      ...baseOpts,
      metadata: { ...baseOpts.metadata, tags: [] },
    };
    const manifest = generateManifest(opts);
    expect(manifest.tags).toBeUndefined();
  });

  test("truncates tags to max 10", () => {
    const opts = {
      ...baseOpts,
      metadata: {
        ...baseOpts.metadata,
        tags: Array.from({ length: 15 }, (_, i) => `tag${i}`),
      },
    };
    const manifest = generateManifest(opts);
    expect(manifest.tags!.length).toBe(10);
  });

  test("published_at is valid ISO 8601", () => {
    const manifest = generateManifest(baseOpts);
    const date = new Date(manifest.published_at);
    expect(date.toISOString()).toBe(manifest.published_at);
  });
});

// ─── formatPublishMachine ───────────────────────────────────────────────────

describe("formatPublishMachine", () => {
  test("outputs v1 envelope on success", () => {
    const result = makeDummyPublishResult();
    const output = formatPublishMachine(result);
    const parsed = JSON.parse(output);

    expect(parsed.version).toBe(1);
    expect(parsed.type).toBe("publish");
    expect(parsed.success).toBe(true);
    expect(parsed.manifest).toBeTruthy();
    expect(parsed.pr_url).toBe(
      "https://github.com/luongnv89/asm-registry/pull/1",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.security_verdict).toBe("pass");
    expect(parsed.fallback).toBe(false);
    expect(parsed.fallback_reason).toBeNull();
  });

  test("outputs v1 envelope on failure", () => {
    const result = makeDummyPublishResult({
      success: false,
      error: "Security audit verdict: dangerous",
      prUrl: null,
      securityVerdict: "dangerous",
    });
    const output = formatPublishMachine(result);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("dangerous");
    expect(parsed.pr_url).toBeNull();
  });

  test("includes fallback info when gh unavailable", () => {
    const result = makeDummyPublishResult({
      prUrl: null,
      fallback: true,
      fallbackReason: "gh CLI not found",
    });
    const output = formatPublishMachine(result);
    const parsed = JSON.parse(output);

    expect(parsed.fallback).toBe(true);
    expect(parsed.fallback_reason).toBe("gh CLI not found");
  });
});

// ─── formatFallbackInstructions ─────────────────────────────────────────────

describe("formatFallbackInstructions", () => {
  test("returns empty string when no manifest", () => {
    const result = makeDummyPublishResult({ manifest: null });
    expect(formatFallbackInstructions(result)).toBe("");
  });

  test("includes manual steps", () => {
    const result = makeDummyPublishResult({
      fallback: true,
      fallbackReason: "gh CLI not found",
    });
    const output = formatFallbackInstructions(result);

    expect(output).toContain("Fork");
    expect(output).toContain("Create branch");
    expect(output).toContain("Open a PR");
    expect(output).toContain("asm doctor");
    expect(output).toContain("test-skill");
    expect(output).toContain("testuser");
  });

  test("includes the generated manifest JSON", () => {
    const result = makeDummyPublishResult({
      fallback: true,
      fallbackReason: "gh CLI not authenticated",
    });
    const output = formatFallbackInstructions(result);
    expect(output).toContain('"name": "test-skill"');
    expect(output).toContain('"author": "testuser"');
  });
});

// ─── parseArgs integration ──────────────────────────────────────────────────

describe("parseArgs publish flags", () => {
  // Import parseArgs to verify flag parsing
  const { parseArgs } = require("./cli");
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("parses publish command", () => {
    const result = parse("publish");
    expect(result.command).toBe("publish");
  });

  test("parses publish with path", () => {
    const result = parse("publish", "./my-skill");
    expect(result.command).toBe("publish");
    expect(result.subcommand).toBe("./my-skill");
  });

  test("parses --dry-run flag", () => {
    const result = parse("publish", "--dry-run");
    expect(result.flags.dryRun).toBe(true);
  });

  test("parses --machine flag", () => {
    const result = parse("publish", "--machine");
    expect(result.flags.machine).toBe(true);
  });

  test("parses --force flag", () => {
    const result = parse("publish", "--force");
    expect(result.flags.force).toBe(true);
  });

  test("parses --yes flag", () => {
    const result = parse("publish", "-y");
    expect(result.flags.yes).toBe(true);
  });

  test("parses combined flags", () => {
    const result = parse(
      "publish",
      "./my-skill",
      "--dry-run",
      "--json",
      "--force",
    );
    expect(result.command).toBe("publish");
    expect(result.subcommand).toBe("./my-skill");
    expect(result.flags.dryRun).toBe(true);
    expect(result.flags.json).toBe(true);
    expect(result.flags.force).toBe(true);
  });
});

// ─── isCLIMode ──────────────────────────────────────────────────────────────

describe("isCLIMode recognizes publish", () => {
  const { isCLIMode } = require("./cli");

  test("publish is recognized as CLI mode", () => {
    expect(isCLIMode(["bun", "script.ts", "publish"])).toBe(true);
  });

  test("publish with flags is CLI mode", () => {
    expect(isCLIMode(["bun", "script.ts", "publish", "--dry-run"])).toBe(true);
  });
});

// ─── checkIsGitRepo ────────────────────────────────────────────────────────

describe("checkIsGitRepo", () => {
  test("resolves for a valid git repo", async () => {
    // The project root is a git repo
    await expect(checkIsGitRepo(process.cwd())).resolves.toBeUndefined();
  });

  test("rejects for a non-git directory", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "publisher-nogit-"));
    try {
      await expect(checkIsGitRepo(nonGitDir)).rejects.toThrow(
        "not inside a git repository",
      );
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ─── getHeadCommit ─────────────────────────────────────────────────────────

describe("getHeadCommit", () => {
  test("returns a 40-character hex SHA", async () => {
    const sha = await getHeadCommit(process.cwd());
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("rejects for a non-git directory", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "publisher-nohead-"));
    try {
      await expect(getHeadCommit(nonGitDir)).rejects.toThrow(
        "Failed to get HEAD commit",
      );
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

// ─── getRemoteOrigin ───────────────────────────────────────────────────────

describe("getRemoteOrigin", () => {
  test("returns an HTTPS URL for the project root", async () => {
    const url = await getRemoteOrigin(process.cwd());
    expect(url).toMatch(/^https:\/\/github\.com\//);
    // Should not end with .git
    expect(url).not.toMatch(/\.git$/);
  });

  test("rejects for a repo without a remote", async () => {
    const noRemoteDir = await mkdtemp(join(tmpdir(), "publisher-noremote-"));
    try {
      // Init a bare git repo with no remote
      spawnSyncArgv(["git", "init"], { cwd: noRemoteDir });
      await expect(getRemoteOrigin(noRemoteDir)).rejects.toThrow(
        "No remote origin found",
      );
    } finally {
      await rm(noRemoteDir, { recursive: true, force: true });
    }
  });
});

// ─── checkGhCli ────────────────────────────────────────────────────────────

describe("checkGhCli", () => {
  test("returns an object with available, authenticated, and login fields", async () => {
    const result = await checkGhCli();
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.authenticated).toBe("boolean");
    // login is string | null
    if (result.login !== null) {
      expect(typeof result.login).toBe("string");
    }
  });

  test("if available, authenticated is also a boolean", async () => {
    const result = await checkGhCli();
    if (result.available) {
      expect(typeof result.authenticated).toBe("boolean");
    } else {
      expect(result.authenticated).toBe(false);
      expect(result.login).toBeNull();
    }
  });
});

// ─── stripControlChars ────────────────────────────────────────────────────

describe("stripControlChars", () => {
  test("returns plain text unchanged", () => {
    expect(stripControlChars("hello-world")).toBe("hello-world");
  });

  test("strips ANSI color escape sequences", () => {
    expect(stripControlChars("\x1b[31mred\x1b[0m")).toBe("red");
  });

  test("strips OSC escape sequences", () => {
    expect(stripControlChars("\x1b]0;malicious title\x07safe")).toBe("safe");
  });

  test("strips control characters except newline and tab", () => {
    expect(stripControlChars("a\x00b\x01c\x0Ed")).toBe("abcd");
    expect(stripControlChars("line\n\ttab")).toBe("line\n\ttab");
  });

  test("strips DEL character (0x7F)", () => {
    expect(stripControlChars("abc\x7Fdef")).toBe("abcdef");
  });

  test("strips complex nested escape sequences", () => {
    const malicious = "\x1b[31;1m\x1b]2;pwned\x07evil\x1b[0m";
    const result = stripControlChars(malicious);
    expect(result).toBe("evil");
    expect(result).not.toContain("\x1b");
  });
});

// ─── publishSkill integration ──────────────────────────────────────────────

describe("publishSkill", () => {
  // We need a git repo with SKILL.md and a remote for these tests.
  // The _auditFn option injects a stub without mock.module (avoids cross-file leaks).
  let gitDir: string;

  const { publishSkill } = require("./publisher");

  function fakeAudit(
    overrides: Partial<SecurityAuditReport> = {},
  ): (path: string, name: string) => Promise<SecurityAuditReport> {
    return async () => ({ ...makeDummySecurityReport(), ...overrides });
  }

  // Tests must be host-independent: they should not take a different branch
  // through publishSkill depending on whether the developer happens to have `gh`
  // installed and authenticated. Each test that reaches step 6 passes this stub
  // so results match across dev machines, CI, and the pre-commit hook.
  function fakeGhCli(
    overrides: Partial<{
      available: boolean;
      authenticated: boolean;
      login: string | null;
    }> = {},
  ): () => Promise<{
    available: boolean;
    authenticated: boolean;
    login: string | null;
  }> {
    const result = {
      available: true,
      authenticated: true,
      login: "testuser",
      ...overrides,
    };
    return async () => result;
  }

  beforeEach(async () => {
    gitDir = await mkdtemp(join(tmpdir(), "publish-integ-"));
    // Init git repo
    spawnSyncArgv(["git", "init"], { cwd: gitDir });
    spawnSyncArgv(["git", "config", "user.email", "test@test.com"], {
      cwd: gitDir,
    });
    spawnSyncArgv(["git", "config", "user.name", "Test"], { cwd: gitDir });
    // Add remote
    spawnSyncArgv(
      [
        "git",
        "remote",
        "add",
        "origin",
        "https://github.com/testuser/my-skill",
      ],
      { cwd: gitDir },
    );
    // Write a SKILL.md and commit so HEAD exists
    await writeFile(
      join(gitDir, "SKILL.md"),
      makeSkillMd({
        name: "test-skill",
        description: "A test skill",
        version: "1.0.0",
        license: "MIT",
        creator: "testuser",
      }),
    );
    spawnSyncArgv(["git", "add", "."], { cwd: gitDir });
    spawnSyncArgv(["git", "commit", "-m", "init"], { cwd: gitDir });
  });

  afterEach(async () => {
    await rm(gitDir, { recursive: true, force: true });
  });

  test("dangerous verdict blocks publish", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: false,
      force: false,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "dangerous",
        verdictReason: "Executes arbitrary shell commands",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("dangerous");
    expect(result.securityVerdict).toBe("dangerous");
    expect(result.manifest).toBeNull();
    expect(result.prUrl).toBeNull();
  });

  test("warning verdict blocks publish without --force", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: false,
      force: false,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "warning",
        verdictReason: "Suspicious patterns detected",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("warning");
    expect(result.error).toContain("--force");
  });

  test("--force overrides warning verdict", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: true,
      force: true,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "warning",
        verdictReason: "Suspicious patterns detected",
      }),
      _checkGhCliFn: fakeGhCli(),
    });

    // With --force + --dry-run, should succeed past the verdict check
    expect(result.success).toBe(true);
    expect(result.securityVerdict).toBe("warning");
    expect(result.manifest).not.toBeNull();
  });

  test("--force does NOT override dangerous verdict", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: false,
      force: true,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "dangerous",
        verdictReason: "Critical security issue",
      }),
    });

    expect(result.success).toBe(false);
    expect(result.securityVerdict).toBe("dangerous");
  });

  test("--dry-run exits before side effects with valid manifest", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: true,
      force: false,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "safe",
        verdictReason: "No issues found",
      }),
      _checkGhCliFn: fakeGhCli(),
    });

    expect(result.success).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest!.name).toBe("test-skill");
    expect(result.manifest!.repository).toBe(
      "https://github.com/testuser/my-skill",
    );
    expect(result.manifest!.security_verdict).toBe("pass");
    // No PR should be created in dry-run
    expect(result.prUrl).toBeNull();
  });

  test("dry-run manifest includes correct metadata fields", async () => {
    const result = await publishSkill({
      path: gitDir,
      dryRun: true,
      force: false,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "safe",
        verdictReason: "Clean",
      }),
      _checkGhCliFn: fakeGhCli(),
    });

    expect(result.success).toBe(true);
    const m = result.manifest!;
    expect(m.version).toBe("1.0.0");
    expect(m.license).toBe("MIT");
    expect(m.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(m.published_at).toBeTruthy();
  });

  test("non-git directory throws error", async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), "publish-nogit-"));
    await writeFile(
      join(nonGitDir, "SKILL.md"),
      makeSkillMd({ name: "test", description: "test" }),
    );

    await expect(
      publishSkill({
        path: nonGitDir,
        dryRun: true,
        force: false,
        yes: true,
        _auditFn: fakeAudit(),
      }),
    ).rejects.toThrow("not inside a git repository");

    await rm(nonGitDir, { recursive: true, force: true });
  });

  test("fallback path when gh CLI is unavailable", async () => {
    // This test's point is to exercise the `gh not available` branch explicitly.
    // Stub gh as unavailable so the test runs the same whether or not the host
    // has gh installed; the fallback path still produces a valid manifest.
    const result = await publishSkill({
      path: gitDir,
      dryRun: true,
      force: false,
      yes: true,
      _auditFn: fakeAudit({
        verdict: "safe",
        verdictReason: "No issues found",
      }),
      _checkGhCliFn: fakeGhCli({ available: false, authenticated: false }),
    });

    // Fallback path should still succeed with a manifest — PR creation is
    // skipped, author falls back to metadata.creator.
    expect(result.success).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.error).toBeNull();
  });

  test("validateManifest failure when name contains uppercase/special chars", async () => {
    // Overwrite SKILL.md with a name that violates the registry NAME_PATTERN (^[a-z0-9]([a-z0-9-]*[a-z0-9])?$)
    await writeFile(
      join(gitDir, "SKILL.md"),
      makeSkillMd({
        name: "My_Skill!",
        description: "A test skill with bad name",
        version: "1.0.0",
        license: "MIT",
        creator: "testuser",
      }),
    );
    spawnSyncArgv(["git", "add", "."], { cwd: gitDir });
    spawnSyncArgv(["git", "commit", "-m", "bad name"], { cwd: gitDir });

    const result = await publishSkill({
      path: gitDir,
      dryRun: true,
      force: false,
      yes: true,
      _auditFn: fakeAudit({ verdict: "safe", verdictReason: "OK" }),
      _checkGhCliFn: fakeGhCli(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Manifest validation failed");
    expect(result.error).toContain("name");
  });
});

// ─── checkGhCli authenticated:true but login:null ──────────────────────────

describe("checkGhCli edge case: authenticated but login null", () => {
  // Use the _checkGhCliFn override to simulate a transient API failure
  // where authentication succeeds but the `gh api user` call fails.

  let gitDirLocal: string;

  beforeEach(async () => {
    gitDirLocal = await mkdtemp(join(tmpdir(), "publish-loginull-"));
    spawnSyncArgv(["git", "init"], { cwd: gitDirLocal });
    spawnSyncArgv(["git", "config", "user.email", "test@test.com"], {
      cwd: gitDirLocal,
    });
    spawnSyncArgv(["git", "config", "user.name", "Test"], {
      cwd: gitDirLocal,
    });
    spawnSyncArgv(
      [
        "git",
        "remote",
        "add",
        "origin",
        "https://github.com/testuser/my-skill",
      ],
      { cwd: gitDirLocal },
    );
    await writeFile(
      join(gitDirLocal, "SKILL.md"),
      makeSkillMd({
        name: "test-skill",
        description: "A test skill",
        version: "1.0.0",
        license: "MIT",
        creator: "testuser",
      }),
    );
    spawnSyncArgv(["git", "add", "."], { cwd: gitDirLocal });
    spawnSyncArgv(["git", "commit", "-m", "init"], { cwd: gitDirLocal });
  });

  afterEach(async () => {
    await rm(gitDirLocal, { recursive: true, force: true });
  });

  test("publishSkill throws when gh is authenticated but login is null", async () => {
    const { publishSkill: publishSkillFn } = require("./publisher");

    await expect(
      publishSkillFn({
        path: gitDirLocal,
        dryRun: true,
        force: false,
        yes: true,
        _auditFn: async () => makeDummySecurityReport(),
        _checkGhCliFn: async () => ({
          available: true,
          authenticated: true,
          login: null,
        }),
      }),
    ).rejects.toThrow("Could not determine GitHub username");
  });
});

// ─── publishSkill fallback: gh available but not authenticated ────────────

describe("publishSkill fallback: gh available but not authenticated", () => {
  let gitDirLocal: string;

  const { publishSkill: publishSkillFn } = require("./publisher");

  beforeEach(async () => {
    gitDirLocal = await mkdtemp(join(tmpdir(), "publish-noauth-"));
    spawnSyncArgv(["git", "init"], { cwd: gitDirLocal });
    spawnSyncArgv(["git", "config", "user.email", "test@test.com"], {
      cwd: gitDirLocal,
    });
    spawnSyncArgv(["git", "config", "user.name", "Test"], {
      cwd: gitDirLocal,
    });
    spawnSyncArgv(
      [
        "git",
        "remote",
        "add",
        "origin",
        "https://github.com/testuser/my-skill",
      ],
      { cwd: gitDirLocal },
    );
    await writeFile(
      join(gitDirLocal, "SKILL.md"),
      makeSkillMd({
        name: "test-skill",
        description: "A test skill",
        version: "1.0.0",
        license: "MIT",
        creator: "testuser",
      }),
    );
    spawnSyncArgv(["git", "add", "."], { cwd: gitDirLocal });
    spawnSyncArgv(["git", "commit", "-m", "init"], { cwd: gitDirLocal });
  });

  afterEach(async () => {
    await rm(gitDirLocal, { recursive: true, force: true });
  });

  test("returns fallback result when gh is available but not authenticated", async () => {
    const result = await publishSkillFn({
      path: gitDirLocal,
      dryRun: false,
      force: false,
      yes: true,
      _auditFn: async () => makeDummySecurityReport(),
      _checkGhCliFn: async () => ({
        available: true,
        authenticated: false,
        login: null,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest!.name).toBe("test-skill");
    expect(result.manifest!.author).toBe("testuser");
    expect(result.prUrl).toBeNull();
    expect(result.fallback).toBe(true);
    expect(result.fallbackReason).toBe("gh CLI not authenticated");
  });

  test("fallback validates manifest and rejects invalid names", async () => {
    // Overwrite SKILL.md with an invalid name
    await writeFile(
      join(gitDirLocal, "SKILL.md"),
      makeSkillMd({
        name: "INVALID_NAME!",
        description: "A test skill",
        version: "1.0.0",
        license: "MIT",
        creator: "testuser",
      }),
    );
    spawnSyncArgv(["git", "add", "."], { cwd: gitDirLocal });
    spawnSyncArgv(["git", "commit", "-m", "bad name"], { cwd: gitDirLocal });

    const result = await publishSkillFn({
      path: gitDirLocal,
      dryRun: false,
      force: false,
      yes: true,
      _auditFn: async () => makeDummySecurityReport(),
      _checkGhCliFn: async () => ({
        available: true,
        authenticated: false,
        login: null,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Manifest validation failed");
    expect(result.error).toContain("name");
  });
});

// ─── parseSkillMetadata with tags ──────────────────────────────────────────

describe("parseSkillMetadata tags parsing", () => {
  let tagsDir: string;

  beforeEach(async () => {
    tagsDir = await mkdtemp(join(tmpdir(), "publisher-tags-"));
  });

  afterEach(async () => {
    await rm(tagsDir, { recursive: true, force: true });
  });

  test("parses comma-separated tags", async () => {
    await writeFile(
      join(tagsDir, "SKILL.md"),
      makeSkillMd({
        name: "tag-skill",
        description: "skill with tags",
        tags: "automation, testing, ci",
      }),
    );
    const meta = await parseSkillMetadata(tagsDir);
    expect(meta.tags).toEqual(["automation", "testing", "ci"]);
  });

  test("parses space-separated tags", async () => {
    await writeFile(
      join(tagsDir, "SKILL.md"),
      makeSkillMd({
        name: "tag-skill",
        description: "skill with tags",
        tags: "deploy monitor alert",
      }),
    );
    const meta = await parseSkillMetadata(tagsDir);
    expect(meta.tags).toEqual(["deploy", "monitor", "alert"]);
  });

  test("lowercases tags", async () => {
    await writeFile(
      join(tagsDir, "SKILL.md"),
      makeSkillMd({
        name: "tag-skill",
        description: "skill with tags",
        tags: "Deploy, MONITOR",
      }),
    );
    const meta = await parseSkillMetadata(tagsDir);
    expect(meta.tags).toEqual(["deploy", "monitor"]);
  });

  test("filters out empty tags from extra commas/spaces", async () => {
    await writeFile(
      join(tagsDir, "SKILL.md"),
      makeSkillMd({
        name: "tag-skill",
        description: "skill with tags",
        tags: "deploy,,  , monitor",
      }),
    );
    const meta = await parseSkillMetadata(tagsDir);
    expect(meta.tags).toEqual(["deploy", "monitor"]);
  });

  test("returns empty array when tags field is absent", async () => {
    await writeFile(
      join(tagsDir, "SKILL.md"),
      makeSkillMd({
        name: "tag-skill",
        description: "skill with no tags",
      }),
    );
    const meta = await parseSkillMetadata(tagsDir);
    expect(meta.tags).toEqual([]);
  });
});

// ─── escapeMarkdown / sanitizeForMarkdown ──────────────────────────────────

describe("escapeMarkdown", () => {
  test("escapes backticks", () => {
    expect(escapeMarkdown("code `here`")).toBe("code \\`here\\`");
  });

  test("escapes square brackets", () => {
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\](url)");
  });

  test("escapes angle brackets to HTML entities", () => {
    expect(escapeMarkdown("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("escapes pipe characters", () => {
    expect(escapeMarkdown("col1 | col2")).toBe("col1 \\| col2");
  });

  test("escapes backslashes", () => {
    expect(escapeMarkdown("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  test("leaves normal text unchanged", () => {
    expect(escapeMarkdown("A useful skill for testing")).toBe(
      "A useful skill for testing",
    );
  });
});

describe("sanitizeForMarkdown", () => {
  test("strips control chars and escapes markdown", () => {
    const input = "\x1b[31m<b>`injected`</b>\x1b[0m";
    const result = sanitizeForMarkdown(input);
    expect(result).not.toContain("\x1b");
    expect(result).toContain("\\`");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });
});
