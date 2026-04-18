/**
 * Snapshot tests for the quality provider adapter (PR 2, #156).
 *
 * Each corpus skill in `tests/fixtures/skills/` has a checked-in
 * `EvalResult` fixture in `./fixtures/<name>.json`. We run the provider
 * through `runProvider()` (same entry point the CLI will use in PR 3),
 * normalize away non-deterministic fields, and assert deep equality
 * against the fixture.
 *
 * Non-deterministic fields stripped before comparison:
 *   - `startedAt`, `durationMs`  — stamped by the runner on every call.
 *   - `raw.evaluatedAt`          — wall-clock set by `evaluateSkill()`.
 *   - `raw.skillPath`,
 *     `raw.skillMdPath`          — absolute paths depend on the
 *                                   developer's checkout; fixtures store
 *                                   a `__FIXTURE__/<name>` marker.
 *
 * Drift in fixtures is a review artifact — if the evaluator's scoring
 * changes, these snapshots flag it so reviewers can decide whether the
 * scoring change is intentional.
 */

import { describe, expect, it } from "bun:test";
import { join, resolve } from "path";
import { readFile, stat, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { qualityProviderV1 } from "./index";
import { runProvider } from "../../../runner";
import {
  list,
  resolve as resolveProvider,
  __resetForTests,
  register,
} from "../../../registry";
import type { EvalResult } from "../../../types";

// ─── Fixture corpus ─────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "../../../../..");
const CORPUS_DIR = join(REPO_ROOT, "tests/fixtures/skills");
const FIXTURES_DIR = join(__dirname, "fixtures");

/** Every skill name under `tests/fixtures/skills/` that has a snapshot. */
const CORPUS_SKILLS = ["well-formed", "missing-frontmatter"] as const;

// ─── Normalizers ────────────────────────────────────────────────────────────

/**
 * Remove runner-stamped timing fields so snapshots stay deterministic.
 * Returns a new object; the input is not mutated.
 */
function stripTimings(
  result: EvalResult,
): Omit<EvalResult, "startedAt" | "durationMs"> {
  // Destructure to a new object so snapshots don't care about timing jitter.
  const { startedAt: _s, durationMs: _d, ...stable } = result;
  return stable;
}

/**
 * Replace developer-specific absolute paths in `raw` with the same
 * `__FIXTURE__/<name>` marker the generator script used. Also strips the
 * wall-clock `evaluatedAt`. Everything else in `raw` is kept as-is so the
 * fixture captures the full evaluator report.
 */
function normalizeRaw(raw: unknown, name: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const report = raw as Record<string, unknown>;
  const { evaluatedAt: _a, ...rest } = report;
  return {
    ...rest,
    skillPath: `__FIXTURE__/${name}`,
    skillMdPath: `__FIXTURE__/${name}/SKILL.md`,
  };
}

async function loadFixture(name: string): Promise<unknown> {
  const path = join(FIXTURES_DIR, `${name}.json`);
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

// ─── Provider shape ─────────────────────────────────────────────────────────

describe("qualityProviderV1 — contract surface", () => {
  it("has id, version, schemaVersion, description", () => {
    expect(qualityProviderV1.id).toBe("quality");
    expect(qualityProviderV1.version).toBe("1.0.0");
    expect(qualityProviderV1.schemaVersion).toBe(1);
    expect(qualityProviderV1.description.length).toBeGreaterThan(0);
  });

  it("applicable() returns ok=true for a real SKILL.md", async () => {
    const skillPath = join(CORPUS_DIR, "well-formed");
    const skillMdPath = join(skillPath, "SKILL.md");
    const res = await qualityProviderV1.applicable(
      { skillPath, skillMdPath },
      {},
    );
    expect(res.ok).toBe(true);
  });

  it("applicable() returns ok=false with a reason when SKILL.md is missing", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "quality-applicable-"));
    const res = await qualityProviderV1.applicable(
      { skillPath: tmp, skillMdPath: join(tmp, "SKILL.md") },
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
  });
});

