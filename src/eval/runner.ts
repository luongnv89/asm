/**
 * Runner for evaluation providers.
 *
 * The runner owns three cross-cutting concerns so individual providers
 * don't have to:
 *
 *   1. **Timing** — records `startedAt` (ISO-8601) and `durationMs` for
 *      every invocation, including ones that throw.
 *   2. **Error normalization** — any error thrown by the provider (or its
 *      unhandled rejections during `run()`) is converted into a populated
 *      `EvalResult` with `passed: false`, `score: 0`, and a single
 *      `Finding` of severity `error`. Callers of `runProvider` therefore
 *      never need try/catch around the call.
 *   3. **Timeout enforcement** — when `opts.timeoutMs` is set (or
 *      `opts.signal` is passed), the runner races the provider against
 *      a timeout and returns a timeout-shaped `EvalResult` on expiry.
 *
 * Providers that need to respect cancellation should read `opts.signal`
 * themselves (the runner exposes it directly); the timeout also fires
 * the same signal so well-behaved providers cancel in-flight work.
 */

import type {
  EvalOpts,
  EvalProvider,
  EvalResult,
  Finding,
  SkillContext,
} from "./types";

// ─── Error → Finding ────────────────────────────────────────────────────────

/**
 * Extract a human-readable message from an unknown thrown value.
 * Mirrors `Error.prototype.message` extraction but falls back to
 * `String(value)` for non-Error throws.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Build the error-shaped `EvalResult` used when a provider throws or
 * times out. Kept as a tiny helper so timing fields stay consistent.
 */
function buildErrorResult(
  provider: Pick<EvalProvider, "id" | "version" | "schemaVersion">,
  startedAt: string,
  durationMs: number,
  message: string,
  code: string,
): EvalResult {
  const finding: Finding = {
    severity: "error",
    message,
    code,
  };
  return {
    providerId: provider.id,
    providerVersion: provider.version,
    schemaVersion: provider.schemaVersion,
    score: 0,
    passed: false,
    categories: [],
    findings: [finding],
    raw: undefined,
    startedAt,
    durationMs,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Run a single provider against a `SkillContext` and return a normalized
 * `EvalResult`.
 *
 * Contract:
 *   - Always sets `startedAt` and `durationMs` (including on error).
 *   - Thrown errors become `EvalResult` with a `severity: "error"` finding
 *     and `passed: false`.
 *   - `opts.timeoutMs` > 0 → provider is raced against the timeout.
 *
 * The runner trusts that the provider's own `applicable()` has already
 * been checked by the caller when appropriate; it does not call it here
 * because some callers intentionally want to see a provider's error even
 * when `applicable()` says no.
 */
export async function runProvider(
  provider: EvalProvider,
  ctx: SkillContext,
  opts: EvalOpts = {},
): Promise<EvalResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();

  // Stable identity snapshot — used for error-path results so we still
  // report provider id/version/schemaVersion even if the provider object
  // mutates mid-run.
  const identity = {
    id: provider.id,
    version: provider.version,
    schemaVersion: provider.schemaVersion,
  };

  // Compose timeout + external signal so both can trigger cancellation.
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else
      opts.signal.addEventListener("abort", () =>
        controller.abort(opts.signal?.reason),
      );
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(
      () => controller.abort(new Error("timeout")),
      opts.timeoutMs,
    );
  }

  const effectiveOpts: EvalOpts = { ...opts, signal: controller.signal };

  try {
    const raced = await Promise.race<
      { kind: "ok"; value: EvalResult } | { kind: "timeout" }
    >([
      provider
        .run(ctx, effectiveOpts)
        .then((value) => ({ kind: "ok", value }) as const),
      new Promise<{ kind: "timeout" }>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ kind: "timeout" });
          return;
        }
        controller.signal.addEventListener("abort", () =>
          resolve({ kind: "timeout" }),
        );
      }),
    ]);

    const durationMs = Math.max(0, Math.round(performance.now() - start));

    if (raced.kind === "timeout") {
      const reason = controller.signal.reason;
      const message =
        reason instanceof Error && reason.message === "timeout"
          ? `provider timed out after ${opts.timeoutMs}ms`
          : `provider aborted: ${errorMessage(reason)}`;
      return buildErrorResult(
        identity,
        startedAt,
        durationMs,
        message,
        reason instanceof Error && reason.message === "timeout"
          ? "timeout"
          : "aborted",
      );
    }

    // Normalize provider-returned result: stamp timing and identity so
    // providers can't lie about who they are or skip timing fields.
    const result = raced.value;
    return {
      ...result,
      providerId: identity.id,
      providerVersion: identity.version,
      schemaVersion: result.schemaVersion ?? identity.schemaVersion,
      startedAt,
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.max(0, Math.round(performance.now() - start));
    return buildErrorResult(
      identity,
      startedAt,
      durationMs,
      errorMessage(err),
      "provider-threw",
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
