import { ansi } from "../formatter";
import type { SkillInfo } from "../utils/types";
import { checkHealth } from "../health";
import type { SecurityAuditReport } from "../utils/types";

// ─── Shared helpers ─────────────────────────────────────────────────────────

export function verdictToRiskScore(verdict: string): number {
  switch (verdict) {
    case "dangerous":
      return 3;
    case "warning":
      return 2;
    case "caution":
      return 1;
    default:
      return 0;
  }
}

/**
 * Build the common machine-output data shape for security audit commands.
 * Accepts one or more SecurityAuditReports and returns { verdict, findings, risk_score }.
 */

export function formatAuditMachineData(reports: SecurityAuditReport[]) {
  return {
    verdict: reports.every((r) => r.verdict === "safe")
      ? "safe"
      : reports.some((r) => r.verdict === "dangerous")
        ? "dangerous"
        : "warning",
    findings: reports.map((r) => ({
      skill: r.skillName,
      verdict: r.verdict,
      verdict_reason: r.verdictReason,
      total_files: r.totalFiles,
      total_lines: r.totalLines,
    })),
    risk_score: reports.reduce(
      (sum, r) => sum + verdictToRiskScore(r.verdict),
      0,
    ),
  };
}
export function error(msg: string) {
  console.error(ansi.red(`Error: ${msg}`));
}

// ─── Help text ──────────────────────────────────────────────────────────────

export async function enrichWithHealth(skills: SkillInfo[]): Promise<void> {
  await Promise.all(
    skills.map(async (skill) => {
      skill.warnings = await checkHealth(skill);
    }),
  );
}

export function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let resolved = false;

    function cleanup() {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.pause();
      clearTimeout(timer);
    }

    function finish(value: string) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    }

    function onData(chunk: string) {
      data += chunk;
      if (data.includes("\n")) {
        finish(data.trim());
      }
    }

    function onEnd() {
      finish(data.trim());
    }

    const timer = setTimeout(() => {
      finish(data.trim());
    }, 30_000);

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

// ─── disable / enable ────────────────────────────────────────────────────────

export function groupBySource(
  matched: SkillInfo[],
  pool: SkillInfo[],
): SiblingGroup[] {
  const siblingsByPath = new Map<string, SkillInfo[]>();
  for (const s of pool) {
    const list = siblingsByPath.get(s.realPath) ?? [];
    list.push(s);
    siblingsByPath.set(s.realPath, list);
  }

  const groups = new Map<string, SiblingGroup>();
  for (const s of matched) {
    if (groups.has(s.realPath)) continue;
    groups.set(s.realPath, {
      realPath: s.realPath,
      representative: s,
      siblings: siblingsByPath.get(s.realPath) ?? [s],
    });
  }
  return [...groups.values()];
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface SiblingGroup {
  /** Canonical on-disk directory (resolved `realPath`) all siblings share. */
  realPath: string;
  /** The instance to drive the on-disk rename from (any sibling works). */
  representative: SkillInfo;
  /** Every scanned instance — across providers/scopes — sharing `realPath`. */
  siblings: SkillInfo[];
}
