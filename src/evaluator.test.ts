import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  buildFixPlan,
  evaluateSkillContent,
  evaluateSkill,
  applyFix,
  splitSkillMd,
  unifiedDiff,
  formatReport,
  formatReportJSON,
  formatFixPreview,
  buildEvalMachineData,
  resolveEvalInput,
  classifyEvalDirectory,
  findChildSkillDirs,
  looksLikeGithubInput,
  runWithConcurrency,
  summariseBatch,
  formatBatchSummary,
  buildBatchMachineData,
  type EvalBatchItem,
  type EvalProvenance,
} from "./evaluator";
import { mkdtemp, rm, readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

function skillDir(name = "sample-skill") {
  return join(tempDir, name);
}

async function writeSkillMd(
  dir: string,
  content: string,
  fileName = "SKILL.md",
): Promise<string> {
  const { mkdir } = await import("fs/promises");
  await mkdir(dir, { recursive: true });
  const p = join(dir, fileName);
  await writeFile(p, content, "utf-8");
  return p;
}

const HIGH_QUALITY_SKILL = `---
name: code-review
description: Review pull request diffs for code smells, style issues, and safety problems before merging.
version: 1.0.0
license: MIT
creator: Test Author
compatibility: Claude Code
allowed-tools: Read Grep
effort: medium
---

# Code review

## When to Use

- When the user asks to "review this PR" or "check the diff"
- Before merging any change larger than 10 lines

## Prerequisites

- A git repository with the target branch checked out
- Read access to the files being reviewed

## Instructions

1. Run \`git diff main...HEAD\` to list files
2. Read each file and check for common smells
3. Emit a markdown report summarising findings

## Example

\`\`\`bash
$ asm eval ./code-review
Overall score: 95/100
\`\`\`

## Acceptance Criteria

- Produces a markdown report with sections per file
- Flags any use of \`eval()\` or \`exec\` as dangerous
- Does not modify the working tree

## Edge cases

- Empty diffs: emit a short "no changes" note
- Binary files: skip and mention the filename in the report

## Safety

See \`references/safety.md\` for error handling rules.
Always confirm before writing. Never run destructive commands without a dry-run.
`;

const POOR_SKILL = `---
name: BadName
description: foo
---

short
`;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "eval-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("splitSkillMd", () => {
  it("splits frontmatter and body", () => {
    const r = splitSkillMd("---\nname: x\n---\nhello world\n");
    expect(r.rawFrontmatter).toBe("name: x");
    expect(r.body.trim()).toBe("hello world");
  });

  it("handles no frontmatter", () => {
    const r = splitSkillMd("just markdown\n");
    expect(r.rawFrontmatter).toBeNull();
    expect(r.body).toContain("just markdown");
  });

  it("handles unclosed frontmatter", () => {
    const r = splitSkillMd("---\nkey: value\nmore\n");
    expect(r.rawFrontmatter).not.toBeNull();
  });
});

