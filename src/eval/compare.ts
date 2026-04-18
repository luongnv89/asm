/**
 * Version comparison rendering for the `asm eval` provider framework.
 *
 * `--compare` is the upgrade safety mechanism: a user can diff two
 * provider versions against the same skill before promoting a new one.
 * This module is **provider-agnostic** — it takes two `EvalResult`
 * values and renders a readable diff. Coupling it to any particular
 * provider would make the contract (and the test story) worse.
 *
 * Diff dimensions covered:
 *
 *   - **Score**       — before → after, signed delta.
 *   - **Pass/fail**   — explicit flip indicator when `passed` changes.
 *   - **Categories**  — score/max deltas per category; added and
 *                       removed categories highlighted.
 *   - **Findings**    — added and removed findings keyed by `code`
 *                       (fallback to `message`), so a provider that
 *                       emits stable codes across versions produces a
 *                       stable, readable diff.
 *   - **Schema**      — mismatched `schemaVersion` surfaces as a
 *                       warning line in the header. Not an error —
 *                       structural diffing still works.
 *
 * Output contract:
 *
 *   - Returns a plain string. The caller (`cmdEval` in `src/cli.ts`)
 *     is responsible for writing to stdout and deciding the exit code.
 *   - Uses ANSI color codes only when `opts.useColor !== false`. The
 *     CLI passes `useColor: !args.flags.noColor`.
 *   - Never calls `process.exit`, reads from disk, or invokes the
 *     registry. All inputs are passed in explicitly — this keeps the
 *     module trivially testable.
 *
 * See `compare.test.ts` for the canonical shape examples the rendering
 * is locked in against, and `docs/eval-providers.md` for the user-
 * facing docs on version pinning and the `--compare` workflow.
 */

import type { CategoryResult, EvalResult, Finding } from "./types";

// ─── ANSI helpers ───────────────────────────────────────────────────────────

/**
 * Minimal ANSI helper tuple used by the renderer. A tiny inline subset
 * of what the CLI provides so the module stays dependency-free (the
 * registry and runner are also inlined-helper-style).
 */
interface AnsiHelpers {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}

/** Color-disabled helper. Used when `opts.useColor === false`. */
const PLAIN: AnsiHelpers = {
  bold: (s) => s,
  dim: (s) => s,
  red: (s) => s,
  green: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
};

/** Color-enabled helper. Mirrors the codes used elsewhere in `src/cli.ts`. */
const COLOR: AnsiHelpers = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ─── Public options ─────────────────────────────────────────────────────────

/** Options for {@link compareResults}. All fields optional. */
export interface CompareOptions {
  /** Whether to emit ANSI color codes. Default: true. */
  useColor?: boolean;
  /**
   * Optional labels for each side. When omitted, the renderer uses
   * `{providerId}@{providerVersion}` for both sides. The labels appear
   * in the header.
   */
  beforeLabel?: string;
  afterLabel?: string;
}

// ─── Delta helpers ──────────────────────────────────────────────────────────

/**
 * Format a signed numeric delta with a leading `+` for positive values.
 * A zero delta renders as `±0` so the eye always sees a sign even when
 * the delta is neutral.
 */
function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "±0";
}

/**
 * Pick the most discriminating key for a finding. We prefer `code`
 * (machine-readable, stable across versions) and fall back to
 * `message` (human text, less stable but always present).
 *
 * Exposed for testing — the rule is small but load-bearing for how
 * "the same finding across versions" is detected.
 */
export function findingKey(f: Finding): string {
  return f.code ? `code:${f.code}` : `msg:${f.message}`;
}

/**
 * Compute sets of added and removed findings between two flat finding
 * lists. A finding is "the same" if and only if its {@link findingKey}
 * matches. Order is preserved from the input arrays so the rendered
 * diff mirrors the provider's own ordering.
 */
function diffFindings(
  before: Finding[],
  after: Finding[],
): { added: Finding[]; removed: Finding[] } {
  const beforeKeys = new Set(before.map(findingKey));
  const afterKeys = new Set(after.map(findingKey));
  const removed = before.filter((f) => !afterKeys.has(findingKey(f)));
  const added = after.filter((f) => !beforeKeys.has(findingKey(f)));
  return { added, removed };
}

/**
 * Compute per-category deltas keyed by category id. Categories present
 * on only one side surface as added/removed with their full score.
 *
 * The returned `changed` array lists categories whose score changed
 * (including max-changes at unchanged score — rare but possible when a
 * provider shifts its rubric between versions).
 */
