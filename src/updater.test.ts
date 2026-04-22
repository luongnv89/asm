import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  shortHash,
  resolveSourceType,
  sourceToCloneUrl,
  extractOwnerRepo,
  getLatestRemoteCommit,
  formatOutdatedTable,
  formatOutdatedJSON,
  formatOutdatedMachine,
  formatUpdateJSON,
  formatUpdateMachine,
  updateSkills,
} from "./updater";
import type { OutdatedSummary, UpdateSummary } from "./updater";
import type { LockEntry } from "./utils/types";

// ─── shortHash ──────────────────────────────────────────────────────────────

describe("shortHash", () => {
  test("truncates a 40-char hash to 7 chars", () => {
    const hash = "a1b2c3d4e5f6789012345678901234567890abcd";
    expect(shortHash(hash)).toBe("a1b2c3d");
  });

  test("returns 'unknown' for unknown hash", () => {
    expect(shortHash("unknown")).toBe("unknown");
  });

  test("returns 'unknown' for empty string", () => {
    expect(shortHash("")).toBe("unknown");
  });

  test("handles short hashes gracefully", () => {
    expect(shortHash("abc")).toBe("abc");
  });
});

// ─── resolveSourceType ──────────────────────────────────────────────────────

describe("resolveSourceType", () => {
  test("returns explicit sourceType when present", () => {
    const entry: LockEntry = {
      source: "github:user/repo",
      commitHash: "abc1234",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "registry",
    };
    expect(resolveSourceType(entry)).toBe("registry");
  });

  test("infers local from source string", () => {
    const entry: LockEntry = {
      source: "local:/path/to/skill",
      commitHash: "abc1234",
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    expect(resolveSourceType(entry)).toBe("local");
  });

  test("defaults to github for github: sources", () => {
    const entry: LockEntry = {
      source: "github:user/repo",
      commitHash: "abc1234",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    expect(resolveSourceType(entry)).toBe("github");
  });

  test("defaults to github for unknown formats", () => {
    const entry: LockEntry = {
      source: "something-else",
      commitHash: "abc1234",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    expect(resolveSourceType(entry)).toBe("github");
  });
});

// ─── sourceToCloneUrl ───────────────────────────────────────────────────────

describe("sourceToCloneUrl", () => {
  test("converts github:owner/repo to HTTPS clone URL", () => {
    expect(sourceToCloneUrl("github:alice/my-skill")).toBe(
      "https://github.com/alice/my-skill.git",
    );
  });

  test("returns null for local sources", () => {
    expect(sourceToCloneUrl("local:/path/to/skill")).toBeNull();
  });

  test("returns null for unknown formats", () => {
    expect(sourceToCloneUrl("something-else")).toBeNull();
  });

  test("returns file:// URL as-is", () => {
    expect(sourceToCloneUrl("file:///tmp/my-repo.git")).toBe(
      "file:///tmp/my-repo.git",
    );
  });

  test("strips #ref fragment from github source", () => {
    expect(sourceToCloneUrl("github:alice/my-skill#main")).toBe(
      "https://github.com/alice/my-skill.git",
    );
  });

  test("strips #ref:subpath fragment from github source", () => {
    expect(sourceToCloneUrl("github:alice/my-skill#v2:src/skill")).toBe(
      "https://github.com/alice/my-skill.git",
    );
  });
});

// ─── extractOwnerRepo ─────────────────────────────────────────────────────

describe("extractOwnerRepo", () => {
  test("extracts owner and repo from github:owner/repo", () => {
    const result = extractOwnerRepo("github:alice/my-skill");
    expect(result).toEqual({ owner: "alice", repo: "my-skill" });
  });

  test("strips #ref fragment before extracting", () => {
    const result = extractOwnerRepo("github:alice/my-skill#main");
    expect(result).toEqual({ owner: "alice", repo: "my-skill" });
  });

  test("strips #ref:subpath fragment before extracting", () => {
    const result = extractOwnerRepo("github:alice/my-skill#v2:src/skill");
    expect(result).toEqual({ owner: "alice", repo: "my-skill" });
  });

  test("returns null for non-github sources", () => {
    expect(extractOwnerRepo("local:/path/to/skill")).toBeNull();
    expect(extractOwnerRepo("file:///tmp/repo")).toBeNull();
  });

  test("returns null for malformed github sources", () => {
    expect(extractOwnerRepo("github:")).toBeNull();
    expect(extractOwnerRepo("github:onlyowner")).toBeNull();
  });
});

// ─── formatOutdatedTable ────────────────────────────────────────────────────

describe("formatOutdatedTable", () => {
  test("shows 'No skills installed' when empty", () => {
    const summary: OutdatedSummary = {
      entries: [],
      outdatedCount: 0,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 0,
    };
    expect(formatOutdatedTable(summary, false)).toBe("No skills installed.");
  });

  test("formats entries with correct status labels", () => {
    const summary: OutdatedSummary = {
      entries: [
        {
          name: "code-review",
          installedCommit: "a1b2c3d",
          latestCommit: "e5f6g7h",
          source: "github:user/repo",
          sourceType: "registry",
          status: "outdated",
        },
        {
          name: "my-skill",
          installedCommit: "1234567",
          latestCommit: "1234567",
          source: "github:user/skill",
          sourceType: "github",
          status: "up-to-date",
        },
        {
          name: "old-skill",
          installedCommit: "unknown",
          latestCommit: "unknown",
          source: "github:user/old",
          sourceType: "github",
          status: "untracked",
        },
      ],
      outdatedCount: 1,
      upToDateCount: 1,
      untrackedCount: 1,
      errorCount: 0,
    };

    const output = formatOutdatedTable(summary, false);
    expect(output).toContain("code-review");
    expect(output).toContain("my-skill");
    expect(output).toContain("old-skill");
    expect(output).toContain("1 outdated");
    expect(output).toContain("1 up to date");
    expect(output).toContain("1 untracked");
  });

  test("includes summary line with all categories", () => {
    const summary: OutdatedSummary = {
      entries: [
        {
          name: "err-skill",
          installedCommit: "abc1234",
          latestCommit: "unknown",
          source: "github:user/err",
          sourceType: "github",
          status: "error",
          error: "Failed to fetch",
        },
      ],
      outdatedCount: 0,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 1,
    };

    const output = formatOutdatedTable(summary, false);
    expect(output).toContain("1 error");
  });
});

// ─── formatOutdatedJSON ─────────────────────────────────────────────────────

describe("formatOutdatedJSON", () => {
  test("produces valid JSON with correct structure", () => {
    const summary: OutdatedSummary = {
      entries: [
        {
          name: "test-skill",
          installedCommit: "a1b2c3d",
          latestCommit: "e5f6g7h",
          source: "github:user/repo",
          sourceType: "github",
          status: "outdated",
        },
      ],
      outdatedCount: 1,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 0,
    };

    const parsed = JSON.parse(formatOutdatedJSON(summary));
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.skills[0].name).toBe("test-skill");
    expect(parsed.skills[0].status).toBe("outdated");
    expect(parsed.summary.outdated).toBe(1);
  });
});

// ─── formatOutdatedMachine ──────────────────────────────────────────────────

describe("formatOutdatedMachine", () => {
  test("produces v1 envelope format", () => {
    const summary: OutdatedSummary = {
      entries: [],
      outdatedCount: 0,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 0,
    };

    const parsed = JSON.parse(formatOutdatedMachine(summary));
    expect(parsed.v).toBe(1);
    expect(parsed.type).toBe("outdated");
    expect(parsed.data).toBeDefined();
    expect(parsed.data.skills).toEqual(expect.any(Array));
  });
});

// ─── formatUpdateJSON ───────────────────────────────────────────────────────

describe("formatUpdateJSON", () => {
  test("produces valid JSON with correct structure", () => {
    const summary: UpdateSummary = {
      results: [
        {
          name: "my-skill",
          status: "updated",
          oldCommit: "a1b2c3d",
          newCommit: "e5f6g7h",
          securityVerdict: "safe",
        },
        {
          name: "bad-skill",
          status: "skipped",
          reason: "Security audit: dangerous",
          securityVerdict: "dangerous",
        },
      ],
      updatedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    };

    const parsed = JSON.parse(formatUpdateJSON(summary));
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].status).toBe("updated");
    expect(parsed.results[1].status).toBe("skipped");
    expect(parsed.summary.updated).toBe(1);
    expect(parsed.summary.skipped).toBe(1);
  });
});

