/**
 * Evaluator fix pipeline — report aggregation, the `--fix` planner/applier,
 * and the human/JSON report formatters.
 *
 * Split from evaluator.ts (issue #455). The category scorers and shared types
 * live in `evaluator-core.ts`; batch/input resolution lives in
 * `evaluator-batch.ts`.
 */

import { readFile, writeFile, stat, copyFile, readdir } from "fs/promises";
import { join, resolve, basename, isAbsolute } from "path";
import type { ProviderEvalReport } from "./eval/summary";
import { parseFrontmatter } from "./utils/frontmatter";
import { runCommand } from "./utils/spawn";
import type {
  CategoryResult,
  EvaluationReport,
  FixPlanItem,
  FixResult,
} from "./evaluator-core";
import {
  ROOT_README_SUGGESTION,
  CANONICAL_FIELD_ORDER,
  splitSkillMd,
  lineCount,
  scoreStructure,
  scoreDescription,
  scorePromptEngineering,
  scoreContextEfficiency,
  scoreSafety,
  scoreTestability,
  scoreNaming,
  scoreLicense,
} from "./evaluator-core";
import { scorePII, scoreScriptLint } from "./evaluator-pii-lint";

// ─── Report aggregator ─────────────────────────────────────────────────────

/**
 * Compute the full evaluation report for a parsed SKILL.md.
 */
export async function evaluateSkillContent(args: {
  content: string;
  skillPath: string;
  skillMdPath: string;
  /**
   * Directory entry names at the skill root (basename only, one level deep).
   * Used for filesystem-aware checks such as the README-at-root convention.
   * When omitted (e.g., content-only callers) those checks are skipped.
   */
  rootEntries?: string[];
}): Promise<EvaluationReport> {
  const { content, skillPath, skillMdPath, rootEntries } = args;
  const fm = parseFrontmatter(content);
  const { rawFrontmatter, body } = splitSkillMd(content);

  // Synchronous scorers run immediately; async scorers run in parallel.
  const syncCategories: CategoryResult[] = [
    scoreStructure(fm, body, rawFrontmatter, rootEntries),
    scoreDescription(fm, body),
    scorePromptEngineering(fm, body),
    scoreContextEfficiency(fm, body),
    scoreSafety(fm, body),
    scoreTestability(fm, body),
    scoreLicense(fm, body, rootEntries),
    scoreNaming(fm, body),
  ];

  const [piiResult, scriptLintResult] = await Promise.all([
    scorePII(skillPath),
    scoreScriptLint(skillPath),
  ]);

  const categories: CategoryResult[] = [
    ...syncCategories,
    piiResult,
    scriptLintResult,
  ];

  // Naming bonus: directory basename matches `name` frontmatter
  if (fm.name && basename(skillPath) === fm.name) {
    const naming = categories.find((c) => c.id === "naming")!;
    if (naming.score < naming.max) {
      naming.score = Math.min(naming.max, naming.score + 1);
      naming.findings.push("Directory name matches frontmatter `name`.");
    }
  }

  const sumScore = categories.reduce((s, c) => s + c.score, 0);
  const sumMax = categories.reduce((s, c) => s + c.max, 0);
  const overallScore = Math.round((sumScore / sumMax) * 100);

  let grade: EvaluationReport["grade"] = "F";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 65) grade = "C";
  else if (overallScore >= 50) grade = "D";

  // Top 3 suggestions: pick from the 3 lowest-scoring categories. Structural
  // warnings that don't move the score (e.g., README-at-root) are promoted
  // first so they always surface in the default CLI output.
  const topSuggestions: string[] = [];
  const structure = categories.find((c) => c.id === "structure");
  if (structure?.suggestions.includes(ROOT_README_SUGGESTION)) {
    topSuggestions.push(ROOT_README_SUGGESTION);
  }
  const sortedByScore = [...categories].sort(
    (a, b) => a.score / a.max - b.score / b.max,
  );
  for (const cat of sortedByScore) {
    for (const s of cat.suggestions) {
      if (topSuggestions.length >= 3) break;
      if (!topSuggestions.includes(s)) topSuggestions.push(s);
    }
    if (topSuggestions.length >= 3) break;
  }

  return {
    skillPath,
    skillMdPath,
    evaluatedAt: new Date().toISOString(),
    categories,
    overallScore,
    grade,
    topSuggestions,
    frontmatter: fm,
  };
}

