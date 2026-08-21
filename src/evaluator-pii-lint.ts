/**
 * PII detection and script linting scorers for the skill evaluator.
 *
 * Issues #492 (PII detection) and #494 (script linting).
 * These scorers need filesystem access so they are async and called from
 * evaluateSkillContent via Promise.all.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, isAbsolute, resolve } from "path";
import type { CategoryResult } from "./evaluator-core";

// ─── PII detection scorer ──────────────────────────────────────────────────

/**
 * PII detection categories and their regex patterns.
 *
 * In-scope (detected):
 *   - Email addresses
 *   - Phone numbers (US / international formats)
 *   - Postal / mailing addresses (street, city, state, zip)
 *   - US Social Security Numbers
 *   - US / UK driver licence numbers
 *
 * Deliberately out of scope:
 *   - Full names (too many false positives from common words)
 *   - IP addresses / hostnames (infrastructure, not PII)
 *   - Credit-card numbers (handled by a separate secrets scan)
 *   - Passport / visa numbers (jurisdictional noise)
 *
 * Severity: "warning" — a PII hit does NOT block indexing; it warns the
 * author so they can scrub examples, transcripts, or fixture data before
 * publishing.
 */

const PII_PATTERNS: {
  category: string;
  pattern: RegExp;
}[] = [
  {
    category: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
  },
  {
    category: "phone",
    pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[\s-]?\d{3}[-.]?\d{4}\b/g,
  },
  {
    category: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    category: "address",
    pattern:
      /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Place|Pl|Way|Circle|Cir)\b/gi,
  },
  {
    category: "license",
    pattern: /\b[A-Z]{2}\d{6,8}\b/g,
  },
];

/**
 * Scan all text files in a skill directory for PII patterns.
 *
 * Scans files with extensions: .md, .txt, .json, .yaml, .yml, .sh, .py, .bash,
 * .js, .ts, .jsx, .tsx, .html, .css, .log.
 *
 * Returns a CategoryResult with findings per-file:per-line.
 */
