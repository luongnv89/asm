/**
 * Evaluator core: types, constants, and category scorers.
 * Split from evaluator.ts (issue #455).
 */
/**
 * Skill quality evaluator for `asm eval <skill-path>`.
 *
 * Evaluates a skill's SKILL.md against skill-authoring best practices and
 * produces a structured report with per-category scores, an overall score,
 * and actionable improvement suggestions.
 *
 * Categories (8):
 *   1. Structure & completeness   — frontmatter + markdown structure
 *   2. Description quality        — specific trigger phrasing, action verbs
 *   3. Prompt engineering         — progressive disclosure, degrees of freedom, examples
 *   4. Context efficiency         — references/templates instead of inline content
 *   5. Safety & guardrails        — error handling, prerequisites, confirmations
 *   6. Testability                — acceptance criteria, edge cases, verifiable outputs
 *   7. License verification       — SPDX licence declared, recognised, or missing
 *   8. Naming & conventions       — naming conventions, imperative mood, consistent labels
 *
 * Also provides `--fix` / `--fix --dry-run` auto-fix for deterministic
 * frontmatter issues (ordering, version default, author from git, effort
 * inference from size, trailing whitespace, CRLF normalization).
 *
 * Schema mapping notes (see also /docs/ARCHITECTURE.md + README "SKILL.md Format"):
 *   - Issue wording     → codebase convention
 *   - `author` is the canonical authorship field (top-level or `metadata.author`);
 *     `creator` is accepted as a legacy alias for backwards compatibility and
 *     resolves identically. The auto-fixer emits `author:` going forward.
 *   - top-level `version` → `metadata.version` (preferred) with `version` fallback
 *   - `XS/S/M/L/XL`     → `low/medium/high/max`
 *   - `type`            → not a recognized frontmatter field; ignored by the
 *                          evaluator so this PR does not silently invent a
 *                          schema. Downstream issues can add it later.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Canonical frontmatter key ordering used by the auto-fixer.
 *
 *  `author` is the canonical authorship field; `creator` is kept in the list
 *  so legacy skills that still declare it are reordered correctly rather than
 *  sinking to the bottom of the frontmatter. New skills scaffolded by the
 *  auto-fixer receive `author:`.
 */
export const CANONICAL_FIELD_ORDER = [
  "name",
  "description",
  "version",
  "license",
  "author",
  "creator",
  "compatibility",
  "allowed-tools",
  "effort",
  "tags",
  "metadata",
] as const;

/** Words we reward as "action verbs" in descriptions. */
// ─── Report aggregator ─────────────────────────────────────────────────────

/**
 * Compute the full evaluation report for a parsed SKILL.md.
 */

// Re-exports — public surface preserved after the split (#677).
export type {
  FixPlanItem,
  EvaluationReport,
  CategoryResult,
  FixResult,
} from "./evaluator-types";
export {
  ROOT_README_SUGGESTION,
  scorePromptEngineering,
  splitSkillMd,
  lineCount,
  scoreDescription,
  scoreContextEfficiency,
  scoreStructure,
} from "./evaluator-scorers";
export {
  scoreTestability,
  scoreSafety,
  scoreLicense,
  scoreNaming,
} from "./evaluator-scorers-policy";
export type { CategoryResultWithLicense } from "./evaluator-scorers-policy";
