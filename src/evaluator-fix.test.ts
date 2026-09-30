import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  applyFix,
  buildFixPlan,
  detectGitAuthor,
  evaluateSkill,
  evaluateSkillContent,
  evaluateSkillContentSync,
  formatFixPreview,
  formatReport,
} from "./evaluator-fix";
import { ROOT_README_SUGGESTION } from "./evaluator-core";
import type { EvaluationReport } from "./evaluator-core";
import type { ProviderEvalReport } from "./eval/summary";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Issue #674 — sibling coverage for evaluator-fix.ts. evaluator.test.ts
// exercises the happy paths through the evaluator.ts facade; this file pins
// the failure branches: unreadable inputs, fixer edge cases, malformed
// provider payloads, and the detectGitAuthor fallbacks.

const runCommandMock = vi.hoisted(() => vi.fn());
const fsCtl = vi.hoisted(() => ({
  /** Absolute paths for which the mocked readdir must reject. */
  readdirFailures: new Set<string>(),
  realReaddir: null as unknown as (
    path: string,
    options?: unknown,
  ) => Promise<unknown>,
}));

vi.mock("./utils/spawn", () => ({
  runCommand: runCommandMock,
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  fsCtl.realReaddir = actual.readdir as typeof fsCtl.realReaddir;
  return {
    ...actual,
    readdir: (path: string, options?: unknown) => {
      if (fsCtl.readdirFailures.has(String(path))) {
        return Promise.reject(
          Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          }),
        );
      }
      return fsCtl.realReaddir(path, options);
    },
  };
});

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "eval-fix-test-"));
  runCommandMock.mockReset();
  // Default: any subprocess (e.g. a linter probe) exits cleanly.
  runCommandMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  fsCtl.readdirFailures.clear();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const HIGH_SKILL = `---
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

// Complete skill minus `author`, with a README at the root: structure scores
// 9/10 so it sorts first in the suggestion loop, and its suggestions are
// [add-author, ROOT_README_SUGGESTION] — the promoted README then hits the
// `includes` dedup guard instead of being pushed a second time.
const ALMOST_PERFECT_SKILL = `---
name: code-review
description: Review pull request diffs for code smells, style issues, and safety problems before merging.
version: 1.0.0
license: MIT
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

## Expected output

Emit a markdown report; verify every file appears once. The expected output
must fit within the agent's token budget for the context window.

## Edge cases

- Empty diffs: emit a short "no changes" note
- Binary files: skip and mention the filename in the report

## Safety

See \`references/safety.md\` for error handling rules.
Always confirm before writing. Never run destructive commands without a dry-run.
`;

const MID_SKILL = `---
name: mid-skill
description: Generate reports when asked to summarise things.
version: 1.0.0
license: MIT
---

# mid

## When to Use
- thing

## Instructions
1. do it
`;

async function writeSkillMd(dir: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const p = join(dir, "SKILL.md");
  await writeFile(p, content, "utf-8");
  return p;
}

function mkReport(
  overrides: Partial<EvaluationReport> & {
    providers?: ProviderEvalReport[];
  } = {},
): EvaluationReport & { providers?: ProviderEvalReport[] } {
  return {
    skillPath: "/virtual/x",
    skillMdPath: "/virtual/x/SKILL.md",
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    categories: [
      {
        id: "structure",
        name: "Structure & completeness",
        score: 9,
        max: 10,
        findings: [],
        suggestions: [],
      },
    ],
    overallScore: 90,
    grade: "A",
    topSuggestions: [],
    frontmatter: {},
    ...overrides,
  };
}

function mkProvider(
  overrides: Partial<ProviderEvalReport> = {},
): ProviderEvalReport {
  return {
    id: "extra-provider",
    version: "1.0.0",
    schemaVersion: 1,
    score: 42,
    passed: true,
    categories: [],
    findings: [],
    ...overrides,
  };
}

