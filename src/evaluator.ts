/**
 * Skill quality evaluator for `asm eval <skill-path>`.
 *
 * Evaluates a skill's SKILL.md against skill-authoring best practices and
 * produces a structured report with per-category scores, an overall score,
 * and actionable improvement suggestions.
 *
 * This module is split into three physical files for maintainability:
 *   - `evaluator-core.ts` — types, constants, and category scorers
 *   - `evaluator-fix.ts` — fix pipeline, formatters, evaluateSkill
 *   - `evaluator-batch.ts` — input resolution, concurrency, batch reporting
 *
 * Re-export everything here so existing imports continue to work.
 */

export {
  // ── Types ──
  type CategoryResult,
  type EvaluationReport,
  type FixPlanItem,
  type FixResult,
  // ── Constants ──
  ROOT_README_SUGGESTION,
  CANONICAL_FIELD_ORDER,
  // ── Core helpers ──
  splitSkillMd,
} from "./evaluator-core";

export {
  // ── Fix-pipeline types ──
  type BuildFixPlanOptions,
  type BuildFixPlanResult,
  type ApplyFixOptions,
  // ── Report + fix pipeline ──
  evaluateSkillContent,
  evaluateSkill,
  buildFixPlan,
  unifiedDiff,
  applyFix,
  detectGitAuthor,
  formatReport,
  formatReportJSON,
  formatFixPreview,
} from "./evaluator-fix";

export {
  // ── Batch / input resolution types ──
  type EvalTarget,
  type EvalProvenance,
  type ResolvedEvalInput,
  type DirectoryClassification,
  type ResolveEvalInputOptions,
  // ── Batch / input resolution functions ──
  findChildSkillDirs,
  classifyEvalDirectory,
  looksLikeGithubInput,
  resolveEvalInput,
  // ── Batch reporting ──
  type EvalBatchItem,
  type EvalBatchAggregate,
  type EvalBatchResult,
  summariseBatch,
  runWithConcurrency,
  formatBatchSummary,
  buildBatchMachineData,
  buildEvalMachineData,
} from "./evaluator-batch";
