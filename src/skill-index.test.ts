import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  searchSkills,
  getAllIndexedSkills,
  getTotalSkillCount,
  loadAllIndices,
  getMissingMetadataFields,
  resolveIndexedSkillByName,
  _resetMemo,
  _getReadFileCount,
} from "./skill-index";
import type { IndexedSkillMatch } from "./skill-index";
import {
  getSkillIndexResourcesPath,
  getBundledIndexDir,
  getIndexDir,
} from "./config";
import type { IndexedSkill } from "./utils/types";

// These tests exercise loadAllIndices/searchSkills/etc. against the bundled
// index that ships with the package (data/skill-index/). The user index dir
// is the vitest sandbox (ASM_CONFIG_DIR), so host ~/.config is not merged.

describe("loadAllIndices", () => {
  beforeEach(() => _resetMemo());
  afterEach(() => _resetMemo());

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

  it("second call costs ≤ 5 ms (memoization benchmark)", async () => {
    // First call — cold, reads and parses the full corpus
    const t0 = performance.now();
    await loadAllIndices();
    const cold = performance.now() - t0;

    // Second call — should hit the cache (no reset)
    const t1 = performance.now();
    await loadAllIndices();
    const warm = performance.now() - t1;

    // Warm call must be dramatically faster than cold
    expect(warm).toBeLessThanOrEqual(5);
    expect(warm).toBeLessThan(cold * 0.3);
  });

  it("corpus is read from disk exactly once per process", async () => {
    // First call — reads all files
    await loadAllIndices();
    const afterFirst = _getReadFileCount();

    // Second call — should not read any files
    await loadAllIndices();
    const afterSecond = _getReadFileCount();

    expect(afterSecond).toBe(afterFirst);
  });
});

