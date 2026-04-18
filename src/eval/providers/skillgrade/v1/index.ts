/**
 * Skillgrade provider — v1.
 *
 * Shells out to the `skillgrade` CLI (https://github.com/mgechev/skillgrade)
 * to answer the orthogonal question *"does this skill actually work?"*.
 * The quality provider (PR 2, #156) already answers *"is it well-written?"*.
 *
 * Architecture (see `docs/SKILLGRADE_INTEGRATION_PLAN.md` §4 PR 4):
 *
 *   - `applicable()` performs three cheap checks:
 *       1. `skillgrade` binary on PATH
 *       2. binary version inside `externalRequires` range
 *       3. `eval.yaml` present in the skill directory
 *     Each failure returns an actionable `reason` the CLI renders.
 *
 *   - `run()` invokes `skillgrade run --ci --threshold <n> --preset <p>
 *     --json` via a `Spawner` (injectable seam for tests). The JSON
 *     stdout is parsed and handed to `adaptSkillgradeReport` which is
 *     the single source of shape knowledge.
 *
 *   - Every external dependency (spawn, filesystem stat) goes through
 *     a passed-in function so `index.test.ts` never touches the real
 *     binary or network.
 *
 * Error surface (aligned with the runner's error-wrap contract):
 *   - Missing API key        → severity `error`, code `missing-api-key`
 *   - Docker unavailable     → severity `error`, code `docker-unavailable`
 *   - Timeout                → runner's `code: "timeout"` (we signal abort)
 *   - Non-zero exit          → severity `error`, code `skillgrade-nonzero-exit`
 *   - Unparseable stdout     → severity `error`, code `skillgrade-bad-json`
 *
 * The runner stamps `startedAt` / `durationMs` — we leave them blank.
 */

import { stat } from "fs/promises";
import { join } from "path";
import type {
  ApplicableResult,
  EvalOpts,
  EvalProvider,
  EvalResult,
  Finding,
  SkillContext,
} from "../../../types";
import type { Spawner, SpawnOptions, SpawnResult } from "./spawn";
import { bunSpawn } from "./spawn";
import { adaptSkillgradeReport, type SkillgradeReport } from "./adapter";
import { satisfiesExternalRange } from "./semver-range";

// ─── Identity constants ─────────────────────────────────────────────────────

/** Stable provider id used by `registry.resolve("skillgrade", "^1.0.0")`. */
export const PROVIDER_ID = "skillgrade";

/** Provider semver. Bump on adapter feature/fix releases. */
export const PROVIDER_VERSION = "1.0.0";

/** Result-shape version. Bump only on structural breaks to EvalResult. */
export const SCHEMA_VERSION = 1;

/** Default external binary range. Overridable via config. */
export const DEFAULT_EXTERNAL_REQUIRES = ">=0.1.3 <0.3.0";

/** Default threshold (fraction, skillgrade convention). */
export const DEFAULT_THRESHOLD_FRACTION = 0.8;

/** Default preset. */
export const DEFAULT_PRESET: "smoke" | "reliable" | "regression" = "smoke";

/** Default execution provider (skillgrade CLI flag). */
export const DEFAULT_SKILLGRADE_PROVIDER: "docker" | "local" = "docker";

// ─── Injection seams ────────────────────────────────────────────────────────

/**
 * Optional filesystem `exists` seam. Defaults to `fs/promises.stat`.
 * Overridden in tests so `applicable()` can fake "eval.yaml is missing"
 * without touching disk.
 */
export type FileExists = (path: string) => Promise<boolean>;

/**
 * Full configuration for constructing a skillgrade provider instance.
 *
 * Production code calls `createSkillgradeProvider()` with no args and
 * gets the singleton wired to `bunSpawn` + real filesystem. Tests build
 * their own instance per test with hand-rolled fakes.
 */
