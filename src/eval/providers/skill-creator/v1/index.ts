import { readFile, stat } from "fs/promises";
import { parse as parseYaml } from "yaml";
import type {
  ApplicableResult,
  EvalOpts,
  EvalProvider,
  EvalResult,
  Finding,
  SkillContext,
} from "../../../types";

const PROVIDER_ID = "skill-creator";
const PROVIDER_VERSION = "1.0.0";
const SCHEMA_VERSION = 1;

const ALLOWED_PROPERTIES = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
  "effort",
]);

const VALID_EFFORT_LEVELS = new Set(["low", "medium", "high", "max"]);

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
  const errorChecks = checks.filter((check) => check.severity === "error");
  return {
    skillPath: ctx.skillPath,
    skillMdPath: ctx.skillMdPath,
    validatedAt: new Date().toISOString(),
    checkCount: errorChecks.length,
    passedChecks: errorChecks.filter((check) => check.passed).length,
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
      "Name follows skill-creator naming rules",
      validName,
      "error",
      validName
        ? "Name follows the skill-creator kebab-case naming rules."
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
      "Description follows skill-creator formatting rules",
      validDescription,
      "error",
      validDescription
        ? "Description is single-line, angle-bracket free, and within 1024 characters."
        : "Description must be a single line, avoid angle brackets, and stay within 1024 characters.",
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
      : "Effort must be one of: low, medium, high, max.",
  );

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

export const skillCreatorProviderV1: EvalProvider = {
  id: PROVIDER_ID,
  version: PROVIDER_VERSION,
  schemaVersion: SCHEMA_VERSION,
  description:
    "Deterministic SKILL.md validation ported from skill-creator rules.",

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

export default skillCreatorProviderV1;
