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

import { resolveVersion } from "./utils/frontmatter";

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

/**
 * Stable identifier for the root-README structural warning. Used by the
 * `topSuggestions` builder to guarantee the finding reaches the default CLI
 * output even when Structure is not among the lowest-scoring categories.
 */
export const ROOT_README_SUGGESTION =
  "Relocate `README.md` out of the skill root so SKILL.md remains the sole top-level document (e.g., move it to `docs/README.md`).";

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

export function lineCount(str: string): number {
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

export function scoreStructure(
  fm: Record<string, string>,
  body: string,
  rawFrontmatter: string | null,
  rootEntries?: string[],
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

  // `author` is canonical; `creator` is accepted as a legacy alias so existing
  // skills keep their score during the field rename transition.
  const hasAuthor = Boolean(
    fm.author || fm["metadata.author"] || fm.creator || fm["metadata.creator"],
  );
  if (hasAuthor) score += 1;
  else {
    findings.push("Missing `author`.");
    suggestions.push(
      "Add an `author` field so users know who authored and maintains the skill.",
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

  // README convention (skill-creator alignment): README.md is optional but
  // must not sit at the skill root next to SKILL.md. A top-level README is
  // surfaced as a warning only — no score change — since the catalog payload
  // drops findings and rebalancing this saturated scorer would shift every
  // skill's Structure score.
  if (rootEntries) {
    const rootReadme = rootEntries.find((e) => e.toLowerCase() === "readme.md");
    if (rootReadme) {
      findings.push(
        `\`${rootReadme}\` found at skill root; move it to a subdirectory (e.g., \`docs/README.md\`).`,
      );
      suggestions.push(ROOT_README_SUGGESTION);
    }
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

export function scoreDescription(
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

export function scorePromptEngineering(
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

export function scoreContextEfficiency(
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

export function scoreSafety(
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

export function scoreTestability(
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

export function scoreNaming(
  fm: Record<string, string>,
  body: string,
): CategoryResult {
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
