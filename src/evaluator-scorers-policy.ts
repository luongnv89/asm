import type { CategoryResult } from "./evaluator-types";
import {
  SAFETY_KEYWORDS,
  TESTABILITY_KEYWORDS,
  containsAny,
} from "./evaluator-scorers";
// Split from evaluator-core.ts (issue #677).

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

/** Common SPDX license identifiers recognised by the evaluator. */
const RECOGNISED_LICENSES = new Set([
  // Permissive
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unlicense",
  "0BSD",
  "Zlib",
  "BSL-1.0",
  "CC0-1.0",
  // Copyleft (weak)
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "MPL-2.0-no-copyleft-exception",
  // Copyleft (strong)
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  // Other
  "Artistic-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "CPAL-1.0",
  "ECL-2.0",
  "EFL-2.0",
  "Nokia-1.0a",
  "OFL-1.1",
  "SIL-OpenFont-1.1",
  "VSLAM-1.0",
  "WTFPL",
  "ZPL-2.1",
  "NCSA",
  "PostgreSQL",
  "X11",
  "JSON",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-ND-4.0",
  "CC-BY-NC-ND-4.0",
  "Fair",
  "NTP",
  "AFL-3.0",
  "APAFML",
  "OLDAP-2.8",
]);

/**
 * Deprecated ids still on the SPDX License List (`isDeprecatedLicenseId`).
 * They are recognised, so `GPL-2.0+` parses as `GPL-2.0` plus `+`, but the
 * scorer suggests the `-only` / `-or-later` form.
 */
const DEPRECATED_LICENSES = new Set([
  "GPL-2.0",
  "GPL-3.0",
  "LGPL-2.1",
  "LGPL-3.0",
  "AGPL-3.0",
]);

/** A few common ids from the SPDX License Exceptions List. */
const RECOGNISED_EXCEPTIONS = [
  "LLVM-exception",
  "Classpath-exception-2.0",
  "GCC-exception-3.1",
  "Autoconf-exception-3.0",
  "Bison-exception-2.2",
];

/** Lower-cased id → canonical id; SPDX ids match in any case (Annex D.2). */
const LICENSE_BY_LOWER = new Map(
  [...RECOGNISED_LICENSES, ...DEPRECATED_LICENSES].map((id) => [
    id.toLowerCase(),
    id,
  ]),
);
const EXCEPTION_BY_LOWER = new Map(
  RECOGNISED_EXCEPTIONS.map((id) => [id.toLowerCase(), id]),
);

/** `idstring = 1*(ALPHA / DIGIT / "-" / ".")` */
const IDSTRING_RE = /^[A-Za-z0-9.-]+$/;
/** `license-ref = ["DocumentRef-" idstring ":"] "LicenseRef-" idstring` */
const LICENSE_REF_RE =
  /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;
const OPERATORS = new Set(["AND", "OR", "WITH"]);
/**
 * Deepest parenthesis nesting the parser accepts. Recursion would otherwise
 * overflow the stack on crafted input (a few thousand levels).
 */
export const MAX_SPDX_NESTING = 64;

/** Most characters of a declared value quoted in one finding. */
export const MAX_QUOTED_VALUE = 200;
/** Most characters of one identifier or token quoted in a finding. */
const MAX_QUOTED_TOKEN = 60;

/**
 * Quote part of a declared licence value in backticks for a finding. A value
 * longer than `max` is cut, marked with `…`, and followed by its original
 * length, so a crafted value cannot blow up the report.
 */
export function quoteValue(value: string, max = MAX_QUOTED_VALUE): string {
  return value.length <= max
    ? `\`${value}\``
    : `\`${value.slice(0, max)}…\` (${value.length} chars)`;
}

export type SpdxLeafKind = "spdx" | "ref" | "private" | "unknown";

