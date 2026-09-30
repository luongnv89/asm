// Split from evaluator-core.ts (issue #677).

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CategoryResult {
  /** Short, stable id for the category (e.g. "structure"). */
  id: string;
  /** Display name. */
  name: string;
  /** 0..max integer score. */
  score: number;
  /** Maximum attainable score for the category. Always 10 today. */
  max: number;
  /** Human-readable findings (positive and negative). */
  findings: string[];
  /** Concrete improvement suggestions a human author can act on. */
  suggestions: string[];
}

export interface EvaluationReport {
  /** Path to the evaluated skill directory. */
  skillPath: string;
  /** Path to the evaluated SKILL.md. */
  skillMdPath: string;
  /** ISO-8601 timestamp of evaluation. */
  evaluatedAt: string;
  /** Per-category results. */
  categories: CategoryResult[];
  /** Aggregate score in 0..100 (sum of category scores × 100 / sum of maxes). */
  overallScore: number;
  /** Letter grade for humans: A/B/C/D/F. */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Top N improvement suggestions drawn from the lowest-scoring categories. */
  topSuggestions: string[];
  /** Parsed frontmatter (for follow-up tooling). */
  frontmatter: Record<string, string>;
}

export interface FixPlanItem {
  /** Short id of the fix (e.g. "add-missing-version"). */
  id: string;
  /** Description of what will change. */
  description: string;
}

export interface FixResult {
  /** Evaluator report run after the fix (or before, in dry-run). */
  report: EvaluationReport;
  /** Items that would be / were applied. */
  applied: FixPlanItem[];
  /** Items skipped because they are out of scope for auto-fix. */
  skipped: FixPlanItem[];
  /** Unified diff between original and fixed SKILL.md. Empty when no changes. */
  diff: string;
  /** Whether this was a dry run (no writes). */
  dryRun: boolean;
  /** Path to the `.bak` created when writing (null on dry-run or no changes). */
  backupPath: string | null;
  /** Path to the (possibly modified) SKILL.md. */
  skillMdPath: string;
}
