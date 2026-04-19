/**
 * Type contracts for the `asm eval` provider framework.
 *
 * This module defines the public interface that every evaluation provider
 * implements. Providers are versioned on two independent axes:
 *
 *   - `version`       — semver; bumps freely on feature/fix releases and
 *                       participates in semver-range resolution via the
 *                       registry (e.g. `resolve("quality", "^1.0.0")`).
 *   - `schemaVersion` — integer; only bumps when the shape of `EvalResult`
 *                       (or its categories/findings) changes structurally.
 *                       Consumers key their parsers off this.
 *
 * This file carries zero behavior — it is a contract surface only.
 */

// ─── Core value objects ─────────────────────────────────────────────────────

/**
 * Severity of a Finding surfaced by a provider.
 *
 *  - `info`    — informational / suggestion (e.g. "consider renaming X").
 *  - `warning` — recommended to address but not failing.
 *  - `error`   — blocking failure (e.g. provider run threw, missing
 *                prerequisite, unrecoverable exit code).
 */
export type FindingSeverity = "info" | "warning" | "error";

/**
 * One actionable observation produced by a provider.
 *
 * Quality-style providers use `info` to emit improvement suggestions.
 * Runtime providers use `warning`/`error` for rubric failures or
 * environment problems (missing binary, non-zero exit).
 */
export interface Finding {
  /** Severity bucket — drives rendering and CI pass/fail aggregation. */
  severity: FindingSeverity;
  /** Human-readable message. Single line preferred; wrapping is done by UI. */
  message: string;
  /** Optional id of the category this finding belongs to. */
  categoryId?: string;
  /** Optional machine-readable code for tooling (e.g. "missing-frontmatter"). */
  code?: string;
}

/**
 * Per-category aggregate used by providers that partition their scoring.
 *
 * `score` and `max` are both integers. For providers that have no
 * meaningful category breakdown, emit a single synthetic category with
 * `id: "overall"`.
 */
export interface CategoryResult {
  /** Short, stable id for the category (e.g. "structure"). */
  id: string;
  /** Display name. */
  name: string;
  /** 0..max integer score. */
  score: number;
  /** Maximum attainable score for the category. */
  max: number;
  /** Optional per-category findings (positive or negative). */
  findings?: Finding[];
}

/**
 * Normalized result returned by `runner.runProvider()`.
 *
 * All scores are in `[0..100]` regardless of the provider's internal
 * scale, so aggregation can operate uniformly.
 */
export interface EvalResult {
  /** Provider id (same as `EvalProvider.id`). */
  providerId: string;
  /** Provider semver (same as `EvalProvider.version`). */
  providerVersion: string;
  /** Result shape version — bumped only on structural breaks. */
  schemaVersion: number;
  /** Normalized aggregate score in `[0..100]`. */
  score: number;
  /** Whether the skill passed the provider's threshold. */
  passed: boolean;
  /** Per-category breakdown (may be a single synthetic "overall" entry). */
  categories: CategoryResult[];
  /** Flat list of findings across all categories. */
  findings: Finding[];
  /** Provider-specific raw payload (opaque; stable per schemaVersion). */
  raw?: unknown;
  /** ISO-8601 timestamp of when `run()` started. */
  startedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

// ─── Runner inputs ──────────────────────────────────────────────────────────

/**
 * Context for a single provider invocation — "which skill am I evaluating?"
 *
 * Providers that do not need content on disk (e.g. a provider that only
 * inspects frontmatter) may ignore `skillMdPath` and re-read it themselves.
 */
export interface SkillContext {
  /** Absolute path to the skill directory. */
  skillPath: string;
  /** Absolute path to the skill's `SKILL.md`. */
  skillMdPath: string;
  /** Optional skill name (falls back to directory basename). */
  skillName?: string;
}

/**
 * Options that apply to a provider invocation.
 *
 * Individual providers pick out the fields they understand; unknown
 * fields are ignored. Keeping this a single flat bag avoids a cascade
 * of provider-specific option types leaking into the runner.
 */
export interface EvalOpts {
  /** Pass/fail threshold in 0..100. Providers may override internally. */
  threshold?: number;
  /** Hard timeout in milliseconds (runner enforces). */
  timeoutMs?: number;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
  /** Free-form provider-specific options. */
  [key: string]: unknown;
}

// ─── Provider contract ──────────────────────────────────────────────────────

/**
 * External prerequisite declaration.
 *
 * Providers that shell out to a binary declare the binary name and an
 * acceptable semver range so the runner/CLI can produce actionable
 * "install this version" messages when absent. Unused by the current
 * built-in provider set; kept as a contract for future providers.
 */
export interface ExternalRequirement {
  /** Binary name to look up on PATH. */
  binary?: string;
  /** Acceptable semver range (e.g. `^0.1.0`). */
  semverRange?: string;
  /** Install hint shown to users when missing. */
  installHint?: string;
}

/**
 * Outcome of `applicable()` — whether a provider can run against a context.
 *
 * A "no" result MUST include a `reason` the CLI can show to the user.
 */
export interface ApplicableResult {
  ok: boolean;
  reason?: string;
}

/**
 * Contract every evaluation provider implements.
 *
 * The framework resolves providers by `(id, semverRange)`, checks
 * `applicable()`, then calls `run()` via the runner so timing and
 * error normalization are consistent across providers.
 */
export interface EvalProvider {
  /** Stable provider id (e.g. `"quality"`). */
  id: string;
  /** Provider semver (drives `registry.resolve()` range matching). */
  version: string;
  /** Result-shape version; bump only on structural breaks. */
  schemaVersion: number;
  /** Short human description shown by `asm eval-providers list`. */
  description: string;
  /** Optional internal capabilities the provider requires. */
  requires?: string[];
  /** Optional external binary / version prerequisite. */
  externalRequires?: ExternalRequirement;

  /**
   * Quick feasibility check before running.
   *
   * Returns `{ ok: false, reason }` when the provider cannot execute
   * against this context (missing binary, version mismatch, missing
   * `eval.yaml`, etc.). Must be cheap — no long-running work here.
   */
  applicable(ctx: SkillContext, opts: EvalOpts): Promise<ApplicableResult>;

  /**
   * Evaluate the skill and return a normalized result.
   *
   * Providers SHOULD NOT catch their own errors — the runner wraps
   * thrown errors into an error-shaped `EvalResult` (severity: error)
   * so callers never need try/catch around `runner.runProvider`.
   */
  run(ctx: SkillContext, opts: EvalOpts): Promise<EvalResult>;
}