describe("evaluateSkillContent — grade boundaries and promotions", () => {
  const LICENSE_AT_ROOT = ["SKILL.md", "LICENSE"];

  it("grades a near-perfect skill A (async path)", async () => {
    const report = await evaluateSkillContent({
      content: HIGH_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: LICENSE_AT_ROOT,
    });
    expect(report.overallScore).toBeGreaterThanOrEqual(90);
    expect(report.grade).toBe("A");
  });

  it("grades a mid-range skill C (async path)", async () => {
    const report = await evaluateSkillContent({
      content: MID_SKILL,
      skillPath: "/virtual/mid-skill",
      skillMdPath: "/virtual/mid-skill/SKILL.md",
      rootEntries: LICENSE_AT_ROOT,
    });
    expect(report.overallScore).toBeGreaterThanOrEqual(65);
    expect(report.overallScore).toBeLessThan(80);
    expect(report.grade).toBe("C");
  });

  it("grades a weak-but-passing skill D (async path)", async () => {
    const report = await evaluateSkillContent({
      content: MID_SKILL,
      skillPath: "/virtual/mid-skill",
      skillMdPath: "/virtual/mid-skill/SKILL.md",
    });
    expect(report.overallScore).toBeGreaterThanOrEqual(50);
    expect(report.overallScore).toBeLessThan(65);
    expect(report.grade).toBe("D");
  });

  it("grades the same bands in the sync path", () => {
    const a = evaluateSkillContentSync({
      content: HIGH_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: LICENSE_AT_ROOT,
    });
    expect(a.grade).toBe("A");
    const c = evaluateSkillContentSync({
      content: MID_SKILL,
      skillPath: "/virtual/mid-skill",
      skillMdPath: "/virtual/mid-skill/SKILL.md",
      rootEntries: LICENSE_AT_ROOT,
    });
    expect(c.grade).toBe("C");
  });

  it("awards the naming bonus when the directory matches frontmatter name", async () => {
    const report = await evaluateSkillContent({
      content:
        "---\nname: my-skill\ndescription: Do a thing when triggered.\nversion: 1.0.0\n---\nbody\n",
      skillPath: "/virtual/my-skill",
      skillMdPath: "/virtual/my-skill/SKILL.md",
    });
    const naming = report.categories.find((c) => c.id === "naming")!;
    expect(naming.findings.some((f) => /Directory name matches/.test(f))).toBe(
      true,
    );
  });

  it("promotes the README-at-root suggestion once, ahead of score order", async () => {
    const report = await evaluateSkillContent({
      content: HIGH_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: ["SKILL.md", "README.md"],
    });
    expect(report.topSuggestions[0]).toBe(ROOT_README_SUGGESTION);
    // The dedup guard must keep it to a single entry even though the
    // structure category still carries the same suggestion.
    expect(
      report.topSuggestions.filter((s) => s === ROOT_README_SUGGESTION),
    ).toHaveLength(1);
  });

  it("promotes the README-at-root suggestion in the sync path too", () => {
    const report = evaluateSkillContentSync({
      content: HIGH_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: ["SKILL.md", "README.md"],
    });
    expect(report.topSuggestions[0]).toBe(ROOT_README_SUGGESTION);
  });

  it("deduplicates the promoted suggestion when structure is scored early", async () => {
    const report = await evaluateSkillContent({
      content: ALMOST_PERFECT_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: ["SKILL.md", "LICENSE", "README.md"],
    });
    expect(report.topSuggestions[0]).toBe(ROOT_README_SUGGESTION);
    expect(
      report.topSuggestions.filter((s) => s === ROOT_README_SUGGESTION),
    ).toHaveLength(1);
  });

  it("deduplicates the promoted suggestion in the sync path", () => {
    const report = evaluateSkillContentSync({
      content: ALMOST_PERFECT_SKILL,
      skillPath: "/virtual/code-review",
      skillMdPath: "/virtual/code-review/SKILL.md",
      rootEntries: ["SKILL.md", "LICENSE", "README.md"],
    });
    expect(
      report.topSuggestions.filter((s) => s === ROOT_README_SUGGESTION),
    ).toHaveLength(1);
  });
});

