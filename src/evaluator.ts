/**
 * Skill quality evaluator for `asm eval <skill-path>`.
 *
 * Evaluates a skill's SKILL.md against skill-authoring best practices and
 * produces a structured report with per-category scores, an overall score,
 * and actionable improvement suggestions.
 *
 * Categories (7):
 *   1. Structure & completeness   — frontmatter + markdown structure
 *   2. Description quality        — specific trigger phrasing, action verbs
 *   3. Prompt engineering         — progressive disclosure, degrees of freedom, examples
 *   4. Context efficiency         — references/templates instead of inline content
 *   5. Safety & guardrails        — error handling, prerequisites, confirmations
 *   6. Testability                — acceptance criteria, edge cases, verifiable outputs
 *   7. Naming & conventions       — naming conventions, imperative mood, consistent labels
 *
 * Also provides `--fix` / `--fix --dry-run` auto-fix for deterministic
 * frontmatter issues (ordering, version default, creator from git, effort
 * inference from size, trailing whitespace, CRLF normalization).
 *
 * Schema mapping notes (see also /docs/ARCHITECTURE.md + README "SKILL.md Format"):
 *   - Issue wording     → codebase convention
 *   - `author`          → `creator` (or `metadata.creator`)
 *   - top-level `version` → `metadata.version` (preferred) with `version` fallback
 *   - `XS/S/M/L/XL`     → `low/medium/high/max`
 *   - `type`            → not a recognized frontmatter field; ignored by the
 *                          evaluator so this PR does not silently invent a
 *                          schema. Downstream issues can add it later.
 */

import {
  readFile,
  writeFile,
  stat,
  copyFile,
  access,
  readdir,
} from "fs/promises";
import { join, resolve, basename, isAbsolute } from "path";
import type { ProviderEvalReport } from "./eval/summary";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";

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

// ─── Constants ──────────────────────────────────────────────────────────────

/** Canonical frontmatter key ordering used by the auto-fixer. */
export const CANONICAL_FIELD_ORDER = [
  "name",
  "description",
  "version",
  "license",
  "creator",
  "compatibility",
  "allowed-tools",
  "effort",
  "tags",
  "metadata",
] as const;

/** Words we reward as "action verbs" in descriptions. */
const ACTION_VERBS = [
  "add",
  "analyze",
  "audit",
  "build",
  "check",
  "configure",
  "convert",
  "create",
  "debug",
  "deploy",
  "detect",
  "edit",
  "evaluate",
  "explain",
  "export",
  "extract",
  "fetch",
  "find",
  "fix",
  "format",
  "generate",
  "identify",
  "improve",
  "index",
  "inspect",
  "install",
  "list",
  "manage",
  "migrate",
  "optimize",
  "parse",
  "plan",
  "prepare",
  "publish",
  "refactor",
  "remove",
  "rename",
  "report",
  "research",
  "review",
  "run",
  "scaffold",
  "scan",
  "score",
  "search",
  "set",
  "setup",
  "show",
  "summarize",
  "sync",
  "test",
  "transform",
  "translate",
  "update",
  "validate",
  "verify",
  "write",
];

const SAFETY_KEYWORDS = [
  "confirm",
  "confirmation",
  "error",
  "errors",
  "fail",
  "failure",
  "caution",
  "warning",
  "prerequisite",
  "prerequisites",
  "requires",
  "requirements",
  "rollback",
  "dry-run",
  "dry run",
  "safety",
  "validate",
  "validation",
  "check",
  "backup",
];

const TESTABILITY_KEYWORDS = [
  "acceptance criteria",
  "expected output",
  "expected result",
  "edge case",
  "edge cases",
  "test",
  "tests",
  "testing",
  "verify",
  "verification",
  "assert",
  "example input",
  "example output",
  "given",
  "then",
];

