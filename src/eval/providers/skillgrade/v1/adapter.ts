/**
 * Adapter: skillgrade JSON → `EvalResult` (shape from `src/eval/types.ts`).
 *
 * The adapter is a pure function. It takes a single parsed skillgrade
 * run-report (the `--json` output from `skillgrade run`) and returns a
 * normalized `EvalResult`. Nothing else in the provider should ever
 * manipulate skillgrade JSON directly — all shape knowledge lives here.
 *
 * Mapping rules (see `docs/SKILLGRADE_INTEGRATION_PLAN.md` §4 PR 4):
 *
 *   - `passRate`           → `score`       (scaled to 0..100 integer)
 *   - `passed` / threshold → `passed`      (if `passed` is explicitly
 *                                           present, it wins; otherwise we
 *                                           compute `passRate >= threshold`)
 *   - `tasks[]`            → `categories`  (one category per task — id,
 *                                           name derived from id, score
 *                                           from task.passRate × max,
 *                                           max = task.trials)
 *   - `tasks[].graders[]`  → `findings`    (per-grader; severity `warning`
 *                                           when failing, `info` when passing)
 *   - full input JSON      → `raw`
 *
 * The adapter never throws on shape drift — it degrades gracefully so a
 * slightly newer skillgrade can still be introspected. Missing fields
 * fall back to reasonable defaults (empty arrays, zero scores). Fixture
 * snapshot tests catch any drift that matters.
 */

import type { CategoryResult, EvalResult, Finding } from "../../../types";

// ─── Input shape (best-effort, permissive) ──────────────────────────────────

/**
 * A single grader output from skillgrade JSON.
 *
 * Skillgrade's grader shape varies by grader kind; we read a small
 * stable subset and carry the rest through in `raw`.
 */
export interface SkillgradeGrader {
  id?: string;
  passed?: boolean;
  message?: string;
  score?: number;
  [key: string]: unknown;
}

/**
 * A single task result from skillgrade JSON.
 */
export interface SkillgradeTask {
  id?: string;
  passed?: boolean;
  trials?: number;
  passing?: number;
  passRate?: number;
  graders?: SkillgradeGrader[];
  [key: string]: unknown;
}

/**
 * Top-level skillgrade run report. Fields not listed here are preserved
 * verbatim in `EvalResult.raw`.
 */
export interface SkillgradeReport {
  version?: string;
  skill?: string;
  preset?: string;
  threshold?: number;
  passRate?: number;
  passed?: boolean;
  tasks?: SkillgradeTask[];
  summary?: {
    totalTrials?: number;
    passingTrials?: number;
    durationMs?: number;
  };
  [key: string]: unknown;
}

/**
 * Inputs the adapter needs beyond the raw JSON: the provider identity
 * (so the caller controls id/version/schemaVersion) and the threshold
 * used for pass/fail resolution when the JSON omits `passed`.
 */
