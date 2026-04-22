import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  validateManifest,
  levenshtein,
  detectTyposquats,
  checkAuthorIdentity,
  isDuplicate,
  buildIndex,
  isBareOrScopedName,
  isScopedName,
  findByBareName,
  findByScopedName,
  findSimilarNames,
  resolveFromRegistry,
} from "./registry";
import type { RegistryManifest, RegistryIndex } from "./registry";

// ─── Helpers ────────────────────────────────────────────────────────────────

function validManifest(
  overrides: Partial<RegistryManifest> = {},
): RegistryManifest {
  return {
    name: "test-skill",
    author: "testuser",
    description: "A test skill for unit testing",
    repository: "https://github.com/testuser/test-repo",
    commit: "a".repeat(40),
    security_verdict: "pass",
    published_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── validateManifest ───────────────────────────────────────────────────────

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const errors = validateManifest(validManifest());
    expect(errors).toHaveLength(0);
  });

  it("accepts a valid manifest with all optional fields", () => {
    const errors = validateManifest(
      validManifest({
        version: "1.2.3",
        license: "MIT",
        tags: ["security", "audit"],
        checksum: "sha256:" + "a".repeat(64),
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    expect(validateManifest(null)).toHaveLength(1);
    expect(validateManifest("string")).toHaveLength(1);
    expect(validateManifest(42)).toHaveLength(1);
    expect(validateManifest([])).toHaveLength(1);
  });

  it("rejects missing required fields", () => {
    const errors = validateManifest({});
    const missingFields = errors.map((e) => e.field);
    expect(missingFields).toContain("name");
    expect(missingFields).toContain("author");
    expect(missingFields).toContain("description");
    expect(missingFields).toContain("repository");
    expect(missingFields).toContain("commit");
    expect(missingFields).toContain("security_verdict");
    expect(missingFields).toContain("published_at");
  });

  it("rejects invalid name pattern", () => {
    const errors = validateManifest(
      validManifest({ name: "Invalid-Name" as any }),
    );
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("accepts valid lowercase name with hyphens", () => {
    const errors = validateManifest(validManifest({ name: "my-cool-skill" }));
    expect(errors).toHaveLength(0);
  });

  it("rejects name starting with hyphen", () => {
    const errors = validateManifest(
      validManifest({ name: "-bad-start" as any }),
    );
    expect(errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects invalid commit SHA (too short)", () => {
    const errors = validateManifest(validManifest({ commit: "abc123" as any }));
    expect(errors.some((e) => e.field === "commit")).toBe(true);
  });

  it("rejects invalid repository URL", () => {
    const errors = validateManifest(
      validManifest({ repository: "not-a-url" as any }),
    );
    expect(errors.some((e) => e.field === "repository")).toBe(true);
  });

  it("rejects invalid security_verdict", () => {
    const errors = validateManifest(
      validManifest({ security_verdict: "unknown" as any }),
    );
    expect(errors.some((e) => e.field === "security_verdict")).toBe(true);
  });

  it("rejects unknown properties", () => {
    const manifest = { ...validManifest(), extra_field: "not allowed" };
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === "extra_field")).toBe(true);
  });

  it("rejects invalid version", () => {
    const errors = validateManifest(validManifest({ version: "not-semver" }));
    expect(errors.some((e) => e.field === "version")).toBe(true);
  });

  it("accepts semver with prerelease", () => {
    const errors = validateManifest(validManifest({ version: "1.0.0-beta.1" }));
    expect(errors).toHaveLength(0);
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: 11 }, (_, i) => `tag${i}`);
    const errors = validateManifest(validManifest({ tags }));
    expect(errors.some((e) => e.field === "tags")).toBe(true);
  });

  it("rejects duplicate tags", () => {
    const errors = validateManifest(
      validManifest({ tags: ["security", "security"] }),
    );
    expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
  });

  it("rejects invalid tag pattern", () => {
    const errors = validateManifest(validManifest({ tags: ["Invalid_Tag"] }));
    expect(errors.some((e) => e.field.startsWith("tags["))).toBe(true);
  });

  it("rejects invalid checksum format", () => {
    const errors = validateManifest(validManifest({ checksum: "md5:abc" }));
    expect(errors.some((e) => e.field === "checksum")).toBe(true);
  });

  it("accepts valid checksum", () => {
    const errors = validateManifest(
      validManifest({ checksum: "sha256:" + "f".repeat(64) }),
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid published_at date", () => {
    const errors = validateManifest(
      validManifest({ published_at: "not-a-date" }),
    );
    expect(errors.some((e) => e.field === "published_at")).toBe(true);
  });

  it("rejects description exceeding max length", () => {
    const errors = validateManifest(
      validManifest({ description: "x".repeat(257) }),
    );
    expect(errors.some((e) => e.field === "description")).toBe(true);
  });
});

// ─── levenshtein ────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  it("returns length for empty vs non-empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshtein("", "")).toBe(0);
  });

  it("computes single insertion", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
  });

  it("computes single deletion", () => {
    expect(levenshtein("abcd", "abc")).toBe(1);
  });

  it("computes single substitution", () => {
    expect(levenshtein("abc", "axc")).toBe(1);
  });

  it("computes kitten -> sitting = 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("computes skill-auditor vs skil-auditor = 1", () => {
    expect(levenshtein("skill-auditor", "skil-auditor")).toBe(1);
  });

  it("computes skill-auditor vs skill-auditr = 1", () => {
    expect(levenshtein("skill-auditor", "skill-auditr")).toBe(1);
  });
});

