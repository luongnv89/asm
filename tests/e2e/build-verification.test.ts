import { fileURLToPath } from "url";
import { describe, test, expect } from "vitest";
import { join, resolve, dirname } from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { MINISEARCH_OPTIONS } from "../../scripts/minisearch-options";

const WEBSITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "website");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
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

// ─── catalog dedup preserves distinct install paths (issue #201) ───────────

const CATALOG_PATH = join(WEBSITE_DIR, "catalog.json");
const catalogExists = existsSync(CATALOG_PATH);

describe("catalog: preserves all distinct install targets (issue #201)", () => {
  if (!catalogExists) {
    test.skip("catalog.json not present — run `bun scripts/build-catalog.ts` to generate it", () => {});
    return;
  }
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));

  test("catalog.totalSkills equals catalog.skills.length", () => {
    expect(catalog.totalSkills).toBe(catalog.skills.length);
  });

  test("every catalog skill has a unique installUrl", () => {
    const urls = catalog.skills.map(
      (s: { installUrl: string }) => s.installUrl,
    );
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("every repo's skillCount matches the number of catalog skills for that repo", () => {
    const countsByRepo: Record<string, number> = {};
    for (const s of catalog.skills) {
      const key = `${s.owner}/${s.repo}`;
      countsByRepo[key] = (countsByRepo[key] ?? 0) + 1;
    }
    for (const r of catalog.repos) {
      const key = `${r.owner}/${r.repo}`;
      expect(countsByRepo[key] ?? 0).toBe(r.skillCount);
    }
  });

  test("plugin-bundle repos with same skill name at multiple relPaths are all preserved", () => {
    // Find any repo that has multiple skills sharing a name (the pattern
    // that used to trigger the broken dedup).
    const skillsByRepoAndName: Record<string, number> = {};
    for (const s of catalog.skills) {
      const key = `${s.owner}/${s.repo}::${s.name}`;
      skillsByRepoAndName[key] = (skillsByRepoAndName[key] ?? 0) + 1;
    }
    const hasMultiNameRepo = Object.values(skillsByRepoAndName).some(
      (n) => n > 1,
    );
    // If no repo in the fixture ships a duplicated name, skip — the guard is
    // exercised in the uniqueness + count tests above.
    if (!hasMultiNameRepo) return;
    // Otherwise every entry survived with a distinct installUrl.
    const multiNameEntries = catalog.skills.filter(
      (s: { owner: string; repo: string; name: string }) =>
        skillsByRepoAndName[`${s.owner}/${s.repo}::${s.name}`] > 1,
    );
    const urls = multiNameEntries.map(
      (s: { installUrl: string }) => s.installUrl,
    );
    expect(new Set(urls).size).toBe(urls.length);
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
    // Keep this resilient to formatter-driven quote/line-wrap changes.
    expect(html).toMatch(
      /return\s+["']~["']\s*\+\s*count\s*\+\s*["'] tokens["']/,
    );
  });
});

// ─── split artifacts (issue #214) ──────────────────────────────────────────
// The build emits three browser-facing artifacts derived from catalog.json so
// the frontend can fetch only what it needs on page load. catalog.json stays
// the authoritative internal source (tests above still pass against it).

const SKILLS_MIN_PATH = join(WEBSITE_DIR, "skills.min.json");
const SEARCH_IDX_PATH = join(WEBSITE_DIR, "search.idx.json");
const SKILLS_DETAIL_DIR = join(WEBSITE_DIR, "skills");

describe("catalog: split artifacts (issue #214)", () => {
  if (!catalogExists || !existsSync(SKILLS_MIN_PATH)) {
    test.skip("split artifacts not present — run `bun scripts/build-catalog.ts` to generate them", () => {});
    return;
  }
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf-8"));
  const skillsMin = JSON.parse(readFileSync(SKILLS_MIN_PATH, "utf-8"));

  test("skills.min.json mirrors catalog totalSkills and top-level aggregates", () => {
    expect(skillsMin.totalSkills).toBe(catalog.totalSkills);
    expect(skillsMin.totalRepos).toBe(catalog.totalRepos);
    expect(skillsMin.categories).toEqual(catalog.categories);
    expect(skillsMin.skills.length).toBe(catalog.skills.length);
    expect(skillsMin.version).toBe(catalog.version);
  });

  test("every slim skill row carries the fields the card + filters need", () => {
    for (const s of skillsMin.skills) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.detailPath).toBe("string");
      expect(s.detailPath).toMatch(/^skills\/[0-9a-f]{16}\.json$/);
      expect(typeof s.name).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.owner).toBe("string");
      expect(typeof s.repo).toBe("string");
      expect(Array.isArray(s.categories)).toBe(true);
      expect(typeof s.installUrl).toBe("string");
      expect(typeof s.hasTools).toBe("boolean");
      expect(typeof s.verified).toBe("boolean");
    }
  });

  test("every detailPath resolves to an on-disk skill file", () => {
    for (const s of skillsMin.skills) {
      const p = join(WEBSITE_DIR, s.detailPath);
      expect(existsSync(p)).toBe(true);
    }
  });

  test("skills/ directory count matches catalog.skills.length", () => {
    const files = readdirSync(SKILLS_DETAIL_DIR).filter((f) =>
      f.endsWith(".json"),
    );
    expect(files.length).toBe(catalog.skills.length);
  });

  test("search.idx.json is a MiniSearch serialization with the expected shape", () => {
    const idx = JSON.parse(readFileSync(SEARCH_IDX_PATH, "utf-8"));
    expect(idx.documentCount).toBe(catalog.skills.length);
    expect(idx.serializationVersion).toBeDefined();
    // The build script uses numeric ids (row index in catalog.skills) to
    // shrink the index — guard that invariant because the frontend relies on
    // `catalog.skills[hit.id]` to map hits back to slim rows. Must be a
    // real number, not a string-of-digits.
    expect(typeof idx.documentIds).toBe("object");
    const firstKey = Object.keys(idx.documentIds)[0];
    expect(typeof idx.documentIds[firstKey]).toBe("number");
  });

  test("slim rows align 1:1 with catalog.skills by id + derived fields", () => {
    // Ordering must match because the search index uses array indices as
    // document IDs — if these ever diverge, `catalog.skills[hit.id]` maps
    // to the wrong slim row silently.
    for (let i = 0; i < catalog.skills.length; i++) {
      const full = catalog.skills[i];
      const slim = skillsMin.skills[i];
      expect(slim.id).toBe(full.id);
      expect(slim.name).toBe(full.name);
      expect(slim.owner).toBe(full.owner);
      expect(slim.repo).toBe(full.repo);
      expect(slim.hasTools).toBe(
        Array.isArray(full.allowedTools) && full.allowedTools.length > 0,
      );
      if (full.evalSummary) {
        expect(slim.evalSummary?.grade).toBe(full.evalSummary.grade);
        expect(slim.evalSummary?.overallScore).toBe(
          full.evalSummary.overallScore,
        );
      }
    }
  });

  test("MiniSearch options match between build script and frontend loader", () => {
    // Guard against silent scoring drift: if any option (fields, idField,
    // boost weights, fuzzy, prefix, storeFields) diverges between the
    // build-time serialization and the frontend's loadJSON call, relevance
    // ranking breaks without any thrown error. The build script imports
    // MINISEARCH_OPTIONS directly from scripts/minisearch-options.ts, so
    // we compare the frontend's inline copy against that canonical module.
    const html = readFileSync(join(WEBSITE_DIR, "index.html"), "utf-8");

    // Find the frontend options literal and slice its balanced-brace body.
    // A regex with `\[[^\]]*\]` would silently return null on multi-line
    // arrays and let the test pass vacuously, so we walk braces instead.
    const marker = "const MINISEARCH_OPTIONS = {";
    const start = html.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const braceStart = html.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(braceStart);
    const literal = html.slice(braceStart, end + 1);

    // The inline copy is JS (unquoted keys, single quotes, optional trailing
    // commas). Convert to strict JSON: double-quote keys, swap quote style,
    // strip trailing commas.
    const jsonLike = literal
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/'([^']*)'/g, '"$1"')
      .replace(/,(\s*[}\]])/g, "$1");
    const frontendOptions = JSON.parse(jsonLike);
    expect(frontendOptions).toEqual(MINISEARCH_OPTIONS);
  });

  test("search.idx.json deserializes and finds a known query (smoke test)", async () => {
    const idxText = readFileSync(SEARCH_IDX_PATH, "utf-8");
    // Import dynamically so the tests don't pay the load cost when the
    // artifact isn't present (already guarded above).
    const { default: MiniSearch } = await import("minisearch");
    const idx = MiniSearch.loadJSON(idxText, MINISEARCH_OPTIONS);
    const hits = idx.search("skill");
    expect(hits.length).toBeGreaterThan(0);
    expect(typeof hits[0].id).toBe("number");
    expect(catalog.skills[hits[0].id]).toBeDefined();
  });

  test("search.idx.json and skills.min.json share the same generatedAt", () => {
    // The frontend boot guard compares these two fields to detect CDN/cache
    // skew between artifacts — without matching generatedAt values the array-
    // index invariant (hit.id → catalog.skills[i]) silently misaligns.
    const idx = JSON.parse(readFileSync(SEARCH_IDX_PATH, "utf-8"));
    const slim = JSON.parse(readFileSync(SKILLS_MIN_PATH, "utf-8"));
    expect(typeof idx.generatedAt).toBe("string");
    expect(idx.generatedAt).toBe(slim.generatedAt);
  });

  test("skills.min.json is materially smaller than catalog.json (raw bytes)", () => {
    const catalogSize = statSync(CATALOG_PATH).size;
    const slimSize = statSync(SKILLS_MIN_PATH).size;
    // Conservative lower-bound check — the whole point of the split. If this
    // ever regresses, either the slim shape drifted or catalog.json shrunk
    // for other reasons; either way, worth looking at.
    expect(slimSize).toBeLessThan(catalogSize * 0.75);
  });
});