/**
 * Synchronous version of evaluateSkillContent for callers that only have
 * content (no filesystem access). Uses placeholder results for the
 * async-only scorers (pii and script-lint) so the overall score is still
 * computed from the sync categories.
 */
export function evaluateSkillContentSync(args: {
  content: string;
  skillPath: string;
  skillMdPath: string;
  rootEntries?: string[];
}): EvaluationReport {
  const { content, skillPath, skillMdPath, rootEntries } = args;
  const fm = parseFrontmatter(content);
  const { rawFrontmatter, body } = splitSkillMd(content);

  const categories: CategoryResult[] = [
    scoreStructure(fm, body, rawFrontmatter, rootEntries),
    scoreDescription(fm, body),
    scorePromptEngineering(fm, body),
    scoreContextEfficiency(fm, body),
    scoreSafety(fm, body),
    scoreTestability(fm, body),
    scoreLicense(fm, body, rootEntries),
    scoreNaming(fm, body),
    // Async-only scorers — placeholder when content-only is the only input.
    {
      id: "pii",
      name: "PII detection",
      score: 10,
      max: 10,
      findings: ["Skipped — content-only evaluation"],
      suggestions: [],
    },
    {
      id: "script-lint",
      name: "Script linting",
      score: 10,
      max: 10,
      findings: ["Skipped — content-only evaluation"],
      suggestions: [],
    },
  ];

  // Naming bonus
  if (fm.name && basename(skillPath) === fm.name) {
    const naming = categories.find((c) => c.id === "naming")!;
    if (naming.score < naming.max) {
      naming.score = Math.min(naming.max, naming.score + 1);
      naming.findings.push("Directory name matches frontmatter `name`.");
    }
  }

  const sumScore = categories.reduce((s, c) => s + c.score, 0);
  const sumMax = categories.reduce((s, c) => s + c.max, 0);
  const overallScore = Math.round((sumScore / sumMax) * 100);

  let grade: EvaluationReport["grade"] = "F";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 65) grade = "C";
  else if (overallScore >= 50) grade = "D";

  const topSuggestions: string[] = [];
  const structure = categories.find((c) => c.id === "structure");
  if (structure?.suggestions.includes(ROOT_README_SUGGESTION)) {
    topSuggestions.push(ROOT_README_SUGGESTION);
  }
  const sortedByScore = [...categories].sort(
    (a, b) => a.score / a.max - b.score / b.max,
  );
  for (const cat of sortedByScore) {
    for (const s of cat.suggestions) {
      if (topSuggestions.length >= 3) break;
      if (!topSuggestions.includes(s)) topSuggestions.push(s);
    }
    if (topSuggestions.length >= 3) break;
  }

  return {
    skillPath,
    skillMdPath,
    evaluatedAt: new Date().toISOString(),
    categories,
    overallScore,
    grade,
    topSuggestions,
    frontmatter: fm,
  };
}

/**
 * Read SKILL.md from a skill directory and evaluate it.
 * Throws if the path does not exist or SKILL.md is missing.
 */
export async function evaluateSkill(
  skillPath: string,
): Promise<EvaluationReport> {
  const resolved = isAbsolute(skillPath) ? skillPath : resolve(skillPath);

  let s;
  try {
    s = await stat(resolved);
  } catch {
    throw new Error(`Skill path does not exist: ${resolved}`);
  }

  let skillMdPath: string;
  let content: string;

  if (s.isFile()) {
    // Accept a direct SKILL.md path
    skillMdPath = resolved;
    content = await readFile(skillMdPath, "utf-8");
    return evaluateSkillContent({
      content,
      skillPath:
        basename(resolved) === "SKILL.md" ? basename(resolved) : resolved,
      skillMdPath,
    });
  }

  if (!s.isDirectory()) {
    throw new Error(`Skill path is not a directory or file: ${resolved}`);
  }

  skillMdPath = join(resolved, "SKILL.md");
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error(
      `SKILL.md not found in ${resolved}. Run "asm init" to create one.`,
    );
  }

  let rootEntries: string[] | undefined;
  try {
    rootEntries = await readdir(resolved);
  } catch {
    rootEntries = undefined;
  }

  return evaluateSkillContent({
    content,
    skillPath: resolved,
    skillMdPath,
    rootEntries,
  });
}