describe("evaluateSkill — filesystem error branches", () => {
  it("resolves a relative skill path against the cwd", async () => {
    await writeSkillMd(join(tempDir, "rel"), HIGH_SKILL);
    const prevCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const report = await evaluateSkill("rel");
      expect(report.skillPath).toBe(join(process.cwd(), "rel"));
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("keeps the full path as skillPath for a file not named SKILL.md", async () => {
    const dir = join(tempDir, "alt-file");
    await mkdir(dir, { recursive: true });
    const alt = join(dir, "OTHER.md");
    await writeFile(alt, HIGH_SKILL, "utf-8");

    const report = await evaluateSkill(alt);
    expect(report.skillPath).toBe(alt);
    expect(report.skillMdPath).toBe(alt);
  });

  it("rejects a path that is neither a file nor a directory", async () => {
    await expect(evaluateSkill("/dev/null")).rejects.toThrow(
      /not a directory or file/,
    );
  });

  it("still evaluates when the skill root cannot be readdir'd", async () => {
    const dir = join(tempDir, "unreadable-root");
    await writeSkillMd(dir, HIGH_SKILL);
    // A README sits at the root, but with readdir failing the evaluator
    // must degrade to "no rootEntries" instead of crashing.
    await writeFile(join(dir, "README.md"), "# readme\n", "utf-8");
    fsCtl.readdirFailures.add(dir);

    const report = await evaluateSkill(dir);
    expect(report.skillPath).toBe(dir);
    const structure = report.categories.find((c) => c.id === "structure")!;
    expect(structure.findings.some((f) => /skill root/i.test(f))).toBe(false);
    expect(report.topSuggestions).not.toContain(ROOT_README_SUGGESTION);
  });
});

describe("buildFixPlan — uncovered planner branches", () => {
  it("infers effort: high for bodies between 81 and 250 lines", () => {
    const body = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const plan = buildFixPlan(
      `---\nname: x\ndescription: do a thing\n---\n\n${body}\n`,
    );
    expect(plan.newContent).toContain("effort: high");
  });

  it("infers effort: max for bodies over 250 lines", () => {
    const body = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
    const plan = buildFixPlan(
      `---\nname: x\ndescription: do a thing\n---\n\n${body}\n`,
    );
    expect(plan.newContent).toContain("effort: max");
  });

  it("refuses to reorder frontmatter containing a non key-value line", () => {
    const plan = buildFixPlan(
      "---\nversion: 1.0.0\nname: x\n- a stray list line\ndescription: do a thing\n---\n\nbody\n",
    );
    expect(plan.applied.some((a) => a.id === "reorder-frontmatter")).toBe(
      false,
    );
    // The raw block is preserved verbatim — unsafe to touch.
    expect(plan.newContent).toContain("- a stray list line");
  });

  it("keeps a nested block intact when it contains a blank line", () => {
    const plan = buildFixPlan(
      "---\ncreator: Alice\nname: x\ndescription: do a thing\nversion: 1.0.0\nmetadata:\n  author: Jane\n\n  reviewer: Bob\n---\n\nbody\n",
    );
    // Simple keys reorder; the nested metadata block (blank line included)
    // stays verbatim at the end.
    expect(plan.newContent.indexOf("name: x")).toBeLessThan(
      plan.newContent.indexOf("description:"),
    );
    expect(plan.newContent).toContain(
      "metadata:\n  author: Jane\n\n  reviewer: Bob",
    );
  });

  it("keeps original order between two non-canonical keys when reordering", () => {
    const plan = buildFixPlan(
      "---\nzzz-custom: 1\naaa-custom: 2\nname: x\ndescription: do a thing\nversion: 1.0.0\n---\n\nbody\n",
    );
    expect(plan.applied.some((a) => a.id === "reorder-frontmatter")).toBe(true);
    const out = plan.newContent;
    // Canonical keys move first; unknown keys keep their relative order.
    expect(out.indexOf("name: x")).toBeLessThan(out.indexOf("zzz-custom"));
    expect(out.indexOf("zzz-custom")).toBeLessThan(out.indexOf("aaa-custom"));
  });

  it("appends a trailing newline when the fixed content lacks one", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 1.0.0\n---\n\nbody without newline",
    );
    expect(plan.newContent.endsWith("\n")).toBe(true);
  });

  it("does not duplicate an `effort:` line whose value is empty", () => {
    // fm.effort is falsy so the planner tries to infer one, but the raw
    // block already has an `effort:` key — appendFrontmatterKey must bail.
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 1.0.0\neffort:\n---\n\nbody\n",
    );
    expect(plan.newContent.match(/^effort:/gm)).toHaveLength(1);
  });

  it("treats metadata.version as a declared version", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nmetadata:\n  version: 2.0.0\n---\n\nbody\n",
    );
    expect(plan.applied.some((a) => a.id === "add-missing-version")).toBe(
      false,
    );
  });

  it("treats metadata.creator as a declared authorship", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 1.0.0\nmetadata:\n  creator: Jane Doe\n---\n\nbody\n",
      { gitAuthor: "Git Name" },
    );
    expect(plan.applied.some((a) => a.id === "add-missing-author")).toBe(false);
  });

  it("quotes an author value containing YAML-special characters", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 1.0.0\n---\n\nbody\n",
      { gitAuthor: "Jane: Doe" },
    );
    expect(plan.newContent).toContain('author: "Jane: Doe"');
  });

  it("skips the author fix when gitAuthor is only whitespace", () => {
    const plan = buildFixPlan(
      "---\nname: x\ndescription: do a thing\nversion: 1.0.0\n---\n\nbody\n",
      { gitAuthor: "   " },
    );
    expect(plan.skipped.some((s) => s.id === "add-missing-author")).toBe(true);
  });
});