describe("evaluateSkillContent", () => {
  it("scores a high-quality skill highly", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    expect(report.overallScore).toBeGreaterThan(70);
    expect(report.grade).not.toBe("F");
    expect(report.categories).toHaveLength(7);
  });

  it("returns 7 categories with the expected ids", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const ids = report.categories.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "context-efficiency",
        "description",
        "naming",
        "prompt-engineering",
        "safety",
        "structure",
        "testability",
      ].sort(),
    );
  });

  it("scores a poor skill lower than a good one", () => {
    const good = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const poor = evaluateSkillContent({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(poor.overallScore).toBeLessThan(good.overallScore);
  });

  it("detects missing frontmatter fields", () => {
    const report = evaluateSkillContent({
      content: "---\nname: test\n---\nbody\n",
      skillPath: "/virtual/test",
      skillMdPath: "/virtual/test/SKILL.md",
    });
    const structure = report.categories.find((c) => c.id === "structure")!;
    expect(structure.findings.some((f) => /description/i.test(f))).toBe(true);
  });

  it("penalises very short descriptions", () => {
    const report = evaluateSkillContent({
      content: "---\nname: a\ndescription: foo\n---\nbody\n",
      skillPath: "/virtual/a",
      skillMdPath: "/virtual/a/SKILL.md",
    });
    const desc = report.categories.find((c) => c.id === "description")!;
    expect(desc.score).toBeLessThan(5);
  });

  it("rewards action-verb + trigger phrasing in descriptions", () => {
    const report = evaluateSkillContent({
      content:
        "---\nname: x\ndescription: Generate release notes when shipping a new version of the package.\n---\nbody text with content here\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const desc = report.categories.find((c) => c.id === "description")!;
    expect(desc.score).toBeGreaterThanOrEqual(7);
  });

  it("flags non-kebab-case names", () => {
    const report = evaluateSkillContent({
      content:
        "---\nname: BadName\ndescription: Something that does work.\n---\nbody\n",
      skillPath: "/virtual/BadName",
      skillMdPath: "/virtual/BadName/SKILL.md",
    });
    const naming = report.categories.find((c) => c.id === "naming")!;
    expect(
      naming.findings.some((f) => /not lowercase kebab-case/.test(f)),
    ).toBe(true);
  });

  it("produces up to 3 top suggestions", () => {
    const report = evaluateSkillContent({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(report.topSuggestions.length).toBeGreaterThan(0);
    expect(report.topSuggestions.length).toBeLessThanOrEqual(3);
  });

  it("scores in the 0..100 range", () => {
    const report = evaluateSkillContent({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("awards naming bonus when directory matches frontmatter name", () => {
    const matchDir = evaluateSkillContent({
      content:
        "---\nname: my-skill\ndescription: Generate something when asked.\n---\n# hi\n\n## When to Use\n- thing\n",
      skillPath: "/virtual/my-skill",
      skillMdPath: "/virtual/my-skill/SKILL.md",
    });
    const mismatchDir = evaluateSkillContent({
      content:
        "---\nname: my-skill\ndescription: Generate something when asked.\n---\n# hi\n\n## When to Use\n- thing\n",
      skillPath: "/virtual/other-dir",
      skillMdPath: "/virtual/other-dir/SKILL.md",
    });
    const matchScore = matchDir.categories.find(
      (c) => c.id === "naming",
    )!.score;
    const mismatchScore = mismatchDir.categories.find(
      (c) => c.id === "naming",
    )!.score;
    expect(matchScore).toBeGreaterThanOrEqual(mismatchScore);
  });
});

describe("evaluateSkill (filesystem)", () => {
  it("reads SKILL.md from a directory", async () => {
    const dir = skillDir("ok");
    await writeSkillMd(dir, HIGH_QUALITY_SKILL);
    const report = await evaluateSkill(dir);
    expect(report.skillPath).toBe(dir);
    expect(report.overallScore).toBeGreaterThan(60);
  });

  it("accepts a direct SKILL.md file path", async () => {
    const dir = skillDir("ok2");
    const p = await writeSkillMd(dir, HIGH_QUALITY_SKILL);
    const report = await evaluateSkill(p);
    expect(report.skillMdPath).toBe(p);
  });

  it("throws when path does not exist", async () => {
    await expect(evaluateSkill(join(tempDir, "missing"))).rejects.toThrow(
      /does not exist/i,
    );
  });

  it("throws when SKILL.md is missing", async () => {
    const { mkdir } = await import("fs/promises");
    await mkdir(join(tempDir, "empty"), { recursive: true });
    await expect(evaluateSkill(join(tempDir, "empty"))).rejects.toThrow(
      /SKILL\.md/,
    );
  });
});

describe("buildFixPlan", () => {
  it("adds missing version when absent", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\n---\n\nbody here\n",
    );
    expect(plan.newContent).toContain("version: 0.1.0");
    expect(plan.applied.some((a) => a.id === "add-missing-version")).toBe(true);
  });

  it("does not touch version when already set", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 2.0.0\n---\n\nbody\n",
    );
    expect(plan.newContent).not.toContain("version: 0.1.0");
    expect(plan.applied.some((a) => a.id === "add-missing-version")).toBe(
      false,
    );
  });

  it("adds creator from gitAuthor option when absent", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\n---\n\nbody\n",
      { gitAuthor: "Jane Doe" },
    );
    expect(plan.newContent).toContain("creator: Jane Doe");
    expect(plan.applied.some((a) => a.id === "add-missing-creator")).toBe(true);
  });

  it("skips creator when no gitAuthor is provided", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\n---\n\nbody\n",
    );
    expect(plan.skipped.some((s) => s.id === "add-missing-creator")).toBe(true);
  });

  it("infers effort from line count when missing", () => {
    const longBody = Array.from({ length: 30 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const plan = buildFixPlan(
      `---\nname: x\ndescription: do a thing\n---\n\n${longBody}\n`,
    );
    expect(plan.newContent).toMatch(/effort: (low|medium|high|max)/);
    expect(plan.applied.some((a) => a.id === "infer-missing-effort")).toBe(
      true,
    );
  });

  it("normalises CRLF to LF", () => {
    const plan = buildFixPlan(
      "---\r\nname: x\r\ndescription: do a thing\r\n---\r\n\r\nbody\r\n",
    );
    expect(plan.newContent).not.toContain("\r");
    expect(plan.applied.some((a) => a.id === "normalise-line-endings")).toBe(
      true,
    );
  });

  it("strips trailing whitespace", () => {
    const plan = buildFixPlan(
      "---\nname: x   \ndescription: do a thing  \n---\n\nbody   \n",
    );
    expect(plan.applied.some((a) => a.id === "strip-trailing-whitespace")).toBe(
      true,
    );
    expect(plan.newContent).not.toMatch(/[ \t]+\n/);
  });

  it("reorders frontmatter keys to canonical order", () => {
    const plan = buildFixPlan(
      "---\ncreator: Alice\nname: x\nversion: 0.1.0\ndescription: do a thing\n---\n\nbody\n",
    );
    expect(plan.applied.some((a) => a.id === "reorder-frontmatter")).toBe(true);
    const nameIdx = plan.newContent.indexOf("name:");
    const descIdx = plan.newContent.indexOf("description:");
    const creatorIdx = plan.newContent.indexOf("creator:");
    expect(nameIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(creatorIdx);
  });

  it("leaves description alone (content-level fix)", () => {
    const plan = buildFixPlan("---\nname: x\n---\n\nbody\n");
    expect(plan.skipped.some((s) => s.id === "missing-description")).toBe(true);
  });

  it("skips when there is no frontmatter", () => {
    const plan = buildFixPlan("# hi\njust markdown\n");
    expect(plan.skipped.some((s) => s.id === "missing-frontmatter")).toBe(true);
  });
});

describe("unifiedDiff", () => {
  it("returns empty string when contents match", () => {
    expect(unifiedDiff("abc\n", "abc\n")).toBe("");
  });

  it("includes +/- lines on change", () => {
    const d = unifiedDiff("a\nb\nc\n", "a\nX\nc\n");
    expect(d).toContain("-b");
    expect(d).toContain("+X");
  });
});

describe("applyFix", () => {
  it("dry-run does NOT modify the file", async () => {
    const dir = skillDir("dry");
    const original = "---\nname: dry\ndescription: does a thing\n---\n\nbody\n";
    await writeSkillMd(dir, original);
    const r = await applyFix(dir, { dryRun: true, gitAuthor: "Alice" });
    expect(r.dryRun).toBe(true);
    const after = await readFile(join(dir, "SKILL.md"), "utf-8");
    expect(after).toBe(original);
    expect(r.backupPath).toBeNull();
    expect(r.applied.length).toBeGreaterThan(0);
    expect(r.diff).not.toBe("");
  });

  it("writing applies changes and creates .bak backup", async () => {
    const dir = skillDir("wet");
    const original = "---\nname: wet\ndescription: does a thing\n---\n\nbody\n";
    await writeSkillMd(dir, original);
    const r = await applyFix(dir, { dryRun: false, gitAuthor: "Alice" });
    expect(r.dryRun).toBe(false);
    expect(r.backupPath).toBe(join(dir, "SKILL.md.bak"));
    const after = await readFile(join(dir, "SKILL.md"), "utf-8");
    expect(after).toContain("version: 0.1.0");
    expect(after).toContain("creator: Alice");
    const backup = await readFile(r.backupPath!, "utf-8");
    expect(backup).toBe(original);
  });

  it("is idempotent when nothing needs fixing", async () => {
    const dir = skillDir("clean");
    await writeSkillMd(dir, HIGH_QUALITY_SKILL);
    const r = await applyFix(dir, { dryRun: false, gitAuthor: "Ignored" });
    expect(r.applied).toEqual([]);
    expect(r.backupPath).toBeNull();
    // No changes → .bak should not be created
    await expect(access(join(dir, "SKILL.md.bak"))).rejects.toThrow();
  });

  it("report is consistent with the post-fix content", async () => {
    const dir = skillDir("cons");
    await writeSkillMd(
      dir,
      "---\nname: cons\ndescription: does a specific thing when asked.\n---\n\n# cons\n\nSome body text with enough content to pass basic checks.\n",
    );
    const r = await applyFix(dir, { dryRun: false, gitAuthor: "Bob" });
    expect(r.report.frontmatter.version).toBe("0.1.0");
    expect(r.report.frontmatter.creator).toBe("Bob");
  });
});

describe("formatters", () => {
  it("formatReport contains key sections", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const text = formatReport(report);
    expect(text).toContain("Overall score:");
    expect(text).toContain("Categories:");
    expect(text).toContain("Structure & completeness");
  });

  it("formatReport inlines extra providers in headline and renders their findings", () => {
    const baseReport = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const withProviders = {
      ...baseReport,
      providers: [
        {
          id: "quality",
          version: "1.0.0",
          schemaVersion: 1,
          score: baseReport.overallScore,
          passed: true,
          categories: [],
          findings: [],
        },
        {
          id: "skill-creator",
          version: "1.0.0",
          schemaVersion: 1,
          score: 88,
          passed: true,
          categories: [],
          findings: [
            {
              severity: "warning" as const,
              message: "Missing negative-trigger clause.",
              code: "negative-trigger-clause",
              categoryId: "validation",
            },
          ],
        },
      ],
    };
    const text = formatReport(withProviders);
    // Extra provider surfaces next to the headline
    expect(text).toContain("skill-creator@1.0.0:  88/100  pass");
    // Quality categories appear exactly once
    const categoriesMatches = text.match(/Structure & completeness/g) ?? [];
    expect(categoriesMatches.length).toBe(1);
    // Extra-provider findings render in their own block
    expect(text).toContain("skill-creator@1.0.0 findings:");
    expect(text).toContain("[warning] Missing negative-trigger clause.");
  });

  it("formatReportJSON returns parseable JSON", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const parsed = JSON.parse(formatReportJSON(report));
    expect(parsed.overallScore).toBeGreaterThan(0);
    expect(Array.isArray(parsed.categories)).toBe(true);
  });

  it("buildEvalMachineData has the expected shape", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const data = buildEvalMachineData(report);
    expect(data.overall_score).toBe(report.overallScore);
    expect(data.categories.length).toBe(7);
    expect(data.fix).toBeNull();
  });

  it("formatFixPreview summarises applied and skipped items", () => {
    const report = evaluateSkillContent({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const preview = formatFixPreview({
      report,
      applied: [{ id: "x", description: "did the thing" }],
      skipped: [{ id: "y", description: "skipped the other thing" }],
      diff: "",
      dryRun: true,
      backupPath: null,
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    expect(preview).toContain("did the thing");
    expect(preview).toContain("skipped the other thing");
  });
});

// ─── Input resolution / collection detection (issues #193 + #194) ──────────

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

describe("looksLikeGithubInput", () => {
  it("recognises github: shorthand", () => {
    expect(looksLikeGithubInput("github:owner/repo")).toBe(true);
    expect(looksLikeGithubInput("github:owner/repo#main")).toBe(true);
    expect(looksLikeGithubInput("github:owner/repo:subdir")).toBe(true);
  });

  it("recognises https github URLs", () => {
    expect(looksLikeGithubInput("https://github.com/a/b")).toBe(true);
    expect(looksLikeGithubInput("http://github.com/a/b")).toBe(true);
    expect(looksLikeGithubInput("https://github.com/a/b/tree/main/sub")).toBe(
      true,
    );
  });

  it("rejects local paths", () => {
    expect(looksLikeGithubInput("./skills")).toBe(false);
    expect(looksLikeGithubInput("/tmp/x")).toBe(false);
    expect(looksLikeGithubInput("my-skill")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(looksLikeGithubInput("")).toBe(false);
  });
});

describe("classifyEvalDirectory", () => {
  it("detects a single skill (SKILL.md at root)", async () => {
    const dir = skillDir("single-skill");
    await writeSkillMd(dir, MINI_SKILL);
    const r = await classifyEvalDirectory(dir);
    expect(r.kind).toBe("single");
    expect(r.skillDirs).toEqual([dir]);
  });

  it("detects a collection (no root SKILL.md, children have one)", async () => {
    const root = join(tempDir, "collection");
    const { mkdir } = await import("fs/promises");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "alpha"), MINI_SKILL);
    await writeSkillMd(join(root, "beta"), MINI_SKILL);
    const r = await classifyEvalDirectory(root);
    expect(r.kind).toBe("collection");
    expect(r.skillDirs.length).toBe(2);
    expect(r.skillDirs.map((d) => d.split("/").pop()).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("returns 'none' for an empty directory", async () => {
    const { mkdir } = await import("fs/promises");
    await mkdir(join(tempDir, "empty"), { recursive: true });
    const r = await classifyEvalDirectory(join(tempDir, "empty"));
    expect(r.kind).toBe("none");
    expect(r.skillDirs).toEqual([]);
  });

  it("skips hidden and node_modules child directories", async () => {
    const root = join(tempDir, "noisy");
    const { mkdir } = await import("fs/promises");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "real"), MINI_SKILL);
    await writeSkillMd(join(root, ".hidden"), MINI_SKILL);
    await writeSkillMd(join(root, "node_modules"), MINI_SKILL);
    const r = await classifyEvalDirectory(root);
    expect(r.kind).toBe("collection");
    expect(r.skillDirs.length).toBe(1);
    expect(r.skillDirs[0].endsWith("/real")).toBe(true);
  });
});

describe("findChildSkillDirs", () => {
  it("returns empty array for a non-existent directory", async () => {
    const r = await findChildSkillDirs(join(tempDir, "does-not-exist"));
    expect(r).toEqual([]);
  });

  it("is sorted by basename", async () => {
    const root = join(tempDir, "sorted");
    const { mkdir } = await import("fs/promises");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "c"), MINI_SKILL);
    await writeSkillMd(join(root, "a"), MINI_SKILL);
    await writeSkillMd(join(root, "b"), MINI_SKILL);
    const r = await findChildSkillDirs(root);
    expect(r.map((d) => d.split("/").pop())).toEqual(["a", "b", "c"]);
  });
});

describe("resolveEvalInput (local)", () => {
  it("resolves a single skill directory", async () => {
    const dir = skillDir("single");
    await writeSkillMd(dir, MINI_SKILL);
    const r = await resolveEvalInput(dir);
    expect(r.isCollection).toBe(false);
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].skillPath).toBe(dir);
    expect(r.provenance.remote).toBe(false);
  });

  it("resolves a collection and sets isCollection=true", async () => {
    const root = join(tempDir, "coll");
    const { mkdir } = await import("fs/promises");
    await mkdir(root, { recursive: true });
    await writeSkillMd(join(root, "a"), MINI_SKILL);
    await writeSkillMd(join(root, "b"), MINI_SKILL);
    const r = await resolveEvalInput(root);
    expect(r.isCollection).toBe(true);
    expect(r.targets).toHaveLength(2);
    expect(r.provenance.remote).toBe(false);
  });

  it("throws on missing path", async () => {
    await expect(resolveEvalInput(join(tempDir, "missing"))).rejects.toThrow(
      /does not exist/,
    );
  });

  it("throws on an empty directory", async () => {
    const { mkdir } = await import("fs/promises");
    await mkdir(join(tempDir, "empty"), { recursive: true });
    await expect(resolveEvalInput(join(tempDir, "empty"))).rejects.toThrow(
      /No SKILL\.md/,
    );
  });

  it("accepts a SKILL.md file directly as input", async () => {
    const dir = skillDir("directfile");
    const p = await writeSkillMd(dir, MINI_SKILL);
    const r = await resolveEvalInput(p);
    expect(r.isCollection).toBe(false);
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].skillMdPath).toBe(p);
  });
});

