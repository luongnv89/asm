import { describe, expect, it, beforeEach, afterEach } from "bun:test";
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
} from "./registry";
import type { RegistryManifest } from "./registry";

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