// ─── detectTyposquats ───────────────────────────────────────────────────────

describe("detectTyposquats", () => {
  const existingNames = [
    "skill-auditor",
    "code-review",
    "issue-resolver",
    "test-coverage",
  ];

  it("detects typosquat within threshold", () => {
    const matches = detectTyposquats("skil-auditor", existingNames);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].existingName).toBe("skill-auditor");
    expect(matches[0].distance).toBeLessThanOrEqual(2);
  });

  it("returns empty for exact match", () => {
    // Exact matches are excluded (same name is not a typosquat)
    const matches = detectTyposquats("skill-auditor", existingNames);
    expect(matches).toHaveLength(0);
  });

  it("returns empty for very different names", () => {
    const matches = detectTyposquats("completely-different", existingNames);
    expect(matches).toHaveLength(0);
  });

  it("respects custom threshold", () => {
    // Distance of 1 should catch "skil-auditor"
    const matches1 = detectTyposquats("skil-auditor", existingNames, 1);
    expect(matches1.length).toBeGreaterThan(0);

    // Distance of 0 should only catch exact (which is excluded)
    const matches0 = detectTyposquats("skil-auditor", existingNames, 0);
    expect(matches0).toHaveLength(0);
  });

  it("sorts results by distance", () => {
    // Add names at different distances
    const names = ["abc", "abcd", "abcde"];
    const matches = detectTyposquats("ab", names, 3);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].distance).toBeGreaterThanOrEqual(
        matches[i - 1].distance,
      );
    }
  });
});

// ─── checkAuthorIdentity ────────────────────────────────────────────────────

describe("checkAuthorIdentity", () => {
  it("returns true for matching author", () => {
    const manifest = validManifest({ author: "luongnv89" });
    expect(checkAuthorIdentity(manifest, "luongnv89")).toBe(true);
  });

  it("returns false for mismatched author", () => {
    const manifest = validManifest({ author: "luongnv89" });
    expect(checkAuthorIdentity(manifest, "otheruser")).toBe(false);
  });

  it("is case-insensitive (GitHub usernames are case-insensitive)", () => {
    const manifest = validManifest({ author: "Luongnv89" });
    expect(checkAuthorIdentity(manifest, "luongnv89")).toBe(true);
    expect(checkAuthorIdentity(manifest, "LUONGNV89")).toBe(true);
  });
});

// ─── isDuplicate ────────────────────────────────────────────────────────────

describe("isDuplicate", () => {
  const existing = [
    validManifest({
      name: "skill-a",
      author: "user1",
      commit: "a".repeat(40),
    }),
    validManifest({
      name: "skill-b",
      author: "user2",
      commit: "b".repeat(40),
    }),
  ];

  it("detects exact duplicate (same author, name, commit)", () => {
    const manifest = validManifest({
      name: "skill-a",
      author: "user1",
      commit: "a".repeat(40),
    });
    expect(isDuplicate(manifest, existing)).toBe(true);
  });

  it("allows same name/author with different commit", () => {
    const manifest = validManifest({
      name: "skill-a",
      author: "user1",
      commit: "c".repeat(40),
    });
    expect(isDuplicate(manifest, existing)).toBe(false);
  });

  it("allows same name with different author", () => {
    const manifest = validManifest({
      name: "skill-a",
      author: "user2",
      commit: "a".repeat(40),
    });
    expect(isDuplicate(manifest, existing)).toBe(false);
  });

  it("returns false for empty existing list", () => {
    const manifest = validManifest();
    expect(isDuplicate(manifest, [])).toBe(false);
  });
});

