import { describe, test, expect } from "bun:test";
import { join, resolve } from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";

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

// ─── chunk files ────────────────────────────────────────────────────────────

describe("build: chunk files present", () => {
  test("dist/ contains chunk files from code splitting", () => {
    const chunks = readdirSync(DIST).filter(
      (f) => f.startsWith("chunk-") && f.endsWith(".js"),
    );
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