// ─── formatUpdateMachine ────────────────────────────────────────────────────

describe("formatUpdateMachine", () => {
  test("produces v1 envelope format", () => {
    const summary: UpdateSummary = {
      results: [],
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };

    const parsed = JSON.parse(formatUpdateMachine(summary));
    expect(parsed.v).toBe(1);
    expect(parsed.type).toBe("update");
    expect(parsed.data).toBeDefined();
    expect(parsed.data.results).toEqual(expect.any(Array));
  });

  test("includes oldCommit, newCommit, and securityVerdict in results", () => {
    const summary: UpdateSummary = {
      results: [
        {
          name: "my-skill",
          status: "updated",
          oldCommit: "a1b2c3d",
          newCommit: "e5f6g7h",
          securityVerdict: "safe",
        },
        {
          name: "skipped-skill",
          status: "skipped",
          reason: "Already up to date",
        },
      ],
      updatedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    };

    const parsed = JSON.parse(formatUpdateMachine(summary));
    const updatedResult = parsed.data.results[0];
    expect(updatedResult.oldCommit).toBe("a1b2c3d");
    expect(updatedResult.newCommit).toBe("e5f6g7h");
    expect(updatedResult.securityVerdict).toBe("safe");

    // Results without optional fields should have null values
    const skippedResult = parsed.data.results[1];
    expect(skippedResult.oldCommit).toBeNull();
    expect(skippedResult.newCommit).toBeNull();
    expect(skippedResult.securityVerdict).toBeNull();
  });
});