export type SpdxExpressionParse =
  | {
      ok: true;
      /** Licence ids and references, in order (any `+` stripped). */
      leaves: { id: string; kind: SpdxLeafKind }[];
      exceptions: { id: string; known: boolean }[];
      /** Canonical deprecated ids used; `orLater` when written with `+`. */
      deprecated: { id: string; orLater: boolean }[];
    }
  | { ok: false; error: string };

/**
 * Kind of a single licence token: a listed SPDX id, a `LicenseRef-`, a
 * one-word private form (`Proprietary`, `UNLICENSED`, `private`), or unknown.
 */
function leafKind(id: string): SpdxLeafKind {
  if (LICENSE_BY_LOWER.has(id.toLowerCase())) return "spdx";
  if (LICENSE_REF_RE.test(id)) return "ref";
  if (isPrivateLicense(id)) return "private";
  return "unknown";
}

/**
 * Parse an SPDX license expression (SPDX 2.3 Annex D,
 * https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/):
 *
 *   simple-expression   = license-id / license-id"+" / license-ref
 *   compound-expression = simple-expression
 *                       / simple-expression "WITH" license-exception-id
 *                       / compound-expression "AND" compound-expression
 *                       / compound-expression "OR" compound-expression
 *                       / "(" compound-expression ")"
 *
 * Precedence is `+`, `WITH`, `AND`, `OR` (D.4.5). Operators are matched
 * case-sensitively and identifiers case-insensitively (D.2), so prose such as
 * "Proprietary and confidential" is not read as an expression. Syntax only:
 * leaves are classified, not rejected, when they are not on the list.
 */
export function parseSpdxExpression(input: string): SpdxExpressionParse {
  const tokens = input.match(/\(|\)|[^\s()]+/g) ?? [];
  if (tokens.length === 0) return { ok: false, error: "empty expression" };

  const leaves: { id: string; kind: SpdxLeafKind }[] = [];
  const exceptions: { id: string; known: boolean }[] = [];
  const deprecated: { id: string; orLater: boolean }[] = [];
  let pos = 0;
  let depth = 0;

  class SyntaxError_ extends Error {}
  const fail = (message: string): never => {
    throw new SyntaxError_(message);
  };
  const q = (tok: string) => quoteValue(tok, MAX_QUOTED_TOKEN);
  const after = () => (pos > 0 ? ` after ${q(tokens[pos - 1])}` : "");

  const parseSimple = (): void => {
    const tok = tokens[pos];
    if (tok === undefined) fail(`expected a licence identifier${after()}`);
    if (tok === "(" || tok === ")" || OPERATORS.has(tok) || tok === "+") {
      fail(`expected a licence identifier but found ${q(tok)}`);
    }
    pos++;
    const plus = tok.endsWith("+");
    const id = plus ? tok.slice(0, -1) : tok;
    if (LICENSE_REF_RE.test(id)) {
      if (plus) fail(`\`+\` may follow only a licence identifier (${q(tok)})`);
      leaves.push({ id, kind: "ref" });
      return;
    }
    if (!IDSTRING_RE.test(id)) {
      fail(`${q(tok)} is not a valid licence identifier`);
    }
    const canonical = LICENSE_BY_LOWER.get(id.toLowerCase());
    if (canonical && DEPRECATED_LICENSES.has(canonical)) {
      deprecated.push({ id: canonical, orLater: plus });
    }
    leaves.push({ id, kind: leafKind(id) });
  };

  const parseTerm = (): void => {
    if (tokens[pos] === "(") {
      if (++depth > MAX_SPDX_NESTING) {
        fail(`parentheses nested more than ${MAX_SPDX_NESTING} deep`);
      }
      pos++;
      parseOr();
      if (tokens[pos] !== ")") fail(`expected \`)\`${after()}`);
      pos++;
      depth--;
      if (tokens[pos] === "WITH") {
        fail("WITH must follow a single licence identifier, not `)`");
      }
      return;
    }
    parseSimple();
    if (tokens[pos] === "WITH") {
      pos++;
      const exc = tokens[pos];
      if (
        exc === undefined ||
        exc === "(" ||
        exc === ")" ||
        OPERATORS.has(exc) ||
        !IDSTRING_RE.test(exc)
      ) {
        fail("expected a licence exception after `WITH`");
      }
      pos++;
      exceptions.push({
        id: exc,
        known: EXCEPTION_BY_LOWER.has(exc.toLowerCase()),
      });
    }
  };

  const parseAnd = (): void => {
    parseTerm();
    while (tokens[pos] === "AND") {
      pos++;
      parseTerm();
    }
  };

  function parseOr(): void {
    parseAnd();
    while (tokens[pos] === "OR") {
      pos++;
      parseAnd();
    }
  }

  try {
    parseOr();
    if (pos < tokens.length) {
      const tok = tokens[pos];
      const hint = OPERATORS.has(tok.toUpperCase())
        ? " (operators AND, OR, WITH are upper-case)"
        : "";
      fail(`unexpected ${q(tok)}${hint}`);
    }
  } catch (err) {
    if (err instanceof SyntaxError_) return { ok: false, error: err.message };
    throw err;
  }
  return { ok: true, leaves, exceptions, deprecated };
}