// ─── Auto-fix pipeline ─────────────────────────────────────────────────────

/**
 * Compute a deterministic fix plan + new SKILL.md content for the given
 * original content. Caller decides whether to write to disk or dry-run.
 *
 * Only low-risk, deterministic edits are applied:
 *   - Add missing `version` as `0.1.0`
 *   - Add missing `author` from git `user.name` if available (legacy
 *     `creator:` is accepted and left in place — not rewritten)
 *   - Infer `effort` from body line count (low/medium/high/max)
 *   - Normalise trailing whitespace and CRLF line endings
 *   - Ensure a blank line between `---` and body
 *   - Reorder frontmatter keys to canonical order when all keys are simple
 *
 * Description-quality fixes and other subjective content are NEVER auto-fixed;
 * they're returned in `skipped`.
 */
export interface BuildFixPlanOptions {
  /** Optional git author string to use when no authorship field
   *  (`author`, `metadata.author`, or the legacy `creator` aliases) is
   *  present. The fixer writes `author:` going forward. */
  gitAuthor?: string | null;
}

export interface BuildFixPlanResult {
  /** Transformed SKILL.md. Same as original if nothing changed. */
  newContent: string;
  applied: FixPlanItem[];
  skipped: FixPlanItem[];
}

function inferEffortFromLines(bodyLines: number): string {
  if (bodyLines <= 20) return "low";
  if (bodyLines <= 80) return "medium";
  if (bodyLines <= 250) return "high";
  return "max";
}

/**
 * Rewrite a frontmatter block so that canonical top-level keys appear in a
 * consistent order. The rewriter is intentionally conservative: it only touches
 * simple `key: value` scalars. Nested blocks (e.g. `metadata:` with indented
 * children) are preserved verbatim at their current position.
 */
function reorderFrontmatter(raw: string): {
  newFrontmatter: string;
  changed: boolean;
} {
  const lines = raw.split("\n");
  type Entry = { key: string; text: string };
  const simple: Entry[] = [];
  const nested: Entry[] = []; // kept at end, in original relative order

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      // blank line — attach to previous context implicitly by ignoring it
      i++;
      continue;
    }
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!match) {
      // Non key-value line at top-level — bail out, treat as unsafe to reorder
      return { newFrontmatter: raw, changed: false };
    }
    const key = match[1];
    const rest = match[2];
    if (rest === "" || rest === ">" || rest === "|") {
      // Nested block or multiline — collect until next non-indented, non-blank line
      const block: string[] = [line];
      i++;
      while (i < lines.length) {
        const nxt = lines[i];
        if (nxt.trim() === "") {
          block.push(nxt);
          i++;
          continue;
        }
        if (/^\s+/.test(nxt)) {
          block.push(nxt);
          i++;
        } else {
          break;
        }
      }
      nested.push({ key, text: block.join("\n") });
    } else {
      simple.push({ key, text: line });
      i++;
    }
  }

  // Sort simple entries by canonical order; unknown keys preserve original order after known.
  const orderIndex = (k: string) => {
    const idx = CANONICAL_FIELD_ORDER.indexOf(
      k as (typeof CANONICAL_FIELD_ORDER)[number],
    );
    return idx === -1 ? CANONICAL_FIELD_ORDER.length + 1 : idx;
  };
  const sortedSimple = [...simple].sort((a, b) => {
    const da = orderIndex(a.key);
    const db = orderIndex(b.key);
    if (da !== db) return da - db;
    return simple.indexOf(a) - simple.indexOf(b);
  });

  const simpleChanged = sortedSimple.some((e, idx) => e !== simple[idx]);

  const rebuilt = [
    ...sortedSimple.map((e) => e.text),
    ...nested.map((e) => e.text),
  ].join("\n");
  return {
    newFrontmatter: rebuilt,
    changed: simpleChanged,
  };
}

/**
 * Build the fix plan and the transformed SKILL.md content.
 */
