import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  buildFixPlan,
  evaluateSkillContentSync,
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
import { basename, join } from "path";
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

describe("evaluateSkillContentSync", () => {
  it("scores a high-quality skill highly", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    expect(report.overallScore).toBeGreaterThan(70);
    expect(report.grade).not.toBe("F");
    expect(report.categories).toHaveLength(10);
  });

  it("returns 10 categories (8 sync + pii + script-lint placeholders)", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const ids = report.categories.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        "context-efficiency",
        "description",
        "license",
        "naming",
        "pii",
        "prompt-engineering",
        "safety",
        "script-lint",
        "structure",
        "testability",
      ].sort(),
    );
  });

  it("scores a poor skill lower than a good one", () => {
    const good = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const poor = evaluateSkillContentSync({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(poor.overallScore).toBeLessThan(good.overallScore);
  });

  it("detects missing frontmatter fields", () => {
    const report = evaluateSkillContentSync({
      content: "---\nname: test\n---\nbody\n",
      skillPath: "/virtual/test",
      skillMdPath: "/virtual/test/SKILL.md",
    });
    const structure = report.categories.find((c) => c.id === "structure")!;
    expect(structure.findings.some((f) => /description/i.test(f))).toBe(true);
  });

  it("penalises very short descriptions", () => {
    const report = evaluateSkillContentSync({
      content: "---\nname: a\ndescription: foo\n---\nbody\n",
      skillPath: "/virtual/a",
      skillMdPath: "/virtual/a/SKILL.md",
    });
    const desc = report.categories.find((c) => c.id === "description")!;
    expect(desc.score).toBeLessThan(5);
  });

  it("rewards action-verb + trigger phrasing in descriptions", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Generate release notes when shipping a new version of the package.\n---\nbody text with content here\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const desc = report.categories.find((c) => c.id === "description")!;
    expect(desc.score).toBeGreaterThanOrEqual(7);
  });

  it("flags non-kebab-case names", () => {
    const report = evaluateSkillContentSync({
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

  it("awards authorship point for legacy creator-only skills", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing when triggered.\nversion: 1.0.0\nlicense: MIT\ncreator: Legacy Author\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const structure = report.categories.find((c) => c.id === "structure")!;
    expect(structure.findings.some((f) => /Missing.*author/i.test(f))).toBe(
      false,
    );
  });

  it("awards authorship point for metadata.author skills", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing when triggered.\nversion: 1.0.0\nlicense: MIT\nmetadata:\n  author: Jane Doe\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const structure = report.categories.find((c) => c.id === "structure")!;
    expect(structure.findings.some((f) => /Missing.*author/i.test(f))).toBe(
      false,
    );
  });

  it("produces up to 3 top suggestions", () => {
    const report = evaluateSkillContentSync({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(report.topSuggestions.length).toBeGreaterThan(0);
    expect(report.topSuggestions.length).toBeLessThanOrEqual(3);
  });

  it("scores in the 0..100 range", () => {
    const report = evaluateSkillContentSync({
      content: POOR_SKILL,
      skillPath: "/virtual/bad",
      skillMdPath: "/virtual/bad/SKILL.md",
    });
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });

  it("awards naming bonus when directory matches frontmatter name", () => {
    const matchDir = evaluateSkillContentSync({
      content:
        "---\nname: my-skill\ndescription: Generate something when asked.\n---\n# hi\n\n## When to Use\n- thing\n",
      skillPath: "/virtual/my-skill",
      skillMdPath: "/virtual/my-skill/SKILL.md",
    });
    const mismatchDir = evaluateSkillContentSync({
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

  it("marks pii and script-lint as skipped for content-only calls", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /Skipped/i.test(f))).toBe(true);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    expect(lint.findings.some((f) => /Skipped/i.test(f))).toBe(true);
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

  // README-at-root convention (issue #227): README.md is optional and must
  // not sit next to SKILL.md. A top-level README produces a warning finding
  // on the Structure category without changing scores.
  describe("README-at-root rule", () => {
    const findReadmeFinding = (
      report: Awaited<ReturnType<typeof evaluateSkill>>,
    ) =>
      report.categories
        .find((c) => c.id === "structure")
        ?.findings.find((f) => /found at skill root/i.test(f));

    it("does not warn when no README exists", async () => {
      const dir = skillDir("no-readme");
      await writeSkillMd(dir, HIGH_QUALITY_SKILL);
      const report = await evaluateSkill(dir);
      expect(findReadmeFinding(report)).toBeUndefined();
    });

    it("does not warn when README.md lives in a subdirectory", async () => {
      const dir = skillDir("subdir-readme");
      await writeSkillMd(dir, HIGH_QUALITY_SKILL);
      await writeSkillMd(join(dir, "docs"), "# Docs\n", "README.md");
      const report = await evaluateSkill(dir);
      expect(findReadmeFinding(report)).toBeUndefined();
    });

    it("warns when README.md sits at the skill root", async () => {
      const dir = skillDir("root-readme");
      await writeSkillMd(dir, HIGH_QUALITY_SKILL);
      await writeSkillMd(dir, "# Root readme\n", "README.md");
      const report = await evaluateSkill(dir);
      const finding = findReadmeFinding(report);
      expect(finding).toBeDefined();
      const structure = report.categories.find((c) => c.id === "structure")!;
      expect(
        structure.suggestions.some((s) => /relocate `README\.md`/i.test(s)),
      ).toBe(true);
      // The root-README suggestion must reach topSuggestions even when
      // Structure is not among the lowest-scoring categories, so the default
      // CLI output surfaces the warning.
      expect(
        report.topSuggestions.some((s) => /relocate `README\.md`/i.test(s)),
      ).toBe(true);
    });

    it("warns for case variants like README.MD", async () => {
      const dir = skillDir("root-readme-upper");
      await writeSkillMd(dir, HIGH_QUALITY_SKILL);
      await writeSkillMd(dir, "# upper\n", "README.MD");
      const report = await evaluateSkill(dir);
      const structure = report.categories.find((c) => c.id === "structure")!;
      expect(structure.findings.some((f) => f.includes("`README.MD`"))).toBe(
        true,
      );
    });

    it("does not change the Structure score when a root README is present", async () => {
      const cleanDir = skillDir("score-clean");
      await writeSkillMd(cleanDir, HIGH_QUALITY_SKILL);
      const clean = await evaluateSkill(cleanDir);

      const offendingDir = skillDir("score-root-readme");
      await writeSkillMd(offendingDir, HIGH_QUALITY_SKILL);
      await writeSkillMd(offendingDir, "# Root readme\n", "README.md");
      const offending = await evaluateSkill(offendingDir);

      const cleanStructure = clean.categories.find(
        (c) => c.id === "structure",
      )!;
      const offendingStructure = offending.categories.find(
        (c) => c.id === "structure",
      )!;
      expect(offendingStructure.score).toBe(cleanStructure.score);
    });

    it("skips the rule when evaluating a direct SKILL.md file path", async () => {
      const dir = skillDir("direct-file");
      const skillMdPath = await writeSkillMd(dir, HIGH_QUALITY_SKILL);
      await writeSkillMd(dir, "# Root readme\n", "README.md");
      const report = await evaluateSkill(skillMdPath);
      expect(findReadmeFinding(report)).toBeUndefined();
    });
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

  it("adds author from gitAuthor option when absent", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\n---\n\nbody\n",
      { gitAuthor: "Jane Doe" },
    );
    expect(plan.newContent).toContain("author: Jane Doe");
    expect(plan.applied.some((a) => a.id === "add-missing-author")).toBe(true);
  });

  it("skips author when no gitAuthor is provided", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\n---\n\nbody\n",
    );
    expect(plan.skipped.some((s) => s.id === "add-missing-author")).toBe(true);
  });

  it("accepts legacy `creator:` as an alias and does not re-add author", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\ncreator: Legacy Author\n---\n\nbody\n",
      { gitAuthor: "Jane Doe" },
    );
    expect(plan.newContent).not.toContain("author: Jane Doe");
    expect(plan.applied.some((a) => a.id === "add-missing-author")).toBe(false);
  });

  it("accepts `metadata.author` as canonical", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nmetadata:\n  author: Jane Doe\n---\n\nbody\n",
      { gitAuthor: "Git Name" },
    );
    expect(plan.applied.some((a) => a.id === "add-missing-author")).toBe(false);
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
    expect(after).toContain("author: Alice");
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
    expect(r.report.frontmatter.author).toBe("Bob");
  });
});

