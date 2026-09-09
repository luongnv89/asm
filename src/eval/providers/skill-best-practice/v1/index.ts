import { readFile, stat } from "fs/promises";
import { basename } from "path";
import { parse as parseYaml } from "yaml";
import type {
  ApplicableResult,
  EvalOpts,
  EvalProvider,
  EvalResult,
  Finding,
  SkillContext,
} from "../../../types";

const PROVIDER_ID = "skill-best-practice";
const PROVIDER_VERSION = "1.2.0";
const SCHEMA_VERSION = 1;

const ALLOWED_PROPERTIES = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
  "effort",
  "dependencies",
]);

// Aligned with skill-creator SKILL.md (v1.7.1) and quick_validate.py.
// `xhigh` slots between `high` and `max` for tasks needing extended
// deliberation beyond `high` but short of full exhaustive analysis.
const VALID_EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Runtime context budget: descriptions over this length get truncated
// tail-first, chopping the negative-trigger clause. 1024 stays as the hard
// shape limit checked separately.
const DESCRIPTION_RUNTIME_TARGET = 250;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

interface ValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
}

interface ValidationPayload {
  skillPath: string;
  skillMdPath: string;
  validatedAt: string;
  checkCount: number;
  passedChecks: number;
  checks: ValidationCheck[];
  frontmatter: Record<string, unknown> | null;
}

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const lines = content.split("\n");
  if (lines.length < 3 || lines[0]?.trim() !== "---") return null;
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex === -1) return null;
  return lines.slice(1, closingIndex).join("\n");
}

function toFinding(check: ValidationCheck): Finding {
  return {
    severity: check.severity,
    message: check.message,
    code: check.id,
    categoryId: "validation",
  };
}

function pushCheck(
  checks: ValidationCheck[],
  id: string,
  label: string,
  passed: boolean,
  severity: "error" | "warning",
  message: string,
): void {
  checks.push({ id, label, passed, severity, message });
}

function buildRaw(
  ctx: SkillContext,
  checks: ValidationCheck[],
  frontmatter: Record<string, unknown> | null,
): ValidationPayload {
  return {
    skillPath: ctx.skillPath,
    skillMdPath: ctx.skillMdPath,
    validatedAt: new Date().toISOString(),
    checkCount: checks.length,
    passedChecks: checks.filter((check) => check.passed).length,
    checks,
    frontmatter,
  };
}

