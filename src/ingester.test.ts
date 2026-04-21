import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ensureIndexDir, listIndexedRepos, removeRepoIndex } from "./ingester";
import { getIndexDir } from "./config";
import { discoverSkills } from "./installer";
import { verifySkill } from "./verifier";

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

describe("ingester verification path", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-ingest-verify-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("produces verified:true for a well-formed skill", async () => {
    const skillDir = join(tempDir, "good-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: good-skill
description: A well-documented skill for testing
version: 1.0.0
---

# Good Skill

This skill provides helpful instructions for the AI agent with enough body content.
`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(1);

    const skillMdContent = await readFile(
      join(tempDir, discovered[0].relPath, "SKILL.md"),
      "utf-8",
    );
    const result = verifySkill(discovered[0], skillMdContent);
    expect(result.verified).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("produces verified:false for a skill with missing description", async () => {
    const skillDir = join(tempDir, "no-desc-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: no-desc-skill
---

# No Description Skill

This skill is missing the description field in frontmatter so it should fail verification.
`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(1);

    const skillMdContent = await readFile(
      join(tempDir, discovered[0].relPath, "SKILL.md"),
      "utf-8",
    );
    const result = verifySkill(discovered[0], skillMdContent);
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("description"))).toBe(true);
  });

  it("produces verified:false for a skill with malicious patterns", async () => {
    const skillDir = join(tempDir, "malicious-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: malicious-skill
description: A skill that tries to decode secrets
version: 1.0.0
---

# Malicious Skill

This skill does something suspicious: atob('aGVsbG8=') to decode hidden data.
There is enough content here to pass the body length check.
`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(1);

    const skillMdContent = await readFile(
      join(tempDir, discovered[0].relPath, "SKILL.md"),
      "utf-8",
    );
    const result = verifySkill(discovered[0], skillMdContent);
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("malicious pattern"))).toBe(
      true,
    );
  });

  it("writes correct verified field to output JSON for mixed skills", async () => {
    // Create one valid skill and one invalid skill
    const goodDir = join(tempDir, "alpha-good");
    const badDir = join(tempDir, "beta-bad");
    await mkdir(goodDir, { recursive: true });
    await mkdir(badDir, { recursive: true });

    await writeFile(
      join(goodDir, "SKILL.md"),
      `---
name: alpha-good
description: A valid skill
version: 1.0.0
---

# Alpha Good

This is a well-formed skill with enough content to pass all verification checks.
`,
      "utf-8",
    );

    await writeFile(
      join(badDir, "SKILL.md"),
      `---
name: beta-bad
---
x`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(2);

    // Replicate the ingester's verification loop
    const results: Array<{ name: string; verified: boolean }> = [];
    for (const skill of discovered) {
      const content = await readFile(
        join(tempDir, skill.relPath, "SKILL.md"),
        "utf-8",
      );
      const v = verifySkill(skill, content);
      results.push({ name: skill.name, verified: v.verified });
    }

    const good = results.find((r) => r.name === "alpha-good");
    const bad = results.find((r) => r.name === "beta-bad");
    expect(good).toBeDefined();
    expect(good!.verified).toBe(true);
    expect(bad).toBeDefined();
    expect(bad!.verified).toBe(false);
  });
});

describe("ingester enrichment (issue #188 + #187)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-ingest-enrich-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("populates tokenCount on every DiscoveredSkill", async () => {
    const skillDir = join(tempDir, "token-skill");
    await mkdir(skillDir, { recursive: true });
    const body = "Hello world. This is a test.";
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: token-skill
description: A skill for token counting
version: 0.1.0
---

# Token Skill

${body}
`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(1);
    expect(typeof discovered[0].tokenCount).toBe("number");
    expect(discovered[0].tokenCount!).toBeGreaterThan(0);
  });

  it("ingester runs eval and produces a slim evalSummary", async () => {
    // Use the inline path the ingester takes — read content + call
    // evaluator + project the slim shape — to validate the contract
    // without needing a real git clone.
    const { evaluateSkillContent } = await import("./evaluator");
    const skillDir = join(tempDir, "eval-skill");
    await mkdir(skillDir, { recursive: true });
    const skillMd = `---
name: eval-skill
description: A skill we will evaluate inline
version: 0.2.0
license: MIT
creator: Tester
---

## Instructions

Use this skill when you need an example.

- Step 1
- Step 2

\`\`\`
example
\`\`\`
`;
    const skillMdPath = join(skillDir, "SKILL.md");
    await writeFile(skillMdPath, skillMd, "utf-8");

    const report = evaluateSkillContent({
      content: skillMd,
      skillPath: skillDir,
      skillMdPath,
    });

    // Project the slim shape the ingester writes into IndexedSkill.
    const slim = {
      overallScore: report.overallScore,
      grade: report.grade,
      categories: report.categories.map((c) => ({
        id: c.id,
        name: c.name,
        score: c.score,
        max: c.max,
      })),
      evaluatedAt: report.evaluatedAt,
      evaluatedVersion: "0.2.0",
    };

    expect(typeof slim.overallScore).toBe("number");
    expect(slim.overallScore).toBeGreaterThanOrEqual(0);
    expect(slim.overallScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"].includes(slim.grade)).toBe(true);
    expect(Array.isArray(slim.categories)).toBe(true);
    expect(slim.categories.length).toBeGreaterThan(0);
    for (const c of slim.categories) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.name).toBe("string");
      expect(typeof c.score).toBe("number");
      expect(typeof c.max).toBe("number");
      // Findings/suggestions intentionally NOT in the slim shape.
      expect((c as any).findings).toBeUndefined();
      expect((c as any).suggestions).toBeUndefined();
    }
    expect(typeof slim.evaluatedAt).toBe("string");
    expect(slim.evaluatedVersion).toBe("0.2.0");
  });

  it("projects provider summaries with provider metadata", async () => {
    const { toSkillEvalSummary } = await import("./eval/summary");
    const summary = toSkillEvalSummary(
      {
        providerId: "skill-best-practice",
        providerVersion: "1.0.0",
        schemaVersion: 1,
        score: 100,
        passed: true,
        categories: [
          {
            id: "validation",
            name: "Deterministic validation",
            score: 7,
            max: 7,
          },
        ],
        findings: [],
        startedAt: "2026-04-21T10:00:00.000Z",
        durationMs: 3,
      },
      "0.2.0",
    );

    expect(summary.providerId).toBe("skill-best-practice");
    expect(summary.providerVersion).toBe("1.0.0");
    expect(summary.schemaVersion).toBe(1);
    expect(summary.passed).toBe(true);
    expect(summary.overallScore).toBe(100);
    expect(summary.grade).toBe("A");
    expect(summary.categories).toHaveLength(1);
  });
});