/** Licence file names (case-insensitive) recognised at a directory root. */
const LICENSE_FILE_NAMES = new Set([
  "license",
  "license.md",
  "license.txt",
  "copying",
  "copying.md",
  "copying.txt",
]);

/** Whether `name` is a recognised licence file name (case-insensitive). */
export function isLicenseFileName(name: string): boolean {
  return LICENSE_FILE_NAMES.has(name.toLowerCase());
}

/** Return the first licence file name among `entries`, if any. */
export function findLicenseFileName(entries?: string[]): string | undefined {
  return entries?.find(isLicenseFileName);
}

/**
 * Declarations that mark a skill as private / proprietary rather than
 * openly licensed: `Proprietary`, npm's `UNLICENSED`, `SEE LICENSE IN <file>`,
 * `private`, and any "All rights reserved" notice. The SPDX `Unlicense`
 * (public domain) is deliberately not matched.
 */
const PRIVATE_LICENSE_PATTERNS: RegExp[] = [
  /^proprietary\b/i,
  /^unlicensed$/i,
  /^private\b/i,
  /^see licen[cs]e in\s+\S/i,
  /\ball rights reserved\b/i,
];

export function isPrivateLicense(license: string): boolean {
  const id = license.trim();
  return PRIVATE_LICENSE_PATTERNS.some((re) => re.test(id));
}

type LicenseAssessment =
  | { status: "recognised"; finding: string; suggestions: string[] }
  | { status: "private" }
  | { status: "unrecognised"; reason: string };

/** Quote up to five ids for a finding, each clipped, then "and N more". */
const codeList = (ids: string[]) => {
  const shown = ids.slice(0, 5).map((id) => quoteValue(id, MAX_QUOTED_TOKEN));
  if (ids.length > 5) shown.push(`and ${ids.length - 5} more`);
  return shown.join(", ");
};

/**
 * Classify a declared `license:` value (#771, #783).
 *
 * The #771 rule (private if `isPrivateLicense` matches the whole value, else
 * not recognised) applies when the value names no listed SPDX id and no
 * `LicenseRef-`, or does not parse as an expression. So "PROPRIETARY AND
 * CONFIDENTIAL", "All rights reserved" and `SEE LICENSE IN <file>` stay
 * private, while `MIT OR` is not recognised.
 *
 * Otherwise the expression's ids and exceptions must all be recognised. One that also names private terms
 * (`Apache-2.0 OR Proprietary`) is scored under the SPDX rule, because the
 * SPDX terms need the licence text. A private alternative must not lift the
 * no-file score above what the open licence earns alone.
 */
