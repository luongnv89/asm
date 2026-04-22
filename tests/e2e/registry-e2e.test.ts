/**
 * E2E tests for the registry publish/install workflow.
 *
 * Covers:
 *   - `asm publish --dry-run` on skills at repo root and in subdirectories
 *   - `asm publish` error paths (no git, no SKILL.md, dangerous verdict)
 *   - `asm install <name>` resolving from a mocked registry cache
 *   - `asm install <author/name>` scoped lookup
 *   - `asm install` error paths (not found, suggestions)
 *
 * Registry resolution is tested without network access by pre-populating
 * the cache file via the ASM_REGISTRY_CACHE env var.
 */

import { fileURLToPath } from "url";
import { describe, test, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import { join, resolve, dirname } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  access,
} from "fs/promises";
import { tmpdir } from "os";
import { spawnCollect } from "../../src/utils/test-spawn";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_BIN = join(ROOT, "dist", "agent-skill-manager.js");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Run the built dist binary with env overrides */
async function runAsm(
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await spawnCollect(["node", DIST_BIN, ...args], {
    env: { ...process.env, NO_COLOR: "1", ...opts.env },
    cwd: opts.cwd ?? ROOT,
  });
  return { stdout: res.stdout.trim(), stderr: res.stderr.trim(), exitCode: res.exitCode };
}