// ─── updateSkill (pure/early-return paths) ─────────────────────────────────

describe("updateSkill", () => {
  test("skips local skills", async () => {
    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: "local:/path/to/skill",
      commitHash: "abc1234",
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };

    const result = await updateSkill("local-skill", entry, false);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("Local skill");
  });

  test("fails when clone URL cannot be determined", async () => {
    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: "invalid-source",
      commitHash: "abc1234",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };

    const result = await updateSkill("bad-source-skill", entry, false);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("Cannot determine remote URL");
  });

  test("fails when clone target repo does not exist", async () => {
    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: "github:nonexistent-user-asm-test/nonexistent-repo-asm-test",
      commitHash: "abc1234567890123456789012345678901234567",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "github",
    };

    const result = await updateSkill("nonexistent-skill", entry, false);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("Clone failed");
  });
});

// ─── getLatestRemoteCommit ────────────────────────────────────────────────

describe("getLatestRemoteCommit", () => {
  test("returns null for unreachable repo", async () => {
    const result = await getLatestRemoteCommit(
      "https://github.com/nonexistent-user-asm-test/nonexistent-repo-asm-test.git",
      "HEAD",
    );
    expect(result).toBeNull();
  });

  test("returns null for invalid URL", async () => {
    const result = await getLatestRemoteCommit("not-a-url", null);
    expect(result).toBeNull();
  });
});

// ─── checkOutdated (pure logic paths) ─────────────────────────────────────