function assessLicense(value: string): LicenseAssessment {
  const words = value.match(/[^\s()]+/g) ?? [];
  const namesOpenLicence = words.some((w) => {
    const kind = leafKind(w.endsWith("+") ? w.slice(0, -1) : w);
    return kind === "spdx" || kind === "ref";
  });
  const parsed = namesOpenLicence ? parseSpdxExpression(value) : undefined;
  if (!parsed?.ok) {
    if (isPrivateLicense(value)) return { status: "private" };
    return {
      status: "unrecognised",
      reason: parsed
        ? `but it is not a valid SPDX license expression: ${parsed.error}.`
        : "but not in asm's list of recognised SPDX identifiers.",
    };
  }

  const unknownIds = parsed.leaves
    .filter((l) => l.kind === "unknown")
    .map((l) => l.id);
  const unknownExceptions = parsed.exceptions
    .filter((e) => !e.known)
    .map((e) => e.id);
  if (unknownIds.length || unknownExceptions.length) {
    const parts: string[] = [];
    if (unknownIds.length) {
      parts.push(
        `${codeList(unknownIds)} ${unknownIds.length > 1 ? "are" : "is"} not in asm's list of recognised SPDX identifiers`,
      );
    }
    if (unknownExceptions.length) {
      parts.push(
        `${codeList(unknownExceptions)} ${unknownExceptions.length > 1 ? "are" : "is"} not in asm's list of recognised SPDX exceptions`,
      );
    }
    return { status: "unrecognised", reason: `but ${parts.join("; ")}.` };
  }

  const suggestions = [
    ...new Set(
      parsed.deprecated.map(({ id, orLater }) =>
        orLater
          ? `\`${id}+\` is deprecated on the SPDX License List — use \`${id}-or-later\`.`
          : `\`${id}\` is deprecated on the SPDX License List — use \`${id}-only\` or \`${id}-or-later\`.`,
      ),
    ),
  ];
  const privateTerms = parsed.leaves
    .filter((l) => l.kind === "private")
    .map((l) => l.id);
  const refs = parsed.leaves.filter((l) => l.kind === "ref").map((l) => l.id);
  const refNote = refs.length
    ? ` Custom reference ${codeList(refs)}: its text belongs in the licence file.`
    : "";

  if (privateTerms.length) {
    return {
      status: "recognised",
      finding: `License declared: ${quoteValue(value)} mixes SPDX terms with private terms (${codeList(privateTerms)}), so it is not valid SPDX as written (use ${codeList(privateTerms.map((t) => `LicenseRef-${t}`))} for the private terms) — SPDX licence rule applied: the SPDX terms need a licence file; the private-licence rule (#771) covers only declarations with no SPDX identifier.${refNote}`,
      suggestions,
    };
  }
  const single =
    parsed.leaves.length === 1 &&
    parsed.exceptions.length === 0 &&
    parsed.leaves[0].kind === "spdx" &&
    words.length === 1 &&
    !value.endsWith("+");
  return {
    status: "recognised",
    finding: single
      ? `License declared: ${quoteValue(value)} (SPDX recognised).`
      : `License declared: ${quoteValue(value)} (valid SPDX license expression, every identifier recognised).${refNote}`,
    suggestions,
  };
}

/**
 * Score whether a skill declares a license and whether that declaration is
 * a recognised SPDX identifier or a private licence (issue #771).
 *
 * A licence file is the skill's own LICENSE / LICENSE.md / LICENSE.txt /
 * COPYING at the skill root, or — when the skill has none — one inherited
 * from the enclosing repository (`inheritedLicenseFile`, a path relative to
 * the skill dir, resolved by the caller up to the git root).
 *
 * "Recognised SPDX" covers a listed id and a valid SPDX license expression
 * (#783, `parseSpdxExpression`) whose ids and exceptions are all recognised,
 * including `LicenseRef-` references and expressions that mix SPDX terms
 * with private ones (`Apache-2.0 OR Proprietary`).
 *
 * Scoring:
 *   10 — recognised SPDX or private licence declared AND a licence file
 *        (own or inherited) present.
 *    8 — private licence declared (`Proprietary`, `UNLICENSED`,
 *        `SEE LICENSE IN <file>`, `private`, "All rights reserved") with no
 *        licence file — private terms need neither SPDX nor a LICENSE file.
 *    5 — recognised SPDX licence declared but no licence file anywhere.
 *    2 — a licence is declared (in frontmatter or LICENSE file) but the
 *        identifier is neither SPDX nor private, or an expression names an
 *        unknown id or exception, or has invalid syntax.
 *    0 — no licence declared at all (an inherited file alone does not count).
 *
 * The scorer also records a `licenseStatus` tag on the result so callers can
 * surface the position without parsing free-text findings.
 */