export async function scorePII(skillPath: string): Promise<CategoryResult> {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 10; // start perfect; deduct for each category found
  const categoryHits = new Set<string>();

  const resolved = isAbsolute(skillPath) ? skillPath : resolve(skillPath);

  // Collect text files to scan
  const textExtensions = new Set([
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".sh",
    ".py",
    ".bash",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".html",
    ".css",
    ".log",
  ]);

  async function scanDir(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        // Skip hidden dirs, node_modules, dist, build
        if (entry.startsWith(".") || entry === "node_modules") continue;
        await scanDir(full);
      } else if (s.isFile()) {
        const ext = entry.includes(".") ? "." + entry.split(".").pop() : "";
        if (!textExtensions.has(ext)) continue;
        try {
          const content = await readFile(full, "utf-8");
          const lines = content.split("\n");
          let inFrontmatter = false;
          let inCodeFence = false;
          for (const pii of PII_PATTERNS) {
            pii.pattern.lastIndex = 0;
            inFrontmatter = false;
            inCodeFence = false;
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              const line = lines[lineIdx];
              // Toggle frontmatter block
              if (line.trim() === "---") {
                inFrontmatter = !inFrontmatter;
                continue;
              }
              // Toggle code fence blocks
              if (line.trim().startsWith("```")) {
                inCodeFence = !inCodeFence;
                continue;
              }
              // Skip lines inside frontmatter or code fences
              if (inFrontmatter || inCodeFence) continue;
              const matches = line.match(pii.pattern);
              if (matches && matches.length > 0) {
                if (!categoryHits.has(pii.category)) {
                  categoryHits.add(pii.category);
                  score -= 2;
                }
                const relPath = full.replace(resolved + "/", "");
                findings.push(
                  `[${pii.category}] ${relPath}:${lineIdx + 1} — found ${matches.length} match(es)`,
                );
              }
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  await scanDir(resolved);

  if (categoryHits.size === 0) {
    findings.push("No PII detected in skill files.");
  } else {
    findings.push(
      `PII detected in ${categoryHits.size} category/categories: ${[...categoryHits].join(", ")}.`,
    );
    suggestions.push(
      "Remove or redact personal data from examples, transcripts, and fixture files before publishing.",
    );
  }

  return {
    id: "pii",
    name: "PII detection",
    score: Math.max(0, Math.min(10, Math.round(score))),
    max: 10,
    findings,
    suggestions,
  };
}

// ─── Script lint scorer ─────────────────────────────────────────────────────

/**
 * Script languages and their linter commands.
 *
 * In-scope:
 *   - Bash / shell scripts (.sh, .bash) → shellcheck
 *   - Python scripts (.py) → python3 -m py_compile (syntax check)
 *
 * Deliberately out of scope:
 *   - JavaScript / TypeScript (handled by the build system)
 *   - Ruby, Perl, etc. (not commonly bundled with skills)
 *
 * Graceful degradation: when a linter is unavailable the scorer records a
 * "skipped" finding instead of silently passing, so the author knows the
 * check was not performed.
 */

const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".py"]);

const LINTER_CONFIG: Record<
  string,
  {
    command: string;
    args: string[];
    language: string;
  }
> = {
  ".sh": {
    command: "shellcheck",
    args: ["--format=json1"],
    language: "bash/shell",
  },
  ".bash": {
    command: "shellcheck",
    args: ["--format=json1"],
    language: "bash/shell",
  },
  ".py": {
    command: "python3",
    args: ["-m", "py_compile"],
    language: "python",
  },
};

interface LintFinding {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

/**
 * Run a linter on a single script file and return structured findings.
 * Returns null when the linter is unavailable.
 */
async function runLinter(
  filePath: string,
  ext: string,
): Promise<LintFinding[] | null> {
  const config = LINTER_CONFIG[ext];
  if (!config) return null;

  try {
    const { runCommand } = await import("./utils/spawn");
    const result = await runCommand([config.command, ...config.args, filePath]);

    if (result.exitCode !== 0) {
      // Parse output based on linter type
      if (ext === ".py") {
        // Python compile errors are multi-line:
        //   File "path", line N
        //     code
        //           ^
        // SyntaxError: message
        const lines = result.stderr.split("\n");
        const findings: LintFinding[] = [];
        let pendingLine = 0;
        for (const line of lines) {
          const fileMatch = line.match(/File "([^"]+)", line (\d+)/);
          if (fileMatch) {
            pendingLine = parseInt(fileMatch[2], 10);
            continue;
          }
          const syntaxMatch = line.match(
            /^\s*(SyntaxError|IndentationError|ImportError|AttributeError|TypeError|ValueError):\s*(.+)$/,
          );
          if (syntaxMatch) {
            findings.push({
              file: filePath,
              line: pendingLine || 0,
              severity: "error",
              message: `${syntaxMatch[1]}: ${syntaxMatch[2].trim()}`,
            });
            pendingLine = 0;
          }
        }
        return findings;
      }

      // Shellcheck JSON output
      try {
        const issues = JSON.parse(result.stderr);
        const findings: LintFinding[] = [];
        if (Array.isArray(issues)) {
          for (const issue of issues) {
            if (issue && typeof issue === "object") {
              const i = issue as Record<string, unknown>;
              findings.push({
                file: filePath,
                line: Number(i.line) || 0,
                severity:
                  i.level === "error" || i.level === "e"
                    ? "error"
                    : i.level === "warning" || i.level === "w"
                      ? "warning"
                      : "info",
                message: (i.message as string) || "Unknown issue",
              });
            }
          }
        }
        return findings;
      } catch {
        // If JSON parsing fails, fall back to stderr text
        return [
          {
            file: filePath,
            line: 0,
            severity: "warning",
            message: `Linter exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
          },
        ];
      }
    }
    return [];
  } catch (err: unknown) {
    // Linter not found — return null to signal "skipped"
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    // Other errors — treat as skipped
    return null;
  }
}

/**
 * Lint executable scripts bundled with a skill.
 *
 * Scans for .sh, .bash, and .py files. Runs shellcheck for shell scripts
 * and python3 -m py_compile for Python scripts. When a linter is
 * unavailable the check is marked as "skipped".
 */
export async function scoreScriptLint(
  skillPath: string,
): Promise<CategoryResult> {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 10;
  let lintedCount = 0;
  let skipped = false;
  const allFindings: LintFinding[] = [];

  const resolved = isAbsolute(skillPath) ? skillPath : resolve(skillPath);

  async function scanDir(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        await scanDir(full);
      } else if (s.isFile()) {
        const ext = entry.includes(".") ? "." + entry.split(".").pop() : "";
        if (!SCRIPT_EXTENSIONS.has(ext)) continue;
        const relPath = full.replace(resolved + "/", "");
        const linterResult = await runLinter(full, ext);
        if (linterResult === null) {
          skipped = true;
          const lang = LINTER_CONFIG[ext]?.language || ext;
          findings.push(
            `[${lang}] ${relPath}: lint skipped — linter not available`,
          );
        } else {
          lintedCount++;
          allFindings.push(...linterResult);
          for (const f of linterResult) {
            const sev = f.severity.toUpperCase();
            findings.push(
              `[${sev}] ${relPath}:${f.line || "*"} — ${f.message}`,
            );
          }
        }
      }
    }
  }

  await scanDir(resolved);

  if (lintedCount === 0 && !skipped) {
    findings.push("No bundled scripts found to lint.");
  } else if (skipped && lintedCount === 0) {
    findings.push("No bundled scripts found and linter is unavailable.");
  } else if (allFindings.length === 0) {
    findings.push(`Linted ${lintedCount} script(s) — no issues found.`);
  } else {
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;
    score = Math.max(0, 10 - errors * 3 - warnings);
    findings.push(
      `Found ${errors} error(s) and ${warnings} warning(s) across ${lintedCount} script(s).`,
    );
    suggestions.push(
      "Fix lint errors in bundled scripts — quoting issues, undefined variables, and syntax errors can cause runtime failures.",
    );
  }

  return {
    id: "script-lint",
    name: "Script linting",
    score: Math.max(0, Math.min(10, Math.round(score))),
    max: 10,
    findings,
    suggestions,
  };
}
