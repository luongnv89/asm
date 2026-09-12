import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  colorEvalScore,
  formatSkillDetail,
  formatSkillInspect,
} from "./formatter-detail";
import type { SkillInfo } from "./utils/types";

// Issue #674 — sibling coverage for formatter-detail.ts. formatter.test.ts
// exercises the renderers through the formatter.ts facade; this file pins the
// branches the facade tests never reach: the allowed-tools warning block,
// provider-keyed eval summary ordering/fallbacks, and the colour paths.

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path: "/home/user/.claude/skills/test-skill",
    originalPath: "~/.claude/skills/test-skill",
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/home/user/.claude/skills/test-skill",
    fileCount: 3,
    effort: undefined,
    ...overrides,
  };
}

function makeEvalSummary(
  overrides: Partial<NonNullable<SkillInfo["evalSummary"]>> = {},
): NonNullable<SkillInfo["evalSummary"]> {
  return {
    overallScore: 87,
    grade: "B",
    categories: [{ id: "structure", name: "Structure", score: 9, max: 10 }],
    evaluatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("formatSkillDetail — allowed tools and warnings", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("renders the risk warning for high-risk tools", async () => {
    const output = await formatSkillDetail(
      makeSkill({ allowedTools: ["Bash", "Read"] }),
    );
    expect(output).toContain("Allowed Tools:");
    expect(output).toContain("Bash");
    expect(output).toContain("! This skill can execute shell commands");
  });

  test("lists tools without a warning for low-risk tools", async () => {
    const output = await formatSkillDetail(
      makeSkill({ allowedTools: ["Read", "Grep"] }),
    );
    expect(output).toContain("Allowed Tools:");
    expect(output).toContain("Read");
    expect(output).not.toContain("This skill can");
  });

  test("falls back to countFiles and renders token count when set", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        fileCount: undefined,
        path: "/nonexistent/skill/dir",
        tokenCount: 512,
      }),
    );
    // countFiles swallows readdir failures → 0.
    expect(output).toContain("File Count: 0");
    expect(output).toContain("Est. Tokens: ~512 tokens");
  });

  test("renders the warnings block for skill warnings", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        warnings: [
          { category: "missing-version", message: "No version field" },
        ],
      }),
    );
    expect(output).toContain("Warnings:");
    expect(output).toContain("[missing-version] No version field");
  });
});

describe("formatSkillDetail — eval summary fallbacks", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("falls back to evalSummary when evalSummaries is an empty map", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        evalSummary: makeEvalSummary(),
        evalSummaries: {},
      }),
    );
    expect(output).toContain("Overall: 87 / 100");
  });

  test("omits the categories block when a summary has none", async () => {
    const output = await formatSkillDetail(
      makeSkill({ evalSummary: makeEvalSummary({ categories: [] }) }),
    );
    expect(output).toContain("Overall: 87 / 100");
    expect(output).not.toContain("Categories:");
  });

  test("omits the version suffix when evaluatedVersion is unset", async () => {
    const output = await formatSkillDetail(
      makeSkill({ evalSummary: makeEvalSummary() }),
    );
    expect(output).toContain("Evaluated: 2026-04-20T10:00:00.000Z");
    expect(output).not.toContain("— version");
  });

  test("orders provider summaries quality-first, then alphabetical", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        evalSummaries: {
          "zeta-provider": makeEvalSummary({
            providerId: "zeta-provider",
            providerVersion: "2.0.0",
          }),
          // Inserted last in the record but must sort first.
          quality: makeEvalSummary({
            providerId: "quality",
            providerVersion: "1.0.0",
          }),
          "alpha-provider": makeEvalSummary({
            providerId: "alpha-provider",
            providerVersion: "0.1.0",
          }),
        },
      }),
    );
    const q = output.indexOf("quality@1.0.0");
    const a = output.indexOf("alpha-provider@0.1.0");
    const z = output.indexOf("zeta-provider@2.0.0");
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThan(a);
    expect(a).toBeLessThan(z);
  });

  test("falls back to '?' for a provider id without a version", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        evalSummaries: {
          quality: makeEvalSummary({
            providerId: "quality",
            providerVersion: "1.0.0",
          }),
          other: makeEvalSummary({
            providerId: "unversioned",
            providerVersion: undefined,
          }),
        },
      }),
    );
    expect(output).toContain("unversioned@?");
  });

  test("sorts two provider-less summaries by their quality label", async () => {
    // Both entries lack providerId — the comparator's `?? "quality"`
    // fallback fires on both sides of the comparison.
    const output = await formatSkillDetail(
      makeSkill({
        evalSummaries: {
          second: makeEvalSummary({ overallScore: 50, grade: "D" }),
          first: makeEvalSummary({ overallScore: 90, grade: "A" }),
        },
      }),
    );
    expect(output.match(/quality: \d+ \/ 100/g)?.length).toBe(2);
  });

  test("labels a provider-less summary as quality in multi-provider mode", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        evalSummaries: {
          // No providerId/providerVersion → label "quality", version "?".
          bare: makeEvalSummary({ overallScore: 55, grade: "D" }),
          other: makeEvalSummary({
            providerId: "other",
            providerVersion: "3.0.0",
            overallScore: 99,
            grade: "A",
          }),
        },
      }),
    );
    expect(output).toContain("quality: 55 / 100  (D)");
    expect(output).toContain("other@3.0.0: 99 / 100  (A)");
    // Multi-provider mode prefixes the categories heading with the label.
    expect(output).toContain("Categories (quality):");
  });
});

