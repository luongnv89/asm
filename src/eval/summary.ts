import type { SkillEvalSummary } from "../utils/types";
import type { EvalResult } from "./types";

export interface ProviderEvalReport {
  id: string;
  version: string;
  schemaVersion: number;
  score: number;
  passed: boolean;
  categories: EvalResult["categories"];
  findings: EvalResult["findings"];
  raw?: unknown;
}

export function scoreToGrade(score: number): SkillEvalSummary["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}

export function toProviderEvalReport(result: EvalResult): ProviderEvalReport {
  return {
    id: result.providerId,
    version: result.providerVersion,
    schemaVersion: result.schemaVersion,
    score: result.score,
    passed: result.passed,
    categories: result.categories,
    findings: result.findings,
    raw: result.raw,
  };
}

export function toSkillEvalSummary(
  result: EvalResult,
  evaluatedVersion?: string,
): SkillEvalSummary {
  return {
    providerId: result.providerId,
    providerVersion: result.providerVersion,
    schemaVersion: result.schemaVersion,
    passed: result.passed,
    overallScore: result.score,
    grade: scoreToGrade(result.score),
    categories: result.categories.map((c) => ({
      id: c.id,
      name: c.name,
      score: c.score,
      max: c.max,
    })),
    evaluatedAt: result.startedAt,
    evaluatedVersion,
  };
}

export function sortProviderReports<T extends { id: string }>(
  reports: T[],
): T[] {
  return [...reports].sort((a, b) => {
    if (a.id === "quality" && b.id !== "quality") return -1;
    if (b.id === "quality" && a.id !== "quality") return 1;
    return a.id.localeCompare(b.id);
  });
}