export interface AdaptInputs {
  providerId: string;
  providerVersion: string;
  schemaVersion: number;
  /** Threshold in 0..1 used for `passed` fallback computation. */
  thresholdFraction: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clamp an arbitrary number to `[0..100]` and round to a stable integer.
 * Used for both overall `score` and per-category `score`. Non-numeric
 * inputs degrade to 0 so shape drift can't break score arithmetic.
 */
function toPercentage(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const pct = Math.round(value * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/**
 * Humanize an id like `"weather-known-city"` into `"Weather Known City"`
 * for `CategoryResult.name`. Kept local so snapshots stay stable without
 * depending on an external casing library.
 */
function humanize(id: string): string {
  return id
    .split(/[-_]+/)
    .map((part) =>
      part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : "",
    )
    .join(" ");
}

/**
 * Map one skillgrade task to a `CategoryResult`.
 *
 * `score` / `max` are integers: when skillgrade reports both `passing`
 * and `trials`, we use them directly. Otherwise `passRate × 10` with
 * max 10 gives a usable category breakdown for UIs.
 */
function taskToCategory(task: SkillgradeTask, index: number): CategoryResult {
  const id =
    typeof task.id === "string" && task.id.length > 0
      ? task.id
      : `task-${index + 1}`;
  const name = humanize(id);
  if (
    typeof task.passing === "number" &&
    typeof task.trials === "number" &&
    task.trials > 0
  ) {
    return {
      id,
      name,
      score: Math.max(0, Math.min(task.passing, task.trials)),
      max: task.trials,
    };
  }
  const passRate = typeof task.passRate === "number" ? task.passRate : 0;
  return {
    id,
    name,
    score: Math.max(0, Math.min(10, Math.round(passRate * 10))),
    max: 10,
  };
}

/**
 * Map graders across all tasks to `Finding[]`.
 *
 * Severity rules:
 *   - Passing grader  → severity `info` (still surfaced so users see
 *                       what skillgrade checked successfully).
 *   - Failing grader  → severity `warning` (the overall `passed` flag
 *                       already captures whether the run was a fail).
 *
 * Tasks with no graders contribute one synthetic finding summarizing
 * the task's own pass/fail so UIs always have something to show.
 */
function graderFindings(tasks: SkillgradeTask[]): Finding[] {
  const out: Finding[] = [];
  for (const task of tasks) {
    const categoryId = typeof task.id === "string" ? task.id : undefined;
    const graders = Array.isArray(task.graders) ? task.graders : [];
    if (graders.length === 0) {
      out.push({
        severity: task.passed === false ? "warning" : "info",
        message: `task ${categoryId ?? "(unnamed)"} ${
          task.passed === false ? "failed" : "passed"
        }`,
        categoryId,
      });
      continue;
    }
    for (const g of graders) {
      const message =
        typeof g.message === "string" && g.message.length > 0
          ? g.message
          : `grader ${g.id ?? "(unnamed)"} ${g.passed ? "passed" : "failed"}`;
      out.push({
        severity: g.passed === false ? "warning" : "info",
        message,
        categoryId,
        code: typeof g.id === "string" ? `grader:${g.id}` : undefined,
      });
    }
  }
  return out;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Convert a parsed skillgrade run-report into an `EvalResult`.
 *
 * Contract:
 *   - Never throws on malformed shape — missing fields fall back to
 *     safe defaults so fixture drift doesn't crash the CLI.
 *   - `raw` is the input report by reference; callers pass already-parsed
 *     JSON so the adapter does not own string handling.
 *   - Timing fields (`startedAt`, `durationMs`) are placeholders; the
 *     runner stamps them. Keeping this file unaware of wall clock makes
 *     snapshot testing trivial.
 */
export function adaptSkillgradeReport(
  report: SkillgradeReport | unknown,
  inputs: AdaptInputs,
): EvalResult {
  // Defensive unwrap: accept any parsed JSON, coerce to report-shape.
  const safe: SkillgradeReport =
    report && typeof report === "object" ? (report as SkillgradeReport) : {};

  const tasks = Array.isArray(safe.tasks) ? safe.tasks : [];
  const categories = tasks.map(taskToCategory);
  const findings = graderFindings(tasks);

  const score = toPercentage(safe.passRate);

  // `passed` resolution: explicit flag wins; otherwise threshold compare.
  // skillgrade historically emits `passed` but we belt-and-brace so a
  // newer build that drops it still yields a deterministic result.
  let passed: boolean;
  if (typeof safe.passed === "boolean") {
    passed = safe.passed;
  } else if (typeof safe.passRate === "number") {
    passed = safe.passRate >= inputs.thresholdFraction;
  } else {
    passed = false;
  }

  return {
    providerId: inputs.providerId,
    providerVersion: inputs.providerVersion,
    schemaVersion: inputs.schemaVersion,
    score,
    passed,
    categories,
    findings,
    raw: safe,
    startedAt: "",
    durationMs: 0,
  };
}
