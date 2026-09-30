import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildSkillInstallUrl,
  ensureIndexDir,
  ingestRepo,
  listIndexedRepos,
  removeRepoIndex,
} from "./ingester";
import { getIndexDir } from "./config";
import { discoverSkills } from "./installer";
import { dedupeSkillsByName } from "./skill-dedupe";
import { verifySkill } from "./verifier";
import type { EvalProvider } from "./eval/types";
import type { IndexedSkill } from "./utils/types";

// ─── Config sandbox for production-ingest tests ─────────────────────────────
// Production-ingest tests must never write to the real getIndexDir user
// config.  We intercept getIndexDir at module-load time so that
// ensureIndexDir / removeRepoIndex / listIndexedRepos all operate under a
// tempDir that is cleaned up in afterEach.

let sandboxIndexDir: string | null = null;

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    getIndexDir: () => sandboxIndexDir ?? actual.getIndexDir(),
  };
});

const ingestMocks = vi.hoisted(() => ({
  checkGitAvailable: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  cloneToTemp: vi.fn<() => Promise<string>>(),
  cleanupTemp: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  getEvalProviders: vi.fn<() => EvalProvider[]>(() => []),
}));

vi.mock("./installer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./installer")>();
  return {
    ...actual,
    checkGitAvailable: ingestMocks.checkGitAvailable,
    cloneToTemp: ingestMocks.cloneToTemp,
    cleanupTemp: ingestMocks.cleanupTemp,
  };
});