export function buildFixPlan(
  originalContent: string,
  options: BuildFixPlanOptions = {},
): BuildFixPlanResult {
  const applied: FixPlanItem[] = [];
  const skipped: FixPlanItem[] = [];

  // Normalise CRLF → LF once up front
  let working = originalContent.replace(/\r\n/g, "\n");
  if (working !== originalContent) {
    applied.push({
      id: "normalise-line-endings",
      description: "Convert CRLF line endings to LF.",
    });
  }

  // Strip trailing whitespace on each line.
  const lines = working.split("\n");
  const stripped = lines.map((l) => l.replace(/[ \t]+$/g, ""));
  if (stripped.some((l, i) => l !== lines[i])) {
    applied.push({
      id: "strip-trailing-whitespace",
      description: "Strip trailing whitespace from lines.",
    });
  }
  working = stripped.join("\n");

  // Split + parse
  const { rawFrontmatter, body } = splitSkillMd(working);
  const fm = parseFrontmatter(working);

  if (rawFrontmatter === null) {
    skipped.push({
      id: "missing-frontmatter",
      description:
        "SKILL.md has no frontmatter — not auto-fixable (requires author decisions).",
    });
    return { newContent: working, applied, skipped };
  }

  // Work on the frontmatter block as a string that we can transform.
  let fmStr = rawFrontmatter;

  // 1) Add missing `version` as 0.1.0 when neither top-level nor metadata.version is present.
  const hasVersion = Boolean(fm.version || fm["metadata.version"]);
  if (!hasVersion) {
    fmStr = appendFrontmatterKey(fmStr, "version", "0.1.0");
    applied.push({
      id: "add-missing-version",
      description: "Add `version: 0.1.0`.",
    });
  }

  // 2) Add missing author from git config user.name (if provided).
  //    `creator` is still accepted as a legacy alias, so a skill that declares
  //    only `creator:` is considered complete and the auto-fixer leaves it
  //    alone. New skills get `author:` written.
  const hasAuthor = Boolean(
    fm.author || fm["metadata.author"] || fm.creator || fm["metadata.creator"],
  );
  if (!hasAuthor) {
    const gitAuthor = options.gitAuthor?.trim();
    if (gitAuthor) {
      fmStr = appendFrontmatterKey(fmStr, "author", gitAuthor);
      applied.push({
        id: "add-missing-author",
        description: `Add \`author: ${gitAuthor}\` from git config.`,
      });
    } else {
      skipped.push({
        id: "add-missing-author",
        description:
          "Missing `author` — no git user.name found to fill in safely.",
      });
    }
  }

  // 3) Infer `effort` from body line count.
  if (!fm.effort) {
    const inferred = inferEffortFromLines(lineCount(body));
    fmStr = appendFrontmatterKey(fmStr, "effort", inferred);
    applied.push({
      id: "infer-missing-effort",
      description: `Infer \`effort: ${inferred}\` from body size.`,
    });
  }

  // 4) Default description? Not auto-fixable — belongs to author.
  if (!fm.description) {
    skipped.push({
      id: "missing-description",
      description:
        "Missing `description` — content-level fix, left to the author.",
    });
  }

  // 5) Reorder simple top-level fields to canonical order.
  const reorder = reorderFrontmatter(fmStr);
  if (reorder.changed) {
    applied.push({
      id: "reorder-frontmatter",
      description: "Reorder frontmatter fields to canonical order.",
    });
    fmStr = reorder.newFrontmatter;
  }

  // Re-assemble content: ensure a single blank line between frontmatter and body.
  const trimmedBody = body.replace(/^\n+/, "");
  let newContent = `---\n${fmStr.replace(/^\n+|\n+$/g, "")}\n---\n\n${trimmedBody}`;

  // Ensure trailing newline on file
  if (!newContent.endsWith("\n")) newContent += "\n";

  // Ensure final normalisation only reports applied.reorder/whitespace once.
  if (newContent === originalContent.replace(/\r\n/g, "\n")) {
    // no effective change besides possibly CRLF normalisation already recorded
  }

  return {
    newContent,
    applied,
    skipped,
  };
}

/**
 * Append a simple `key: value` line to a frontmatter block if not already present.
 * Values are quoted when they contain characters that would otherwise need escaping.
 */