async function validate(ctx: SkillContext): Promise<{
  score: number;
  passed: boolean;
  findings: Finding[];
  raw: ValidationPayload;
}> {
  const content = await readFile(ctx.skillMdPath, "utf-8");
  const checks: ValidationCheck[] = [];
  const frontmatterBlock = extractFrontmatter(content);

  if (frontmatterBlock === null) {
    pushCheck(
      checks,
      "missing-frontmatter",
      "Frontmatter exists",
      false,
      "error",
      "SKILL.md must start with a YAML frontmatter block.",
    );
    const raw = buildRaw(ctx, checks, null);
    return {
      score: 0,
      passed: false,
      findings: checks.map(toFinding),
      raw,
    };
  }

  pushCheck(
    checks,
    "frontmatter-present",
    "Frontmatter exists",
    true,
    "error",
    "SKILL.md contains a YAML frontmatter block.",
  );

  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatterBlock);
  } catch (err: any) {
    pushCheck(
      checks,
      "invalid-yaml",
      "Frontmatter parses as YAML",
      false,
      "error",
      `Invalid YAML in frontmatter: ${err?.message ?? String(err)}`,
    );
    const raw = buildRaw(ctx, checks, null);
    return {
      score: 0,
      passed: false,
      findings: checks.map(toFinding),
      raw,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    pushCheck(
      checks,
      "frontmatter-not-object",
      "Frontmatter is a mapping",
      false,
      "error",
      "Frontmatter must parse to a YAML object.",
    );
    const raw = buildRaw(ctx, checks, null);
    return {
      score: 0,
      passed: false,
      findings: checks.map(toFinding),
      raw,
    };
  }

  const frontmatter = parsed as Record<string, unknown>;
  pushCheck(
    checks,
    "frontmatter-object",
    "Frontmatter is a mapping",
    true,
    "error",
    "Frontmatter parses to a YAML object.",
  );

  const unexpectedKeys = Object.keys(frontmatter).filter(
    (key) => !ALLOWED_PROPERTIES.has(key),
  );
  pushCheck(
    checks,
    "allowed-keys",
    "Allowed top-level keys only",
    unexpectedKeys.length === 0,
    "error",
    unexpectedKeys.length === 0
      ? "Frontmatter uses only the allowed top-level keys."
      : `Unexpected frontmatter key(s): ${unexpectedKeys.sort().join(", ")}.`,
  );

  const name = frontmatter.name;
  const nameString = typeof name === "string" ? name.trim() : "";
  pushCheck(
    checks,
    "name-present",
    "Name is present and non-empty",
    nameString.length > 0,
    "error",
    nameString.length > 0
      ? "Frontmatter includes a non-empty `name`."
      : "Frontmatter must include a non-empty string `name`.",
  );

  if (nameString.length > 0) {
    const validName =
      /^[a-z0-9-]+$/.test(nameString) &&
      !nameString.startsWith("-") &&
      !nameString.endsWith("-") &&
      !nameString.includes("--") &&
      nameString.length <= 64;
    pushCheck(
      checks,
      "name-kebab-case",
      "Name follows skill-best-practice naming rules",
      validName,
      "error",
      validName
        ? "Name follows the skill-best-practice kebab-case naming rules."
        : "Name must be kebab-case, avoid consecutive/edge hyphens, and stay within 64 characters.",
    );
  }

  const description = frontmatter.description;
  const descriptionString =
    typeof description === "string" ? description.trim() : "";
  pushCheck(
    checks,
    "description-present",
    "Description is present and non-empty",
    descriptionString.length > 0,
    "error",
    descriptionString.length > 0
      ? "Frontmatter includes a non-empty `description`."
      : "Frontmatter must include a non-empty string `description`.",
  );

  if (descriptionString.length > 0) {
    const validDescription =
      !descriptionString.includes("\n") &&
      !descriptionString.includes("\r") &&
      !descriptionString.includes("<") &&
      !descriptionString.includes(">") &&
      descriptionString.length <= 1024;
    pushCheck(
      checks,
      "description-shape",
      "Description follows skill-best-practice formatting rules",
      validDescription,
      "error",
      validDescription
        ? "Description is single-line, angle-bracket free, and within 1024 characters."
        : "Description must be a single line, avoid angle brackets, and stay within 1024 characters.",
    );

    const withinRuntimeBudget =
      descriptionString.length <= DESCRIPTION_RUNTIME_TARGET;
    pushCheck(
      checks,
      "description-runtime-budget",
      "Description fits the runtime context budget",
      withinRuntimeBudget,
      "warning",
      withinRuntimeBudget
        ? `Description is ${descriptionString.length} chars (target ≤ ${DESCRIPTION_RUNTIME_TARGET}).`
        : `Description is ${descriptionString.length} chars; target ≤ ${DESCRIPTION_RUNTIME_TARGET}. The /skills listing truncates tail-first, often chopping the negative-trigger clause.`,
    );
  }

  const effort = frontmatter.effort;
  pushCheck(
    checks,
    "effort-enum",
    "Effort uses the supported enum",
    effort === undefined ||
      (typeof effort === "string" && VALID_EFFORT_LEVELS.has(effort.trim())),
    "error",
    effort === undefined ||
      (typeof effort === "string" && VALID_EFFORT_LEVELS.has(effort.trim()))
      ? "Effort is omitted or uses a supported value."
      : "Effort must be one of: low, medium, high, xhigh, max.",
  );

  const dependencies = frontmatter.dependencies;
  if (dependencies !== undefined) {
    const dependenciesValid =
      Array.isArray(dependencies) &&
      dependencies.length > 0 &&
      dependencies.every(
        (dependency) =>
          typeof dependency === "string" && dependency.trim().length > 0,
      );
    pushCheck(
      checks,
      "dependencies-shape",
      "Dependencies are non-empty skill reference strings",
      dependenciesValid,
      "error",
      dependenciesValid
        ? "Dependencies are a non-empty YAML sequence of skill reference strings."
        : "Dependencies must be a non-empty YAML sequence containing only non-empty skill reference strings.",
    );
  }

  const compatibility = frontmatter.compatibility;
  if (compatibility !== undefined) {
    const compatibilityValid =
      typeof compatibility === "string" && compatibility.length <= 500;
    pushCheck(
      checks,
      "compatibility-shape",
      "Compatibility is a short string",
      compatibilityValid,
      "error",
      compatibilityValid
        ? "Compatibility is a valid short string."
        : "Compatibility must be a string no longer than 500 characters.",
    );
  }

  // metadata.version is mandatory per skill-creator's "Version Management"
  // rule. We split presence and semver-format into separate checks so the
  // emitted error message points at the right fix.
  const metadata =
    frontmatter.metadata &&
    typeof frontmatter.metadata === "object" &&
    !Array.isArray(frontmatter.metadata)
      ? (frontmatter.metadata as Record<string, unknown>)
      : null;
  const metadataVersion = metadata?.version;
  const metadataVersionString =
    typeof metadataVersion === "string" || typeof metadataVersion === "number"
      ? String(metadataVersion).trim()
      : "";

  const hasMetadataVersion = metadataVersionString.length > 0;
  pushCheck(
    checks,
    "metadata-version-present",
    "metadata.version is present",
    hasMetadataVersion,
    "error",
    hasMetadataVersion
      ? "Frontmatter declares `metadata.version`."
      : "Frontmatter must declare `metadata.version` (start new skills at 1.0.0).",
  );

  if (hasMetadataVersion) {
    const validSemver = SEMVER_RE.test(metadataVersionString);
    pushCheck(
      checks,
      "metadata-version-semver",
      "metadata.version follows MAJOR.MINOR.PATCH",
      validSemver,
      "error",
      validSemver
        ? "`metadata.version` follows semantic versioning."
        : `\`metadata.version\` must follow semantic versioning (e.g. 1.0.0); got "${metadataVersionString}".`,
    );
  }

  // metadata.author is recommended (especially for published skills) but not
  // required, so this is a warning. Emit it only when a metadata block exists
  // and lacks `author`, or when `metadata` is missing entirely. A top-level
  // `author` would already be flagged by `allowed-keys`.
  const metadataAuthor = metadata?.author;
  const hasMetadataAuthor =
    typeof metadataAuthor === "string" && metadataAuthor.trim().length > 0;
  pushCheck(
    checks,
    "metadata-author-present",
    "metadata.author is present",
    hasMetadataAuthor,
    "warning",
    hasMetadataAuthor
      ? "Frontmatter declares `metadata.author`."
      : "Add `metadata.author` (recommended for published skills) so users know who maintains the skill.",
  );

  // name-matches-directory: skill-creator requires the frontmatter `name` to
  // exactly match the parent directory name. This is what `quick_validate.py`
  // would flag as a hard error.
  if (nameString.length > 0) {
    const dirName = basename(ctx.skillPath);
    const matchesDir = dirName === nameString;
    pushCheck(
      checks,
      "name-matches-directory",
      "Name matches the parent directory",
      matchesDir,
      "error",
      matchesDir
        ? "Frontmatter `name` matches the skill directory."
        : `Frontmatter \`name\` ("${nameString}") must match the parent directory ("${dirName}").`,
    );
  }

  const hasNegativeTriggerClause =
    /don'?t use (?:for|when|if|on)|not (?:for|intended for|suitable for|meant for)\b|skip (?:for|when|if)|avoid (?:using )?(?:for|when|on)|never (?:use )?for\b|only (?:use )?for\b/i.test(
      descriptionString,
    );
  pushCheck(
    checks,
    "negative-trigger-clause",
    "Description includes a negative-trigger clause",
    hasNegativeTriggerClause,
    "warning",
    hasNegativeTriggerClause
      ? "Description names adjacent cases that should not trigger the skill."
      : "Description appears to lack a negative-trigger clause; consider naming adjacent cases that should not trigger the skill.",
  );

  const raw = buildRaw(ctx, checks, frontmatter);
  const score =
    raw.checkCount === 0
      ? 100
      : Math.round((raw.passedChecks / raw.checkCount) * 100);
  const findings = checks.filter((check) => !check.passed).map(toFinding);

  return {
    score,
    passed: findings.every((finding) => finding.severity !== "error"),
    findings,
    raw,
  };
}

