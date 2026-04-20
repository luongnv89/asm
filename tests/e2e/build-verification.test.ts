import { describe, test, expect } from "bun:test";
import { join, resolve } from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";

const WEBSITE_DIR = resolve(import.meta.dir, "..", "..", "website");

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist");
const ENTRY = join(DIST, "agent-skill-manager.js");
const DATA_DIR = join(ROOT, "data", "skill-index");

// ─── dist entry point ───────────────────────────────────────────────────────

describe("build: dist entry point", () => {
  test("dist/agent-skill-manager.js exists", () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  test("first line is a node shebang", () => {
    const first = readFileSync(ENTRY, "utf-8").split("\n")[0];
    expect(first).toBe("#!/usr/bin/env node");
  });

  test("file size is reasonable (10 KB – 5 MB)", () => {
    const size = statSync(ENTRY).size;
    expect(size).toBeGreaterThan(10_000);
    expect(size).toBeLessThan(5_000_000);
  });
});

// ─── bun:ffi regression (issue #35) ─────────────────────────────────────────

describe("build: no bun:ffi leak (issue #35 regression)", () => {
  test('no dist file contains a literal "bun:ffi" import', () => {
    const files = readdirSync(DIST).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const content = readFileSync(join(DIST, file), "utf-8");
      // The stub replaces bun:ffi at build time. If the literal protocol
      // string leaks through, Node.js will throw ERR_UNSUPPORTED_ESM_URL_SCHEME.
      const hasBunFfi =
        content.includes('from "bun:ffi"') ||
        content.includes("from 'bun:ffi'") ||
        content.includes('require("bun:ffi")');
      expect(hasBunFfi).toBe(false);
    }
  });
});

// ─── data directory ─────────────────────────────────────────────────────────

describe("build: data/skill-index shipped", () => {
  test("data/skill-index/ directory exists", () => {
    expect(existsSync(DATA_DIR)).toBe(true);
  });

  test("data/skill-index/ contains at least one JSON file", () => {
    const jsons = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    expect(jsons.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── website: best practices page ──────────────────────────────────────────

describe("website: best practices page", () => {
  const html = readFileSync(join(WEBSITE_DIR, "index.html"), "utf-8");

  test("website/index.html contains the best-practices page element", () => {
    expect(html).toContain('id="page-best-practices"');
  });

  test("renderBestPracticesPage function is defined", () => {
    expect(html).toContain("function renderBestPracticesPage()");
  });

  test("navigateTo('best-practices') is wired in the nav", () => {
    expect(html).toContain("navigateTo('best-practices')");
  });

  test("best practices page includes key content sections", () => {
    expect(html).toContain("Best Practices for Creating Agent Skills");
    expect(html).toContain("Key Principles");
    expect(html).toContain("Official Anthropic Resources");
    expect(html).toContain("Community Guides");
  });
});

// ─── chunk files ────────────────────────────────────────────────────────────

describe("build: chunk files present", () => {
  test("dist/ contains chunk files from code splitting", () => {
    const chunks = readdirSync(DIST).filter(
      (f) => f.startsWith("chunk-") && f.endsWith(".js"),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── token count + eval enrichment (issues #188 + #187) ────────────────────

describe("data/skill-index: token count + eval enrichment", () => {
  test("at least one indexed skill has tokenCount", () => {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    let foundTokenCount = false;
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));
      for (const skill of data.skills || []) {
        if (typeof skill.tokenCount === "number" && skill.tokenCount > 0) {
          foundTokenCount = true;
          break;
        }
      }
      if (foundTokenCount) break;
    }
    expect(foundTokenCount).toBe(true);
  });

  test("at least one indexed skill has evalSummary with required fields", () => {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    let foundEvalSummary = false;
    let exampleSummary: any = null;
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));
      for (const skill of data.skills || []) {
        if (skill.evalSummary) {
          foundEvalSummary = true;
          exampleSummary = skill.evalSummary;
          break;
        }
      }
      if (foundEvalSummary) break;
    }
    expect(foundEvalSummary).toBe(true);
    expect(typeof exampleSummary.overallScore).toBe("number");
    expect(["A", "B", "C", "D", "F"].includes(exampleSummary.grade)).toBe(true);
    expect(Array.isArray(exampleSummary.categories)).toBe(true);
    expect(exampleSummary.categories.length).toBeGreaterThan(0);
    expect(typeof exampleSummary.evaluatedAt).toBe("string");
  });

  test("evalSummary categories are slim — no findings/suggestions in payload", () => {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));
      for (const skill of data.skills || []) {
        if (!skill.evalSummary) continue;
        for (const c of skill.evalSummary.categories) {
          // The slim shape only includes id/name/score/max — keep it that way
          // so the catalog payload doesn't bloat to ~MBs.
          expect(c.findings).toBeUndefined();
          expect(c.suggestions).toBeUndefined();
        }
      }
    }
  });
});

// ─── website surfaces token count + eval (issues #188 + #187) ──────────────

describe("website: token count + eval surfaces", () => {
  const html = readFileSync(join(WEBSITE_DIR, "index.html"), "utf-8");

  test("renderCard reads tokenCount and renders the badge", () => {
    expect(html).toContain("formatTokens");
    expect(html).toContain("badge-tokens");
    expect(html).toContain("s.tokenCount");
  });

  test("renderCard reads evalSummary and renders the eval badge", () => {
    expect(html).toContain("badge-eval");
    expect(html).toContain("s.evalSummary");
    expect(html).toContain("evalScoreClass");
  });

  test("modal renders an eval section with empty-state fallback", () => {
    expect(html).toContain("modal-eval");
    expect(html).toContain("modal-eval-header");
    expect(html).toContain("eval-empty");
    // Always rendered even when there is no data — see issue #187 acceptance criteria
    expect(html).toContain("No <code>asm eval</code> data is available");
  });

  test("modal exposes Est. Tokens row when tokenCount is present", () => {
    expect(html).toContain("Est. Tokens");
  });

  test("formatTokens always prefixes its output with `~` (approximation)", () => {
    expect(html).toMatch(/return\s+'~'\s*\+\s*count\s*\+\s*' tokens'/);
  });
});