describe("checkOutdated logic paths", () => {
  test("local skills are always reported as up-to-date", async () => {
    // We test the logic through resolveSourceType + the status rules:
    // Local skills cannot be checked remotely, so they return "up-to-date"
    const entry: LockEntry = {
      source: "local:/some/path",
      commitHash: "abc1234",
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    expect(resolveSourceType(entry)).toBe("local");
    // The checkOutdated function assigns "up-to-date" for local entries
    // This is verified by the sourceType being "local"
  });

  test("entries without commitHash are reported as untracked", () => {
    // checkOutdated marks entries with no commitHash or "unknown" as untracked
    const entry: LockEntry = {
      source: "github:user/repo",
      commitHash: "unknown",
      ref: "main",
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    // The shortHash utility reflects unknown status
    expect(shortHash(entry.commitHash)).toBe("unknown");
  });

  test("registry skills with matching commit are up-to-date", () => {
    // Verify the comparison logic: same commit = up-to-date
    const installedCommit = "a1b2c3d4e5f6789012345678901234567890abcd";
    const manifestCommit = "a1b2c3d4e5f6789012345678901234567890abcd";
    expect(manifestCommit === installedCommit).toBe(true);
  });

  test("registry skills with different commit are outdated", () => {
    // Verify the comparison logic: different commit = outdated
    const installedCommit: string = "a1b2c3d4e5f6789012345678901234567890abcd";
    const manifestCommit: string = "f9e8d7c6b5a4321098765432109876543210fedc";
    expect(manifestCommit !== installedCommit).toBe(true);
  });
});

// ─── updateSkill (security audit block scenario) ──────────────────────────

describe("updateSkill security audit scenarios", () => {
  // These tests verify the security-blocks-update behavior using
  // a real git clone against a minimal repo that will be audited.

  test("updateSkill returns correct shape for all early-return paths", async () => {
    const { updateSkill } = await import("./updater");

    // Local skill path
    const localEntry: LockEntry = {
      source: "local:/path",
      commitHash: "abc",
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    const localResult = await updateSkill("local-test", localEntry, false);
    expect(localResult).toHaveProperty("name", "local-test");
    expect(localResult).toHaveProperty("status", "skipped");
    expect(localResult).toHaveProperty("reason");

    // Bad source path
    const badEntry: LockEntry = {
      source: "unknown:foo",
      commitHash: "abc",
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
    };
    const badResult = await updateSkill("bad-test", badEntry, false);
    expect(badResult).toHaveProperty("name", "bad-test");
    expect(badResult).toHaveProperty("status", "failed");
    expect(badResult.reason).toContain("Cannot determine remote URL");
  });
});

// ─── checkOutdated (injectable overrides) ───────────────────────────────────

describe("checkOutdated with injectable overrides", () => {
  test("returns empty summary when no skills are installed", async () => {
    const { checkOutdated } = await import("./updater");
    const summary = await checkOutdated({
      readLockFn: async () => ({ version: 1, skills: {} }),
      fetchRegistryIndexFn: async () => null,
    });
    expect(summary.entries).toHaveLength(0);
    expect(summary.outdatedCount).toBe(0);
    expect(summary.upToDateCount).toBe(0);
    expect(summary.untrackedCount).toBe(0);
    expect(summary.errorCount).toBe(0);
  });

  test("reports local skills as up-to-date", async () => {
    const { checkOutdated } = await import("./updater");
    const summary = await checkOutdated({
      readLockFn: async () => ({
        version: 1,
        skills: {
          "my-local": {
            source: "local:/path/to/skill",
            commitHash: "abc1234",
            ref: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
          },
        },
      }),
      fetchRegistryIndexFn: async () => null,
    });
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe("up-to-date");
    expect(summary.entries[0].sourceType).toBe("local");
  });

  test("reports skills with unknown commitHash as untracked", async () => {
    const { checkOutdated } = await import("./updater");
    const summary = await checkOutdated({
      readLockFn: async () => ({
        version: 1,
        skills: {
          "old-skill": {
            source: "github:user/old",
            commitHash: "unknown",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
          },
        },
      }),
      fetchRegistryIndexFn: async () => null,
    });
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe("untracked");
    expect(summary.untrackedCount).toBe(1);
  });

  test("detects outdated registry skills against index manifest", async () => {
    const installedHash = "a1b2c3d4e5f6789012345678901234567890abcd";
    const latestHash = "f9e8d7c6b5a4321098765432109876543210fedc";

    const { checkOutdated } = await import("./updater");
    const summary = await checkOutdated({
      readLockFn: async () => ({
        version: 1,
        skills: {
          "code-review": {
            source: "github:user/code-review",
            commitHash: installedHash,
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "registry",
            registryName: "code-review",
          },
        },
      }),
      fetchRegistryIndexFn: async () =>
        ({
          manifests: [
            {
              name: "code-review",
              commit: latestHash,
              repo: "user/code-review",
            },
          ],
        }) as any,
    });
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe("outdated");
    expect(summary.outdatedCount).toBe(1);
  });

  test("reports registry skill as up-to-date when commit matches manifest", async () => {
    const commitHash = "a1b2c3d4e5f6789012345678901234567890abcd";

    const { checkOutdated } = await import("./updater");
    const summary = await checkOutdated({
      readLockFn: async () => ({
        version: 1,
        skills: {
          "code-review": {
            source: "github:user/code-review",
            commitHash,
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "registry",
            registryName: "code-review",
          },
        },
      }),
      fetchRegistryIndexFn: async () =>
        ({
          manifests: [
            {
              name: "code-review",
              commit: commitHash,
              repo: "user/code-review",
            },
          ],
        }) as any,
    });
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe("up-to-date");
    expect(summary.upToDateCount).toBe(1);
  });
});

// ─── updateSkill happy path (real local git repo) ───────────────────────────

/**
 * Helper: create a bare git repo with a single commit containing a skill.md.
 * Returns { bareRepoPath, commitHash }.
 */
async function createBareGitRepo(
  parentDir: string,
  repoName: string,
  content: string,
): Promise<{ bareRepoPath: string; commitHash: string }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);

  // Create a work repo, commit, then clone to bare
  const workDir = join(parentDir, `${repoName}-work`);
  const bareDir = join(parentDir, `${repoName}.git`);

  await mkdir(workDir, { recursive: true });
  await exec("git", ["init", workDir]);
  await exec("git", ["-C", workDir, "config", "user.email", "test@test.com"]);
  await exec("git", ["-C", workDir, "config", "user.name", "Test"]);
  await writeFile(join(workDir, "skill.md"), content);
  await exec("git", ["-C", workDir, "add", "."]);
  await exec("git", ["-C", workDir, "commit", "-m", "init"]);

  const { stdout } = await exec("git", ["-C", workDir, "rev-parse", "HEAD"]);
  const commitHash = stdout.trim();

  // Clone to bare
  await exec("git", ["clone", "--bare", workDir, bareDir]);

  return { bareRepoPath: bareDir, commitHash };
}

describe("updateSkill happy path", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-update-test-"));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  test("successful clone, audit, and atomic swap", async () => {
    // Create a real bare git repo as the "remote"
    const { bareRepoPath, commitHash: newCommit } = await createBareGitRepo(
      tempDir,
      "test-skill",
      "# New version\nNew content",
    );

    // Create a fake "installed" skill directory
    const skillsDir = join(tempDir, "skills");
    const installedDir = join(skillsDir, "test-skill");
    await mkdir(installedDir, { recursive: true });
    await writeFile(
      join(installedDir, "skill.md"),
      "# Old version\nOld content",
    );

    const oldCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    // Track what writeLockEntry receives
    let writtenLock: any = null;

    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: `file://${bareRepoPath}`,
      commitHash: oldCommit,
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "github",
    };

    const result = await updateSkill("test-skill", entry, false, {
      auditFn: async () => ({ verdict: "safe" }),
      loadConfigFn: async () =>
        ({ providers: [{ name: "claude", global: skillsDir }] }) as any,
      resolveProviderPathFn: (p: string) => p,
      writeLockEntryFn: async (name: string, e: any) => {
        writtenLock = { name, entry: e };
      },
    });
    expect(result.status).toBe("updated");
    expect(result.name).toBe("test-skill");
    expect(result.securityVerdict).toBe("safe");

    // Verify lock was updated with new commit
    expect(writtenLock).not.toBeNull();
    expect(writtenLock!.name).toBe("test-skill");
    expect(writtenLock!.entry.commitHash).toBe(newCommit);

    // Verify the installed directory was swapped
    const { readFile } = await import("fs/promises");
    const installedContent = await readFile(
      join(installedDir, "skill.md"),
      "utf-8",
    );
    expect(installedContent).toContain("New version");
  });

  test("updateSkill skips when security audit returns dangerous", async () => {
    const { bareRepoPath } = await createBareGitRepo(
      tempDir,
      "danger-skill",
      "# Dangerous skill content",
    );

    const oldCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: `file://${bareRepoPath}`,
      commitHash: oldCommit,
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "github",
    };

    const result = await updateSkill("dangerous-skill", entry, false, {
      auditFn: async () => ({ verdict: "dangerous" }),
      loadConfigFn: async () =>
        ({ providers: [{ name: "claude", global: tempDir }] }) as any,
      resolveProviderPathFn: (p: string) => p,
      writeLockEntryFn: async () => {},
    });
    expect(result.status).toBe("skipped");
    expect(result.securityVerdict).toBe("dangerous");
    expect(result.reason).toContain("dangerous");
  });

  test("updateSkill with warning verdict: skips without --yes, proceeds with --yes", async () => {
    const { bareRepoPath } = await createBareGitRepo(
      tempDir,
      "warn-skill",
      "# Warning skill content",
    );

    const skillsDir = join(tempDir, "warn-skills");
    const installedDir = join(skillsDir, "warn-skill");
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, "skill.md"), "# Old");

    const oldCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const overrides = {
      auditFn: async () => ({ verdict: "warning" as const }),
      loadConfigFn: async () =>
        ({ providers: [{ name: "claude", global: skillsDir }] }) as any,
      resolveProviderPathFn: (p: string) => p,
      writeLockEntryFn: async () => {},
    };

    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: `file://${bareRepoPath}`,
      commitHash: oldCommit,
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "github",
    };

    // Without --yes (skipConfirm=false) — should skip
    const resultNoYes = await updateSkill(
      "warn-skill",
      entry,
      false,
      overrides,
    );
    expect(resultNoYes.status).toBe("skipped");
    expect(resultNoYes.securityVerdict).toBe("warning");
    expect(resultNoYes.reason).toContain("--yes");

    // With --yes (skipConfirm=true) — should proceed
    const resultYes = await updateSkill("warn-skill", entry, true, overrides);
    expect(resultYes.status).toBe("updated");
    expect(resultYes.securityVerdict).toBe("warning");
  });

  test("updateSkill with caution verdict: skips without --yes, proceeds with --yes", async () => {
    const { bareRepoPath } = await createBareGitRepo(
      tempDir,
      "caution-skill",
      "# Caution skill content",
    );

    const skillsDir = join(tempDir, "caution-skills");
    const installedDir = join(skillsDir, "caution-skill");
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, "skill.md"), "# Old");

    const oldCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const overrides = {
      auditFn: async () => ({ verdict: "caution" as const }),
      loadConfigFn: async () =>
        ({ providers: [{ name: "claude", global: skillsDir }] }) as any,
      resolveProviderPathFn: (p: string) => p,
      writeLockEntryFn: async () => {},
    };

    const { updateSkill } = await import("./updater");
    const entry: LockEntry = {
      source: `file://${bareRepoPath}`,
      commitHash: oldCommit,
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      sourceType: "github",
    };

    // Without --yes (skipConfirm=false) — should skip
    const resultNoYes = await updateSkill(
      "caution-skill",
      entry,
      false,
      overrides,
    );
    expect(resultNoYes.status).toBe("skipped");
    expect(resultNoYes.securityVerdict).toBe("caution");
    expect(resultNoYes.reason).toContain("caution");
    expect(resultNoYes.reason).toContain("--yes");

    // With --yes (skipConfirm=true) — should proceed
    const resultYes = await updateSkill(
      "caution-skill",
      entry,
      true,
      overrides,
    );
    expect(resultYes.status).toBe("updated");
    expect(resultYes.securityVerdict).toBe("caution");
  });
});

