import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  shortHash,
  resolveSourceType,
  sourceToCloneUrl,
  formatOutdatedTable,
  formatOutdatedJSON,
  formatOutdatedMachine,
  formatUpdateJSON,
  formatUpdateMachine,
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
    expect(parsed.skills).toBeArrayOfSize(1);
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
    expect(parsed.data.skills).toBeArray();
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
    expect(parsed.results).toBeArrayOfSize(2);
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
    expect(parsed.data.results).toBeArray();
  });
});
