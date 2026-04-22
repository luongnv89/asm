import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  mkdir,
  appendFile,
} from "fs/promises";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import {
  readLock,
  writeLockEntry,
  removeLockEntry,
  getCommitHash,
} from "./lock";

// Mock config to use a temp directory for the lock file
let tempDir: string;
let lockPath: string;

vi.doMock("../config", () => ({
  getLockPath: () => lockPath,
}));

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "lock-test-"));
  lockPath = join(tempDir, ".skill-lock.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── readLock tests ──────────────────────────────────────────────────────────

describe("readLock", () => {
  test("returns empty lock when file does not exist", async () => {
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
  });

  test("reads valid lock file", async () => {
    const data = {
      version: 1,
      skills: {
        "my-skill": {
          source: "github:owner/repo",
          commitHash: "abc123",
          ref: "main",
          installedAt: "2026-03-20T12:00:00Z",
          provider: "claude",
        },
      },
    };
    await writeFile(lockPath, JSON.stringify(data), "utf-8");
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills["my-skill"].source).toBe("github:owner/repo");
    expect(lock.skills["my-skill"].commitHash).toBe("abc123");
  });

  test("handles corrupted JSON by returning empty lock", async () => {
    await writeFile(lockPath, "not-valid-json{{{", "utf-8");
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
  });

  test("handles invalid schema (missing version) by returning empty lock", async () => {
    await writeFile(lockPath, JSON.stringify({ skills: {} }), "utf-8");
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
  });

  test("handles invalid schema (skills not object) by returning empty lock", async () => {
    await writeFile(
      lockPath,
      JSON.stringify({ version: 1, skills: "bad" }),
      "utf-8",
    );
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
  });

  test("handles invalid schema (skills is null) by returning empty lock", async () => {
    await writeFile(
      lockPath,
      JSON.stringify({ version: 1, skills: null }),
      "utf-8",
    );
    const lock = await readLock();
    expect(lock.version).toBe(1);
    expect(lock.skills).toEqual({});
  });
});

// ─── writeLockEntry tests ────────────────────────────────────────────────────

describe("writeLockEntry", () => {
  test("creates lock file and writes entry when file does not exist", async () => {
    await writeLockEntry("test-skill", {
      source: "github:alice/test-skill",
      commitHash: "def456",
      ref: "main",
      installedAt: "2026-03-20T12:00:00Z",
      provider: "claude",
    });

    const raw = await readFile(lockPath, "utf-8");
    const lock = JSON.parse(raw);
    expect(lock.version).toBe(1);
    expect(lock.skills["test-skill"].source).toBe("github:alice/test-skill");
    expect(lock.skills["test-skill"].commitHash).toBe("def456");
  });

  test("adds entry to existing lock file", async () => {
    const initial = {
      version: 1,
      skills: {
        existing: {
          source: "github:bob/existing",
          commitHash: "111",
          ref: "main",
          installedAt: "2026-03-19T10:00:00Z",
          provider: "claude",
        },
      },
    };
    await writeFile(lockPath, JSON.stringify(initial), "utf-8");

    await writeLockEntry("new-skill", {
      source: "github:alice/new-skill",
      commitHash: "222",
      ref: "v1.0",
      installedAt: "2026-03-20T12:00:00Z",
      provider: "codex",
    });

    const raw = await readFile(lockPath, "utf-8");
    const lock = JSON.parse(raw);
    expect(Object.keys(lock.skills)).toHaveLength(2);
    expect(lock.skills["existing"].commitHash).toBe("111");
    expect(lock.skills["new-skill"].commitHash).toBe("222");
  });

  test("updates existing entry", async () => {
    await writeLockEntry("my-skill", {
      source: "github:owner/repo",
      commitHash: "old-hash",
      ref: "main",
      installedAt: "2026-03-19T00:00:00Z",
      provider: "claude",
    });

    await writeLockEntry("my-skill", {
      source: "github:owner/repo",
      commitHash: "new-hash",
      ref: "v2.0",
      installedAt: "2026-03-20T12:00:00Z",
      provider: "claude",
    });

    const lock = await readLock();
    expect(lock.skills["my-skill"].commitHash).toBe("new-hash");
    expect(lock.skills["my-skill"].ref).toBe("v2.0");
  });
});

// ─── removeLockEntry tests ───────────────────────────────────────────────────

describe("removeLockEntry", () => {
  test("removes existing entry", async () => {
    const data = {
      version: 1,
      skills: {
        "skill-a": {
          source: "github:owner/a",
          commitHash: "aaa",
          ref: "main",
          installedAt: "2026-03-20T12:00:00Z",
          provider: "claude",
        },
        "skill-b": {
          source: "github:owner/b",
          commitHash: "bbb",
          ref: "main",
          installedAt: "2026-03-20T12:00:00Z",
          provider: "claude",
        },
      },
    };
    await writeFile(lockPath, JSON.stringify(data), "utf-8");

    await removeLockEntry("skill-a");

    const lock = await readLock();
    expect(lock.skills["skill-a"]).toBeUndefined();
    expect(lock.skills["skill-b"]).toBeDefined();
  });

  test("no-op when entry does not exist", async () => {
    const data = {
      version: 1,
      skills: {
        "skill-a": {
          source: "github:owner/a",
          commitHash: "aaa",
          ref: "main",
          installedAt: "2026-03-20T12:00:00Z",
          provider: "claude",
        },
      },
    };
    await writeFile(lockPath, JSON.stringify(data), "utf-8");

    await removeLockEntry("nonexistent");

    const lock = await readLock();
    expect(Object.keys(lock.skills)).toHaveLength(1);
    expect(lock.skills["skill-a"]).toBeDefined();
  });

  test("no-op when lock file does not exist", async () => {
    // Should not throw
    await removeLockEntry("anything");
  });
});

// ─── corruption recovery tests ───────────────────────────────────────────────

describe("corruption recovery", () => {
  test("creates backup of corrupted file", async () => {
    await writeFile(lockPath, "corrupted{{{data", "utf-8");
    await readLock();

    const backupContent = await readFile(lockPath + ".bak", "utf-8");
    expect(backupContent).toBe("corrupted{{{data");
  });

  test("write after corruption recovery works", async () => {
    await writeFile(lockPath, "corrupted", "utf-8");
    await readLock(); // triggers recovery

    await writeLockEntry("fresh-skill", {
      source: "github:owner/fresh",
      commitHash: "fff",
      ref: "main",
      installedAt: "2026-03-20T12:00:00Z",
      provider: "claude",
    });

    const lock = await readLock();
    expect(lock.skills["fresh-skill"].commitHash).toBe("fff");
  });
});

// ─── getCommitHash tests ─────────────────────────────────────────────────────

describe("getCommitHash", () => {
  let gitDir: string;

  beforeEach(async () => {
    gitDir = await mkdtemp(join(tmpdir(), "git-hash-test-"));
  });

  afterEach(async () => {
    await rm(gitDir, { recursive: true, force: true });
  });

  test("returns commit hash from a valid git repo", async () => {
    execSync(
      "git init && git config user.email 'test@test.com' && git config user.name 'Test' && git commit --allow-empty -m 'init'",
      { cwd: gitDir, stdio: "pipe" },
    );
    const hash = await getCommitHash(gitDir);
    expect(hash).not.toBeNull();
    expect(hash!.length).toBe(40);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("returns null for a non-git directory", async () => {
    const hash = await getCommitHash(gitDir);
    expect(hash).toBeNull();
  });

  test("returns null for a nonexistent directory", async () => {
    const hash = await getCommitHash(join(gitDir, "does-not-exist"));
    expect(hash).toBeNull();
  });
});