describe("applyFix — error branches", () => {
  it("rejects when the skill path does not exist", async () => {
    await expect(
      applyFix(join(tempDir, "missing"), { dryRun: true }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects a path that is neither a file nor a directory", async () => {
    await expect(applyFix("/dev/null", { dryRun: true })).rejects.toThrow(
      /not a directory or file/,
    );
  });

  it("rejects when the directory has no SKILL.md", async () => {
    const dir = join(tempDir, "no-skillmd");
    await mkdir(dir, { recursive: true });
    await expect(applyFix(dir, { dryRun: true })).rejects.toThrow(
      /SKILL\.md not found at/,
    );
  });

  it("resolves a relative skill path against the cwd", async () => {
    await writeSkillMd(
      join(tempDir, "rel-fix"),
      "---\nname: rel-fix\ndescription: does a thing\n---\n\nbody\n",
    );
    const prevCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const r = await applyFix("rel-fix", { dryRun: true });
      expect(r.skillMdPath).toBe(join(process.cwd(), "rel-fix", "SKILL.md"));
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("accepts a direct SKILL.md file path and writes a .bak next to it", async () => {
    const dir = join(tempDir, "direct");
    const skillMd = await writeSkillMd(
      dir,
      "---\nname: direct\ndescription: does a thing\n---\n\nbody\n",
    );
    const r = await applyFix(skillMd, { dryRun: false, gitAuthor: "Al" });
    expect(r.backupPath).toBe(`${skillMd}.bak`);
    const backup = await readFile(r.backupPath!, "utf-8");
    expect(backup).toContain("name: direct");
    expect(backup).not.toContain("version:");
  });
});

describe("detectGitAuthor — git config fallbacks", () => {
  it("returns null when git exits non-zero", async () => {
    runCommandMock.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    expect(await detectGitAuthor()).toBeNull();
  });

  it("returns null when user.name is empty", async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: "   \n",
      stderr: "",
    });
    expect(await detectGitAuthor()).toBeNull();
  });

  it("returns null when git cannot be spawned", async () => {
    runCommandMock.mockRejectedValue(new Error("spawn git ENOENT"));
    expect(await detectGitAuthor()).toBeNull();
  });

  it("returns the trimmed user.name on success", async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 0,
      stdout: "  Jane Doe\n",
      stderr: "",
    });
    expect(await detectGitAuthor()).toBe("Jane Doe");
    expect(runCommandMock).toHaveBeenCalledWith([
      "git",
      "config",
      "--global",
      "--get",
      "user.name",
    ]);
  });
});