// ─── website loader swap (issue #214) ──────────────────────────────────────

describe("website: loader uses split artifacts (issue #214)", () => {
  const html = readFileSync(join(WEBSITE_DIR, "index.html"), "utf-8");

  test("boot fetches skills.min.json + search.idx.json in parallel", () => {
    // Assert the resources + Promise.all are present without coupling to
    // quote style or formatter line wrapping inside the HTML script block.
    expect(html).toMatch(/fetch\(["']skills\.min\.json["']\)/);
    expect(html).toMatch(/fetch\(["']search\.idx\.json["']\)/);
    expect(html).toContain("Promise.all");
  });

  test("boot no longer fetches catalog.json directly", () => {
    // The string "catalog.json" survives in gitignore comments etc., so
    // scope the check to a literal fetch call.
    expect(html).not.toContain("fetch('catalog.json')");
  });

  test("MiniSearch runtime is vendored (not CDN-loaded)", () => {
    expect(html).toContain('src="assets/minisearch.min.js"');
  });

  test("old linear scoreSkill / tokenize path is removed", () => {
    // The linear Array.filter + scoreSkill path was the thing being replaced.
    // If either name reappears we likely regressed into dual-path code.
    expect(html).not.toContain("function scoreSkill");
    expect(html).not.toContain("SCORE_NAME_EXACT");
  });

  test("openModal fetches the per-skill detail on demand", () => {
    expect(html).toContain("fetchSkillDetail");
    expect(html).toContain("detailPath");
    expect(html).toContain("detailCache");
  });
});