const EFFICIENCY_KEYWORDS = [
  "reference",
  "references",
  "see",
  "template",
  "templates",
  "script",
  "scripts",
  "helper",
  "helpers",
  "link",
];

const PROGRESSIVE_DISCLOSURE_KEYWORDS = [
  "when to use",
  "quick start",
  "overview",
  "instructions",
  "steps",
  "workflow",
  "phases",
  "progressive",
];

// ─── Body / Frontmatter helpers ─────────────────────────────────────────────

/**
 * Split SKILL.md content into `{ frontmatter, body, rawFrontmatter }`.
 * If no frontmatter block is present, `rawFrontmatter` is null and the entire
 * content is returned as the body.
 */
export function splitSkillMd(content: string): {
  rawFrontmatter: string | null;
  body: string;
} {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { rawFrontmatter: null, body: content };
  }

  // Find the closing `---`
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      const fm = lines.slice(1, i).join("\n");
      const body = lines.slice(i + 1).join("\n");
      return { rawFrontmatter: fm, body };
    }
  }

  // Unclosed frontmatter → treat entire rest as "frontmatter-ish"
  return {
    rawFrontmatter: lines.slice(1).join("\n"),
    body: "",
  };
}

function lineCount(str: string): number {
  if (!str) return 0;
  return str.split("\n").length;
}

function wordCount(str: string): number {
  if (!str) return 0;
  return str
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean).length;
}

