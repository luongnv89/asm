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
  "Apache-2.0 WITH LLVM-exception",
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

/** Licence file names (case-insensitive) recognised at a directory root. */
const LICENSE_FILE_NAMES = new Set([
  "license",
  "license.md",
  "license.txt",
  "copying",
  "copying.md",
  "copying.txt",
]);

/** Return the first licence file name among `entries`, if any. */
export function findLicenseFileName(entries?: string[]): string | undefined {
  return entries?.find((e) => LICENSE_FILE_NAMES.has(e.toLowerCase()));
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

/**
 * Score whether a skill declares a license and whether that declaration is
 * a recognised SPDX identifier or a private licence (issue #771).
 *
 * A licence file is the skill's own LICENSE / LICENSE.md / LICENSE.txt /
 * COPYING at the skill root, or — when the skill has none — one inherited
 * from the enclosing repository (`inheritedLicenseFile`, a path relative to
 * the skill dir, resolved by the caller up to the git root).
 *
 * Scoring:
 *   10 — recognised SPDX or private licence declared AND a licence file
 *        (own or inherited) present.
 *    8 — private licence declared (`Proprietary`, `UNLICENSED`,
 *        `SEE LICENSE IN <file>`, `private`, "All rights reserved") with no
 *        licence file — private terms need neither SPDX nor a LICENSE file.
 *    5 — recognised SPDX licence declared but no licence file anywhere.
 *    2 — a licence is declared (in frontmatter or LICENSE file) but the
 *        identifier is neither SPDX nor private.
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

  if (hasFmLicense) {
    if (RECOGNISED_LICENSES.has(fmLicense)) {
      licenseStatus = "recognised";
    } else if (isPrivateLicense(fmLicense)) {
      licenseStatus = "private";
    } else {
      licenseStatus = "unrecognised";
    }
  } else if (hasLicenseFile) {
    // License file exists but no frontmatter declaration — treat as
    // "unrecognised" because we cannot programmatically verify the file
    // contents without reading it (avoids filesystem reads in the scorer).
    licenseStatus = "unrecognised";
  }

  switch (licenseStatus) {
    case "recognised": {
      score = licenseFileFinding ? 10 : 5;
      findings.push(`License declared: \`${fmLicense}\` (SPDX recognised).`);
      findings.push(
        licenseFileFinding ??
          "No LICENSE file found — consider adding one for clarity.",
      );
      break;
    }
    case "private": {
      score = licenseFileFinding ? 10 : 8;
      findings.push(
        `Private licence declared: \`${fmLicense}\` — no SPDX identifier or LICENSE file required.`,
      );
      if (licenseFileFinding) findings.push(licenseFileFinding);
      break;
    }
    case "unrecognised": {
      score = 2;
      if (hasFmLicense) {
        findings.push(
          `License declared as \`${fmLicense}\` but not in the SPDX list.`,
        );
      }
      if (hasLicenseFile && !hasFmLicense) {
        findings.push(`LICENSE file present but no frontmatter license field.`);
      }
      suggestions.push(
        "Use a standard SPDX licence identifier (e.g. `MIT`, `Apache-2.0`, `GPL-3.0-only`) so tooling can verify redistributability.",
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