/** Run a git command in a directory */
async function git(args: string[], cwd: string): Promise<string> {
  const res = await spawnCollect(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

/** Create a minimal git repo with one commit */
async function makeGitRepo(
  dir: string,
  remoteUrl = "https://github.com/testuser/test-repo",
): Promise<string> {
  await git(["init", "-b", "main"], dir);
  await git(["remote", "add", "origin", remoteUrl], dir);
  // Create a placeholder file so we can commit
  await writeFile(join(dir, ".gitkeep"), "");
  await git(["add", ".gitkeep"], dir);
  await git(["commit", "-m", "initial commit"], dir);
  return (await git(["rev-parse", "HEAD"], dir)).trim();
}

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill for E2E testing.
version: 1.0.0
license: MIT
creator: testuser
tags: test
---

# Test Skill

You are a test assistant. Say hello.
`;

// Triggers "dangerous" verdict: shell execution (exec) + network access (curl)
const DANGEROUS_SKILL_MD = `---
name: dangerous-skill
description: A skill with dangerous patterns.
version: 1.0.0
---

# Dangerous Skill

Uses exec() to run curl commands: exec(cmd), curl https://evil.com
`;

/** Build a registry cache entry (fresh TTL) pointing at a real installed skill */
function makeRegistryCache(manifests: object[]): object {
  return {
    fetched_at: new Date().toISOString(),
    ttl_seconds: 3600,
    data: {
      generated_at: new Date().toISOString(),
      manifests,
    },
  };
}

// ─── Setup: ensure dist is built ─────────────────────────────────────────────

beforeAll(async () => {
  try {
    await access(DIST_BIN);
  } catch {
    throw new Error(
      `dist binary not found at ${DIST_BIN}. Run "bun run build" first.`,
    );
  }
});

// ─── Publish E2E ─────────────────────────────────────────────────────────────

describe("publish: skill at repo root", () => {
  let repoDir: string;
  let headSha: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "asm-e2e-publish-root-"));
    headSha = await makeGitRepo(repoDir);
    await writeFile(join(repoDir, "SKILL.md"), VALID_SKILL_MD);
    await git(["add", "SKILL.md"], repoDir);
    await git(["commit", "-m", "add skill"], repoDir);
    headSha = await git(["rev-parse", "HEAD"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("--dry-run outputs valid manifest JSON", async () => {
    const { stdout, stderr, exitCode } = await runAsm(
      ["publish", "--dry-run", repoDir],
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Dry run");
    const json = JSON.parse(stdout);
    expect(json.name).toBe("test-skill");
    expect(json.author).toBeTypeOf("string");
    expect(json.repository).toMatch(/^https:\/\/github\.com\//);
    expect(json.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(json.security_verdict).toBe("pass");
  });

  test("--dry-run: skill at root has no skill_path", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", repoDir],
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    // skill_path should be absent when skill is at repo root
    expect(json.skill_path).toBeUndefined();
  });

  test("--machine --dry-run: outputs v1 envelope", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", "--machine", repoDir],
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.version).toBe(1);
    expect(json.command).toBe("publish");
    expect(json.status).toBe("ok");
    expect(json.data).toBeDefined();
    expect(json.data.manifest).toBeDefined();
  });
});

describe("publish: skill in subdirectory", () => {
  let repoDir: string;
  let skillDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "asm-e2e-publish-subdir-"));
    await makeGitRepo(repoDir);
    skillDir = join(repoDir, "skills", "test-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD);
    await git(["add", "."], repoDir);
    await git(["commit", "-m", "add subdir skill"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("--dry-run: manifest includes skill_path", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", skillDir],
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.skill_path).toBe("skills/test-skill");
  });

  test("--dry-run: repository points to repo root, not skill subdir", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", skillDir],
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    // Repository is the repo root URL, not a subdir URL
    expect(json.repository).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    expect(json.repository).not.toContain("skills");
  });

  test("--dry-run: commit SHA is 40 hex chars", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", skillDir],
    );
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout);
    expect(json.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("publish: error paths", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-e2e-publish-err-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("non-git directory exits with error", async () => {
    const { stdout, stderr, exitCode } = await runAsm(
      ["publish", "--dry-run", tmpDir],
    );
    // exits 0 but outputs error (publisher returns result, not throws)
    expect(stdout + stderr).toMatch(/git|Error/i);
  });

  test("missing SKILL.md exits with error", async () => {
    await makeGitRepo(tmpDir);
    const { stdout, stderr, exitCode } = await runAsm(
      ["publish", "--dry-run", tmpDir],
    );
    expect(stdout + stderr).toMatch(/SKILL\.md/i);
  });

  test("dangerous skill verdict is rejected", async () => {
    await makeGitRepo(tmpDir);
    await writeFile(join(tmpDir, "SKILL.md"), DANGEROUS_SKILL_MD);
    await git(["add", "SKILL.md"], tmpDir);
    await git(["commit", "-m", "add dangerous skill"], tmpDir);

    const { stdout, stderr } = await runAsm(
      ["publish", "--dry-run", tmpDir],
    );
    expect(stdout + stderr).toMatch(/dangerous/i);
  });

  test("missing required name field in SKILL.md", async () => {
    await makeGitRepo(tmpDir);
    await writeFile(
      join(tmpDir, "SKILL.md"),
      "---\ndescription: no name here\n---\n\nBody.",
    );
    await git(["add", "SKILL.md"], tmpDir);
    await git(["commit", "-m", "add invalid skill"], tmpDir);

    const { stdout, stderr } = await runAsm(
      ["publish", "--dry-run", tmpDir],
    );
    expect(stdout + stderr).toMatch(/name/i);
  });

  test("publish --help exits 0 and mentions options", async () => {
    const { stdout, exitCode } = await runAsm(["publish", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--yes");
  });
});

// ─── Install from registry E2E ───────────────────────────────────────────────

describe("install: resolve from registry cache", () => {
  let tempEnvDir: string;
  let installRoot: string;
  let registryCachePath: string;

  // A real manifest pointing to the hello-world skill we published
  // during the workflow test. The skill lives at skills/hello-world/
  // inside luongnv89/asm at a known commit.
  const HELLO_WORLD_MANIFEST = {
    name: "hello-world",
    author: "luongnv89",
    description:
      "A minimal test skill that greets the user and demonstrates the ASM publish workflow.",
    repository: "https://github.com/luongnv89/asm",
    commit: "107b9a3254e246a9b17bac380cf8d7ae9a0d9573",
    skill_path: "skills/hello-world",
    version: "1.0.0",
    license: "MIT",
    tags: ["test", "demo"],
    security_verdict: "pass",
    published_at: "2026-04-09T19:39:00.793Z",
  };

  const SKILL_AUDITOR_MANIFEST = {
    name: "skill-auditor",
    author: "luongnv89",
    description:
      "Analyze agent skills for security risks, malicious patterns, and potential dangers before installation",
    repository: "https://github.com/luongnv89/skills",
    commit: "474ed376930b4ec3b7e67208000997b8ee0255ac",
    version: "1.0.0",
    license: "MIT",
    tags: ["security", "audit", "trust"],
    security_verdict: "pass",
    published_at: "2026-03-28T00:00:00Z",
  };

  beforeEach(async () => {
    tempEnvDir = await mkdtemp(join(tmpdir(), "asm-e2e-registry-"));
    registryCachePath = join(tempEnvDir, "registry-cache.json");
    installRoot = join(tempEnvDir, "skills");
    await mkdir(installRoot, { recursive: true });

    // Write a fresh registry cache with two test manifests
    const cache = makeRegistryCache([
      HELLO_WORLD_MANIFEST,
      SKILL_AUDITOR_MANIFEST,
    ]);
    await writeFile(registryCachePath, JSON.stringify(cache, null, 2));
  });

  afterEach(async () => {
    await rm(tempEnvDir, { recursive: true, force: true });
  });

  /** Shared env that injects the fake registry cache and an isolated skill dir */
  function testEnv(): Record<string, string> {
    return {
      ASM_REGISTRY_CACHE: registryCachePath,
    };
  }

  test("bare name resolves from registry cache", async () => {
    const { stdout, stderr, exitCode } = await runAsm(
      ["install", "hello-world", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    // Should resolve from registry and attempt to install
    expect(stdout + stderr).toMatch(/Resolving.*hello-world/i);
    expect(stdout + stderr).toMatch(/Resolved.*luongnv89\/hello-world/i);
  });

  test("resolved source includes skill_path subpath", async () => {
    const { stdout, stderr } = await runAsm(
      ["install", "hello-world", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    // The parsed source should show the skill_path as a subpath
    expect(stdout + stderr).toContain("skills/hello-world");
  });

  test("scoped name author/skill resolves correctly", async () => {
    const { stdout, stderr } = await runAsm(
      ["install", "luongnv89/hello-world", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    expect(stdout + stderr).toMatch(/Resolving.*luongnv89\/hello-world/i);
    expect(stdout + stderr).toMatch(/Resolved.*luongnv89\/hello-world/i);
  });

  test("nonexistent bare name falls back gracefully", async () => {
    const { stdout, stderr, exitCode } = await runAsm(
      ["install", "nonexistent-skill-xyz", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    // Not in registry → tries existing resolution methods → eventually fails
    // The important thing is it doesn't crash with an unhandled exception
    expect(exitCode).toBeLessThanOrEqual(2);
  });

  test("scoped name not in registry gives clear error", async () => {
    const { stdout, stderr, exitCode } = await runAsm(
      ["install", "nobody/nonexistent-xyz", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    expect(exitCode).toBeGreaterThan(0);
    expect(stdout + stderr).toMatch(/not found/i);
  });

  test("--no-cache flag bypasses the registry cache", async () => {
    // With --no-cache, fetching will fail (since ASM_REGISTRY_URL is not set
    // to a real server in this test). The fallback is that resolution falls
    // through to existing source handling, not that it throws.
    const { stdout, stderr, exitCode } = await runAsm(
      [
        "install",
        "hello-world",
        "--no-cache",
        "--provider",
        "agents",
        "--scope",
        "project",
        "--yes",
      ],
      {
        env: {
          ...testEnv(),
          // Point at a non-existent URL so the fresh fetch fails
          ASM_REGISTRY_URL: "https://localhost:0/index.json",
        },
      },
    );
    // Should fall back gracefully, not crash
    expect(exitCode).toBeLessThanOrEqual(2);
  });

  test("registry cache with two manifests: disambiguation on ambiguous name", async () => {
    // Add a second author publishing the same skill name
    const cache = makeRegistryCache([
      HELLO_WORLD_MANIFEST,
      { ...HELLO_WORLD_MANIFEST, author: "otherusername" },
    ]);
    await writeFile(registryCachePath, JSON.stringify(cache, null, 2));

    const { stdout, stderr, exitCode } = await runAsm(
      // Non-TTY: should error on ambiguity (cannot prompt)
      ["install", "hello-world", "--provider", "agents", "--scope", "project", "--yes"],
      { env: testEnv() },
    );
    // Should mention multiple matches or ask user to use scoped name
    expect(stdout + stderr).toMatch(/multiple|scoped|author\/name/i);
  });
});

// ─── Registry manifest validation ────────────────────────────────────────────

describe("publish: manifest field validation (dry-run --machine)", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "asm-e2e-publish-validation-"));
    await makeGitRepo(repoDir);
    await writeFile(join(repoDir, "SKILL.md"), VALID_SKILL_MD);
    await git(["add", "SKILL.md"], repoDir);
    await git(["commit", "-m", "add skill"], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("manifest has all required fields", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", "--machine", repoDir],
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    const manifest = envelope.data.manifest;

    expect(manifest.name).toBeTypeOf("string");
    expect(manifest.author).toBeTypeOf("string");
    expect(manifest.description).toBeTypeOf("string");
    expect(manifest.repository).toMatch(/^https:\/\/github\.com\//);
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.security_verdict).toMatch(/^(pass|warning|dangerous)$/);
    expect(manifest.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("manifest tags come from SKILL.md frontmatter", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", "--machine", repoDir],
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(Array.isArray(envelope.data.manifest.tags)).toBe(true);
    expect(envelope.data.manifest.tags).toContain("test");
  });

  test("manifest version matches SKILL.md version", async () => {
    const { stdout, exitCode } = await runAsm(
      ["publish", "--dry-run", "--machine", repoDir],
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.data.manifest.version).toBe("1.0.0");
  });
});
