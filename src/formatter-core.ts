/**
 * Formatter core — colors, tables, list/search formatters, and JSON output.
 * Split from formatter.ts (issue #455). Skill detail/inspect rendering lives
 * in `formatter-detail.ts`.
 */

import type {
  DependencyAcquireResult,
  DependencyReleaseResult,
  DependencyStaleCleanupResult,
  GetBorrowCleanupResult,
  GetPathResult,
  GetResult,
} from "./utils/types";
import { formatTokenCount } from "./utils/token-count";
import { ansi } from "./formatter-colors";

// ─── Tag editing ─────────────────────────────────────────────────────────────

export interface TagUpdateResult {
  name: string;
  path: string;
  tags: string[];
  /** Tags this call actually added/removed (diff of before vs after). */
  applied: string[];
  changed: boolean;
}

export function formatTagUpdates(
  action: "add" | "remove",
  results: TagUpdateResult[],
): string {
  const verb = action === "add" ? "Added tags to" : "Removed tags from";
  return results
    .map((result) => {
      const applied =
        result.applied.length > 0 ? result.applied.join(", ") : "(none)";
      const remaining =
        action === "remove" && result.changed
          ? ` — now: ${result.tags.length > 0 ? result.tags.join(", ") : "(none)"}`
          : "";
      const suffix = result.changed ? "" : " (unchanged)";
      return `${verb} ${ansi.bold(result.name)}: ${applied}${remaining}${suffix}`;
    })
    .join("\n");
}

// ─── Reference-tier output ─────────────────────────────────────────────────

export function formatGetProvenance(result: GetResult | GetPathResult): string {
  const lines = [
    `  ${ansi.bold(result.name)}  ${ansi.dim(formatTokenCount(result.tokenCount))}`,
    `  ${ansi.dim("source:")} ${result.source}${result.commit ? ` @ ${result.commit.slice(0, 7)}` : ""} ${ansi.dim(`(${result.tier})`)}`,
  ];
  if (result.security) {
    const { risk, warnings, categories } = result.security;
    const label =
      risk === "high"
        ? ansi.red("[!] High Risk")
        : risk === "medium"
          ? ansi.yellow("[~] Medium Risk")
          : ansi.green("[ok] Safe");
    const detail = warnings
      ? ansi.dim(
          ` (${warnings} warning${warnings === 1 ? "" : "s"}: ${categories.join(", ")})`,
        )
      : "";
    lines.push(`  ${ansi.dim("security:")} ${label}${detail}`);
  }
  lines.push(
    `  ${ansi.dim("residency:")} ${ansi.dim("path" in result ? "none — borrowed copy is not installed" : "none — nothing was installed")}`,
  );
  if ("path" in result) {
    lines.push(
      `  ${ansi.dim("borrow:")} full copy retained until explicit cleanup`,
    );
    // Do not interpolate a filesystem path into pasteable shell syntax. Config
    // roots may contain quotes, $ or backticks; structured output provides argv.
    lines.push(
      `  ${ansi.dim("cleanup:")} run asm cleanup with the exact path printed to stdout.`,
    );
  }
  return lines.join("\n") + "\n\n";
}

export function formatGetPath(result: GetPathResult): string {
  return result.path + "\n";
}

export function formatGetBorrowCleanup(result: GetBorrowCleanupResult): string {
  switch (result.status) {
    case "removed":
      return `Removed borrowed skill: ${result.path}`;
    case "missing":
      return `Borrow was already missing: ${result.path}`;
    case "not-found":
      return `No registered borrow at this exact path (nothing removed): ${result.path}`;
    case "refused":
      return `Borrow cleanup refused: ${result.errors.join("; ")}`;
  }
}

export function formatCleanupHelp(): string {
  return `${ansi.bold("Usage:")} asm cleanup <borrowed-path> [--json | --machine]

Remove only an exact ASM-owned directory returned by asm get --path.
Original local, installed and library skills are never removed.
Unknown or already cleaned paths are safe no-ops. Ownership mismatches are
refused; unsafe replacements are preserved (possibly in quarantine).
Use the absolute path exactly as returned, not a symlink or parent/child path.`;
}

// ─── Temporary dependency leases ───────────────────────────────────────────

export function formatDependencyDiscovery(result: {
  name: string;
  source: string;
  dependencies: string[];
}): string {
  if (result.dependencies.length === 0) {
    return `${result.name} declares no optional skill dependencies.`;
  }
  return [
    `${ansi.bold(result.name)} optional dependencies (${result.source}):`,
    ...result.dependencies.map((dependency) => `  - ${dependency}`),
  ].join("\n");
}

export function formatDependencyAcquisition(
  result: DependencyAcquireResult,
): string {
  const status = result.owned ? "lease-owned copy" : "pre-existing target";
  return `${ansi.green("✓")} ${result.name} ready at ${result.path} (${status}${result.reused ? ", reused" : ""})`;
}

export function formatDependencyRelease(
  result: DependencyReleaseResult,
): string {
  if (result.alreadyReleased) {
    return `Session ${result.sessionId} was already released.`;
  }
  return [
    `${ansi.green("✓")} released session ${result.sessionId}`,
    `  removed: ${result.removed.length}`,
    `  preserved: ${result.preserved.length}`,
    `  already missing: ${result.missing.length}`,
    `  errors: ${result.errors.length}`,
  ].join("\n");
}

export function formatDependencyStaleCleanup(
  result: DependencyStaleCleanupResult,
): string {
  return [
    `${result.dryRun ? "Classified" : "Cleaned"} dependency leases older than ${result.staleBefore}`,
    `  stale: ${result.stale.length}`,
    `  active: ${result.active.length}`,
    `  cleaned: ${result.cleaned.length}`,
    `  errors: ${result.errors.length}`,
  ].join("\n");
}

// ─── JSON formatter ─────────────────────────────────────────────────────────

export function formatJSON(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Re-exports — public surface preserved after the split (#677).
export {
  colorProvider,
  useColor,
  MEDIUM_RISK_TOOLS,
  HIGH_RISK_TOOLS,
  formatAllowedTools,
  toolRiskWarning,
  colorTool,
  providerBadge,
  ansi,
  colorEffort,
} from "./formatter-colors";
export {
  formatSkillTable,
  formatCompactTable,
  shortenPath,
  formatGroupedTable,
  applyListLimit,
  formatGroupByTable,
  LARGE_LIST_THRESHOLD,
  formatListSummary,
} from "./formatter-table";
export type { GroupByAxis } from "./formatter-table";
export {
  formatAvailableSearchResults,
  wordWrap,
  formatSearchResults,
} from "./formatter-search";
export type { AvailableSkillResult } from "./formatter-search";