vi.mock("./eval/builtins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval/builtins")>();
  return {
    ...actual,
    getEvalProviders: ingestMocks.getEvalProviders,
  };
});

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function progressTracker() {
  let value = 0;
  const waiters: Array<{ target: number; resolve: () => void }> = [];
  return {
    advance() {
      value++;
      for (const waiter of waiters) {
        if (value >= waiter.target) waiter.resolve();
      }
    },
    waitFor(target: number): Promise<void> {
      if (value >= target) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for progress ${target}`)),
          5_000,
        );
        waiters.push({
          target,
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
        });
      });
    },
  };
}

async function writeIngestSkill(
  root: string,
  relPath: string,
  name: string,
): Promise<void> {
  const skillDir = join(root, relPath);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: Evaluate deterministic indexing behavior for concurrency tests
version: 1.0.0
license: MIT
creator: Test Author
tags: [Testing, concurrency]
---

# ${name}

## Instructions

Use this skill to validate deterministic indexing output and provider summaries.
`,
    "utf-8",
  );
}

function createTestProvider(
  applicable: EvalProvider["applicable"] = async () => ({ ok: true }),
): EvalProvider {
  return {
    id: "test-provider",
    version: "1.0.0",
    schemaVersion: 1,
    description: "Deterministic ingester test provider",
    applicable,
    async run(ctx) {
      const index = Number(ctx.skillPath.match(/(\d+)$/)?.[1] ?? 0);
      return {
        providerId: "test-provider",
        providerVersion: "1.0.0",
        schemaVersion: 1,
        score: 80 + index,
        passed: true,
        categories: [
          {
            id: "determinism",
            name: "Determinism",
            score: 1,
            max: 1,
          },
        ],
        findings: [],
        startedAt: "",
        durationMs: 0,
      };
    },
  };
}

function withoutEvaluationTimes(skill: IndexedSkill): IndexedSkill {
  const normalized = structuredClone(skill);
  if (normalized.evalSummary) normalized.evalSummary.evaluatedAt = "<time>";
  for (const summary of Object.values(normalized.evalSummaries ?? {})) {
    summary.evaluatedAt = "<time>";
  }
  return normalized;
}

describe("ensureIndexDir", () => {
  beforeEach(async () => {
    sandboxIndexDir = await mkdtemp(join(tmpdir(), "asm-index-sandbox-"));
  });

  afterEach(async () => {
    if (sandboxIndexDir) {
      await rm(sandboxIndexDir, { recursive: true, force: true });
      sandboxIndexDir = null;
    }
  });

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
  beforeEach(async () => {
    sandboxIndexDir = await mkdtemp(join(tmpdir(), "asm-index-sandbox-"));
  });

  afterEach(async () => {
    if (sandboxIndexDir) {
      await rm(sandboxIndexDir, { recursive: true, force: true });
      sandboxIndexDir = null;
    }
  });

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
  beforeEach(async () => {
    sandboxIndexDir = await mkdtemp(join(tmpdir(), "asm-index-sandbox-"));
  });

  afterEach(async () => {
    if (sandboxIndexDir) {
      await rm(sandboxIndexDir, { recursive: true, force: true });
      sandboxIndexDir = null;
    }
  });

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

describe("buildSkillInstallUrl", () => {
  it("does not append a trailing colon for a root-level skill", () => {
    expect(
      buildSkillInstallUrl(
        {
          owner: "zarazhangrui",
          repo: "follow-builders",
          ref: null,
          subpath: null,
          cloneUrl: "https://github.com/zarazhangrui/follow-builders.git",
          sshCloneUrl: "git@github.com:zarazhangrui/follow-builders.git",
        },
        "",
      ),
    ).toBe("github:zarazhangrui/follow-builders");
  });

  it("keeps subdirectory installUrl behavior unchanged", () => {
    expect(
      buildSkillInstallUrl(
        {
          owner: "owner",
          repo: "repo",
          ref: "main",
          subpath: null,
          cloneUrl: "https://github.com/owner/repo.git",
          sshCloneUrl: "git@github.com:owner/repo.git",
        },
        "skills/example",
      ),
    ).toBe("github:owner/repo#main:skills/example");
  });
});

describe("ingestRepo path containment", () => {
  it("rejects a `..` hidden in the ref before clone", async () => {
    const result = await ingestRepo("github:acme/skills#main/../../x");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/escapes the repository/);
    expect(ingestMocks.cloneToTemp).not.toHaveBeenCalled();
  });
});

describe("parallel skill ingestion (issue #372)", () => {
  let tempDir: string;
  let repoName: string;

  beforeEach(async () => {
    sandboxIndexDir = await mkdtemp(join(tmpdir(), "asm-index-sandbox-"));
    tempDir = await mkdtemp(join(tmpdir(), "asm-ingest-parallel-"));
    repoName = `parallel-skills-${tempDir.split("-").at(-1)!.toLowerCase()}`;
    ingestMocks.checkGitAvailable.mockReset();
    ingestMocks.checkGitAvailable.mockResolvedValue(undefined);
    ingestMocks.cloneToTemp.mockReset();
    ingestMocks.cleanupTemp.mockReset();
    ingestMocks.cleanupTemp.mockResolvedValue(undefined);
    ingestMocks.getEvalProviders.mockReset();
    ingestMocks.getEvalProviders.mockReturnValue([]);
  });

  afterEach(async () => {
    ingestMocks.getEvalProviders.mockReturnValue([]);
    await removeRepoIndex("issue-372-tests", repoName);
    await rm(tempDir, { recursive: true, force: true });
    if (sandboxIndexDir) {
      await rm(sandboxIndexDir, { recursive: true, force: true });
      sandboxIndexDir = null;
    }
  });

  it("bounds overlapping work and preserves sequential content in input order", async () => {
    const batchRoot = join(tempDir, "batch");
    const skillNames = Array.from(
      { length: 10 },
      (_, index) => `skill-${String(index).padStart(2, "0")}`,
    );
    for (const name of skillNames) {
      await writeIngestSkill(batchRoot, join("skills", name), name);
    }

    const discovered = await discoverSkills(batchRoot);
    const { kept: deduped } = dedupeSkillsByName(discovered);
    const inputOrder = deduped.map((skill) => skill.name);

    ingestMocks.getEvalProviders.mockReturnValue([createTestProvider()]);
    const sequentialSkills: IndexedSkill[] = [];
    for (const name of inputOrder) {
      const singleRoot = join(tempDir, "sequential", name);
      await writeIngestSkill(singleRoot, join("skills", name), name);
      ingestMocks.cloneToTemp.mockResolvedValueOnce(singleRoot);
      const result = await ingestRepo(`github:issue-372-tests/${repoName}`);
      expect(result.success).toBe(true);
      sequentialSkills.push(...result.repoIndex!.skills);
    }

    const gates = new Map(inputOrder.map((name) => [name, deferred()]));
    const started: string[] = [];
    const applicabilityCompleted: string[] = [];
    const startedProgress = progressTracker();
    const completedProgress = progressTracker();
    let active = 0;
    let maxActive = 0;
    const provider = createTestProvider(async (ctx) => {
      const name = ctx.skillPath.split(/[\\/]/).at(-1)!;
      active++;
      maxActive = Math.max(maxActive, active);
      started.push(name);
      startedProgress.advance();
      try {
        await gates.get(name)!.promise;
        return { ok: true };
      } finally {
        active--;
        applicabilityCompleted.push(name);
        completedProgress.advance();
      }
    });
    ingestMocks.getEvalProviders.mockReturnValue([provider]);
    ingestMocks.cloneToTemp.mockResolvedValueOnce(batchRoot);

    const concurrentResultPromise = ingestRepo(
      `github:issue-372-tests/${repoName}`,
    );
    let concurrentResult!: Awaited<ReturnType<typeof ingestRepo>>;
    try {
      await startedProgress.waitFor(8);
      expect(active).toBe(8);
      expect(maxActive).toBeLessThanOrEqual(8);

      const releaseOrder = [
        ...inputOrder.slice(0, 8).reverse(),
        ...inputOrder.slice(8).reverse(),
      ];
      for (const [index, name] of releaseOrder.entries()) {
        gates.get(name)!.resolve();
        await completedProgress.waitFor(index + 1);
      }
      expect(applicabilityCompleted).toEqual(releaseOrder);
      expect(applicabilityCompleted).not.toEqual(inputOrder);
    } finally {
      for (const gate of gates.values()) gate.resolve();
      concurrentResult = await concurrentResultPromise;
    }

    expect(concurrentResult.success).toBe(true);
    expect(started).toHaveLength(inputOrder.length);
    expect(maxActive).toBe(8);
    expect(
      concurrentResult.repoIndex!.skills.map((skill) => skill.name),
    ).toEqual(inputOrder);
    expect(
      concurrentResult.repoIndex!.skills.every(
        (skill) => JSON.stringify(skill.tags) === '["testing","concurrency"]',
      ),
    ).toBe(true);
    expect(
      concurrentResult.repoIndex!.skills.map(withoutEvaluationTimes),
    ).toEqual(sequentialSkills.map(withoutEvaluationTimes));
  });

  it("isolates a provider failure to its skill", async () => {
    const batchRoot = join(tempDir, "fail-soft");
    const skillNames = ["skill-00", "skill-01", "skill-02"];
    for (const name of skillNames) {
      await writeIngestSkill(batchRoot, join("skills", name), name);
    }
    const discovered = await discoverSkills(batchRoot);
    const { kept: deduped } = dedupeSkillsByName(discovered);
    const inputOrder = deduped.map((skill) => skill.name);
    const failedName = inputOrder[1];
    const visited: string[] = [];

    ingestMocks.getEvalProviders.mockReturnValue([
      createTestProvider(async (ctx) => {
        const name = ctx.skillPath.split(/[\\/]/).at(-1)!;
        visited.push(name);
        if (name === failedName) throw new Error("provider unavailable");
        return { ok: true };
      }),
    ]);
    ingestMocks.cloneToTemp.mockResolvedValueOnce(batchRoot);

    const result = await ingestRepo(`github:issue-372-tests/${repoName}`);

    expect(result.success).toBe(true);
    expect(result.repoIndex!.skills.map((skill) => skill.name)).toEqual(
      inputOrder,
    );
    const failedSkill = result.repoIndex!.skills[1];
    const laterSkill = result.repoIndex!.skills[2];
    expect(failedSkill.name).toBe(failedName);
    expect(failedSkill.verified).toBe(true);
    expect(failedSkill.evalSummary).toBeDefined();
    expect(failedSkill.evalSummaries).toBeUndefined();
    expect(laterSkill.evalSummaries?.["test-provider"]).toMatchObject({
      providerId: "test-provider",
      passed: true,
      overallScore: 82,
    });
    expect(visited.sort()).toEqual([...inputOrder].sort());
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

  it("reads and verifies root-level SKILL.md using empty relPath", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: root-good
description: A root-level skill for testing
version: 1.0.0
---

# Root Good

This root-level skill has enough instruction content to pass verification.
`,
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].relPath).toBe("");

    const skillMdContent = await readFile(
      join(tempDir, discovered[0].relPath, "SKILL.md"),
      "utf-8",
    );
    const result = verifySkill(discovered[0], skillMdContent);
    expect(result.verified).toBe(true);
  });

  it("discovers root and nested skills for indexing", async () => {
    await mkdir(join(tempDir, "skills", "nested-one"), { recursive: true });
    await writeFile(
      join(tempDir, "SKILL.md"),
      "---\nname: root-index\nversion: 1.0.0\ndescription: Root\n---\n# Root\n",
      "utf-8",
    );
    await writeFile(
      join(tempDir, "skills", "nested-one", "SKILL.md"),
      "---\nname: nested-one\nversion: 1.0.0\ndescription: Nested\n---\n# Nested\n",
      "utf-8",
    );

    const discovered = await discoverSkills(tempDir);
    expect(discovered.map((s) => s.relPath).sort()).toEqual([
      "",
      "skills/nested-one",
    ]);
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

describe("ingester dedupe (issue #265)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-ingest-dedupe-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeSkill(relPath: string, name: string): Promise<void> {
    const skillDir = join(tempDir, relPath);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: A skill at ${relPath} for dedup testing
version: 1.0.0
---

# ${name}

Body content long enough to satisfy any minimum-length verification rules.
`,
      "utf-8",
    );
  }

  it("collapses same-name skills to one entry, picking skills/ over .claude/skills/", async () => {
    await writeSkill("skills/foo", "foo");
    await writeSkill(".claude/skills/foo", "foo");

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(2);

    const { kept, decisions } = dedupeSkillsByName(discovered);
    expect(kept).toHaveLength(1);
    expect(kept[0].relPath).toBe("skills/foo");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].name).toBe("foo");
    expect(decisions[0].kept.relPath).toBe("skills/foo");
    expect(decisions[0].dropped.map((d) => d.relPath)).toEqual([
      ".claude/skills/foo",
    ]);
  });

  it("keeps both entries when the names differ across directories", async () => {
    await writeSkill("skills/alpha", "alpha");
    await writeSkill(".claude/skills/beta", "beta");

    const discovered = await discoverSkills(tempDir);
    const { kept, decisions } = dedupeSkillsByName(discovered);
    expect(kept).toHaveLength(2);
    expect(decisions).toEqual([]);
  });

  it("falls through to .agent/skills/ when neither skills/ nor .claude/skills/ has the skill", async () => {
    await writeSkill(".agent/skills/foo", "foo");
    await writeSkill(".agents/skills/foo", "foo");

    const discovered = await discoverSkills(tempDir);
    expect(discovered.length).toBe(2);

    const { kept } = dedupeSkillsByName(discovered);
    expect(kept).toHaveLength(1);
    // Both at priority 3 — first found wins. discoverSkills returns alphabetical
    // by name (same here, "foo" === "foo"), so the order is the walker's
    // traversal order. We don't pin which of the two wins; we only require
    // exactly one to survive.
    expect([".agent/skills/foo", ".agents/skills/foo"]).toContain(
      kept[0].relPath,
    );
  });

  it("is idempotent across repeated runs on the same input", async () => {
    await writeSkill("skills/foo", "foo");
    await writeSkill(".claude/skills/foo", "foo");
    await writeSkill(".agent/skills/foo", "foo");

    const discovered = await discoverSkills(tempDir);
    const first = dedupeSkillsByName(discovered);
    const second = dedupeSkillsByName(first.kept);
    expect(first.kept).toHaveLength(1);
    expect(first.kept[0].relPath).toBe("skills/foo");
    expect(second.kept).toEqual(first.kept);
    expect(second.decisions).toEqual([]);
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
    const { evaluateSkillContentSync } = await import("./evaluator");
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

    const report = evaluateSkillContentSync({
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