export interface SkillgradeProviderOptions {
  /** Spawner seam (default: `bunSpawn`). */
  spawn?: Spawner;
  /** File-exists seam (default: `fs/promises.stat`). */
  fileExists?: FileExists;
  /** Binary name (default: `"skillgrade"`). */
  binary?: string;
  /** Override the declared `externalRequires` range. */
  externalRequires?: string;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/** Default `FileExists` backed by `fs/promises.stat`. */
const defaultFileExists: FileExists = async (p: string) => {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
};

/**
 * Build an error-shaped `EvalResult` the runner would otherwise wrap.
 * Used for skillgrade-specific failure modes (missing API key, docker
 * unavailable, non-zero exit) where we want a semantic `code` — the
 * runner's generic `"provider-threw"` wouldn't tell the CLI *why*.
 */
function errorResult(finding: Finding, raw?: unknown): EvalResult {
  return {
    providerId: PROVIDER_ID,
    providerVersion: PROVIDER_VERSION,
    schemaVersion: SCHEMA_VERSION,
    score: 0,
    passed: false,
    categories: [],
    findings: [finding],
    raw,
    startedAt: "",
    durationMs: 0,
  };
}

/**
 * Classify skillgrade stderr output. `skillgrade` itself does not expose a
 * stable exit-code taxonomy yet, so we use keyword matching on stderr.
 * Each category maps to a distinct `Finding.code` so the CLI can render
 * a targeted hint (e.g. "export ANTHROPIC_API_KEY=…").
 *
 * Keywords are intentionally broad — false positives degrade to a
 * generic `skillgrade-nonzero-exit` finding with stderr embedded in
 * `message` so users still see the full context.
 */
export function classifyStderr(stderr: string): {
  code: string;
  hint: string;
} {
  const lower = stderr.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("anthropic_api_key") ||
    lower.includes("openai_api_key") ||
    lower.includes("unauthorized") ||
    lower.includes("401")
  ) {
    return {
      code: "missing-api-key",
      hint: "set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment",
    };
  }
  if (
    lower.includes("docker") &&
    (lower.includes("not found") ||
      lower.includes("cannot connect") ||
      lower.includes("unavailable") ||
      lower.includes("is not running"))
  ) {
    return {
      code: "docker-unavailable",
      hint: "start Docker or pass --provider local",
    };
  }
  return {
    code: "skillgrade-nonzero-exit",
    hint: "check skillgrade logs above for details",
  };
}

/**
 * Detect the version of the installed `skillgrade` binary.
 *
 * Returns `null` when the binary isn't on PATH (spawn threw ENOENT) or
 * the `--version` output can't be parsed. Callers use `null` to mean
 * "skip the version gate" — `applicable()` still separately verifies
 * the binary is present before reaching the version check.
 */
export async function detectVersion(
  spawn: Spawner,
  binary: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let res: SpawnResult;
  try {
    res = await spawn([binary, "--version"], { timeoutMs: 5_000, signal });
  } catch {
    return null;
  }
  if (res.exitCode !== 0) return null;
  const combined = `${res.stdout}\n${res.stderr}`;
  // Match the first `X.Y.Z` (optionally prefixed by `v`) — skillgrade
  // and most CLIs print `skillgrade 0.1.4\n` or `v0.1.4\n`. We don't
  // use `\b` around the leading digit because letters like `v` are word
  // characters too, so there's no boundary between `v` and `0`.
  const match =
    /(?:^|[^\w.-])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[^\w.-])/m.exec(
      combined,
    );
  return match ? match[1]! : null;
}

/**
 * Compute the absolute path to the skill's `eval.yaml`.
 * Skillgrade looks for this file at the skill root.
 */
export function evalYamlPath(ctx: SkillContext): string {
  return join(ctx.skillPath, "eval.yaml");
}

/**
 * Build the argv for `skillgrade run`, respecting runtime options.
 *
 * `--threshold` accepts a 0..1 fraction; ASM stores thresholds as
 * 0..100 integers in `EvalOpts` but skillgrade wants the fraction,
 * so we scale on the way out.
 */
export function buildRunArgv(
  binary: string,
  resolvedOpts: {
    thresholdFraction: number;
    preset: "smoke" | "reliable" | "regression";
    provider: "docker" | "local";
  },
): string[] {
  return [
    binary,
    "run",
    "--ci",
    "--threshold",
    String(resolvedOpts.thresholdFraction),
    "--preset",
    resolvedOpts.preset,
    "--provider",
    resolvedOpts.provider,
    "--json",
  ];
}

/**
 * Resolve the threshold/preset/provider knobs from raw `EvalOpts`,
 * applying skillgrade defaults so the provider always has a complete
 * set. Exported for tests and for the CLI, which reuses this when
 * printing what it's about to do.
 */
export function resolveRunOpts(opts: EvalOpts): {
  thresholdFraction: number;
  preset: "smoke" | "reliable" | "regression";
  provider: "docker" | "local";
} {
  const thresholdFraction =
    typeof opts.threshold === "number" && Number.isFinite(opts.threshold)
      ? opts.threshold > 1
        ? opts.threshold / 100
        : opts.threshold
      : DEFAULT_THRESHOLD_FRACTION;
  const preset =
    opts.preset === "smoke" ||
    opts.preset === "reliable" ||
    opts.preset === "regression"
      ? opts.preset
      : DEFAULT_PRESET;
  const provider =
    opts.provider === "docker" || opts.provider === "local"
      ? opts.provider
      : DEFAULT_SKILLGRADE_PROVIDER;
  return { thresholdFraction, preset, provider };
}

// ─── Provider factory ───────────────────────────────────────────────────────

/**
 * Construct a skillgrade provider instance with the given injection
 * points. Production imports the prebuilt `skillgradeProviderV1` below;
 * tests build their own instances with fake spawners and filesystem
 * stubs so every code path is deterministic.
 */