// ─── buildIndex ─────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-registry-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty index for non-existent directory", async () => {
    const index = await buildIndex(join(tempDir, "nonexistent"));
    expect(index.manifests).toHaveLength(0);
    expect(typeof index.generated_at).toBe("string");
  });

  it("returns empty index for empty directory", async () => {
    const manifestsDir = join(tempDir, "manifests");
    await mkdir(manifestsDir, { recursive: true });
    const index = await buildIndex(manifestsDir);
    expect(index.manifests).toHaveLength(0);
  });

  it("reads manifests from author subdirectories", async () => {
    const authorDir = join(tempDir, "manifests", "testuser");
    await mkdir(authorDir, { recursive: true });
    await writeFile(
      join(authorDir, "my-skill.json"),
      JSON.stringify(validManifest()),
      "utf-8",
    );

    const index = await buildIndex(join(tempDir, "manifests"));
    expect(index.manifests).toHaveLength(1);
    expect(index.manifests[0].name).toBe("test-skill");
  });

  it("sorts manifests by name", async () => {
    const authorDir = join(tempDir, "manifests", "testuser");
    await mkdir(authorDir, { recursive: true });
    await writeFile(
      join(authorDir, "zebra-skill.json"),
      JSON.stringify(validManifest({ name: "zebra-skill" })),
      "utf-8",
    );
    await writeFile(
      join(authorDir, "alpha-skill.json"),
      JSON.stringify(validManifest({ name: "alpha-skill" })),
      "utf-8",
    );

    const index = await buildIndex(join(tempDir, "manifests"));
    expect(index.manifests).toHaveLength(2);
    expect(index.manifests[0].name).toBe("alpha-skill");
    expect(index.manifests[1].name).toBe("zebra-skill");
  });

  it("reads from multiple author directories", async () => {
    const dir1 = join(tempDir, "manifests", "user1");
    const dir2 = join(tempDir, "manifests", "user2");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await writeFile(
      join(dir1, "skill-a.json"),
      JSON.stringify(validManifest({ name: "skill-a", author: "user1" })),
      "utf-8",
    );
    await writeFile(
      join(dir2, "skill-b.json"),
      JSON.stringify(validManifest({ name: "skill-b", author: "user2" })),
      "utf-8",
    );

    const index = await buildIndex(join(tempDir, "manifests"));
    expect(index.manifests).toHaveLength(2);
  });

  it("skips invalid JSON files", async () => {
    const authorDir = join(tempDir, "manifests", "testuser");
    await mkdir(authorDir, { recursive: true });
    await writeFile(
      join(authorDir, "valid.json"),
      JSON.stringify(validManifest()),
      "utf-8",
    );
    await writeFile(join(authorDir, "broken.json"), "not valid json", "utf-8");

    const index = await buildIndex(join(tempDir, "manifests"));
    expect(index.manifests).toHaveLength(1);
  });

  it("skips non-json files", async () => {
    const authorDir = join(tempDir, "manifests", "testuser");
    await mkdir(authorDir, { recursive: true });
    await writeFile(
      join(authorDir, "skill.json"),
      JSON.stringify(validManifest()),
      "utf-8",
    );
    await writeFile(join(authorDir, "readme.md"), "# Readme", "utf-8");

    const index = await buildIndex(join(tempDir, "manifests"));
    expect(index.manifests).toHaveLength(1);
  });

  it("includes generated_at timestamp", async () => {
    const manifestsDir = join(tempDir, "manifests");
    await mkdir(manifestsDir, { recursive: true });
    const index = await buildIndex(manifestsDir);
    expect(typeof index.generated_at).toBe("string");
    expect(isNaN(Date.parse(index.generated_at))).toBe(false);
  });
});

// ─── isBareOrScopedName ────────────────────────────────────────────────────

