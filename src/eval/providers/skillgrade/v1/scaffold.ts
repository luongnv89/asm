/**
 * Scaffold — wraps `skillgrade init` to create `eval.yaml` in a skill dir.
 *
 * Invoked by the CLI when the user runs `asm eval <skill> --runtime init`.
 * Kept separate from `index.ts` so the provider contract stays minimal:
 * scaffolding is a one-shot action, not a recurring evaluation, and it
 * should never appear in the `EvalResult` pipeline.
 *
 * Like the provider itself, scaffold goes through an injected `Spawner`
 * so tests can exercise every branch (binary missing, non-zero exit,
 * success) without ever touching the real `skillgrade` CLI.
 */

import type { Spawner, SpawnResult } from "./spawn";
import { bunSpawn } from "./spawn";

/** Outcome of a scaffold attempt — consumed directly by the CLI. */
export interface ScaffoldResult {
  /** `true` iff `skillgrade init` exited 0. */
  ok: boolean;
  /** Human-readable message suitable for stdout/stderr. */
  message: string;
  /** Exit code returned by the child process, `null` on signal/timeout. */
  exitCode: number | null;
  /** Raw stdout from `skillgrade init` (kept for verbose mode). */
  stdout: string;
  /** Raw stderr from `skillgrade init` (kept for debugging failures). */
  stderr: string;
}

/**
 * Options accepted by `scaffoldEvalYaml`.
 *
 * `spawn` is the single injection point. Tests pass a fake; production
 * uses the default `bunSpawn`.
 */
export interface ScaffoldOptions {
  /** Absolute path to the skill directory — `skillgrade init` runs here. */
  skillPath: string;
  /** Override the binary name (default: `"skillgrade"`). */
  binary?: string;
  /** Override the timeout in ms (default: 30_000). */
  timeoutMs?: number;
  /** Injection point for testing (default: `bunSpawn`). */
  spawn?: Spawner;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

const DEFAULT_BINARY = "skillgrade";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run `skillgrade init` in the given skill directory.
 *
 * Behavior:
 *   - Returns `ok: true` on exit code 0 with a concise success message.
 *   - Returns `ok: false` with a reason on non-zero exit, timeout, or
 *     aborted signal. The reason embeds stderr so users can copy/paste
 *     it into an issue report.
 *   - Never throws — the CLI only needs to render `message` and pick
 *     the right exit code.
 */
export async function scaffoldEvalYaml(
  opts: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const spawn = opts.spawn ?? bunSpawn;
  const binary = opts.binary ?? DEFAULT_BINARY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: SpawnResult;
  try {
    res = await spawn([binary, "init"], {
      cwd: opts.skillPath,
      timeoutMs,
      signal: opts.signal,
    });
  } catch (err: any) {
    // ENOENT / spawn failure — most commonly the binary is not on PATH.
    const message =
      err?.code === "ENOENT"
        ? `${binary} not installed — run: npm i -g skillgrade`
        : `failed to spawn ${binary}: ${err?.message ?? String(err)}`;
    return {
      ok: false,
      message,
      exitCode: null,
      stdout: "",
      stderr: err?.message ?? String(err),
    };
  }

  if (res.timedOut) {
    return {
      ok: false,
      message: `${binary} init timed out after ${timeoutMs}ms`,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  if (res.aborted) {
    return {
      ok: false,
      message: `${binary} init aborted`,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  if (res.exitCode !== 0) {
    const detail =
      res.stderr.trim().length > 0
        ? res.stderr.trim()
        : res.stdout.trim().length > 0
          ? res.stdout.trim()
          : "no stderr output";
    return {
      ok: false,
      message: `${binary} init failed (exit ${res.exitCode}): ${detail}`,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  return {
    ok: true,
    message: `eval.yaml scaffolded in ${opts.skillPath}`,
    exitCode: 0,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}
