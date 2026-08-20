/**
 * Terminal output formatting for the CLI.
 *
 * Split into two physical files for maintainability (issue #455):
 *   - `formatter-core.ts`   — colors, tables, list/search formatters, JSON
 *   - `formatter-detail.ts` — skill detail and multi-instance inspect renderers
 *
 * Re-export everything here so existing imports continue to work.
 */

export {
  // ── Colors ──
  ansi,
  colorEffort,
  colorProvider,
  colorTool,
  // ── Paths ──
  shortenPath,
  // ── Tables and lists ──
  formatSkillTable,
  LARGE_LIST_THRESHOLD,
  formatListSummary,
  formatCompactTable,
  type GroupByAxis,
  formatGroupByTable,
  applyListLimit,
  formatGroupedTable,
  // ── Search results ──
  formatSearchResults,
  type AvailableSkillResult,
  formatAvailableSearchResults,
  // ── Allowed-tools risk ──
  HIGH_RISK_TOOLS,
  MEDIUM_RISK_TOOLS,
  formatAllowedTools,
  // ── Text helpers ──
  wordWrap,
  // ── JSON ──
  formatJSON,
} from "./formatter-core";

export {
  formatSkillDetail,
  colorEvalScore,
  formatSkillInspect,
} from "./formatter-detail";