describe("isBareOrScopedName", () => {
  it("returns true for bare names", () => {
    expect(isBareOrScopedName("code-review")).toBe(true);
    expect(isBareOrScopedName("skill-auditor")).toBe(true);
    expect(isBareOrScopedName("test123")).toBe(true);
    expect(isBareOrScopedName("a")).toBe(true);
  });

  it("returns true for scoped names", () => {
    expect(isBareOrScopedName("luongnv89/code-review")).toBe(true);
    expect(isBareOrScopedName("user123/my-skill")).toBe(true);
  });

  it("returns false for github: prefix", () => {
    expect(isBareOrScopedName("github:user/repo")).toBe(false);
  });

  it("returns false for URLs", () => {
    expect(isBareOrScopedName("https://github.com/user/repo")).toBe(false);
    expect(isBareOrScopedName("http://example.com")).toBe(false);
  });

  it("returns false for local paths", () => {
    expect(isBareOrScopedName("/absolute/path")).toBe(false);
    expect(isBareOrScopedName("./relative/path")).toBe(false);
    expect(isBareOrScopedName("../parent/path")).toBe(false);
    expect(isBareOrScopedName("~/home/path")).toBe(false);
    expect(isBareOrScopedName("~")).toBe(false);
    expect(isBareOrScopedName(".")).toBe(false);
    expect(isBareOrScopedName("..")).toBe(false);
  });

  it("returns false for paths with multiple slashes", () => {
    expect(isBareOrScopedName("a/b/c")).toBe(false);
  });

  it("returns false for names starting with hyphens", () => {
    expect(isBareOrScopedName("-bad-name")).toBe(false);
  });

  it("returns false for names with uppercase", () => {
    expect(isBareOrScopedName("BadName")).toBe(false);
  });
});

// ─── isScopedName ──────────────────────────────────────────────────────────

describe("isScopedName", () => {
  it("returns true for scoped names", () => {
    expect(isScopedName("luongnv89/code-review")).toBe(true);
    expect(isScopedName("user/skill")).toBe(true);
  });

  it("returns false for bare names", () => {
    expect(isScopedName("code-review")).toBe(false);
  });

  it("returns false for non-names", () => {
    expect(isScopedName("github:user/repo")).toBe(false);
    expect(isScopedName("https://example.com")).toBe(false);
  });
});

// ─── findByBareName ────────────────────────────────────────────────────────

describe("findByBareName", () => {
  const testIndex: RegistryIndex = {
    generated_at: "2026-01-01T00:00:00Z",
    manifests: [
      validManifest({ name: "code-review", author: "alice" }),
      validManifest({ name: "code-review", author: "bob" }),
      validManifest({ name: "skill-auditor", author: "alice" }),
    ],
  };

  it("finds all manifests matching a bare name", () => {
    const results = findByBareName("code-review", testIndex);
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.author).sort()).toEqual(["alice", "bob"]);
  });

  it("returns empty for no match", () => {
    const results = findByBareName("nonexistent", testIndex);
    expect(results).toHaveLength(0);
  });

  it("returns single match when unique", () => {
    const results = findByBareName("skill-auditor", testIndex);
    expect(results).toHaveLength(1);
    expect(results[0].author).toBe("alice");
  });

  it("is case-insensitive", () => {
    const results = findByBareName("Code-Review", testIndex);
    expect(results).toHaveLength(2);
  });
});

// ─── findByScopedName ──────────────────────────────────────────────────────

describe("findByScopedName", () => {
  const testIndex: RegistryIndex = {
    generated_at: "2026-01-01T00:00:00Z",
    manifests: [
      validManifest({ name: "code-review", author: "alice" }),
      validManifest({ name: "code-review", author: "bob" }),
    ],
  };

  it("finds exact author/name match", () => {
    const result = findByScopedName("alice", "code-review", testIndex);
    expect(result).not.toBeNull();
    expect(result!.author).toBe("alice");
  });

  it("returns null for wrong author", () => {
    const result = findByScopedName("charlie", "code-review", testIndex);
    expect(result).toBeNull();
  });

  it("returns null for wrong name", () => {
    const result = findByScopedName("alice", "nonexistent", testIndex);
    expect(result).toBeNull();
  });

  it("is case-insensitive", () => {
    const result = findByScopedName("Alice", "Code-Review", testIndex);
    expect(result).not.toBeNull();
  });
});

// ─── findSimilarNames ──────────────────────────────────────────────────────

describe("findSimilarNames", () => {
  const testIndex: RegistryIndex = {
    generated_at: "2026-01-01T00:00:00Z",
    manifests: [
      validManifest({ name: "code-review" }),
      validManifest({ name: "skill-auditor" }),
      validManifest({ name: "issue-resolver" }),
    ],
  };

  it("suggests similar names for typos", () => {
    const suggestions = findSimilarNames("code-revew", testIndex);
    expect(suggestions).toContain("code-review");
  });

  it("returns empty for very different names", () => {
    const suggestions = findSimilarNames(
      "completely-different-name",
      testIndex,
    );
    expect(suggestions).toHaveLength(0);
  });

  it("limits results to maxSuggestions", () => {
    const suggestions = findSimilarNames("a", testIndex, 1);
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });
});