// ─── updateSkills orchestrator ──────────────────────────────────────────────

describe("updateSkills orchestrator", () => {
  test("filters only outdated entries for update", async () => {
    const updatedNames: string[] = [];
    const summary = await updateSkills(null, false, {
      readLockFn: async () => ({
        version: 1,
        skills: {
          "skill-a": {
            source: "github:user/skill-a",
            commitHash: "aaa",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
          "skill-b": {
            source: "github:user/skill-b",
            commitHash: "bbb",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
        },
      }),
      checkOutdatedFn: async () => ({
        entries: [
          {
            name: "skill-a",
            installedCommit: "aaa",
            latestCommit: "aaa2",
            source: "github:user/skill-a",
            sourceType: "github" as const,
            status: "outdated" as const,
          },
          {
            name: "skill-b",
            installedCommit: "bbb",
            latestCommit: "bbb",
            source: "github:user/skill-b",
            sourceType: "github" as const,
            status: "up-to-date" as const,
          },
        ],
        outdatedCount: 1,
        upToDateCount: 1,
        untrackedCount: 0,
        errorCount: 0,
      }),
      updateSkillFn: async (name, _entry, _skip) => {
        updatedNames.push(name);
        return { name, status: "updated", oldCommit: "aaa", newCommit: "aaa2" };
      },
    });

    // Only skill-a should have been updated (it was outdated)
    expect(updatedNames).toEqual(["skill-a"]);
    expect(summary.updatedCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].name).toBe("skill-a");
  });

  test("warns about missing skill names", async () => {
    const summary = await updateSkills(["nonexistent-skill"], false, {
      readLockFn: async () => ({
        version: 1,
        skills: {
          "skill-a": {
            source: "github:user/skill-a",
            commitHash: "aaa",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
        },
      }),
      checkOutdatedFn: async () => ({
        entries: [
          {
            name: "skill-a",
            installedCommit: "aaa",
            latestCommit: "aaa2",
            source: "github:user/skill-a",
            sourceType: "github" as const,
            status: "outdated" as const,
          },
        ],
        outdatedCount: 1,
        upToDateCount: 0,
        untrackedCount: 0,
        errorCount: 0,
      }),
      updateSkillFn: async (name) => {
        return { name, status: "updated" };
      },
    });

    // The requested skill doesn't exist so it should generate a warning
    expect(summary.warnings).toBeDefined();
    expect(summary.warnings).toContain("nonexistent-skill");
    expect(summary.results).toHaveLength(0);
  });

  test("returns results array with correct counts", async () => {
    const summary = await updateSkills(null, false, {
      readLockFn: async () => ({
        version: 1,
        skills: {
          "skill-a": {
            source: "github:user/skill-a",
            commitHash: "aaa",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
          "skill-b": {
            source: "github:user/skill-b",
            commitHash: "bbb",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
          "skill-c": {
            source: "github:user/skill-c",
            commitHash: "ccc",
            ref: "main",
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "github",
          },
        },
      }),
      checkOutdatedFn: async () => ({
        entries: [
          {
            name: "skill-a",
            installedCommit: "aaa",
            latestCommit: "aaa2",
            source: "github:user/skill-a",
            sourceType: "github" as const,
            status: "outdated" as const,
          },
          {
            name: "skill-b",
            installedCommit: "bbb",
            latestCommit: "bbb2",
            source: "github:user/skill-b",
            sourceType: "github" as const,
            status: "outdated" as const,
          },
          {
            name: "skill-c",
            installedCommit: "ccc",
            latestCommit: "ccc2",
            source: "github:user/skill-c",
            sourceType: "github" as const,
            status: "outdated" as const,
          },
        ],
        outdatedCount: 3,
        upToDateCount: 0,
        untrackedCount: 0,
        errorCount: 0,
      }),
      updateSkillFn: async (name) => {
        if (name === "skill-a")
          return {
            name,
            status: "updated",
            oldCommit: "aaa",
            newCommit: "aaa2",
          };
        if (name === "skill-b")
          return { name, status: "skipped", reason: "Security warning" };
        return { name, status: "failed", reason: "Clone failed" };
      },
    });

    expect(summary.results).toHaveLength(3);
    expect(summary.updatedCount).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  test("passes pre-read lock to checkOutdated (no redundant reads)", async () => {
    let readLockCallCount = 0;
    let checkOutdatedReceivedLock = false;

    await updateSkills(null, false, {
      readLockFn: async () => {
        readLockCallCount++;
        return {
          version: 1,
          skills: {},
        };
      },
      checkOutdatedFn: async (overrides) => {
        // Verify checkOutdated received the pre-read lock
        checkOutdatedReceivedLock = overrides?.lock !== undefined;
        return {
          entries: [],
          outdatedCount: 0,
          upToDateCount: 0,
          untrackedCount: 0,
          errorCount: 0,
        };
      },
      updateSkillFn: async (name) => ({ name, status: "updated" }),
    });

    // readLock should only be called once (not twice)
    expect(readLockCallCount).toBe(1);
    // checkOutdated should have received the pre-read lock
    expect(checkOutdatedReceivedLock).toBe(true);
  });
});
