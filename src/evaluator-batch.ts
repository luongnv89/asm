/**
 * Batch evaluation helpers — input resolution, concurrency, and aggregate reporting.
 *
 * Issues #193 + #194 extend `asm eval` to accept GitHub URLs/shorthand and to
 * evaluate a collection of skills in one go. The input-resolution pipeline is
 * shared between the single-skill path and the batch path so both features
 * stay consistent.
 *
 *   • `asm eval ./skill`                → single skill (SKILL.md at root)
 *   • `asm eval ./skills/`              → collection (enumerated children)
 *   • `asm eval github:owner/repo`      → whole repo (single-or-collection)
 *   • `asm eval github:owner/repo:sub`  → subpath resolved from cloned repo
 *
 * The resolver returns a list of `EvalTarget` entries plus a `cleanup` hook
 * that the caller MUST invoke in a `finally` block — local inputs get a no-op
 * cleanup, remote inputs get an `rm -rf` of the temp clone directory.
 */

import { stat, readdir } from "fs/promises";
import { join, resolve, basename, isAbsolute } from "path";
import type { EvaluationReport, FixResult } from "./evaluator-core";

// Re-export types so consumers can import from evaluator-batch directly
export type {
  CategoryResult,
  EvaluationReport,
  FixPlanItem,
  FixResult,
} from "./evaluator-core";
export type {
  BuildFixPlanOptions,
  BuildFixPlanResult,
  ApplyFixOptions,
} from "./evaluator-fix";

// ─── Input resolution (local path / GitHub shorthand / URL) ───────────────

export interface EvalTarget {
  /** Absolute path to the skill directory. */
  skillPath: string;
  /** Absolute path to the skill's SKILL.md. */
  skillMdPath: string;
  /** Short display label (the skill's directory basename). */
  label: string;
}

export interface EvalProvenance {
  /** Original input as typed by the user (e.g. `github:owner/repo`). */
  input: string;
  /** True when the input was a GitHub URL / shorthand. */
  remote: boolean;
  /** Canonical `github:owner/repo[#ref][:subpath]` form, or null for local. */
  sourceRef?: string | null;
  /** Commit SHA resolved from the temp clone, when available. */
  commitSha?: string | null;
  /** Temp dir created to stage the clone, when applicable. */
  tempPath?: string | null;
}

export interface ResolvedEvalInput {
  /** One entry per SKILL.md to evaluate. */
  targets: EvalTarget[];
  /** True when >1 skill was discovered (or the caller forced batch mode). */
  isCollection: boolean;
  /** Cleanup fn for the temp clone. Safe to call twice; no-op for local paths. */
  cleanup: () => Promise<void>;
  /** Source provenance. */
  provenance: EvalProvenance;
}

/**
 * Detect immediate child directories that contain a `SKILL.md` file. Used to
 * decide whether a given root looks like a single skill or a collection.
 *
 * The search is non-recursive — only the direct children of `rootDir` are
 * considered candidates (matching the expected layouts described in #194:
 * `./skills/<skill>/SKILL.md`).
 */
export async function findChildSkillDirs(rootDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    // Skip common non-skill directories early.
    if (
      entry.startsWith(".") ||
      entry === "node_modules" ||
      entry === "dist" ||
      entry === "build"
    ) {
      continue;
    }

    const full = join(rootDir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    const skillMd = join(full, "SKILL.md");
    try {
      const mdStat = await stat(skillMd);
      if (mdStat.isFile()) results.push(full);
    } catch {
      // no SKILL.md at this child — skip (do not recurse).
    }
  }

  results.sort((a, b) => basename(a).localeCompare(basename(b)));
  return results;
}

/**
 * Result of classifying a local directory path.
 *  - `single`     : the directory itself is a skill (SKILL.md at root)
 *  - `collection` : no root SKILL.md, at least one child has SKILL.md
 *  - `none`       : neither — caller should error out
 */
export interface DirectoryClassification {
  kind: "single" | "collection" | "none";
  /** For `single`: the skill dir. For `collection`: the list of child skill dirs. */
  skillDirs: string[];
}

/**
 * Classify a directory as a single skill, a collection of skills, or neither.
 */
export async function classifyEvalDirectory(
  rootDir: string,
): Promise<DirectoryClassification> {
  const rootSkillMd = join(rootDir, "SKILL.md");
  try {
    const s = await stat(rootSkillMd);
    if (s.isFile()) {
      return { kind: "single", skillDirs: [rootDir] };
    }
  } catch {
    // fall through and look at children
  }

  const children = await findChildSkillDirs(rootDir);
  if (children.length > 0) {
    return { kind: "collection", skillDirs: children };
  }
  return { kind: "none", skillDirs: [] };
}

/**
 * Heuristic: does the input look like a GitHub URL / shorthand rather than a
 * filesystem path? We mirror the rules used by `installer.isLocalPath` / the
 * GitHub URL regex, but keep them local to the evaluator to avoid a cyclic
 * import into `installer.ts`.
 */