describe("resolveEvalInput (github fetchRemote adapter)", () => {
  it("routes github: input through the fetchRemote adapter", async () => {
    // Stage a fake "remote" checkout locally so the test stays off the network.
    const fakeRepo = join(tempDir, "fake-repo");
    const { mkdir } = await import("fs/promises");
    await mkdir(fakeRepo, { recursive: true });
    await writeSkillMd(join(fakeRepo, "alpha"), MINI_SKILL);
    await writeSkillMd(join(fakeRepo, "beta"), MINI_SKILL);

    let cleanupCalled = 0;
    const r = await resolveEvalInput("github:test/fake", {
      fetchRemote: async (input: string) => {
        expect(input).toBe("github:test/fake");
        return {
          rootDir: fakeRepo,
          cleanup: async () => {
            cleanupCalled++;
          },
          sourceRef: "github:test/fake",
          commitSha: "0".repeat(40),
        };
      },
    });

    expect(r.isCollection).toBe(true);
    expect(r.targets).toHaveLength(2);
    expect(r.provenance.remote).toBe(true);
    expect(r.provenance.sourceRef).toBe("github:test/fake");
    expect(r.provenance.commitSha).toBe("0".repeat(40));
    expect(cleanupCalled).toBe(0);
    await r.cleanup();
    expect(cleanupCalled).toBe(1);
  });

  it("routes an https URL through the fetchRemote adapter and resolves single skill", async () => {
    const fakeRepo = join(tempDir, "fake-single");
    await writeSkillMd(fakeRepo, MINI_SKILL);
    const r = await resolveEvalInput(
      "https://github.com/owner/repo/tree/main/sub",
      {
        fetchRemote: async () => ({
          rootDir: fakeRepo,
          cleanup: async () => {},
          sourceRef: "github:owner/repo#main:sub",
          commitSha: null,
        }),
      },
    );
    expect(r.isCollection).toBe(false);
    expect(r.targets).toHaveLength(1);
    expect(r.provenance.remote).toBe(true);
  });

  it("calls cleanup when the remote root has no skills", async () => {
    const fakeRepo = join(tempDir, "empty-remote");
    const { mkdir } = await import("fs/promises");
    await mkdir(fakeRepo, { recursive: true });
    let cleanedUp = 0;
    await expect(
      resolveEvalInput("github:test/nothing", {
        fetchRemote: async () => ({
          rootDir: fakeRepo,
          cleanup: async () => {
            cleanedUp++;
          },
          sourceRef: "github:test/nothing",
          commitSha: null,
        }),
      }),
    ).rejects.toThrow(/No SKILL\.md/);
    expect(cleanedUp).toBe(1);
  });

  it("throws if a github input is supplied with no fetchRemote adapter", async () => {
    await expect(resolveEvalInput("github:owner/repo")).rejects.toThrow(
      /Remote evaluation is not available/,
    );
  });
});