function appendFrontmatterKey(
  fmStr: string,
  key: string,
  value: string,
): string {
  const existing = new RegExp(`^${key}:\\s*`, "m");
  if (existing.test(fmStr)) return fmStr;
  const quoted = /[:#{}[\],&*?|<>=!%@`"']/.test(value)
    ? JSON.stringify(value)
    : value;
  const separator = fmStr.length === 0 || fmStr.endsWith("\n") ? "" : "\n";
  return `${fmStr}${separator}${key}: ${quoted}\n`;
}

// ─── Unified diff ─────────────────────────────────────────────────────────

/**
 * Produce a minimal unified diff between two text blobs. This is intentionally
 * naive — it does not compute the true LCS — but it is good enough for humans
 * to eyeball what the fixer will do, and it avoids adding a dependency.
 */
export function unifiedDiff(
  before: string,
  after: string,
  filename = "SKILL.md",
): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

  // Brute-force line diff: emit all of before as "-", then all of after as "+".
  // Coalesce a leading common prefix and trailing common suffix to keep diff tight.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;

  const aMid = a.slice(pre, a.length - suf);
  const bMid = b.slice(pre, b.length - suf);

  // Hunk header (line numbers are 1-based)
  const aStart = pre + 1;
  const bStart = pre + 1;
  lines.push(`@@ -${aStart},${aMid.length} +${bStart},${bMid.length} @@`);

  // Up to 3 lines of leading context
  const contextBefore = a.slice(Math.max(0, pre - 3), pre).map((l) => ` ${l}`);
  const contextAfter = a
    .slice(a.length - suf, Math.min(a.length, a.length - suf + 3))
    .map((l) => ` ${l}`);

  lines.push(...contextBefore);
  for (const line of aMid) lines.push(`-${line}`);
  for (const line of bMid) lines.push(`+${line}`);
  lines.push(...contextAfter);

  return lines.join("\n");
}

// ─── Apply fix to a skill path ─────────────────────────────────────────────

export interface ApplyFixOptions {
  dryRun: boolean;
  gitAuthor?: string | null;
}

export async function applyFix(
  skillPath: string,
  options: ApplyFixOptions,
): Promise<FixResult> {
  const resolved = isAbsolute(skillPath) ? skillPath : resolve(skillPath);
  let skillMdPath: string;
  const s = await stat(resolved).catch(() => null);
  if (!s) {
    throw new Error(`Skill path does not exist: ${resolved}`);
  }
  if (s.isFile()) {
    skillMdPath = resolved;
  } else if (s.isDirectory()) {
    skillMdPath = join(resolved, "SKILL.md");
  } else {
    throw new Error(`Skill path is not a directory or file: ${resolved}`);
  }

  let original: string;
  try {
    original = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error(`SKILL.md not found at ${skillMdPath}.`);
  }

  const plan = buildFixPlan(original, { gitAuthor: options.gitAuthor });
  const diff = unifiedDiff(original, plan.newContent);

  let backupPath: string | null = null;
  if (!options.dryRun && plan.newContent !== original) {
    backupPath = `${skillMdPath}.bak`;
    await copyFile(skillMdPath, backupPath);
    await writeFile(skillMdPath, plan.newContent, "utf-8");
  }

  // Re-evaluate using the (possibly modified) content.
  const report = await evaluateSkillContent({
    content: options.dryRun ? original : plan.newContent,
    skillPath: resolved,
    skillMdPath,
  });

  return {
    report,
    applied: plan.applied,
    skipped: plan.skipped,
    diff,
    dryRun: options.dryRun,
    backupPath,
    skillMdPath,
  };
}

/**
 * Ask `git config user.name` for a default creator string. Returns null on
 * failure / missing value.
 */