export function looksLikeGithubInput(input: string): boolean {
  if (!input) return false;
  if (input.startsWith("github:")) return true;
  if (/^https?:\/\/github\.com\//i.test(input)) return true;
  return false;
}

function buildTargetFromSkillDir(skillDir: string): EvalTarget {
  return {
    skillPath: skillDir,
    skillMdPath: join(skillDir, "SKILL.md"),
    label: basename(skillDir),
  };
}

/**
 * Resolve the input argument for `asm eval` into one or more evaluation
 * targets. Delegates network fetching to the supplied `fetchRemote` adapter
 * so the pure path-classification logic stays unit-testable without hitting
 * git / the network.
 *
 * Expected contract for `fetchRemote`:
 *   • parse the GitHub input (shorthand or URL)
 *   • clone into a temp directory honouring the `transport` preference
 *   • resolve any subpath segment, returning the final on-disk root
 *   • return `{ rootDir, cleanup, sourceRef, commitSha }`
 *
 * When `fetchRemote` is omitted, this function only handles local paths.
 */
export interface ResolveEvalInputOptions {
  fetchRemote?: (input: string) => Promise<{
    rootDir: string;
    cleanup: () => Promise<void>;
    sourceRef: string;
    commitSha: string | null;
  }>;
}

export async function resolveEvalInput(
  input: string,
  options: ResolveEvalInputOptions = {},
): Promise<ResolvedEvalInput> {
  if (!input) {
    throw new Error("resolveEvalInput: input must be a non-empty string");
  }

  if (looksLikeGithubInput(input)) {
    if (!options.fetchRemote) {
      throw new Error(
        `Remote evaluation is not available in this context: "${input}"`,
      );
    }
    const remote = await options.fetchRemote(input);
    let classification: DirectoryClassification;
    try {
      classification = await classifyEvalDirectory(remote.rootDir);
    } catch (err) {
      await remote.cleanup().catch(() => {});
      throw err;
    }
    if (classification.kind === "none") {
      await remote.cleanup().catch(() => {});
      throw new Error(
        `No SKILL.md found at ${remote.rootDir} (source: ${input}). The location is neither a single skill nor a skill collection.`,
      );
    }
    return {
      targets: classification.skillDirs.map(buildTargetFromSkillDir),
      isCollection: classification.kind === "collection",
      cleanup: remote.cleanup,
      provenance: {
        input,
        remote: true,
        sourceRef: remote.sourceRef,
        commitSha: remote.commitSha,
        tempPath: remote.rootDir,
      },
    };
  }

  // Local path: accept either a SKILL.md file or a directory.
  const abs = isAbsolute(input) ? input : resolve(input);
  let s;
  try {
    s = await stat(abs);
  } catch {
    throw new Error(`Skill path does not exist: ${abs}`);
  }

  if (s.isFile()) {
    // Treat a direct SKILL.md as a single-skill input whose skillPath is the
    // filename (matches legacy evaluateSkill behaviour).
    return {
      targets: [
        {
          skillPath: basename(abs) === "SKILL.md" ? basename(abs) : abs,
          skillMdPath: abs,
          label: basename(abs),
        },
      ],
      isCollection: false,
      cleanup: async () => {},
      provenance: { input, remote: false, sourceRef: null },
    };
  }

  if (!s.isDirectory()) {
    throw new Error(`Skill path is not a directory or file: ${abs}`);
  }

  const classification = await classifyEvalDirectory(abs);
  if (classification.kind === "none") {
    throw new Error(
      `No SKILL.md found in ${abs}. Pass a skill directory, a SKILL.md file, or a collection root with SKILL.md in its children.`,
    );
  }

  return {
    targets: classification.skillDirs.map(buildTargetFromSkillDir),
    isCollection: classification.kind === "collection",
    cleanup: async () => {},
    provenance: { input, remote: false, sourceRef: null },
  };
}

// ─── Aggregate / batch report ─────────────────────────────────────────────

export interface EvalBatchItem {
  /** Short directory label (basename). */
  label: string;
  /** Absolute skill path evaluated. */
  skillPath: string;
  /** The evaluation report, when the eval succeeded. */
  report: EvaluationReport | null;
  /** Error message when eval failed for this skill (non-fatal — kept in results). */
  error: string | null;
}

export interface EvalBatchAggregate {
  total: number;
  succeeded: number;
  failed: number;
  meanScore: number | null;
  top: { label: string; score: number } | null;
  bottom: { label: string; score: number } | null;
}

export interface EvalBatchResult {
  provenance: EvalProvenance;
  aggregate: EvalBatchAggregate;
  results: EvalBatchItem[];
}

export function summariseBatch(items: EvalBatchItem[]): EvalBatchAggregate {
  const succeeded = items.filter((i) => i.report !== null);
  const total = items.length;
  const failed = total - succeeded.length;
  if (succeeded.length === 0) {
    return {
      total,
      succeeded: 0,
      failed,
      meanScore: null,
      top: null,
      bottom: null,
    };
  }
  const scores = succeeded.map((i) => i.report!.overallScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const meanScore = Math.round(mean);
  const sorted = [...succeeded].sort(
    (a, b) => b.report!.overallScore - a.report!.overallScore,
  );
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  return {
    total,
    succeeded: succeeded.length,
    failed,
    meanScore,
    top: { label: top.label, score: top.report!.overallScore },
    bottom: { label: bottom.label, score: bottom.report!.overallScore },
  };
}

/**
 * Run an async task for each input with a bounded concurrency window.
 * Preserves output order (index-indexed results array).
 *
 * On the first mapper rejection a boolean failure flag is set and the
 * original error is remembered.  Workers stop claiming new indexes once
 * failure is observed.  All already-started mapper calls are awaited
 * (because every worker promise is awaited).  After Promise.all the first
 * error is re-thrown; otherwise the ordered results are returned.
 *
 * Empty input always returns an empty array.
 */
export async function runWithConcurrency<T, R>(
  inputs: T[],
  limit: number,
  fn: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  let failure = false;
  let firstError: unknown;
  const boundedLimit = Math.max(1, Math.floor(limit));
  const workers: Promise<void>[] = [];
  const size = Math.min(boundedLimit, inputs.length);
  for (let w = 0; w < size; w++) {
    workers.push(
      (async () => {
        while (true) {
          if (failure) break;
          const idx = next++;
          if (idx >= inputs.length) break;
          try {
            results[idx] = await fn(inputs[idx], idx);
          } catch (err: unknown) {
            if (!failure) {
              failure = true;
              firstError = err;
            }
            break;
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  if (failure) {
    throw firstError;
  }
  return results;
}

/**
 * Render a concise human-readable summary of a batch run. Not the full per-skill
 * detail — caller can still print individual reports before the summary.
 */
export function formatBatchSummary(
  batch: EvalBatchResult,
  widthHint: number = 28,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("Batch summary:");
  lines.push(
    `  Skills evaluated:      ${batch.aggregate.succeeded}/${batch.aggregate.total}` +
      (batch.aggregate.failed > 0
        ? `  (${batch.aggregate.failed} failed)`
        : ""),
  );
  if (batch.aggregate.meanScore !== null) {
    lines.push(`  Mean score:            ${batch.aggregate.meanScore}/100`);
  }
  if (batch.aggregate.top) {
    lines.push(
      `  Top:                   ${batch.aggregate.top.label} (${batch.aggregate.top.score}/100)`,
    );
  }
  if (
    batch.aggregate.bottom &&
    batch.aggregate.bottom.label !== batch.aggregate.top?.label
  ) {
    lines.push(
      `  Bottom:                ${batch.aggregate.bottom.label} (${batch.aggregate.bottom.score}/100)`,
    );
  }
  if (batch.provenance.remote) {
    if (batch.provenance.sourceRef) {
      lines.push(`  Source:                ${batch.provenance.sourceRef}`);
    }
    if (batch.provenance.commitSha) {
      lines.push(`  Commit:                ${batch.provenance.commitSha}`);
    }
    if (batch.provenance.tempPath) {
      lines.push(`  Fetched to:            ${batch.provenance.tempPath}`);
    }
  }
  // widthHint is intentionally unused for now — reserved for future padding.
  void widthHint;
  return lines.join("\n");
}

export function buildBatchMachineData(batch: EvalBatchResult) {
  return {
    provenance: {
      input: batch.provenance.input,
      remote: batch.provenance.remote,
      source_ref: batch.provenance.sourceRef ?? null,
      commit_sha: batch.provenance.commitSha ?? null,
      temp_path: batch.provenance.tempPath ?? null,
    },
    aggregate: {
      total: batch.aggregate.total,
      succeeded: batch.aggregate.succeeded,
      failed: batch.aggregate.failed,
      mean_score: batch.aggregate.meanScore,
      top: batch.aggregate.top,
      bottom: batch.aggregate.bottom,
    },
    results: batch.results.map((r) => ({
      label: r.label,
      skill_path: r.skillPath,
      error: r.error,
      report: r.report ? buildEvalMachineData(r.report, null) : null,
    })),
  };
}

/**
 * Machine-envelope friendly shape for `asm eval`.
 */
export function buildEvalMachineData(
  report: EvaluationReport & {
    providers?: import("./eval/summary").ProviderEvalReport[];
  },
  fix: FixResult | null = null,
) {
  return {
    skill_path: report.skillPath,
    skill_md_path: report.skillMdPath,
    overall_score: report.overallScore,
    grade: report.grade,
    categories: report.categories.map((c) => ({
      id: c.id,
      name: c.name,
      score: c.score,
      max: c.max,
      findings: c.findings,
      suggestions: c.suggestions,
    })),
    top_suggestions: report.topSuggestions,
    providers:
      report.providers?.map((provider) => ({
        id: provider.id,
        version: provider.version,
        schemaVersion: provider.schemaVersion,
        score: provider.score,
        passed: provider.passed,
        categories: provider.categories.map((category) => ({
          id: category.id,
          name: category.name,
          score: category.score,
          max: category.max,
          findings: category.findings ?? [],
        })),
        findings: provider.findings,
      })) ?? [],
    fix: fix
      ? {
          dry_run: fix.dryRun,
          applied: fix.applied,
          skipped: fix.skipped,
          backup_path: fix.backupPath,
          diff: fix.diff,
        }
      : null,
  };
}