function diffCategories(
  before: CategoryResult[],
  after: CategoryResult[],
): {
  changed: {
    id: string;
    name: string;
    beforeScore: number;
    afterScore: number;
    beforeMax: number;
    afterMax: number;
  }[];
  added: CategoryResult[];
  removed: CategoryResult[];
} {
  const beforeById = new Map(before.map((c) => [c.id, c]));
  const afterById = new Map(after.map((c) => [c.id, c]));
  const changed: ReturnType<typeof diffCategories>["changed"] = [];
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) continue;
    if (b.score !== a.score || b.max !== a.max) {
      changed.push({
        id,
        name: a.name,
        beforeScore: b.score,
        afterScore: a.score,
        beforeMax: b.max,
        afterMax: a.max,
      });
    }
  }
  const added = after.filter((c) => !beforeById.has(c.id));
  const removed = before.filter((c) => !afterById.has(c.id));
  return { changed, added, removed };
}

// ─── Renderer ───────────────────────────────────────────────────────────────

/**
 * Format a side label as `id@version` for the header.
 */
function defaultLabel(r: EvalResult): string {
  return `${r.providerId}@${r.providerVersion}`;
}

/**
 * Format a single finding line. Severity is colored consistently with
 * the rest of the runtime eval CLI output (red/yellow/dim).
 */
function formatFindingLine(f: Finding, prefix: string, a: AnsiHelpers): string {
  const sev =
    f.severity === "error"
      ? a.red("error")
      : f.severity === "warning"
        ? a.yellow("warn")
        : a.dim("info");
  const code = f.code ? ` (${a.dim(f.code)})` : "";
  return `  ${prefix} [${sev}]${code} ${f.message}`;
}

/**
 * Render a human-readable diff between two `EvalResult` values.
 *
 * The rendered block groups related information: header → score →
 * pass/fail flip → categories → findings. Each section is skipped
 * entirely when there's nothing to show, so a zero-diff comparison
 * still produces a short, clear "no changes" footer.
 */
export function compareResults(
  before: EvalResult,
  after: EvalResult,
  opts: CompareOptions = {},
): string {
  const a = opts.useColor === false ? PLAIN : COLOR;
  const beforeLabel = opts.beforeLabel ?? defaultLabel(before);
  const afterLabel = opts.afterLabel ?? defaultLabel(after);

  const lines: string[] = [];

  // Header — which two versions are we comparing.
  lines.push(a.bold("Compare: ") + `${beforeLabel} → ${afterLabel}`);

  // Schema-version mismatch is a warning, not a blocker. Two providers
  // at different schema versions can still be diffed structurally — we
  // just flag that the `raw` payloads are not directly comparable.
  if (before.schemaVersion !== after.schemaVersion) {
    lines.push(
      a.yellow(
        `  ! schema version mismatch: ${before.schemaVersion} → ${after.schemaVersion}`,
      ),
    );
  }
  lines.push("");

  // Score delta. Always emitted, even for zero-delta.
  const scoreDelta = after.score - before.score;
  const deltaStr = formatDelta(scoreDelta);
  const coloredDelta =
    scoreDelta > 0
      ? a.green(deltaStr)
      : scoreDelta < 0
        ? a.red(deltaStr)
        : a.dim(deltaStr);
  lines.push(
    `${a.bold("Score:")} ${before.score}/100 → ${after.score}/100 (${coloredDelta})`,
  );

  // Pass/fail flip. Only surface a line when the boolean actually changed.
  if (before.passed !== after.passed) {
    const fromWord = before.passed ? a.green("PASS") : a.red("FAIL");
    const toWord = after.passed ? a.green("PASS") : a.red("FAIL");
    const flipKind = after.passed
      ? a.green("(regression fixed)")
      : a.red("(regression introduced)");
    lines.push(`${a.bold("Verdict:")} ${fromWord} → ${toWord} ${flipKind}`);
  } else {
    const word = after.passed ? a.green("PASS") : a.red("FAIL");
    lines.push(`${a.bold("Verdict:")} ${word} (unchanged)`);
  }

  // Duration note, dim — useful context for upgrade decisions where a
  // new version is N× slower even if the score is identical.
  if (before.durationMs > 0 || after.durationMs > 0) {
    lines.push(
      a.dim(`  duration: ${before.durationMs}ms → ${after.durationMs}ms`),
    );
  }

  // Category breakdown.
  const catDiff = diffCategories(before.categories, after.categories);
  if (
    catDiff.changed.length > 0 ||
    catDiff.added.length > 0 ||
    catDiff.removed.length > 0
  ) {
    lines.push("");
    lines.push(a.bold("Categories:"));
    for (const c of catDiff.changed) {
      const d = c.afterScore - c.beforeScore;
      const sign =
        d > 0
          ? a.green(formatDelta(d))
          : d < 0
            ? a.red(formatDelta(d))
            : a.dim(formatDelta(d));
      lines.push(
        `  ${c.name} (${a.dim(c.id)}): ${c.beforeScore}/${c.beforeMax} → ${c.afterScore}/${c.afterMax} (${sign})`,
      );
    }
    for (const c of catDiff.added) {
      lines.push(
        `  ${a.green("+")} ${c.name} (${a.dim(c.id)}): ${c.score}/${c.max} ${a.green("(new)")}`,
      );
    }
    for (const c of catDiff.removed) {
      lines.push(
        `  ${a.red("-")} ${c.name} (${a.dim(c.id)}): ${c.score}/${c.max} ${a.red("(removed)")}`,
      );
    }
  }

  // Findings diff.
  const findingDiff = diffFindings(before.findings, after.findings);
  if (findingDiff.added.length > 0 || findingDiff.removed.length > 0) {
    lines.push("");
    lines.push(a.bold("Findings:"));
    for (const f of findingDiff.removed) {
      lines.push(formatFindingLine(f, a.red("-"), a));
    }
    for (const f of findingDiff.added) {
      lines.push(formatFindingLine(f, a.green("+"), a));
    }
  }

  // Empty-diff footer. Without this, a zero-diff run would show only
  // a header and a score line, which reads as "did anything happen?"
  const noChanges =
    scoreDelta === 0 &&
    before.passed === after.passed &&
    before.schemaVersion === after.schemaVersion &&
    catDiff.changed.length === 0 &&
    catDiff.added.length === 0 &&
    catDiff.removed.length === 0 &&
    findingDiff.added.length === 0 &&
    findingDiff.removed.length === 0;
  if (noChanges) {
    lines.push("");
    lines.push(a.dim("No differences between versions."));
  }

  return lines.join("\n");
}