export async function detectGitAuthor(): Promise<string | null> {
  try {
    const { stdout, exitCode } = await runCommand([
      "git",
      "config",
      "--global",
      "--get",
      "user.name",
    ]);
    if (exitCode !== 0) return null;
    const trimmed = stdout.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

// ─── Formatters ────────────────────────────────────────────────────────────

function bar(score: number, max: number, width = 20): string {
  const filled = Math.round((score / max) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/**
 * Render a human-readable evaluation report (no ANSI — the CLI adds colour).
 *
 * Quality is the primary provider — its score drives the `Overall score:`
 * headline and its categories get the familiar bar chart. Any additional
 * providers (e.g. skill-best-practice) are surfaced as a one-line score next to
 * the headline plus a dedicated findings block when they have something to
 * say. This keeps a single `asm eval` call showing all results without
 * duplicating quality's categories under a second heading.
 */
export function formatReport(
  report: EvaluationReport & { providers?: ProviderEvalReport[] },
): string {
  const lines: string[] = [];
  lines.push(`Skill evaluation: ${report.skillPath}`);
  lines.push(`SKILL.md:         ${report.skillMdPath}`);
  lines.push("");
  lines.push(`Overall score:    ${report.overallScore}/100  (${report.grade})`);

  const extraProviders = (report.providers ?? []).filter(
    (p) => p.id !== "quality",
  );
  for (const provider of extraProviders) {
    const verdict = provider.passed ? "pass" : "fail";
    const label = `${provider.id}@${provider.version}`;
    lines.push(`  ${label}:  ${provider.score}/100  ${verdict}`);
  }

  lines.push("");
  lines.push("Categories:");
  for (const c of report.categories) {
    lines.push(
      `  ${c.name.padEnd(28)} ${String(c.score).padStart(2)}/${c.max}  ${bar(
        c.score,
        c.max,
      )}`,
    );
  }
  lines.push("");
  if (report.topSuggestions.length > 0) {
    lines.push("Top suggestions:");
    for (const s of report.topSuggestions) {
      lines.push(`  • ${s}`);
    }
  } else {
    lines.push("No suggestions — skill looks great.");
  }

  for (const provider of extraProviders) {
    const checks = extractProviderChecks(provider.raw);
    if (checks && checks.length > 0) {
      lines.push("");
      lines.push(`${provider.id}@${provider.version} breakdown:`);
      for (const check of checks) {
        const mark = check.passed
          ? "√"
          : check.severity === "warning"
            ? "⚠"
            : "×";
        lines.push(`  ${mark} ${check.label}`);
        if (!check.passed) {
          lines.push(`      [${check.severity}] ${check.message}`);
        }
      }
      continue;
    }
    if (provider.findings.length === 0) continue;
    lines.push("");
    lines.push(`${provider.id}@${provider.version} findings:`);
    for (const finding of provider.findings) {
      lines.push(`  [${finding.severity}] ${finding.message}`);
    }
  }
  return lines.join("\n");
}

interface ProviderCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
}

function extractProviderChecks(raw: unknown): ProviderCheck[] | null {
  if (!raw || typeof raw !== "object") return null;
  const checks = (raw as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return null;
  const parsed: ProviderCheck[] = [];
  for (const entry of checks) {
    if (!entry || typeof entry !== "object") return null;
    const c = entry as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      typeof c.label !== "string" ||
      typeof c.passed !== "boolean" ||
      typeof c.message !== "string" ||
      (c.severity !== "error" && c.severity !== "warning")
    ) {
      return null;
    }
    parsed.push({
      id: c.id,
      label: c.label,
      passed: c.passed,
      severity: c.severity,
      message: c.message,
    });
  }
  return parsed;
}

export function formatReportJSON(report: EvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatFixPreview(result: FixResult): string {
  const lines: string[] = [];
  if (result.applied.length === 0 && result.skipped.length === 0) {
    lines.push("No fixes needed — SKILL.md is already clean.");
    return lines.join("\n");
  }
  if (result.applied.length > 0) {
    lines.push(
      `${result.dryRun ? "Would apply" : "Applied"} ${result.applied.length} fix(es):`,
    );
    for (const a of result.applied) {
      lines.push(`  • ${a.description}`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push("");
    lines.push(`Skipped ${result.skipped.length} issue(s) (not auto-fixable):`);
    for (const s of result.skipped) {
      lines.push(`  • ${s.description}`);
    }
  }
  if (result.diff) {
    lines.push("");
    lines.push("Diff:");
    lines.push(result.diff);
  }
  if (!result.dryRun && result.backupPath) {
    lines.push("");
    lines.push(`Backup: ${result.backupPath}`);
  }
  return lines.join("\n");
}