describe("getTotalSkillCount", () => {
  beforeEach(() => _resetMemo());
  afterEach(() => _resetMemo());

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

  it("warm call is instant (cached from loadAllIndices)", async () => {
    // First call populates the cache
    await getTotalSkillCount();

    // Second call — should hit the cache
    const t0 = performance.now();
    await getTotalSkillCount();
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThanOrEqual(5);
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

describe("searchSkills with tag filters", () => {
  const fixturePath = join(getIndexDir(), "issue-584_tag-fixture.json");

  beforeEach(async () => {
    await mkdir(getIndexDir(), { recursive: true });
    await writeFile(
      fixturePath,
      JSON.stringify({
        repoUrl: "https://github.com/issue-584/tag-fixture",
        owner: "issue-584",
        repo: "tag-fixture",
        updatedAt: "2026-01-01T00:00:00.000Z",
        skillCount: 3,
        skills: [
          { ...fixtureSkill("tagged-cli", "cli"), tags: ["CLI", "Testing"] },
          { ...fixtureSkill("tagged-web", "web"), tags: ["frontend"] },
          fixtureSkill("legacy-untagged", "legacy"),
        ],
      }),
      "utf-8",
    );
    _resetMemo();
  });

  afterEach(async () => {
    await rm(fixturePath, { force: true });
    _resetMemo();
  });

  it("normalizes loaded tags and backfills legacy records", async () => {
    const fixture = (await loadAllIndices()).find(
      (index) => index.owner === "issue-584",
    );
    expect(fixture?.skills.map((skill) => skill.tags)).toEqual([
      ["cli", "testing"],
      ["frontend"],
      [],
    ]);
  });

  it("uses AND semantics for one or more tag filters", async () => {
    expect(
      (await searchSkills("tagged", 20, { tags: ["CLI"] })).map(
        (result) => result.skill.name,
      ),
    ).toEqual(["tagged-cli"]);
    expect(
      (await searchSkills("tagged", 20, { tags: ["cli", "testing"] })).map(
        (result) => result.skill.name,
      ),
    ).toEqual(["tagged-cli"]);
    expect(
      await searchSkills("tagged", 20, { tags: ["cli", "frontend"] }),
    ).toEqual([]);
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

  it("filters by model and user invocability independently", async () => {
    const modelOnly = await searchSkills("", 100, { modelInvocable: true });
    expect(modelOnly.length).toBeGreaterThan(0);
    for (const r of modelOnly) {
      expect(r.skill.modelInvocable).not.toBe(false);
    }
    const both = await searchSkills("", 100, {
      modelInvocable: true,
      userInvocable: true,
    });
    for (const r of both) {
      expect(r.skill.modelInvocable).not.toBe(false);
      expect(r.skill.userInvocable).not.toBe(false);
    }
    expect(both.length).toBeLessThanOrEqual(modelOnly.length);
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

  it("does not merge the host user skill-index over bundled data", () => {
    const sandbox = process.env.ASM_CONFIG_DIR;
    expect(sandbox).toBeTruthy();
    expect(getIndexDir()).toBe(join(sandbox!, "skill-index"));
    const hostHome = process.env.ASM_TEST_HOST_HOME;
    if (hostHome) {
      expect(getIndexDir()).not.toBe(
        join(hostHome, ".config", "agent-skill-manager", "skill-index"),
      );
    }
  });

  it("indexes emilkowalski/skills with expected skills and install URLs", async () => {
    const indices = await loadAllIndices();
    const emil = indices.find(
      (idx) => idx.owner === "emilkowalski" && idx.repo === "skills",
    );
    expect(emil).toBeDefined();
    expect(emil!.skillCount).toBe(11);
    const names = new Set(emil!.skills.map((s) => s.name));
    expect(names).toEqual(
      new Set([
        "emil-design-eng",
        "review-animations",
        "animation-vocabulary",
        "apple-design",
        "find-animation-opportunities",
        "improve-animations",
        "pick-ui-library",
        "prototype",
        "animate",
        "animate-expo",
        "ask-sonner",
      ]),
    );
    for (const skill of emil!.skills) {
      expect(skill.installUrl).toMatch(/^github:emilkowalski\/skills:/);
    }
  });

  it("discovers emil-design-eng via search without duplicate repo entries", async () => {
    const results = await searchSkills("emil-design-eng", 20);
    const emilHits = results.filter(
      (r) =>
        r.repo.owner === "emilkowalski" && r.skill.name === "emil-design-eng",
    );
    expect(emilHits).toHaveLength(1);
  });
});

// ─── Exact-name resolution (issue #422) ────────────────────────────────────
//
// Every case below injects its own catalog. `loadAllIndices()` merges the
// bundled index with a user-level one under ~/.config, so a resolver test that
// reads the ambient catalog would pass or fail depending on whose machine ran
// it. The injectable parameter exists precisely so these stay hermetic.

function fixtureSkill(name: string, relPath: string): IndexedSkill {
  return {
    name,
    description: `${name} description`,
    version: "1.0.0",
    license: "MIT",
    creator: "",
    compatibility: "",
    allowedTools: [],
    installUrl: `github:acme/skills:${relPath}`,
    relPath,
    tokenCount: 100,
  };
}

function fixtureCatalog(
  entries: Array<{
    owner: string;
    repo: string;
    name: string;
    relPath: string;
  }>,
): IndexedSkillMatch[] {
  return entries.map((e) => ({
    skill: {
      ...fixtureSkill(e.name, e.relPath),
      installUrl: `github:${e.owner}/${e.repo}:${e.relPath}`,
    },
    repo: { owner: e.owner, repo: e.repo },
  }));
}

describe("resolveIndexedSkillByName (issue #422)", () => {
  const catalog = fixtureCatalog([
    {
      owner: "acme",
      repo: "skills",
      name: "code-review",
      relPath: "skills/code-review",
    },
    {
      owner: "acme",
      repo: "skills",
      name: "dataviz",
      relPath: "skills/dataviz",
    },
    {
      owner: "other",
      repo: "pack",
      name: "code-review",
      relPath: "code-review",
    },
  ]);

  it("resolves a unique name to its single catalog entry", async () => {
    const res = await resolveIndexedSkillByName("dataviz", catalog);
    expect(res.status).toBe("found");
    if (res.status !== "found") throw new Error("unreachable");
    expect(res.match.skill.installUrl).toBe(
      "github:acme/skills:skills/dataviz",
    );
    expect(res.match.repo).toEqual({ owner: "acme", repo: "skills" });
  });

  it("matches case-insensitively and ignores surrounding whitespace", async () => {
    const res = await resolveIndexedSkillByName("  DataViz ", catalog);
    expect(res.status).toBe("found");
  });

  it("reports a cross-repo collision instead of guessing", async () => {
    const res = await resolveIndexedSkillByName("code-review", catalog);
    expect(res.status).toBe("ambiguous");
    if (res.status !== "ambiguous") throw new Error("unreachable");
    expect(res.matches).toHaveLength(2);
    expect(
      res.matches.map((m) => `${m.repo.owner}/${m.repo.repo}`).sort(),
    ).toEqual(["acme/skills", "other/pack"]);
  });

  it("collapses duplicate entries for the same repo and path", async () => {
    const dupes = fixtureCatalog([
      {
        owner: "acme",
        repo: "skills",
        name: "dataviz",
        relPath: "skills/dataviz",
      },
      {
        owner: "acme",
        repo: "skills",
        name: "dataviz",
        relPath: "skills/dataviz",
      },
    ]);
    const res = await resolveIndexedSkillByName("dataviz", dupes);
    expect(res.status).toBe("found");
  });

  it("returns none for an unknown name", async () => {
    expect((await resolveIndexedSkillByName("nope", catalog)).status).toBe(
      "none",
    );
  });

  it("returns none for an empty or whitespace-only name", async () => {
    expect((await resolveIndexedSkillByName("", catalog)).status).toBe("none");
    expect((await resolveIndexedSkillByName("   ", catalog)).status).toBe(
      "none",
    );
  });

  it("is exact, not fuzzy — a partial name does not resolve", async () => {
    expect((await resolveIndexedSkillByName("code", catalog)).status).toBe(
      "none",
    );
    expect((await resolveIndexedSkillByName("data", catalog)).status).toBe(
      "none",
    );
  });

  it("falls back to the real catalog when none is injected", async () => {
    const res = await resolveIndexedSkillByName(
      "definitely-not-a-real-skill-name-422",
    );
    expect(res.status).toBe("none");
  });
});