export function createSkillgradeProvider(
  options: SkillgradeProviderOptions = {},
): EvalProvider {
  const spawn = options.spawn ?? bunSpawn;
  const fileExists = options.fileExists ?? defaultFileExists;
  const binary = options.binary ?? "skillgrade";
  const externalRequires =
    options.externalRequires ?? DEFAULT_EXTERNAL_REQUIRES;

  return {
    id: PROVIDER_ID,
    version: PROVIDER_VERSION,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Runtime eval via skillgrade: runs task prompts through LLM judges and computes a pass rate.",
    externalRequires: {
      binary,
      semverRange: externalRequires,
      installHint: "npm i -g skillgrade",
    },

    /**
     * Three-stage feasibility check. Each failure returns the first
     * blocking reason — no point telling the user about the missing
     * eval.yaml when the binary isn't even installed.
     */
    async applicable(
      ctx: SkillContext,
      opts: EvalOpts,
    ): Promise<ApplicableResult> {
      // Stage 1: binary on PATH (and responsive to --version).
      const detected = await detectVersion(spawn, binary, opts.signal);
      if (detected === null) {
        return {
          ok: false,
          reason: `${binary} not installed or unreachable — run: npm i -g skillgrade`,
        };
      }

      // Stage 2: version inside externalRequires range.
      try {
        if (!satisfiesExternalRange(detected, externalRequires)) {
          return {
            ok: false,
            reason: `${binary} ${detected} is outside required range "${externalRequires}" — upgrade or downgrade the binary`,
          };
        }
      } catch (err: any) {
        return {
          ok: false,
          reason: `invalid externalRequires "${externalRequires}": ${err?.message ?? String(err)}`,
        };
      }

      // Stage 3: eval.yaml present at skill root.
      const yamlPath = evalYamlPath(ctx);
      if (!(await fileExists(yamlPath))) {
        return {
          ok: false,
          reason: `no eval.yaml at ${yamlPath} — run: asm eval --runtime init`,
        };
      }

      return { ok: true };
    },

    /**
     * Execute `skillgrade run ... --json`, parse stdout, adapt to
     * `EvalResult`. The runner handles timeout and wall-clock stamping;
     * we just pipe the timeout through as a cooperative hint.
     */
    async run(ctx: SkillContext, opts: EvalOpts): Promise<EvalResult> {
      const resolved = resolveRunOpts(opts);
      const argv = buildRunArgv(binary, resolved);

      const spawnOpts: SpawnOptions = {
        cwd: ctx.skillPath,
        signal: opts.signal,
      };
      if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
        spawnOpts.timeoutMs = opts.timeoutMs;
      }

      let res: SpawnResult;
      try {
        res = await spawn(argv, spawnOpts);
      } catch (err: any) {
        // Most likely ENOENT — binary vanished between applicable() and run().
        return errorResult({
          severity: "error",
          message: `failed to spawn ${binary}: ${err?.message ?? String(err)}`,
          code: err?.code === "ENOENT" ? "binary-missing" : "spawn-failed",
        });
      }

      if (res.timedOut) {
        // Align with the runner's `"timeout"` code so callers treat this
        // the same as a runner-enforced timeout.
        return errorResult({
          severity: "error",
          message: `skillgrade run timed out`,
          code: "timeout",
        });
      }

      if (res.aborted) {
        return errorResult({
          severity: "error",
          message: `skillgrade run aborted`,
          code: "aborted",
        });
      }

      if (res.exitCode !== 0) {
        const { code, hint } = classifyStderr(res.stderr);
        const stderrExcerpt = res.stderr.trim().slice(0, 2_000);
        return errorResult(
          {
            severity: "error",
            message: `skillgrade exited ${res.exitCode}: ${hint}${
              stderrExcerpt.length > 0 ? `\n${stderrExcerpt}` : ""
            }`,
            code,
          },
          { exitCode: res.exitCode, stderr: res.stderr },
        );
      }

      // Exit code 0 — expect JSON on stdout.
      let parsed: SkillgradeReport;
      try {
        parsed = JSON.parse(res.stdout) as SkillgradeReport;
      } catch (err: any) {
        return errorResult(
          {
            severity: "error",
            message: `skillgrade stdout was not valid JSON: ${err?.message ?? String(err)}`,
            code: "skillgrade-bad-json",
          },
          { stdout: res.stdout, stderr: res.stderr },
        );
      }

      return adaptSkillgradeReport(parsed, {
        providerId: PROVIDER_ID,
        providerVersion: PROVIDER_VERSION,
        schemaVersion: SCHEMA_VERSION,
        thresholdFraction: resolved.thresholdFraction,
      });
    },
  };
}

/**
 * Singleton provider instance wired to production Bun spawn + filesystem.
 * Registered in `src/eval/providers/index.ts`. Tests construct their own
 * via `createSkillgradeProvider(...)`.
 */
export const skillgradeProviderV1: EvalProvider = createSkillgradeProvider();

export default skillgradeProviderV1;