describe("formatSkillInspect — shared-field branches", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  function makePair(refOverrides: Partial<SkillInfo>): SkillInfo[] {
    return [
      makeSkill(refOverrides),
      makeSkill({
        providerLabel: "Codex",
        provider: "codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
  }

  test("renders compatibility, effort and token count when set", async () => {
    const output = await formatSkillInspect(
      makePair({
        compatibility: "Claude Code >= 1.0",
        effort: "high",
        tokenCount: 2048,
      }),
    );
    expect(output).toContain("Compatibility: Claude Code >= 1.0");
    expect(output).toContain("Effort: high");
    expect(output).toContain("Est. Tokens: ~2k tokens");
  });

  test("falls back to countFiles when fileCount is unset", async () => {
    const output = await formatSkillInspect(
      makePair({ fileCount: undefined, path: "/nonexistent/skill/dir" }),
    );
    // countFiles swallows readdir failures → 0.
    expect(output).toContain("File Count: 0");
  });

  test("renders the multi-provider eval block for the reference skill", async () => {
    const output = await formatSkillInspect(
      makePair({
        evalSummaries: {
          quality: makeEvalSummary({
            providerId: "quality",
            providerVersion: "1.0.0",
            evaluatedVersion: "0.9.0",
          }),
          "best-practice": makeEvalSummary({
            providerId: "best-practice",
            providerVersion: "2.1.0",
            overallScore: 64,
            grade: "D",
          }),
        },
      }),
    );
    expect(output).toContain("quality@1.0.0: 87 / 100  (B)");
    expect(output).toContain("— version 0.9.0");
    expect(output).toContain("best-practice@2.1.0: 64 / 100  (D)");
    expect(output).toContain("Structure");
  });

  test("renders a single eval summary without provider prefix", async () => {
    const output = await formatSkillInspect(
      makePair({ evalSummary: makeEvalSummary({ categories: [] }) }),
    );
    expect(output).toContain("Overall: 87 / 100  (B)");
    expect(output).not.toContain("quality@");
  });

  test("renders the empty-eval state when no summary exists", async () => {
    const output = await formatSkillInspect(makePair({}));
    expect(output).toContain("Not available — run `asm eval");
  });

  test("falls back to '?' for an eval summary without providerVersion", async () => {
    const output = await formatSkillInspect(
      makePair({
        evalSummaries: {
          quality: makeEvalSummary({ providerId: "quality" }),
          other: makeEvalSummary({ providerId: "unversioned" }),
        },
      }),
    );
    expect(output).toContain("quality@?");
    expect(output).toContain("unversioned@?");
  });

  test("renders the allowed-tools block and warning for the reference skill", async () => {
    const output = await formatSkillInspect(
      makePair({ allowedTools: ["Bash", "Write"] }),
    );
    expect(output).toContain("Allowed Tools:");
    expect(output).toContain(
      "! This skill can execute shell commands and modify files",
    );
  });

  test("lists allowed tools without a warning for low-risk tools", async () => {
    const output = await formatSkillInspect(
      makePair({ allowedTools: ["Read", "Grep"] }),
    );
    expect(output).toContain("Allowed Tools:");
    expect(output).not.toContain("This skill can");
  });
});

describe("colourised output", () => {
  const origIsTTY = process.stdout.isTTY;
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
    if (origNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = origNoColor;
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  function forceColor(): void {
    delete process.env.NO_COLOR;
    delete (globalThis as any).__CLI_NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
  }

  test("formatSkillDetail emits ANSI escapes when colour is on", async () => {
    forceColor();
    const output = await formatSkillDetail(
      makeSkill({
        allowedTools: ["Bash"],
        warnings: [{ category: "empty-body", message: "No body" }],
        evalSummaries: {
          quality: makeEvalSummary({
            providerId: "quality",
            providerVersion: "1.0.0",
          }),
          other: makeEvalSummary({ providerId: "other" }),
        },
      }),
    );
    expect(output).toContain("\x1b[");
    // Colour on → the warning icon is wrapped, not a bare "!".
    expect(output).toContain("\x1b[33m!\x1b[0m");
    // Multi-provider categories heading is dimmed when coloured.
    expect(output).toContain("\x1b[2m");
  });

  test("formatSkillDetail dims the single-provider categories heading", async () => {
    forceColor();
    const output = await formatSkillDetail(
      makeSkill({ evalSummary: makeEvalSummary() }),
    );
    expect(output).toContain("\x1b[2m  Categories:");
  });

  test("formatSkillDetail dims the empty-eval hint when colour is on", async () => {
    forceColor();
    const output = await formatSkillDetail(makeSkill());
    expect(output).toContain("\x1b[2m");
    expect(output).toContain("Not available");
  });

  test("formatSkillInspect emits ANSI escapes when colour is on", async () => {
    forceColor();
    const output = await formatSkillInspect([
      makeSkill({
        allowedTools: ["Write"],
        warnings: [{ category: "empty-body", message: "No body" }],
        evalSummary: makeEvalSummary(),
      }),
      makeSkill({
        providerLabel: "Codex",
        provider: "codex",
        path: "/home/user/.codex/skills/test-skill",
        isSymlink: true,
        symlinkTarget: "/opt/target",
        warnings: [{ category: "missing-version", message: "No version" }],
      }),
    ]);
    expect(output).toContain("\x1b[");
    expect(output).toContain("\x1b[34;1m"); // blueBold title
    // Aggregated warnings render with the yellow icon when coloured.
    expect(output).toContain("\x1b[33m!\x1b[0m");
    // The eval block's "Evaluated:" label is dimmed when coloured.
    expect(output).toContain("\x1b[2mEvaluated:");

    // A reference skill with no eval gets the dimmed hint instead.
    const noEval = await formatSkillInspect([makeSkill(), makeSkill()]);
    expect(noEval).toContain("Not available");
    expect(noEval).toContain("\x1b[2m");
  });

  test("colorEvalScore tiers map to green/cyan/yellow/red", () => {
    forceColor();
    expect(colorEvalScore(95)).toBe("\x1b[32m95\x1b[0m");
    expect(colorEvalScore(85)).toBe("\x1b[36m85\x1b[0m");
    expect(colorEvalScore(70)).toBe("\x1b[33m70\x1b[0m");
    expect(colorEvalScore(40)).toBe("\x1b[31m40\x1b[0m");
  });

  test("colorEvalScore returns the bare number when colour is off", () => {
    // Force the no-colour path explicitly so the assertion is TTY-agnostic.
    (globalThis as any).__CLI_NO_COLOR = true;
    expect(colorEvalScore(95)).toBe("95");
  });
});
