import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  searchSkills,
  getAllIndexedSkills,
  getTotalSkillCount,
  loadAllIndices,
  getMissingMetadataFields,
} from "./skill-index";
import { getSkillIndexResourcesPath, getBundledIndexDir } from "./config";
import type { IndexedSkill } from "./utils/types";

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
    expect(results.length).toBeGreaterThan(0);
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

  it("each result has valid skill structure including license and creator", async () => {
    const results = await searchSkills("deploy", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.skill.name).toBe("string");
      expect(typeof r.skill.description).toBe("string");
      expect(typeof r.skill.version).toBe("string");
      expect(typeof r.skill.installUrl).toBe("string");
      expect(typeof r.repo.owner).toBe("string");
      expect(typeof r.repo.repo).toBe("string");
      expect("license" in r.skill).toBe(true);
      expect("creator" in r.skill).toBe(true);
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

  it("every index has skillCount matching skills.length", async () => {
    const indices = await loadAllIndices();
    for (const idx of indices) {
      expect(idx.skillCount).toBe(idx.skills.length);
    }
  });
});

describe("getMissingMetadataFields", () => {
  it("returns all fields for empty skill", () => {
    const skill: IndexedSkill = {
      name: "test",
      description: "desc",
      version: "",
      license: "",
      creator: "",
      compatibility: "",
      allowedTools: [],
      installUrl: "github:test/test",
      relPath: "test",
    };
    const missing = getMissingMetadataFields(skill);
    expect(missing).toContain("license");
    expect(missing).toContain("creator");
    expect(missing).toContain("version");
  });

  it("returns empty array for complete skill", () => {
    const skill: IndexedSkill = {
      name: "test",
      description: "desc",
      version: "1.0.0",
      license: "MIT",
      creator: "Test Author",
      compatibility: "",
      allowedTools: [],
      installUrl: "github:test/test",
      relPath: "test",
    };
    const missing = getMissingMetadataFields(skill);
    expect(missing).toHaveLength(0);
  });

  it("treats version 0.0.0 as missing", () => {
    const skill: IndexedSkill = {
      name: "test",
      description: "desc",
      version: "0.0.0",
      license: "MIT",
      creator: "Author",
      compatibility: "",
      allowedTools: [],
      installUrl: "github:test/test",
      relPath: "test",
    };
    const missing = getMissingMetadataFields(skill);
    expect(missing).toContain("version");
    expect(missing).not.toContain("license");
    expect(missing).not.toContain("creator");
  });
});

describe("searchSkills with filters", () => {
  it("filter-only search with --missing returns results", async () => {
    // Many bundled skills have empty license/creator, others do not — this verifies the filter works
    const results = await searchSkills("", 100, { missing: ["license"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.skill.license || "").toBe("");
    }
  });

  it("filter-only search with --has license excludes empty-license skills", async () => {
    const results = await searchSkills("", 100, { has: ["license"] });
    for (const r of results) {
      expect(r.skill.license.length).toBeGreaterThan(0);
    }
  });

  it("filters combine with query", async () => {
    const allResults = await searchSkills("code", 100);
    const filtered = await searchSkills("code", 100, { missing: ["license"] });
    expect(filtered.length).toBeLessThanOrEqual(allResults.length);
  });
});

describe("Index resource integrity", () => {
  it("every enabled repo in resources has a corresponding index file", async () => {
    const resourcesPath = getSkillIndexResourcesPath();
    const resourcesJson = JSON.parse(
      await (await import("fs/promises")).readFile(resourcesPath, "utf-8"),
    );
    const indexDir = getBundledIndexDir();
    const indexFiles = await readdir(indexDir);
    const indexFileSet = new Set(indexFiles);

    for (const repo of resourcesJson.repos) {
      if (repo.enabled) {
        const expectedFilename = `${repo.owner}_${repo.repo}.json`;
        expect(indexFileSet.has(expectedFilename)).toBe(true);
      }
    }
  });

  it("all index files have non-zero skillCount", async () => {
    const indices = await loadAllIndices();
    for (const idx of indices) {
      expect(idx.skillCount).toBeGreaterThan(0);
    }
  });
});