describe("runWithConcurrency", () => {
  it("processes all inputs and preserves order", async () => {
    const inputs = [1, 2, 3, 4, 5, 6, 7];
    const results = await runWithConcurrency(inputs, 3, async (n) => {
      await new Promise((r) => setTimeout(r, 5 * ((n * 13) % 4)));
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("never exceeds the concurrency cap", async () => {
    const limit = 2;
    let inFlight = 0;
    let maxInFlight = 0;
    const inputs = [1, 2, 3, 4, 5, 6];
    await runWithConcurrency(inputs, limit, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return null;
    });
    expect(maxInFlight).toBeLessThanOrEqual(limit);
  });

  it("handles empty input", async () => {
    const r = await runWithConcurrency<number, number>([], 4, async (x) => x);
    expect(r).toEqual([]);
  });

  it("treats limit < 1 as 1", async () => {
    const r = await runWithConcurrency([1, 2, 3], 0, async (x) => x);
    expect(r).toEqual([1, 2, 3]);
  });
});

describe("summariseBatch", () => {
  function mkItem(
    label: string,
    score: number | null,
    err: string | null = null,
  ): EvalBatchItem {
    return {
      label,
      skillPath: `/virtual/${label}`,
      report:
        score === null
          ? null
          : ({
              skillPath: `/virtual/${label}`,
              skillMdPath: `/virtual/${label}/SKILL.md`,
              overallScore: score,
              grade: "B",
              categories: [],
              topSuggestions: [],
              evaluatedAt: new Date().toISOString(),
              frontmatter: {},
            } as any),
      error: err,
    };
  }

  it("computes counts, mean, top, bottom for mixed results", () => {
    const agg = summariseBatch([
      mkItem("a", 90),
      mkItem("b", 70),
      mkItem("c", 50),
      mkItem("d", null, "boom"),
    ]);
    expect(agg.total).toBe(4);
    expect(agg.succeeded).toBe(3);
    expect(agg.failed).toBe(1);
    expect(agg.meanScore).toBe(70);
    expect(agg.top?.label).toBe("a");
    expect(agg.bottom?.label).toBe("c");
  });

  it("returns null mean/top/bottom when nothing succeeded", () => {
    const agg = summariseBatch([mkItem("a", null, "err")]);
    expect(agg.meanScore).toBeNull();
    expect(agg.top).toBeNull();
    expect(agg.bottom).toBeNull();
  });
});

describe("formatBatchSummary", () => {
  it("prints provenance lines when remote", () => {
    const provenance: EvalProvenance = {
      input: "github:a/b",
      remote: true,
      sourceRef: "github:a/b#main",
      commitSha: "abc123",
      tempPath: "/tmp/fake",
    };
    const out = formatBatchSummary({
      provenance,
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
    expect(out).toContain("Batch summary");
    expect(out).toContain("Mean score:");
    expect(out).toContain("Source:");
    expect(out).toContain("github:a/b#main");
    expect(out).toContain("abc123");
  });

  it("skips provenance for local inputs", () => {
    const out = formatBatchSummary({
      provenance: { input: "./skills", remote: false, sourceRef: null },
      aggregate: {
        total: 2,
        succeeded: 2,
        failed: 0,
        meanScore: 80,
        top: { label: "a", score: 90 },
        bottom: { label: "b", score: 70 },
      },
      results: [],
    });
    expect(out).toContain("Skills evaluated:");
    expect(out).not.toContain("Source:");
    expect(out).not.toContain("Commit:");
  });
});

describe("buildBatchMachineData", () => {
  it("wraps provenance, aggregate, and per-skill reports in a machine shape", () => {
    const data = buildBatchMachineData({
      provenance: {
        input: "./skills",
        remote: false,
        sourceRef: null,
      },
      aggregate: {
        total: 1,
        succeeded: 1,
        failed: 0,
        meanScore: 70,
        top: { label: "x", score: 70 },
        bottom: { label: "x", score: 70 },
      },
      results: [
        {
          label: "x",
          skillPath: "/virtual/x",
          error: null,
          report: {
            skillPath: "/virtual/x",
            skillMdPath: "/virtual/x/SKILL.md",
            evaluatedAt: new Date().toISOString(),
            categories: [],
            overallScore: 70,
            grade: "C",
            topSuggestions: [],
            frontmatter: {},
          } as any,
        },
      ],
    });
    expect(data.provenance.input).toBe("./skills");
    expect(data.aggregate.total).toBe(1);
    expect(data.aggregate.mean_score).toBe(70);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results[0].label).toBe("x");
    expect(data.results[0].report).not.toBeNull();
    expect(data.results[0].report?.overall_score).toBe(70);
  });
});