export interface CategoryResultWithLicense extends CategoryResult {
  /** Stable tag describing the licence position. */
  licenseStatus?: "recognised" | "private" | "unrecognised" | "missing";
}

export function scoreLicense(
  fm: Record<string, string>,
  body: string,
  rootEntries?: string[],
  inheritedLicenseFile?: string,
): CategoryResultWithLicense {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  const fmLicense = (fm.license || "").trim();
  const hasFmLicense = Boolean(fmLicense);

  // Check for a LICENSE file at the skill root, else one inherited from the
  // enclosing repository.
  const hasLicenseFile = Boolean(findLicenseFileName(rootEntries));
  const inherited = hasLicenseFile ? undefined : inheritedLicenseFile;
  const licenseFileFinding = hasLicenseFile
    ? "LICENSE file present at skill root."
    : inherited
      ? `LICENSE inherited from the enclosing repository (\`${inherited}\`).`
      : undefined;

  // Classify
  let licenseStatus: "recognised" | "private" | "unrecognised" | "missing" =
    "missing";
  let assessment: LicenseAssessment | undefined;

  if (hasFmLicense) {
    assessment = assessLicense(fmLicense);
    licenseStatus = assessment.status;
  } else if (hasLicenseFile) {
    // License file exists but no frontmatter declaration — treat as
    // "unrecognised" because we cannot programmatically verify the file
    // contents without reading it (avoids filesystem reads in the scorer).
    licenseStatus = "unrecognised";
  }

  switch (licenseStatus) {
    case "recognised": {
      score = licenseFileFinding ? 10 : 5;
      if (assessment?.status === "recognised") {
        findings.push(assessment.finding);
        suggestions.push(...assessment.suggestions);
      }
      findings.push(
        licenseFileFinding ??
          "No LICENSE file found — consider adding one for clarity.",
      );
      break;
    }
    case "private": {
      score = licenseFileFinding ? 10 : 8;
      findings.push(
        `Private licence declared: ${quoteValue(fmLicense)} — no SPDX identifier or LICENSE file required.`,
      );
      if (licenseFileFinding) findings.push(licenseFileFinding);
      break;
    }
    case "unrecognised": {
      score = 2;
      if (assessment?.status === "unrecognised") {
        findings.push(
          `License declared as ${quoteValue(fmLicense)} ${assessment.reason}`,
        );
      }
      if (hasLicenseFile && !hasFmLicense) {
        findings.push(`LICENSE file present but no frontmatter license field.`);
      }
      suggestions.push(
        "Use a standard SPDX licence identifier or expression (e.g. `MIT`, `Apache-2.0`, `MIT OR Apache-2.0`) so tooling can verify redistributability.",
      );
      break;
    }
    case "missing": {
      score = 0;
      findings.push("No license declared.");
      suggestions.push(
        "Add a `license` field to frontmatter (e.g. `license: MIT`) so users know the redistribution terms.",
      );
      if (hasLicenseFile) {
        suggestions.push(
          "A LICENSE file exists — add the corresponding `license:` frontmatter field to match it.",
        );
      }
      break;
    }
  }

  return {
    id: "license",
    name: "License verification",
    score: Math.min(10, Math.round(score)),
    max: 10,
    findings,
    suggestions,
    licenseStatus,
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
