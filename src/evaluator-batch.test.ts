import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBatchMachineData,
  buildEvalMachineData,
  classifyEvalDirectory,
  findChildSkillDirs,
  formatBatchSummary,
  resolveEvalInput,
  runWithConcurrency,
  summariseBatch,
  type EvalBatchItem,
} from "./evaluator-batch";
import type { EvaluationReport, FixResult } from "./evaluator-core";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { basename, join, resolve } from "path";
import { tmpdir } from "os";

// Issue #674 — sibling coverage for evaluator-batch.ts. The happy paths are
// exercised through the facade in evaluator.test.ts; this file pins down the
// failure branches: unreadable children, remote-fetch cleanup on error, and
// the all-failed aggregate rendering.

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "eval-batch-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const MINI_SKILL = `---
name: mini
description: Do something specific when asked.
---
# mini

## When to Use
- something

## Instructions
1. do the thing
`;

async function writeSkillMd(dir: string, content = MINI_SKILL): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf-8");
}

function mkReport(label: string, score: number): EvaluationReport {
  return {
    skillPath: `/virtual/${label}`,
    skillMdPath: `/virtual/${label}/SKILL.md`,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    categories: [],
    overallScore: score,
    grade: "B",
    topSuggestions: [],
    frontmatter: {},
  };
}

describe("findChildSkillDirs — child-entry failures", () => {
  it("skips a plain file at the collection root", async () => {
    const root = join(tempDir, "with-file");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "real"));
    // A regular file is not a directory — hits the !isDirectory continue.
    await writeFile(join(root, "README.md"), "# readme\n", "utf-8");

    const r = await findChildSkillDirs(root);
    expect(r.map((d) => basename(d))).toEqual(["real"]);
  });

  it("skips a child directory that has no SKILL.md", async () => {
    const root = join(tempDir, "with-empty-child");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "real"));
    // stat(SKILL.md) inside this child fails — caught and skipped.
    await mkdir(join(root, "docs"), { recursive: true });

    const r = await findChildSkillDirs(root);
    expect(r.map((d) => basename(d))).toEqual(["real"]);
  });

  it("skips a child whose SKILL.md is a directory, not a file", async () => {
    const root = join(tempDir, "with-dir-skillmd");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "real"));
    // stat succeeds but isFile() is false → not a valid skill child.
    await mkdir(join(root, "weird", "SKILL.md"), { recursive: true });

    const r = await findChildSkillDirs(root);
    expect(r.map((d) => basename(d))).toEqual(["real"]);
  });

  it("skips a dangling symlink whose stat fails", async () => {
    const root = join(tempDir, "with-dangling");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "real"));
    // stat() follows symlinks — a dangling target throws ENOENT, caught.
    await symlink(join(root, "gone-target"), join(root, "dangling"));

    const r = await findChildSkillDirs(root);
    expect(r.map((d) => basename(d))).toEqual(["real"]);
  });
});

describe("classifyEvalDirectory — root SKILL.md that is not a file", () => {
  it("falls through to children when SKILL.md is a directory", async () => {
    const root = join(tempDir, "weird-root");
    // stat succeeds but isFile() is false → classify as collection/none.
    await mkdir(join(root, "SKILL.md"), { recursive: true });
    await writeSkillMd(join(root, "child-skill"));

    const r = await classifyEvalDirectory(root);
    expect(r.kind).toBe("collection");
    expect(r.skillDirs.map((d) => basename(d))).toEqual(["child-skill"]);
  });
});

describe("resolveEvalInput — error branches", () => {
  it("rejects an empty input string", async () => {
    await expect(resolveEvalInput("")).rejects.toThrow(/non-empty/);
  });

  it("cleans up and rethrows when classification of the remote root fails", async () => {
    // A non-string rootDir makes classifyEvalDirectory throw synchronously
    // inside the async fn (path.join requires strings) — the resolver must
    // still run cleanup, and a failing cleanup must not mask the root error.
    const cleanup = vi.fn(async () => {
      throw new Error("cleanup exploded");
    });
    await expect(
      resolveEvalInput("github:test/broken", {
        fetchRemote: async () => ({
          rootDir: 42 as unknown as string,
          cleanup,
          sourceRef: "github:test/broken",
          commitSha: null,
        }),
      }),
    ).rejects.toThrow(TypeError);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up and throws 'No SKILL.md' even when remote cleanup fails", async () => {
    const emptyRepo = join(tempDir, "empty-remote");
    await mkdir(emptyRepo, { recursive: true });
    const cleanup = vi.fn(async () => {
      throw new Error("cleanup exploded");
    });

    await expect(
      resolveEvalInput("github:test/nothing", {
        fetchRemote: async () => ({
          rootDir: emptyRepo,
          cleanup,
          sourceRef: "github:test/nothing",
          commitSha: null,
        }),
      }),
    ).rejects.toThrow(/No SKILL\.md found/);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("resolves a relative local path against the cwd", async () => {
    await writeSkillMd(join(tempDir, "rel-skill"));
    const prevCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const r = await resolveEvalInput("rel-skill");
      expect(r.targets).toHaveLength(1);
      // resolve() anchors on the chdir'd cwd (canonicalised on macOS).
      expect(r.targets[0].skillPath).toBe(resolve("rel-skill"));
      // Local directory inputs get a no-op cleanup — safe to call.
      await expect(r.cleanup()).resolves.toBeUndefined();
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("keeps the full path as skillPath for a file not named SKILL.md", async () => {
    const dir = join(tempDir, "odd-file");
    await mkdir(dir, { recursive: true });
    const alt = join(dir, "OTHER.md");
    await writeFile(alt, MINI_SKILL, "utf-8");

    const r = await resolveEvalInput(alt);
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].skillPath).toBe(alt);
    expect(r.targets[0].skillMdPath).toBe(alt);
    expect(r.targets[0].label).toBe("OTHER.md");
    // Local inputs get a no-op cleanup — it must be safe to call.
    await expect(r.cleanup()).resolves.toBeUndefined();
  });

  it("rejects a path that is neither a file nor a directory", async () => {
    // /dev/null stats successfully but is a character device.
    await expect(resolveEvalInput("/dev/null")).rejects.toThrow(
      /not a directory or file/,
    );
  });
});

describe("runWithConcurrency — failure window", () => {
  it("rethrows the first error when multiple workers fail", async () => {
    // With limit 2 both workers claim an index and reject; the second
    // observes `failure` already set — the first error wins.
    const calls: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 2, async (n) => {
        calls.push(n);
        if (n === 1) throw new Error("boom-1");
        if (n === 2) throw new Error("boom-2");
        return n;
      }),
    ).rejects.toThrow("boom-1");
    // Workers stop claiming new indexes once failure is observed.
    expect(calls).toEqual([1, 2]);
  });
});

describe("batch reporting — failure aggregates", () => {
  const allFailed: EvalBatchItem[] = [
    {
      label: "a",
      skillPath: "/virtual/a",
      report: null,
      error: "SKILL.md not found",
    },
    {
      label: "b",
      skillPath: "/virtual/b",
      report: null,
      error: "parse exploded",
    },
  ];

  it("summariseBatch reports only failures", () => {
    const agg = summariseBatch(allFailed);
    expect(agg).toEqual({
      total: 2,
      succeeded: 0,
      failed: 2,
      meanScore: null,
      top: null,
      bottom: null,
    });
  });

  it("formatBatchSummary shows the failed count and no score lines", () => {
    const out = formatBatchSummary({
      provenance: { input: "./skills", remote: false, sourceRef: null },
      aggregate: summariseBatch(allFailed),
      results: allFailed,
    });
    expect(out).toContain("Skills evaluated:      0/2  (2 failed)");
    expect(out).not.toContain("Mean score:");
    expect(out).not.toContain("Top:");
    expect(out).not.toContain("Bottom:");
  });

  it("formatBatchSummary omits provenance lines the remote left unset", () => {
    const out = formatBatchSummary({
      provenance: {
        input: "github:a/b",
        remote: true,
        sourceRef: null,
        commitSha: null,
        tempPath: null,
      },
      aggregate: {
        total: 1,
        succeeded: 1,
        failed: 0,
        meanScore: 88,
        top: { label: "a", score: 88 },
        bottom: { label: "a", score: 88 },
      },
      results: [],
    });
    expect(out).not.toContain("Source:");
    expect(out).not.toContain("Commit:");
    expect(out).not.toContain("Fetched to:");
  });

  it("buildBatchMachineData keeps a failed item's error and null report", () => {
    const data = buildBatchMachineData({
      provenance: { input: "./skills", remote: false, sourceRef: null },
      aggregate: summariseBatch(allFailed),
      results: allFailed,
    });
    expect(data.aggregate.failed).toBe(2);
    expect(data.results[0].report).toBeNull();
    expect(data.results[0].error).toBe("SKILL.md not found");
  });
});

describe("buildEvalMachineData — provider payload", () => {
  it("serialises extra providers with their categories and findings", () => {
    const report = {
      ...mkReport("x", 70),
      providers: [
        {
          id: "skill-best-practice",
          version: "1.0.0",
          schemaVersion: 1,
          score: 88,
          passed: true,
          categories: [
            {
              id: "validation",
              name: "Deterministic validation",
              score: 7,
              max: 7,
              findings: [],
              suggestions: [],
            },
            // No `findings` key — the `?? []` fallback must kick in.
            {
              id: "other",
              name: "Other",
              score: 1,
              max: 3,
            } as never,
          ],
          findings: [
            {
              severity: "warning" as const,
              message: "Missing negative-trigger clause.",
            },
          ],
        },
      ],
    };
    const data = buildEvalMachineData(report);
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0]).toMatchObject({
      id: "skill-best-practice",
      score: 88,
      passed: true,
    });
    expect(data.providers[0].categories[0].id).toBe("validation");
    expect(data.providers[0].categories[1].findings).toEqual([]);
    expect(data.providers[0].findings).toEqual([
      { severity: "warning", message: "Missing negative-trigger clause." },
    ]);
  });
});

describe("buildEvalMachineData — fix payload", () => {
  it("serialises the fix block when a FixResult is supplied", () => {
    const fix: FixResult = {
      report: mkReport("x", 70),
      applied: [{ id: "add-missing-version", description: "Add `version`." }],
      skipped: [{ id: "missing-description", description: "Left to author." }],
      diff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1,1 +1,2 @@\n+version: 0.1.0",
      dryRun: false,
      backupPath: "/virtual/x/SKILL.md.bak",
      skillMdPath: "/virtual/x/SKILL.md",
    };
    const data = buildEvalMachineData(mkReport("x", 70), fix);
    expect(data.fix).toEqual({
      dry_run: false,
      applied: fix.applied,
      skipped: fix.skipped,
      backup_path: "/virtual/x/SKILL.md.bak",
      diff: fix.diff,
    });
  });
});