// ─── Resolution Logic (calls the actual resolveFromRegistry function) ──────
//
// resolveFromRegistry() is the real exported function: fetch index via HTTP,
// then delegate to isScopedName / findByScopedName / findByBareName /
// findSimilarNames. We mock global.fetch so the real resolveFromRegistry is
// exercised end-to-end without network access or cross-file mock leakage.

describe("resolveFromRegistry", () => {
  const aliceManifest = validManifest({
    name: "code-review",
    author: "alice",
    repository: "https://github.com/alice/my-skills",
    commit: "a".repeat(40),
  });

  const bobManifest = validManifest({
    name: "code-review",
    author: "bob",
    repository: "https://github.com/bob/skills-repo",
    commit: "b".repeat(40),
  });

  const uniqueManifest = validManifest({
    name: "skill-auditor",
    author: "alice",
    repository: "https://github.com/alice/my-skills",
    commit: "c".repeat(40),
  });

  let fetchSpy: import("vitest").MockInstance<typeof fetch>;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  function makeIndex(manifests: RegistryManifest[]): RegistryIndex {
    return { generated_at: "2026-01-01T00:00:00Z", manifests };
  }

  function mockFetch(data: RegistryIndex | null) {
    if (data === null) {
      // Simulate a network failure
      fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("network error"),
      );
    } else {
      fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
  }

  it("resolves a bare name with a single match", async () => {
    mockFetch(makeIndex([uniqueManifest]));
    const result = await resolveFromRegistry("skill-auditor", {
      noCache: true,
    });
    expect(result.resolved).not.toBeNull();
    expect(result.resolved!.manifest.name).toBe("skill-auditor");
    expect(result.resolved!.manifest.author).toBe("alice");
    expect(result.resolved!.source).toBe("registry");
    expect(result.multipleMatches).toHaveLength(0);
  });

  it("returns multiple matches for an ambiguous bare name", async () => {
    mockFetch(makeIndex([aliceManifest, bobManifest, uniqueManifest]));
    const result = await resolveFromRegistry("code-review", { noCache: true });
    expect(result.resolved).toBeNull();
    expect(result.multipleMatches).toHaveLength(2);
    const authors = result.multipleMatches.map((m) => m.author).sort();
    expect(authors).toEqual(["alice", "bob"]);
  });

  it("resolves a scoped name (author/name) to exact match", async () => {
    mockFetch(makeIndex([aliceManifest, bobManifest]));
    const result = await resolveFromRegistry("alice/code-review", {
      noCache: true,
    });
    expect(result.resolved).not.toBeNull();
    expect(result.resolved!.manifest.author).toBe("alice");
    expect(result.resolved!.manifest.name).toBe("code-review");
    expect(result.multipleMatches).toHaveLength(0);
  });

  it("returns suggestions when a scoped name is not found", async () => {
    mockFetch(makeIndex([aliceManifest, uniqueManifest]));
    const result = await resolveFromRegistry("alice/code-revew", {
      noCache: true,
    });
    expect(result.resolved).toBeNull();
    expect(result.multipleMatches).toHaveLength(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions).toContain("code-review");
  });

  it("returns empty result when bare name is not found", async () => {
    mockFetch(makeIndex([aliceManifest, uniqueManifest]));
    const result = await resolveFromRegistry("nonexistent-skill", {
      noCache: true,
    });
    expect(result.resolved).toBeNull();
    expect(result.multipleMatches).toHaveLength(0);
  });

  it("returns empty result when index is null (fetch failure)", async () => {
    // Remove any stale cache so fetchWithCache cannot fall back to it
    const cachePath = join(
      require("os").homedir(),
      ".config",
      "agent-skill-manager",
      "registry-cache.json",
    );
    await rm(cachePath, { force: true });

    mockFetch(null);
    const result = await resolveFromRegistry("code-review", { noCache: true });
    expect(result.resolved).toBeNull();
    expect(result.multipleMatches).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("scoped lookup disambiguates when multiple authors share a name", async () => {
    mockFetch(makeIndex([aliceManifest, bobManifest]));
    const resultAlice = await resolveFromRegistry("alice/code-review", {
      noCache: true,
    });
    const resultBob = await resolveFromRegistry("bob/code-review", {
      noCache: true,
    });
    expect(resultAlice.resolved!.manifest.author).toBe("alice");
    expect(resultBob.resolved!.manifest.author).toBe("bob");
  });

  it("scoped lookup for unknown author returns no match", async () => {
    mockFetch(makeIndex([aliceManifest]));
    const result = await resolveFromRegistry("charlie/code-review", {
      noCache: true,
    });
    expect(result.resolved).toBeNull();
    expect(result.multipleMatches).toHaveLength(0);
  });
});
