/**
 * Spawner seam for the skillgrade provider.
 *
 * The skillgrade provider never shells out directly — it always goes through
 * a `Spawner` function. Tests inject a fake Spawner that returns recorded
 * fixture strings; production wires the default `bunSpawn` below.
 *
 * Why a seam (and not `jest.mock`-style module mocking)? Bun test's module
 * patching story is thin and brittle. A first-class function injection
 * point is explicit, zero-magic, and makes the mock obvious at the call
 * site of every test.
 *
 * Contract:
 *   - `argv[0]` is the binary name (looked up on PATH by `Bun.spawn`).
 *   - `opts.timeoutMs` enforces a hard deadline. On expiry, the process
 *     is killed with SIGTERM and the promise resolves with `exitCode: -1`
 *     and `timedOut: true` (no throw — consumers decide how to handle).
 *   - `stdout` / `stderr` are captured as UTF-8 strings.
 *   - `env` is merged onto `process.env`; callers may pass their own
 *     API keys without pulling in the entire environment.
 *   - Signal-based abort is supported via `opts.signal`.
 */

/**
 * Result of a spawn invocation.
 *
 * `timedOut` fires only when the provided timeout fired; `aborted` fires
 * only when the provided signal fired. Both are `false` on a clean exit,
 * regardless of `exitCode`.
 */
export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

/**
 * Options accepted by a `Spawner`.
 */
export interface SpawnOptions {
  /** Working directory for the spawned process. */
  cwd?: string;
  /** Hard timeout in milliseconds. Non-positive values disable the timer. */
  timeoutMs?: number;
  /** Environment overrides merged onto `process.env`. */
  env?: Record<string, string>;
  /** Cooperative abort signal — fires SIGTERM on the spawned process. */
  signal?: AbortSignal;
}

/**
 * Function signature every caller (provider, scaffold, version probe)
 * uses. Tests implement this directly; production uses `bunSpawn` below.
 */
export type Spawner = (
  argv: string[],
  opts?: SpawnOptions,
) => Promise<SpawnResult>;

/**
 * Read all chunks from a web-readable stream and concatenate them as UTF-8.
 *
 * Bun exposes stdout/stderr as `ReadableStream<Uint8Array>`. We drain
 * fully so tests never observe truncated output on short-lived children.
 */
async function drainStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(out);
}

/**
 * Default production Spawner backed by `Bun.spawn`.
 *
 * Kept thin: it owns process lifecycle, timeout, signal plumbing, and
 * stream draining — nothing else. All skillgrade-specific framing
 * (argv construction, JSON parsing) lives in the provider/adapter.
 */
export const bunSpawn: Spawner = async (
  argv: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> => {
  const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>;

  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wire timeout + signal → SIGTERM. Both are cooperative: skillgrade
  // runs LLM evals which respect Ctrl-C, so terminal signals suffice.
  let timedOut = false;
  let aborted = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already exited */
      }
    }, opts.timeoutMs);
  }
  const onAbort = () => {
    aborted = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  };
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      drainStream(proc.stdout as unknown as ReadableStream<Uint8Array> | null),
      drainStream(proc.stderr as unknown as ReadableStream<Uint8Array> | null),
      proc.exited,
    ]);
    return {
      exitCode: typeof exitCode === "number" ? exitCode : null,
      stdout,
      stderr,
      timedOut,
      aborted,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
};