export const skillBestPracticeProviderV1: EvalProvider = {
  id: PROVIDER_ID,
  version: PROVIDER_VERSION,
  schemaVersion: SCHEMA_VERSION,
  description:
    "Deterministic SKILL.md best-practice validation (rules aligned with the skill-creator standard, v1.7.1).",

  async applicable(ctx: SkillContext): Promise<ApplicableResult> {
    try {
      const file = await stat(ctx.skillMdPath);
      if (!file.isFile()) {
        return {
          ok: false,
          reason: `${ctx.skillMdPath} is not a file`,
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        reason: `SKILL.md not found at ${ctx.skillMdPath}`,
      };
    }
  },

  async run(ctx: SkillContext, _opts: EvalOpts): Promise<EvalResult> {
    const result = await validate(ctx);
    return {
      providerId: PROVIDER_ID,
      providerVersion: PROVIDER_VERSION,
      schemaVersion: SCHEMA_VERSION,
      score: result.score,
      passed: result.passed,
      categories: [
        {
          id: "validation",
          name: "Deterministic validation",
          score: result.raw.passedChecks,
          max: result.raw.checkCount,
          findings: result.findings.length > 0 ? result.findings : undefined,
        },
      ],
      findings: result.findings,
      raw: result.raw,
      startedAt: "",
      durationMs: 0,
    };
  },
};

export default skillBestPracticeProviderV1;