// ─── Provider spec parsing ──────────────────────────────────────────────────

/** Parsed `id@version` spec passed to `--compare`. */
export interface CompareSpec {
  id: string;
  version: string;
}

/**
 * Parse a `--compare` value into two ordered specs.
 *
 * Accepted shapes:
 *   - `<id>@<v1>,<id>@<v2>`  — both specs fully qualified
 *   - `<id>@<v1>,<v2>`       — second spec inherits `<id>` from the first
 *
 * Throws `Error` with an actionable message for any other shape. The
 * exception flows through `cmdEval`'s outer try/catch where it becomes
 * the same `SKILL_NOT_FOUND`-shaped machine envelope used by other
 * eval errors — consistent surface for scripted consumers.
 */
export function parseCompareArg(raw: string): [CompareSpec, CompareSpec] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(
      `--compare requires two provider specs (e.g. "quality@1.0.0,quality@1.0.0")`,
    );
  }
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length !== 2) {
    throw new Error(
      `--compare requires exactly two specs separated by a comma (got ${parts.length})`,
    );
  }
  const first = parseOneSpec(parts[0]!, /* requireId */ true);
  // Second spec may be just a version — inherit the id from the first.
  const second = parseOneSpec(parts[1]!, /* requireId */ false, first.id);
  return [first, second];
}

/**
 * Parse a single `id@version` (or bare `version` when `requireId` is
 * false and a default id is passed). Internal helper for
 * {@link parseCompareArg}.
 */
function parseOneSpec(
  raw: string,
  requireId: boolean,
  defaultId?: string,
): CompareSpec {
  const atIdx = raw.indexOf("@");
  if (atIdx < 0) {
    if (requireId || !defaultId) {
      throw new Error(`--compare spec "${raw}" must be of the form id@version`);
    }
    return { id: defaultId, version: raw };
  }
  const id = raw.slice(0, atIdx).trim();
  const version = raw.slice(atIdx + 1).trim();
  if (id.length === 0 || version.length === 0) {
    throw new Error(
      `--compare spec "${raw}" must be of the form id@version with both id and version`,
    );
  }
  return { id, version };
}