describe("formatReport — provider failure branches", () => {
  it("renders the clean-state line when there are no suggestions", () => {
    const text = formatReport(mkReport({ topSuggestions: [] }));
    expect(text).toContain("No suggestions — skill looks great.");
  });

  it("marks a failing provider verdict in the headline", () => {
    const text = formatReport(
      mkReport({
        providers: [
          mkProvider({ id: "quality", passed: true }),
          mkProvider({ id: "strict-lint", passed: false, score: 12 }),
        ],
      }),
    );
    expect(text).toContain("strict-lint@1.0.0:  12/100  fail");
  });

  it("omits the findings block for a provider with nothing to say", () => {
    const text = formatReport(
      mkReport({
        providers: [mkProvider({ findings: [] })],
      }),
    );
    expect(text).toContain("extra-provider@1.0.0:  42/100  pass");
    expect(text).not.toContain("extra-provider@1.0.0 findings:");
    expect(text).not.toContain("extra-provider@1.0.0 breakdown:");
  });

  it("falls back to findings when raw.checks is not an array", () => {
    const text = formatReport(
      mkReport({
        providers: [
          mkProvider({
            raw: { checks: "not-an-array" },
            findings: [{ severity: "error" as const, message: "lint blew up" }],
          }),
        ],
      }),
    );
    expect(text).toContain("extra-provider@1.0.0 findings:");
    expect(text).toContain("[error] lint blew up");
  });

  it("falls back to findings when a check entry is not an object", () => {
    const text = formatReport(
      mkReport({
        providers: [
          mkProvider({
            raw: { checks: [null, 42] },
            findings: [
              { severity: "warning" as const, message: "partial payload" },
            ],
          }),
        ],
      }),
    );
    expect(text).toContain("[warning] partial payload");
  });

  it("falls back to findings when a check entry has wrong field types", () => {
    const text = formatReport(
      mkReport({
        providers: [
          mkProvider({
            raw: {
              checks: [
                {
                  id: 7,
                  label: "bad id type",
                  passed: true,
                  severity: "error",
                  message: "m",
                },
              ],
            },
            findings: [
              { severity: "error" as const, message: "schema mismatch" },
            ],
          }),
        ],
      }),
    );
    expect(text).toContain("[error] schema mismatch");
  });

  it("renders the checks breakdown with pass/warning/error marks", () => {
    const text = formatReport(
      mkReport({
        providers: [
          mkProvider({
            raw: {
              checks: [
                {
                  id: "ok",
                  label: "passing check",
                  passed: true,
                  severity: "error",
                  message: "unused",
                },
                {
                  id: "warn",
                  label: "soft check",
                  passed: false,
                  severity: "warning",
                  message: "could be better",
                },
                {
                  id: "bad",
                  label: "hard check",
                  passed: false,
                  severity: "error",
                  message: "is broken",
                },
              ],
            },
          }),
        ],
      }),
    );
    expect(text).toContain("extra-provider@1.0.0 breakdown:");
    expect(text).toContain("√ passing check");
    expect(text).toContain("⚠ soft check");
    expect(text).toContain("[warning] could be better");
    expect(text).toContain("× hard check");
    expect(text).toContain("[error] is broken");
  });
});

describe("formatFixPreview — empty and partial results", () => {
  const base = mkReport();

  it("reports a clean skill when nothing applied and nothing skipped", () => {
    const preview = formatFixPreview({
      report: base,
      applied: [],
      skipped: [],
      diff: "",
      dryRun: false,
      backupPath: null,
      skillMdPath: "/virtual/x/SKILL.md",
    });
    expect(preview).toBe("No fixes needed — SKILL.md is already clean.");
  });

  it("uses 'Applied' wording and the Backup line for a real fix run", () => {
    const preview = formatFixPreview({
      report: base,
      applied: [{ id: "add-missing-version", description: "Add `version`." }],
      skipped: [],
      diff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1,1 +1,2 @@\n+version: 0.1.0",
      dryRun: false,
      backupPath: "/virtual/x/SKILL.md.bak",
      skillMdPath: "/virtual/x/SKILL.md",
    });
    expect(preview).toContain("Applied 1 fix(es):");
    expect(preview).not.toContain("Skipped");
    expect(preview).toContain("Diff:");
    expect(preview).toContain("+version: 0.1.0");
    expect(preview).toContain("Backup: /virtual/x/SKILL.md.bak");
  });

  it("renders only the skipped block when nothing was auto-fixable", () => {
    const preview = formatFixPreview({
      report: base,
      applied: [],
      skipped: [
        {
          id: "missing-description",
          description: "Missing `description` — left to the author.",
        },
      ],
      diff: "",
      dryRun: true,
      backupPath: null,
      skillMdPath: "/virtual/x/SKILL.md",
    });
    expect(preview).not.toContain("fix(es):");
    expect(preview).toContain("Skipped 1 issue(s) (not auto-fixable):");
    expect(preview).toContain("Missing `description`");
  });
});