// ─── Snapshot tests ─────────────────────────────────────────────────────────

describe("qualityProviderV1 — snapshot tests per corpus skill", () => {
  for (const name of CORPUS_SKILLS) {
    it(`adapter output matches checked-in fixture for ${name}`, async () => {
      const skillPath = join(CORPUS_DIR, name);
      const skillMdPath = join(skillPath, "SKILL.md");

      // Sanity: fixture skill + snapshot JSON both exist on disk.
      await expect(stat(skillMdPath)).resolves.toBeTruthy();
      await expect(
        stat(join(FIXTURES_DIR, `${name}.json`)),
      ).resolves.toBeTruthy();

      const result = await runProvider(qualityProviderV1, {
        skillPath,
        skillMdPath,
      });

      const stable = stripTimings(result);
      const actual = { ...stable, raw: normalizeRaw(stable.raw, name) };
      const expected = (await loadFixture(name)) as typeof actual;

      expect(actual).toEqual(expected);
    });
  }
});

// ─── Registry integration ──────────────────────────────────────────────────

describe("qualityProviderV1 — registry integration", () => {
  it("resolves via registry.resolve('quality', '^1.0.0')", () => {
    __resetForTests();
    register(qualityProviderV1);
    const resolved = resolveProvider("quality", "^1.0.0");
    expect(resolved.id).toBe("quality");
    expect(resolved.version).toBe("1.0.0");
    expect(resolved.schemaVersion).toBe(1);
    // Confirm it's the same object instance (no copy-on-register).
    expect(resolved).toBe(qualityProviderV1);
  });

  it("is exactly one provider after fresh register", () => {
    __resetForTests();
    register(qualityProviderV1);
    expect(list()).toHaveLength(1);
  });
});

// ─── Mapping invariants ─────────────────────────────────────────────────────

describe("qualityProviderV1 — mapping invariants", () => {
  it("sets passed = true when grade is not F (well-formed)", async () => {
    const skillPath = join(CORPUS_DIR, "well-formed");
    const result = await runProvider(qualityProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
    expect(result.passed).toBe(true);
    // score is the same integer as the underlying report.overallScore
    const raw = result.raw as { overallScore: number; grade: string };
    expect(result.score).toBe(raw.overallScore);
    expect(raw.grade).not.toBe("F");
  });

  it("sets passed = false when grade is F (missing-frontmatter)", async () => {
    const skillPath = join(CORPUS_DIR, "missing-frontmatter");
    const result = await runProvider(qualityProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
    expect(result.passed).toBe(false);
    const raw = result.raw as { grade: string };
    expect(raw.grade).toBe("F");
  });

  it("maps topSuggestions to findings with severity 'info'", async () => {
    const skillPath = join(CORPUS_DIR, "missing-frontmatter");
    const result = await runProvider(qualityProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
    const raw = result.raw as { topSuggestions: string[] };
    expect(result.findings).toHaveLength(raw.topSuggestions.length);
    for (const f of result.findings) {
      expect(f.severity).toBe("info");
    }
    expect(result.findings.map((f) => f.message)).toEqual(raw.topSuggestions);
  });

  it("maps evaluator categories 1:1 by id", async () => {
    const skillPath = join(CORPUS_DIR, "well-formed");
    const result = await runProvider(qualityProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
    const raw = result.raw as { categories: { id: string }[] };
    expect(result.categories.map((c) => c.id)).toEqual(
      raw.categories.map((c) => c.id),
    );
    // Each adapter category exposes only the contract fields.
    for (const c of result.categories) {
      expect(Object.keys(c).sort()).toEqual(["id", "max", "name", "score"]);
    }
  });

  it("stamps providerId, providerVersion, schemaVersion correctly", async () => {
    const skillPath = join(CORPUS_DIR, "well-formed");
    const result = await runProvider(qualityProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
    expect(result.providerId).toBe("quality");
    expect(result.providerVersion).toBe("1.0.0");
    expect(result.schemaVersion).toBe(1);
  });
});