function hasAnyHeading(body: string, min = 1): boolean {
  const headings = body.match(/^#{1,6}\s+\S/gm) || [];
  return headings.length >= min;
}

function containsAny(text: string, needles: string[]): string[] {
  const lc = text.toLowerCase();
  return needles.filter((n) => lc.includes(n));
}

function hasCodeBlock(body: string): boolean {
  return /```[\s\S]+?```/m.test(body);
}

function hasList(body: string): boolean {
  return /^\s*[-*]\s+\S/m.test(body) || /^\s*\d+\.\s+\S/m.test(body);
}

// ─── Category scorers ───────────────────────────────────────────────────────
// Each scorer takes the parsed frontmatter + body and returns a 0..10 score.

function scoreStructure(
  fm: Record<string, string>,
  body: string,
  rawFrontmatter: string | null,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  // Frontmatter present?  (2 pts)
  if (rawFrontmatter !== null) {
    score += 2;
    findings.push("Has YAML frontmatter block.");
  } else {
    findings.push("SKILL.md has no YAML frontmatter.");
    suggestions.push(
      "Add a YAML frontmatter block delimited by `---` with at least `name` and `description` fields.",
    );
  }

  // Required fields (3 pts)
  const hasName = Boolean(fm.name && fm.name.trim());
  const hasDescription = Boolean(fm.description && fm.description.trim());
  if (hasName) score += 1.5;
  else {
    findings.push("Missing required field: name.");
    suggestions.push(
      "Add `name:` to frontmatter (use the skill directory name).",
    );
  }
  if (hasDescription) score += 1.5;
  else {
    findings.push("Missing required field: description.");
    suggestions.push("Add a one-line `description:` to frontmatter.");
  }

  // Recommended fields (3 pts)
  const version = resolveVersion(fm);
  const versionKnown = version && version !== "0.0.0";
  if (versionKnown) score += 1;
  else {
    findings.push("Missing or default version.");
    suggestions.push(
      "Set `metadata.version` (or top-level `version`) using semver (e.g. 0.1.0).",
    );
  }

  const hasCreator = Boolean(fm.creator || fm["metadata.creator"]);
  if (hasCreator) score += 1;
  else {
    findings.push("Missing `creator`.");
    suggestions.push(
      "Add a `creator` field so users know who authored and maintains the skill.",
    );
  }

  const hasLicense = Boolean(fm.license);
  if (hasLicense) score += 1;
  else {
    findings.push("Missing `license`.");
    suggestions.push("Add a `license` field (e.g. `license: MIT`).");
  }

  // Body structure (2 pts)
  const body20 = body.trim().length >= 20;
  const hasHeadings = hasAnyHeading(body, 1);
  if (body20) {
    score += 1;
    findings.push("Body has meaningful content.");
  } else {
    findings.push("Body content is too short (<20 chars of instructions).");
    suggestions.push(
      "Flesh out the markdown body with at least one paragraph of instructions for the agent.",
    );
  }
  if (hasHeadings) {
    score += 1;
    findings.push("Body uses markdown headings.");
  } else {
    findings.push("Body has no markdown headings.");
    suggestions.push(
      "Add section headings (e.g. `## When to Use`, `## Instructions`) so the agent can navigate the skill quickly.",
    );
  }

  return {
    id: "structure",
    name: "Structure & completeness",
    score: Math.round(score),
    max: 10,
    findings,
    suggestions,
  };
}

function scoreDescription(
  fm: Record<string, string>,
  _body: string,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const desc = (fm.description || "").trim();
  if (!desc) {
    findings.push("No description.");
    suggestions.push(
      "Write a one-sentence description that says specifically what the skill does and when to use it.",
    );
    return {
      id: "description",
      name: "Description quality",
      score: 0,
      max: 10,
      findings,
      suggestions,
    };
  }

  const words = wordCount(desc);
  findings.push(`Description is ${words} words.`);

  // Length sweet spot: 8..40 words (4 pts)
  if (words >= 8 && words <= 40) {
    score += 4;
  } else if (words >= 5 && words < 8) {
    score += 2;
    suggestions.push(
      "Lengthen the description slightly so it names both the action and the trigger (aim for 8–20 words).",
    );
  } else if (words >= 41 && words <= 60) {
    score += 2;
    suggestions.push(
      "Trim the description — aim for under 40 words. Move the long version to the markdown body.",
    );
  } else if (words > 60) {
    score += 0;
    suggestions.push(
      "Description is too long. Keep it under 40 words; put detail in the body.",
    );
  } else {
    score += 0;
    suggestions.push("Description is too short. Aim for 8–20 words.");
  }

  // Starts with a lowercase imperative / action verb (3 pts)
  const firstWord = desc
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^\w-]/g, "");
  const hasActionVerb = Boolean(
    firstWord &&
    (ACTION_VERBS.includes(firstWord) ||
      ACTION_VERBS.includes(firstWord.replace(/s$/, ""))),
  );
  if (hasActionVerb) {
    score += 3;
    findings.push("Starts with an action verb.");
  } else {
    findings.push(
      `Does not start with a recognized action verb (got "${firstWord ?? ""}").`,
    );
    suggestions.push(
      'Start the description with an imperative action verb (e.g. "Generate...", "Analyze...", "Review...").',
    );
  }

  // Mentions a specific trigger / "use when" / "for" (3 pts)
  const hasTrigger =
    /\buse when\b|\btrigger\b|\bwhen\b|\bfor\b/i.test(desc) ||
    /\b(before|after|during)\b/i.test(desc);
  if (hasTrigger) {
    score += 3;
    findings.push("Mentions a trigger or use-case signal.");
  } else {
    findings.push("No explicit trigger / use-case phrase.");
    suggestions.push(
      'Name the trigger in the description — e.g. "Use when...", "for reviewing...", "before publishing...".',
    );
  }

  return {
    id: "description",
    name: "Description quality",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

function scorePromptEngineering(
  _fm: Record<string, string>,
  body: string,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  // Progressive disclosure cues: section structure (3 pts)
  const pdMatches = containsAny(body, PROGRESSIVE_DISCLOSURE_KEYWORDS);
  if (pdMatches.length >= 2) {
    score += 3;
    findings.push(
      `Progressive disclosure cues present: ${pdMatches.slice(0, 3).join(", ")}.`,
    );
  } else if (pdMatches.length === 1) {
    score += 1;
    suggestions.push(
      'Add clearer section labels — e.g. "## When to Use" and "## Instructions" — to support progressive disclosure.',
    );
  } else {
    suggestions.push(
      'Structure the body with "## When to Use" and "## Instructions" sections so the agent reads only what it needs.',
    );
  }

  // Lists / steps / ordered instructions (2 pts)
  if (hasList(body)) {
    score += 2;
    findings.push("Uses lists or numbered steps.");
  } else {
    findings.push("No lists or steps detected.");
    suggestions.push(
      "Use bulleted or numbered steps to narrow the agent's degrees of freedom.",
    );
  }

  // Includes examples (2 pts)
  const hasCode = hasCodeBlock(body);
  const mentionsExample = /\bexample\b/i.test(body);
  if (hasCode && mentionsExample) {
    score += 2;
    findings.push("Includes example code block.");
  } else if (hasCode || mentionsExample) {
    score += 1;
    suggestions.push(
      'Back up examples with fenced code blocks labelled under "## Example" so the agent sees concrete input/output.',
    );
  } else {
    suggestions.push(
      'Add an "## Example" section with a fenced code block showing the desired output.',
    );
  }

  // Minimizes degrees of freedom: imperative sentences, explicit phrasing (2 pts)
  const imperativeHits = (
    body.match(
      /^\s*[-*0-9.]*\s*(Do|Use|Run|Call|Check|Validate|Return|Emit|Write|Read|Ask|Confirm|Avoid|Never|Always)\b/gim,
    ) || []
  ).length;
  if (imperativeHits >= 3) {
    score += 2;
    findings.push(`Uses imperative voice (${imperativeHits} cues).`);
  } else if (imperativeHits >= 1) {
    score += 1;
    suggestions.push(
      "Favor imperative voice (Do / Use / Avoid / Never) to narrow the agent's choices.",
    );
  } else {
    suggestions.push(
      'Rewrite instructions in the imperative mood — e.g. "Run `git status` first" instead of "you might want to run".',
    );
  }

  // Length sanity (1 pt) — penalize massive or tiny bodies
  const words = wordCount(body);
  if (words >= 80 && words <= 3000) {
    score += 1;
    findings.push(`Body length within healthy range (${words} words).`);
  } else if (words < 80) {
    findings.push(`Body is very short (${words} words).`);
    suggestions.push(
      "Expand the instructions; an underspecified skill gives the agent too much freedom.",
    );
  } else {
    findings.push(`Body is very long (${words} words).`);
    suggestions.push(
      "Split large content into referenced files; keep SKILL.md focused under ~3000 words.",
    );
  }

  return {
    id: "prompt-engineering",
    name: "Prompt engineering",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

function scoreContextEfficiency(
  _fm: Record<string, string>,
  body: string,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const words = wordCount(body);
  findings.push(`Body is ${words} words.`);

  // Ideal window: 120..1500 words (4 pts)
  if (words >= 120 && words <= 1500) {
    score += 4;
  } else if (words >= 60 && words < 120) {
    score += 2;
    suggestions.push(
      "Expand instructions slightly — too little context can push the agent to improvise.",
    );
  } else if (words > 1500 && words <= 3000) {
    score += 2;
    suggestions.push(
      "Consider moving large sections into referenced files (e.g. `references/*.md`) and linking them instead of inlining.",
    );
  } else if (words > 3000) {
    score += 0;
    suggestions.push(
      "Body is over 3000 words — split long content into referenced files or templates.",
    );
  }

  // References / see / links (3 pts)
  const refMatches = containsAny(body, EFFICIENCY_KEYWORDS);
  if (refMatches.length >= 2) {
    score += 3;
    findings.push(
      `References external files or links (${refMatches.slice(0, 3).join(", ")}).`,
    );
  } else if (refMatches.length === 1) {
    score += 1;
    suggestions.push(
      'Link out to supporting files (e.g. "see `references/examples.md`") instead of inlining them.',
    );
  } else {
    suggestions.push(
      'Offload verbose content to referenced files and link to them ("see `./templates/x.md`").',
    );
  }

  // No giant code blocks (2 pts)
  const codeBlocks = body.match(/```[\s\S]+?```/g) || [];
  const largeBlocks = codeBlocks.filter((b) => lineCount(b) > 60);
  if (largeBlocks.length === 0) {
    score += 2;
    findings.push("No oversized code blocks.");
  } else {
    findings.push(`${largeBlocks.length} code block(s) longer than 60 lines.`);
    suggestions.push(
      "Move large code blocks into referenced template files; link to them from SKILL.md.",
    );
  }

  // Explicit token/budget mention is a bonus (1 pt)
  if (/\btoken\b|\bbudget\b|\bcontext window\b/i.test(body)) {
    score += 1;
    findings.push("Mentions tokens/budget/context window.");
  }

  return {
    id: "context-efficiency",
    name: "Context efficiency",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

function scoreSafety(
  _fm: Record<string, string>,
  body: string,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const hits = containsAny(body, SAFETY_KEYWORDS);
  if (hits.length >= 4) {
    score += 4;
    findings.push(
      `Covers multiple safety cues (${hits.slice(0, 4).join(", ")}).`,
    );
  } else if (hits.length >= 2) {
    score += 2;
    findings.push(`Mentions a few safety cues: ${hits.join(", ")}.`);
    suggestions.push(
      "Add explicit error-handling and confirmation steps so the agent knows how to recover from failures.",
    );
  } else if (hits.length === 1) {
    score += 1;
    suggestions.push(
      'Expand the safety section — include prerequisites, validation steps, and what to do "on error".',
    );
  } else {
    suggestions.push(
      "Describe prerequisites, confirmation prompts, and error-handling steps to reduce blast radius.",
    );
  }

  // Destructive action guardrails (3 pts)
  const mentionsDestructive =
    /\b(rm\s|delete|remove|drop|force|overwrite|destructive)\b/i.test(body);
  const mentionsConfirm =
    /\bconfirm\b|\bdry-?run\b|\bare you sure\b|\bbackup\b/i.test(body);
  if (mentionsDestructive && mentionsConfirm) {
    score += 3;
    findings.push("Destructive actions paired with confirmation/dry-run.");
  } else if (mentionsDestructive) {
    findings.push(
      "References destructive actions without explicit confirmation/dry-run.",
    );
    suggestions.push(
      "Pair any destructive command with an explicit confirmation prompt, dry-run flag, or backup step.",
    );
  } else {
    // No destructive actions mentioned — neutral (add half of the bucket)
    score += 1.5;
  }

  // Prerequisites / requirements (3 pts)
  const hasPrereq =
    /\bprerequisit/i.test(body) ||
    /\brequire/i.test(body) ||
    /\bdepend/i.test(body);
  if (hasPrereq) {
    score += 3;
    findings.push("Declares prerequisites or requirements.");
  } else {
    findings.push("No prerequisites / requirements section.");
    suggestions.push(
      'Add a "## Prerequisites" block listing required tools, credentials, and environment state.',
    );
  }

  return {
    id: "safety",
    name: "Safety & guardrails",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

function scoreTestability(
  _fm: Record<string, string>,
  body: string,
): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const hits = containsAny(body, TESTABILITY_KEYWORDS);
  if (hits.length >= 4) {
    score += 5;
    findings.push(
      `Many testability cues present (${hits.slice(0, 4).join(", ")}).`,
    );
  } else if (hits.length >= 2) {
    score += 3;
    findings.push(`Some testability cues: ${hits.join(", ")}.`);
    suggestions.push(
      'Add an "## Acceptance Criteria" block listing verifiable outputs or checklist items.',
    );
  } else if (hits.length === 1) {
    score += 1;
    suggestions.push(
      'Add concrete "expected output" examples so the agent can self-check.',
    );
  } else {
    suggestions.push(
      'Add a "## Acceptance Criteria" section with testable statements (e.g. "produces a JSON report with overall_score").',
    );
  }

  // Explicit examples of expected output (3 pts)
  if (/expected\s+(output|result|response)/i.test(body)) {
    score += 3;
    findings.push("Describes expected output/result.");
  } else {
    suggestions.push(
      'Include an "Expected output" example so reviewers and the agent can verify correctness.',
    );
  }

  // Edge cases / pitfalls (2 pts)
  if (/\bedge case|gotcha|pitfall|limitation/i.test(body)) {
    score += 2;
    findings.push("Mentions edge cases or limitations.");
  } else {
    suggestions.push(
      'Add a short "Edge cases" list to describe inputs the skill should reject or handle carefully.',
    );
  }

  return {
    id: "testability",
    name: "Testability",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

function scoreNaming(fm: Record<string, string>, body: string): CategoryResult {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const name = (fm.name || "").trim();

  // Kebab-case lowercase, <= 40 chars (4 pts)
  if (name) {
    const kebab = /^[a-z][a-z0-9-]*$/.test(name);
    const slim = name.length <= 40;
    if (kebab && slim) {
      score += 4;
      findings.push(`name "${name}" follows kebab-case convention.`);
    } else {
      if (!kebab) {
        findings.push(`name "${name}" is not lowercase kebab-case.`);
        suggestions.push(
          `Rename to lowercase kebab-case (e.g. "${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")}").`,
        );
      }
      if (!slim) {
        findings.push(`name is ${name.length} chars; keep it <= 40.`);
      }
    }
  } else {
    suggestions.push("Add a kebab-case `name` (e.g. `my-skill`).");
  }

  // Imperative tone in top-level headings (3 pts)
  const headings = body.match(/^#{1,6}\s+(.+)$/gm) || [];
  if (headings.length > 0) {
    const imperative = headings.filter((h) =>
      /^#{1,6}\s+([A-Z][a-z]+|Use|How|When|Workflow|Instructions|Examples|Steps|Acceptance)/.test(
        h,
      ),
    );
    const ratio = imperative.length / headings.length;
    if (ratio >= 0.5) {
      score += 3;
      findings.push("Most headings use action/imperative labels.");
    } else {
      score += 1;
      suggestions.push(
        "Rename body headings to action-oriented labels (e.g. `## Instructions`, `## When to Use`).",
      );
    }
  }

  // Consistent labels (2 pts): both `description` and `name` do not contain stray punctuation
  const descNoise = /(?:\s\s|\bTODO\b|\bFIXME\b|\?{2,})/.test(
    fm.description || "",
  );
  if (!descNoise) {
    score += 2;
    findings.push("Description looks clean (no TODO/FIXME/stray noise).");
  } else {
    suggestions.push(
      "Clean up description — remove TODOs, FIXMEs, double spaces, or trailing punctuation.",
    );
  }

  // Directory basename matches `name` (1 pt) — caller passes skillPath
  // Handled later at report aggregation level, so keep this scorer stateless.

  return {
    id: "naming",
    name: "Naming & conventions",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
  };
}

// ─── Report aggregator ─────────────────────────────────────────────────────

/**
 * Compute the full evaluation report for a parsed SKILL.md.
 */
export function evaluateSkillContent(args: {
  content: string;
  skillPath: string;
  skillMdPath: string;
}): EvaluationReport {
  const { content, skillPath, skillMdPath } = args;
  const fm = parseFrontmatter(content);
  const { rawFrontmatter, body } = splitSkillMd(content);

  const categories: CategoryResult[] = [
    scoreStructure(fm, body, rawFrontmatter),
    scoreDescription(fm, body),
    scorePromptEngineering(fm, body),
    scoreContextEfficiency(fm, body),
    scoreSafety(fm, body),
    scoreTestability(fm, body),
    scoreNaming(fm, body),
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

  // Top 3 suggestions: pick from the 3 lowest-scoring categories
  const topSuggestions: string[] = [];
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

  return evaluateSkillContent({
    content,
    skillPath: resolved,
    skillMdPath,
  });
}

// ─── Auto-fix pipeline ─────────────────────────────────────────────────────

/**
 * Compute a deterministic fix plan + new SKILL.md content for the given
 * original content. Caller decides whether to write to disk or dry-run.
 *
 * Only low-risk, deterministic edits are applied:
 *   - Add missing `version` as `0.1.0`
 *   - Add missing `creator` from git `user.name` if available
 *   - Infer `effort` from body line count (low/medium/high/max)
 *   - Normalise trailing whitespace and CRLF line endings
 *   - Ensure a blank line between `---` and body
 *   - Reorder frontmatter keys to canonical order when all keys are simple
 *
 * Description-quality fixes and other subjective content are NEVER auto-fixed;
 * they're returned in `skipped`.
 */
export interface BuildFixPlanOptions {
  /** Optional git author string to use when `creator` is missing. */
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

  // 2) Add missing creator from git config user.name (if provided).
  const hasCreator = Boolean(fm.creator || fm["metadata.creator"]);
  if (!hasCreator) {
    const gitAuthor = options.gitAuthor?.trim();
    if (gitAuthor) {
      fmStr = appendFrontmatterKey(fmStr, "creator", gitAuthor);
      applied.push({
        id: "add-missing-creator",
        description: `Add \`creator: ${gitAuthor}\` from git config.`,
      });
    } else {
      skipped.push({
        id: "add-missing-creator",
        description:
          "Missing `creator` — no git user.name found to fill in safely.",
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
  const quoted = /[:#{}\[\],&*?|<>=!%@`"']/.test(value)
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
  const report = evaluateSkillContent({
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
    // Use Bun.spawn when available; fall back to child_process for Node tests.
    const proc = Bun.spawn(
      ["git", "config", "--global", "--get", "user.name"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
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
 * providers (e.g. skill-creator) are surfaced as a one-line score next to
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
    if (provider.findings.length === 0) continue;
    lines.push("");
    lines.push(`${provider.id}@${provider.version} findings:`);
    for (const finding of provider.findings) {
      lines.push(`  [${finding.severity}] ${finding.message}`);
    }
  }
  return lines.join("\n");
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

// ─── Input resolution (local path / GitHub shorthand / URL) ───────────────
//
// Issues #193 + #194 extend `asm eval` to accept GitHub URLs/shorthand and to
// evaluate a collection of skills in one go. The input-resolution pipeline is
// shared between the single-skill path and the batch path so both features
// stay consistent.
//
//   • `asm eval ./skill`                → single skill (SKILL.md at root)
//   • `asm eval ./skills/`              → collection (enumerated children)
//   • `asm eval github:owner/repo`      → whole repo (single-or-collection)
//   • `asm eval github:owner/repo:sub`  → subpath resolved from cloned repo
//
// The resolver returns a list of `EvalTarget` entries plus a `cleanup` hook
// that the caller MUST invoke in a `finally` block — local inputs get a no-op
// cleanup, remote inputs get an `rm -rf` of the temp clone directory.

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
 */
export async function runWithConcurrency<T, R>(
  inputs: T[],
  limit: number,
  fn: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  const boundedLimit = Math.max(1, Math.floor(limit));
  const workers: Promise<void>[] = [];
  const size = Math.min(boundedLimit, inputs.length);
  for (let w = 0; w < size; w++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = next++;
          if (idx >= inputs.length) break;
          results[idx] = await fn(inputs[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(workers);
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
  report: EvaluationReport & { providers?: ProviderEvalReport[] },
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
