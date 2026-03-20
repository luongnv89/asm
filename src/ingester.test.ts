import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureIndexDir, listIndexedRepos, removeRepoIndex } from "./ingester";
import { getIndexDir } from "./config";

describe("ensureIndexDir", () => {
  it("creates and returns the index directory path", async () => {
    const dir = await ensureIndexDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
    // The directory should exist after calling ensureIndexDir
    const entries = await readdir(dir);
    expect(Array.isArray(entries)).toBe(true);
  });

  it("returns the same path as getIndexDir()", async () => {
    const dir = await ensureIndexDir();
    expect(dir).toBe(getIndexDir());
  });

  it("is idempotent (safe to call multiple times)", async () => {
    const dir1 = await ensureIndexDir();
    const dir2 = await ensureIndexDir();
    expect(dir1).toBe(dir2);
  });
});

describe("listIndexedRepos", () => {
  it("returns an array", async () => {
    const repos = await listIndexedRepos();
    expect(Array.isArray(repos)).toBe(true);
  });

  it("each entry has required fields", async () => {
    const repos = await listIndexedRepos();
    for (const repo of repos) {
      expect(typeof repo.owner).toBe("string");
      expect(typeof repo.repo).toBe("string");
      expect(typeof repo.skillCount).toBe("number");
      expect(typeof repo.updatedAt).toBe("string");
    }
  });

  it("is sorted by skill count descending", async () => {
    const repos = await listIndexedRepos();
    for (let i = 1; i < repos.length; i++) {
      expect(repos[i].skillCount).toBeLessThanOrEqual(repos[i - 1].skillCount);
    }
  });
});

describe("removeRepoIndex", () => {
  it("returns false for non-existent index", async () => {
    const result = await removeRepoIndex(
      "nonexistent-owner-xyz",
      "nonexistent-repo-xyz",
    );
    expect(result).toBe(false);
  });

  it("returns true and removes an existing index file", async () => {
    // Create a temp index file
    const indexDir = await ensureIndexDir();
    const testOwner = "test-remove-owner-xyz";
    const testRepo = "test-remove-repo-xyz";
    const filePath = join(indexDir, `${testOwner}_${testRepo}.json`);

    const index = {
      repoUrl: "https://github.com/test/test.git",
      owner: testOwner,
      repo: testRepo,
      updatedAt: new Date().toISOString(),
      skillCount: 0,
      skills: [],
    };
    await writeFile(filePath, JSON.stringify(index), "utf-8");

    const result = await removeRepoIndex(testOwner, testRepo);
    expect(result).toBe(true);

    // Verify file is gone
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();
  });
});