describe("formatters", () => {
  it("formatReport contains key sections", () => {
    const report = evaluateSkillContentSync({
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
    const baseReport = evaluateSkillContentSync({
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
          id: "skill-best-practice",
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
    expect(text).toContain("skill-best-practice@1.0.0:  88/100  pass");
    // Quality categories appear exactly once
    const categoriesMatches = text.match(/Structure & completeness/g) ?? [];
    expect(categoriesMatches.length).toBe(1);
    // Without raw.checks, falls through to findings-only block
    expect(text).toContain("skill-best-practice@1.0.0 findings:");
    expect(text).toContain("[warning] Missing negative-trigger clause.");
  });

  it("formatReportJSON returns parseable JSON", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const parsed = JSON.parse(formatReportJSON(report));
    expect(parsed.overallScore).toBeGreaterThan(0);
    expect(Array.isArray(parsed.categories)).toBe(true);
  });

  it("buildEvalMachineData has the expected shape", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_QUALITY_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
    });
    const data = buildEvalMachineData(report);
    expect(data.overall_score).toBe(report.overallScore);
    expect(data.categories.length).toBe(10);
    expect(data.fix).toBeNull();
  });

  it("formatFixPreview summarises applied and skipped items", () => {
    const report = evaluateSkillContentSync({
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
    expect(r.skillDirs.map((d) => basename(d)).sort()).toEqual([
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
    expect(basename(r.skillDirs[0]) === "real").toBe(true);
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
    expect(r.map((d) => basename(d))).toEqual(["a", "b", "c"]);
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

  it("rejects on mapper error, waits for already-started blocked mappers, and does not start queued work", async () => {
    // Regression guard: runWithConcurrency must re-throw the original error
    // (not swallow it) and must not start queued work after the first
    // failure.  Already-started mappers that are blocked on external
    // synchronisation must still be awaited.
    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    // Three independent gates for deterministic synchronisation:
    //   progressGate  — released when the initial 3 workers have all started
    //   rejectionGate — triggers n=1 to throw (and signals the mapper to fail)
    //   inFlightGate  — releases the blocked n=2/n=3 mappers
    const progressGate = deferred();
    const rejectionGate = deferred();
    const inFlightGate = deferred();
    const started = new Set<number>();
    let startedCount = 0;

    const mapper = vi.fn(async (n: number): Promise<number> => {
      started.add(n);
      if (++startedCount === 3) {
        progressGate.resolve();
      }
      if (n === 1) {
        // Wait until the test triggers the rejection, then signal and throw.
        await rejectionGate.promise;
        throw new Error("boom from 1");
      }
      // n=2 and n=3 are blocked until the test releases them.
      await inFlightGate.promise;
      return n * 2;
    });

    const promise = runWithConcurrency([1, 2, 3, 4, 5], 3, mapper);

    // Settlement observer attached immediately so a rejection is captured
    // synchronously.  Using .then(onSuccess, onFailure) avoids creating a
    // new rejecting promise (unlike .finally) so the original promise can
    // still be asserted with expect(...).rejects.
    let settleObserved = false;
    let settleError: unknown = undefined;
    promise.then(
      () => {},
      (err) => {
        settleObserved = true;
        settleError = err;
      },
    );

    // Wait until all three initial workers have started.
    await progressGate.promise;

    // Trigger n=1's rejection.
    rejectionGate.resolve();

    // At this point n=2/n=3 are still blocked on inFlightGate and the
    // promise is unsettled.
    expect(started.size).toBe(3);
    expect(started).toEqual(new Set([1, 2, 3]));
    expect(settleObserved).toBe(false);

    // Release the blocked mappers.
    inFlightGate.resolve();

    // Workers n=2/n=3 complete; Promise.all(workers) settles; the function
    // re-throws the original error.  The settlement observer fires as a
    // microtask — flush until it has run.
    await inFlightGate.promise;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(settleObserved).toBe(true);
    expect(settleError).toBeInstanceOf(Error);
    expect((settleError as Error).message).toBe("boom from 1");

    // Only the initial batch of 3 started — no queued work after failure.
    expect(started.size).toBe(3);
    expect(started).toEqual(new Set([1, 2, 3]));

    // The original promise still rejects with the exact error.
    await expect(promise).rejects.toThrow("boom from 1");
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

// ─── License verification (issue #493) ──────────────────────────────────────

describe("license verification", () => {
  it("reports recognised license when SPDX id is in frontmatter", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing.\nlicense: MIT\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.score).toBeGreaterThanOrEqual(5);
    expect(lic.findings.some((f) => /SPDX recognised/i.test(f))).toBe(true);
  });

  it("reports unrecognised license when frontmatter id is not in SPDX", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing.\nlicense: Proprietary-1.0\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.score).toBeLessThan(5);
    expect(lic.findings.some((f) => /not in the SPDX/i.test(f))).toBe(true);
  });

  it("reports missing when no license field exists", () => {
    const report = evaluateSkillContentSync({
      content: "---\nname: x\ndescription: Do a thing.\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.score).toBe(0);
    expect(lic.findings.some((f) => /No license declared/i.test(f))).toBe(true);
  });

  it("reports recognised license with LICENSE file present", async () => {
    const dir = skillDir("license-file-skill");
    await writeSkillMd(
      dir,
      "---\nname: x\ndescription: Do a thing.\nlicense: Apache-2.0\n---\nbody\n",
    );
    await writeSkillMd(dir, "Apache License\n", "LICENSE");
    const report = await evaluateSkill(dir);
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.score).toBeGreaterThanOrEqual(8);
    expect(lic.findings.some((f) => /LICENSE file present/i.test(f))).toBe(
      true,
    );
  });

  it("scores Apache-2.0 as recognised", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing.\nlicense: Apache-2.0\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.findings.some((f) => /Apache-2.0/i.test(f))).toBe(true);
  });

  it("scores GPL-3.0-only as recognised", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: x\ndescription: Do a thing.\nlicense: GPL-3.0-only\n---\nbody\n",
      skillPath: "/virtual/x",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.findings.some((f) => /GPL-3.0-only/i.test(f))).toBe(true);
  });

  it("reports missing license in findings and suggestions", () => {
    const report = evaluateSkillContentSync({
      content:
        "---\nname: no-license\ndescription: Do a thing when asked.\n---\nbody text here\n",
      skillPath: "/virtual/no-license",
      skillMdPath: "/virtual/no-license/SKILL.md",
    });
    const lic = report.categories.find((c) => c.id === "license")!;
    expect(lic.score).toBe(0);
    expect(lic.findings.some((f) => /No license declared/i.test(f))).toBe(true);
    expect(lic.suggestions.some((s) => /license/i.test(s))).toBe(true);
  });
});

// ─── PII detection (issue #492) ─────────────────────────────────────────────

describe("PII detection (scorePII)", () => {
  it("detects email addresses in skill files", async () => {
    const dir = skillDir("pii-email");
    await writeSkillMd(
      dir,
      "---\nname: pii-email\ndescription: Test skill with PII.\n---\n# PII test\n\nContact us at user@example.com for support.\n",
      "SKILL.md",
    );
    await writeSkillMd(
      dir,
      "# fixtures\n\nAdmin email: admin@company.org\n",
      "fixtures.txt",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /email/i.test(f))).toBe(true);
    expect(pii.score).toBeLessThan(10);
  });

  it("detects SSN-like patterns", async () => {
    const dir = skillDir("pii-ssn");
    await writeSkillMd(
      dir,
      "---\nname: pii-ssn\ndescription: Test skill with SSN.\n---\n# SSN test\n\nExample SSN: 123-45-6789\n",
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /ssn/i.test(f))).toBe(true);
    expect(pii.score).toBeLessThan(10);
  });

  it("detects phone numbers", async () => {
    const dir = skillDir("pii-phone");
    await writeSkillMd(
      dir,
      "---\nname: pii-phone\ndescription: Test skill with phone.\n---\n# Phone test\n\nCall (555) 123-4567 for help.\n",
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /phone/i.test(f))).toBe(true);
    expect(pii.score).toBeLessThan(10);
  });

  it("reports no PII when skill is clean", async () => {
    const dir = skillDir("pii-clean");
    await writeSkillMd(
      dir,
      "---\nname: pii-clean\ndescription: A clean skill with no PII.\n---\n# Clean skill\n\n## Instructions\n1. Do the thing\n2. Verify the result\n",
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /No PII/i.test(f))).toBe(true);
    expect(pii.score).toBe(10);
  });

  it("skips frontmatter and code fences when scanning", async () => {
    const dir = skillDir("pii-fence");
    await writeSkillMd(
      dir,
      `---\nname: pii-fence\ndescription: Test skill.\nemail: skip@me.com\n---\n# PII fence test\n\nHere is an example:\n\n\`\`\`\nuser@test.com\n555-123-4567\n\`\`\`\n\nClean body text with no PII.\n`,
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    // Should NOT detect PII in frontmatter or code fences
    expect(pii.findings.some((f) => /email/i.test(f))).toBe(false);
    expect(pii.score).toBe(10);
  });

  it("scans subdirectories recursively", async () => {
    const dir = skillDir("pii-subdir");
    await writeSkillMd(
      dir,
      "---\nname: pii-subdir\ndescription: Test skill.\n---\n# Test\n",
      "SKILL.md",
    );
    await writeSkillMd(
      join(dir, "data"),
      "# Data\n\nContact: test@subdir.com\n",
      "data.txt",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    expect(pii.findings.some((f) => /email/i.test(f))).toBe(true);
  });

  it("classifies PII as warning — does not block", async () => {
    const dir = skillDir("pii-warning");
    await writeSkillMd(
      dir,
      "---\nname: pii-warning\ndescription: Test.\n---\n# Test\n\nEmail: test@example.com\n",
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const pii = report.categories.find((c) => c.id === "pii")!;
    // PII should have a suggestion to clean up
    expect(pii.suggestions.some((s) => /redact/i.test(s))).toBe(true);
    // Overall score should still be computed (not blocked)
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
  });
});

// ─── Script linting (issue #494) ────────────────────────────────────────────

describe("Script linting (scoreScriptLint)", () => {
  it("reports no scripts when none exist", async () => {
    const dir = skillDir("lint-no-scripts");
    await writeSkillMd(
      dir,
      "---\nname: lint-no-scripts\ndescription: No scripts.\n---\n# Test\n",
      "SKILL.md",
    );
    const report = await evaluateSkill(dir);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    expect(lint.findings.some((f) => /No bundled scripts/i.test(f))).toBe(true);
    expect(lint.score).toBe(10);
  });

  it("reports skipped when linter is unavailable", async () => {
    const dir = skillDir("lint-skipped");
    await writeSkillMd(
      dir,
      "---\nname: lint-skipped\ndescription: Test.\n---\n# Test\n",
      "SKILL.md",
    );
    // Create a .py file — python3 should be available on most systems
    // but if not, we should see "skipped" not a crash
    await writeSkillMd(
      dir,
      "#!/usr/bin/env python3\nprint('hello')\n",
      "helper.py",
    );
    const report = await evaluateSkill(dir);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    const hasSkipped = lint.findings.some((f) => /skipped/i.test(f));
    const hasLinted = lint.findings.some((f) => /Linted/i.test(f));
    // Either skipped or linted — just not a crash
    expect(hasSkipped || hasLinted).toBe(true);
  });

  it("detects Python syntax errors", async () => {
    const dir = skillDir("lint-py-error");
    await writeSkillMd(
      dir,
      "---\nname: lint-py-error\ndescription: Test.\n---\n# Test\n",
      "SKILL.md",
    );
    await writeSkillMd(
      dir,
      "def broken(\n    # Missing closing paren — syntax error\n",
      "broken.py",
    );
    const report = await evaluateSkill(dir);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    // Should either detect the error or report skipped
    const hasError = lint.findings.some((f) => /error/i.test(f));
    const hasSkipped = lint.findings.some((f) => /skipped/i.test(f));
    expect(hasError || hasSkipped).toBe(true);
  });

  it("reports clean when Python file has no syntax errors", async () => {
    const dir = skillDir("lint-py-clean");
    await writeSkillMd(
      dir,
      "---\nname: lint-py-clean\ndescription: Test.\n---\n# Test\n",
      "SKILL.md",
    );
    await writeSkillMd(
      dir,
      "#!/usr/bin/env python3\n\ndef hello():\n    print('hello')\n\nif __name__ == '__main__':\n    hello()\n",
      "hello.py",
    );
    const report = await evaluateSkill(dir);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    const hasClean = lint.findings.some((f) => /no issues/i.test(f));
    const hasSkipped = lint.findings.some((f) => /skipped/i.test(f));
    expect(hasClean || hasSkipped).toBe(true);
  });

  it("classifies lint findings consistently", async () => {
    const dir = skillDir("lint-classify");
    await writeSkillMd(
      dir,
      "---\nname: lint-classify\ndescription: Test.\n---\n# Test\n",
      "SKILL.md",
    );
    await writeSkillMd(
      dir,
      "def broken(\n",
      "broken.py",
    );
    const report = await evaluateSkill(dir);
    const lint = report.categories.find((c) => c.id === "script-lint")!;
    // Score should be less than perfect if errors found
    if (lint.findings.some((f) => /error/i.test(f))) {
      expect(lint.score).toBeLessThan(10);
    }
    // Should have suggestions to fix
    expect(lint.suggestions.some((s) => /lint/i.test(s))).toBe(true);
  });
});
