/**
 * Quality provider — v1.
 *
 * Thin adapter over `src/evaluator.ts`. Proves the `EvalProvider` contract
 * from PR 1 (#155) fits the existing static SKILL.md linter without
 * modifying the evaluator itself. If this adapter needs ugly workarounds,
 * the contract — not the evaluator — is what has to change.
 *
 * Mapping (EvaluationReport → EvalResult), per the issue body and
 * docs/SKILLGRADE_INTEGRATION_PLAN.md §4 PR 2:
 *
 *   - overallScore            → score
 *   - grade !== "F"           → passed
 *   - categories              → categories (1:1, id/name/score/max)
 *   - topSuggestions          → findings with severity "info"
 *   - original report         → raw (stable per schemaVersion)
 *
 * Non-determinism note: the underlying `EvaluationReport` contains
 * `evaluatedAt` (wall-clock) and the runner stamps `startedAt` /
 * `durationMs` on the returned `EvalResult`. Snapshot tests strip these
 * before comparing against checked-in fixtures.
 */

import { stat } from "fs/promises";
import { evaluateSkill, type EvaluationReport } from "../../../../evaluator";
import type {
  ApplicableResult,
  EvalOpts,
  EvalProvider,
  EvalResult,
  Finding,
  SkillContext,
} from "../../../types";

/** Stable provider id used by registry.resolve("quality", "^1.0.0"). */
const PROVIDER_ID = "quality";

/** Provider semver. Bump on logic/feature releases of the adapter. */
const PROVIDER_VERSION = "1.0.0";

/** Result-shape version. Bump only on structural breaks to EvalResult. */
const SCHEMA_VERSION = 1;

/**
 * Map `topSuggestions: string[]` onto the flat `findings: Finding[]` array.
 *
 * Per the issue, every suggestion is surfaced as a `severity: "info"`
 * finding. Category-level detail stays inside `raw` for callers that want
 * the full evaluator report. Kept pure and tiny so snapshots are stable.
 */
function mapTopSuggestions(report: EvaluationReport): Finding[] {
  return report.topSuggestions.map<Finding>((message) => ({
    severity: "info",
    message,
  }));
}

/**
 * Map the evaluator's `CategoryResult[]` onto the contract's `CategoryResult[]`.
 *
 * Both shapes share `id`, `name`, `score`, `max` — we drop the evaluator's
 * free-form `findings: string[]` and `suggestions: string[]` intentionally.
 * Those live in `raw` so callers can still reach them without the adapter
 * inventing a string→Finding conversion the contract doesn't require.
 */
function mapCategories(report: EvaluationReport): EvalResult["categories"] {
  return report.categories.map((c) => ({
    id: c.id,
    name: c.name,
    score: c.score,
    max: c.max,
  }));
}

/**
 * Quality provider v1 — wraps `evaluateSkill()` from `src/evaluator.ts`.
 *
 * `applicable()` is a cheap filesystem stat: if `SKILL.md` doesn't exist
 * at `ctx.skillMdPath`, we bail with a reason the CLI can show. Everything
 * else (frontmatter validity, body length, etc.) is the evaluator's job
 * and shows up as findings/suggestions in the report.
 *
 * `run()` delegates to `evaluateSkill(ctx.skillPath)` and maps the
 * `EvaluationReport` onto an `EvalResult`. Errors thrown by the evaluator
 * (missing SKILL.md, unreadable path) bubble up to the runner, which
 * wraps them into an error-shaped result with a single `severity: "error"`
 * finding — consumers never need try/catch around `runner.runProvider()`.
 *
 * Note: `startedAt` / `durationMs` on the returned result are placeholders;
 * the runner overwrites them both. This keeps the provider oblivious to
 * timing and makes test scaffolding simpler.
 */
export const qualityProviderV1: EvalProvider = {
  id: PROVIDER_ID,
  version: PROVIDER_VERSION,
  schemaVersion: SCHEMA_VERSION,
  description: "Static linter for SKILL.md structure, description, and safety.",

  async applicable(ctx: SkillContext): Promise<ApplicableResult> {
    try {
      const s = await stat(ctx.skillMdPath);
      if (!s.isFile()) {
        return {
          ok: false,
          reason: `${ctx.skillMdPath} is not a file`,
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: `SKILL.md not found at ${ctx.skillMdPath}`,
      };
    }
  },

  async run(ctx: SkillContext, _opts: EvalOpts): Promise<EvalResult> {
    const report = await evaluateSkill(ctx.skillPath);
    return {
      providerId: PROVIDER_ID,
      providerVersion: PROVIDER_VERSION,
      schemaVersion: SCHEMA_VERSION,
      score: report.overallScore,
      passed: report.grade !== "F",
      categories: mapCategories(report),
      findings: mapTopSuggestions(report),
      raw: report,
      // Runner stamps these — the values here are intentionally placeholder.
      startedAt: "",
      durationMs: 0,
    };
  },
};

export default qualityProviderV1;
