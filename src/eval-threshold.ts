/**
 * Pass/fail quality gates for `asm eval` (issue #773).
 *
 *   --min-score N     (0–100) a skill fails when overallScore < N
 *   --min-category N  (0–10)  a skill fails when any category score < N
 *
 * Both bounds are inclusive ("at least N"), so the skill standard's Gate 2
 * (`overallScore > 85` AND every category >= 8) is
 * `--min-score 86 --min-category 8`.
 *
 * This module only judges an already-computed `EvaluationReport` and renders
 * the verdict; it never changes how a report is scored. When neither flag is
 * set, callers skip it entirely so the output stays byte-identical.
 */

import { ansi } from "./formatter";
import type { EvaluationReport } from "./evaluator-types";

export const MIN_SCORE_MAX = 100;
export const MIN_CATEGORY_MAX = 10;

export interface EvalThresholds {
  /** Inclusive floor for `overallScore` (0–100), or null when unset. */
  minScore: number | null;
  /** Inclusive floor for every category score (0–10), or null when unset. */
  minCategory: number | null;
}

export interface FailingCategory {
  id: string;
  name: string;
  score: number;
  max: number;
}

export interface ThresholdVerdict {
  passed: boolean;
  /** True when `--min-score` is set and `overallScore` is below it. */
  overallBelowMin: boolean;
  /** Categories scoring below `--min-category` (empty when unset or none). */
  failingCategories: FailingCategory[];
}

/** True when at least one threshold flag was given. */
export function hasThresholds(t: EvalThresholds): boolean {
  return t.minScore !== null || t.minCategory !== null;
}

/**
 * Parse a `--min-score` / `--min-category` value. Returns the number, or an
 * error message suitable for `Error: …` output. Plain decimals such as
 * `85` or `7.5` are accepted; empty, non-numeric (incl. hex/exponent forms),
 * and out-of-range values are not.
 */
export function parseThresholdValue(
  flag: "--min-score" | "--min-category",
  raw: string | undefined,
): { value: number } | { error: string } {
  const max = flag === "--min-score" ? MIN_SCORE_MAX : MIN_CATEGORY_MAX;
  const trimmed = raw?.trim() ?? "";
  // Plain decimals only: Number() alone would also accept "0x10" or "1e1".
  const n = /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > max) {
    const shown = raw === undefined ? "" : raw;
    return {
      error: `Invalid ${flag}: "${shown}". Must be a number between 0 and ${max}.`,
    };
  }
  return { value: n };
}

export function checkThresholds(
  report: EvaluationReport,
  t: EvalThresholds,
): ThresholdVerdict {
  const overallBelowMin =
    t.minScore !== null && report.overallScore < t.minScore;
  const failingCategories: FailingCategory[] =
    t.minCategory === null
      ? []
      : report.categories
          .filter((c) => c.score < (t.minCategory as number))
          .map((c) => ({ id: c.id, name: c.name, score: c.score, max: c.max }));
  return {
    passed: !overallBelowMin && failingCategories.length === 0,
    overallBelowMin,
    failingCategories,
  };
}

/** `min-score 86, min-category 8` — only the flags that were set. */
export function describeThresholds(t: EvalThresholds): string {
  const parts: string[] = [];
  if (t.minScore !== null) parts.push(`min-score ${t.minScore}`);
  if (t.minCategory !== null) parts.push(`min-category ${t.minCategory}`);
  return parts.join(", ");
}

/**
 * One-line verdict printed after a skill's report, e.g.
 *   Threshold:        PASS  (min-score 86, min-category 8)
 *   Threshold:        FAIL  overall 53/100 < 86; categories < 8: Testability (0/10)
 */
export function formatVerdictLine(
  report: EvaluationReport,
  verdict: ThresholdVerdict,
  t: EvalThresholds,
): string {
  const label = "Threshold:        ";
  if (verdict.passed) {
    return `${label}${ansi.green("PASS")}  ${ansi.dim(`(${describeThresholds(t)})`)}`;
  }
  const reasons: string[] = [];
  if (verdict.overallBelowMin) {
    reasons.push(`overall ${report.overallScore}/100 < ${t.minScore}`);
  }
  if (verdict.failingCategories.length > 0) {
    const cats = verdict.failingCategories
      .map((c) => `${c.name} (${c.score}/${c.max})`)
      .join(", ");
    reasons.push(`categories < ${t.minCategory}: ${cats}`);
  }
  return `${label}${ansi.red("FAIL")}  ${reasons.join("; ")}`;
}

export interface ThresholdCounts {
  /** Evaluated skills that met every threshold. */
  passed: number;
  /** Evaluated skills that missed at least one threshold. */
  failed: number;
  /** Labels of the failing skills, in result order. */
  failedLabels: string[];
}

/**
 * Count pass/fail across a batch. Skills whose evaluation errored have a null
 * verdict and are counted in neither bucket — they keep today's error
 * reporting (`Skills evaluated: x/y (n failed)`) and exit behaviour.
 */
export function countVerdicts(
  items: { label: string; verdict: ThresholdVerdict | null }[],
): ThresholdCounts {
  const counts: ThresholdCounts = { passed: 0, failed: 0, failedLabels: [] };
  for (const item of items) {
    if (!item.verdict) continue;
    if (item.verdict.passed) counts.passed++;
    else {
      counts.failed++;
      counts.failedLabels.push(item.label);
    }
  }
  return counts;
}

/** Lines appended to the batch summary footer. */
export function formatThresholdSummary(
  counts: ThresholdCounts,
  t: EvalThresholds,
): string {
  const judged = counts.passed + counts.failed;
  const lines = [
    `  Thresholds:            ${describeThresholds(t)}`,
    `  Passed:                ${counts.passed}/${judged}`,
    `  Failed:                ${counts.failed}/${judged}` +
      (counts.failed > 0 ? `  (${counts.failedLabels.join(", ")})` : ""),
  ];
  return lines.join("\n");
}

// ─── Structured output (additive fields only) ─────────────────────────────

/** camelCase shape for `--json`. */
export function thresholdsJSON(t: EvalThresholds) {
  return { minScore: t.minScore, minCategory: t.minCategory };
}

/** snake_case shape for the `--machine` v1 envelope. */
export function thresholdsMachine(t: EvalThresholds) {
  return { min_score: t.minScore, min_category: t.minCategory };
}

export function verdictMachine(v: ThresholdVerdict) {
  return {
    passed: v.passed,
    overall_below_min: v.overallBelowMin,
    failing_categories: v.failingCategories,
  };
}
