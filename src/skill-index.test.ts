import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  searchSkills,
  getAllIndexedSkills,
  getTotalSkillCount,
  loadAllIndices,
} from "./skill-index";

// These tests exercise loadAllIndices/searchSkills/etc. against the real
// bundled index that ships with the package (data/skill-index/).
// Since we can't easily patch ESM module exports, we test with whatever
// indices exist in the real config+bundled dirs.

describe("loadAllIndices", () => {
  it("returns an array", async () => {
    const indices = await loadAllIndices();
    expect(Array.isArray(indices)).toBe(true);
  });

  it("each index has required fields", async () => {
    const indices = await loadAllIndices();
    for (const idx of indices) {
      expect(typeof idx.owner).toBe("string");
      expect(typeof idx.repo).toBe("string");
      expect(typeof idx.skillCount).toBe("number");
      expect(Array.isArray(idx.skills)).toBe(true);
    }
  });
});

describe("searchSkills", () => {
  it("returns results as SearchResult objects", async () => {
    const results = await searchSkills("test");
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r).toHaveProperty("skill");
      expect(r).toHaveProperty("repo");
      expect(r).toHaveProperty("score");
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("returns empty array for gibberish query", async () => {
    const results = await searchSkills("zzzzxyz999nonexistent");
    expect(results).toHaveLength(0);
  });

  it("respects the limit parameter", async () => {
    const results = await searchSkills("skill", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("results are sorted by score descending", async () => {
    const results = await searchSkills("code", 50);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it("each result has valid skill structure", async () => {
    const results = await searchSkills("deploy", 5);
    for (const r of results) {
      expect(typeof r.skill.name).toBe("string");
      expect(typeof r.skill.description).toBe("string");
      expect(typeof r.skill.version).toBe("string");
      expect(typeof r.skill.installUrl).toBe("string");
      expect(typeof r.repo.owner).toBe("string");
      expect(typeof r.repo.repo).toBe("string");
    }
  });

  it("uses default limit of 20", async () => {
    const results = await searchSkills("a");
    expect(results.length).toBeLessThanOrEqual(20);
  });
});

describe("getAllIndexedSkills", () => {
  it("returns array of skill+repo pairs", async () => {
    const all = await getAllIndexedSkills();
    expect(Array.isArray(all)).toBe(true);
    for (const entry of all) {
      expect(entry).toHaveProperty("skill");
      expect(entry).toHaveProperty("repo");
      expect(typeof entry.skill.name).toBe("string");
      expect(typeof entry.repo.owner).toBe("string");
    }
  });
});

describe("getTotalSkillCount", () => {
  it("returns a non-negative number", async () => {
    const count = await getTotalSkillCount();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("matches sum of all index skill counts", async () => {
    const indices = await loadAllIndices();
    const expected = indices.reduce((sum, idx) => sum + idx.skillCount, 0);
    const actual = await getTotalSkillCount();
    expect(actual).toBe(expected);
  });
});
