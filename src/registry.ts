/**
 * Registry utilities for the asm-registry.
 *
 * Provides manifest validation against the JSON schema, Levenshtein-based
 * typosquat detection, author identity checks, duplicate detection, and
 * index rebuilding. These functions are used both by the CI pipeline and
 * by the future `asm publish` command.
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

// ─── Manifest Types ─────────────────────────────────────────────────────────

export interface RegistryManifest {
  name: string;
  author: string;
  description: string;
  repository: string;
  commit: string;
  version?: string;
  license?: string;
  tags?: string[];
  security_verdict: "pass" | "warning" | "dangerous";
  published_at: string;
  checksum?: string;
}

export interface RegistryIndex {
  generated_at: string;
  manifests: RegistryManifest[];
}

export interface ValidationError {
  field: string;
  message: string;
}

// ─── Validation Patterns ────────────────────────────────────────────────────

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const AUTHOR_PATTERN = /^[a-zA-Z0-9_-]+$/;
const REPO_URL_PATTERN =
  /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
const TAG_PATTERN = /^[a-z0-9-]+$/;
const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VALID_VERDICTS = ["pass", "warning", "dangerous"] as const;

// ─── Manifest Validation ────────────────────────────────────────────────────

/**
 * Validate a manifest object against the registry schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateManifest(manifest: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [{ field: "(root)", message: "manifest must be a non-null object" }];
  }

  const m = manifest as Record<string, unknown>;

  // Check for unknown properties (additionalProperties: false)
  const knownFields = new Set([
    "name",
    "author",
    "description",
    "repository",
    "commit",
    "version",
    "license",
    "tags",
    "security_verdict",
    "published_at",
    "checksum",
  ]);

  for (const key of Object.keys(m)) {
    if (!knownFields.has(key)) {
      errors.push({
        field: key,
        message: `unknown property "${key}" is not allowed`,
      });
    }
  }

  // Required string fields
  const requiredStrings: Array<{
    field: string;
    pattern?: RegExp;
    maxLength?: number;
  }> = [
    { field: "name", pattern: NAME_PATTERN, maxLength: 128 },
    { field: "author", pattern: AUTHOR_PATTERN, maxLength: 39 },
    { field: "description", maxLength: 256 },
    { field: "repository", pattern: REPO_URL_PATTERN },
    { field: "commit", pattern: COMMIT_PATTERN },
    { field: "published_at" },
  ];

  for (const { field, pattern, maxLength } of requiredStrings) {
    const val = m[field];
    if (val === undefined || val === null) {
      errors.push({ field, message: `required field "${field}" is missing` });
      continue;
    }
    if (typeof val !== "string") {
      errors.push({ field, message: `"${field}" must be a string` });
      continue;
    }
    if (val.length === 0) {
      errors.push({ field, message: `"${field}" must not be empty` });
      continue;
    }
    if (maxLength && val.length > maxLength) {
      errors.push({
        field,
        message: `"${field}" exceeds maximum length of ${maxLength}`,
      });
    }
    if (pattern && !pattern.test(val)) {
      errors.push({
        field,
        message: `"${field}" does not match required pattern`,
      });
    }
  }

  // security_verdict enum
  const verdict = m.security_verdict;
  if (verdict === undefined || verdict === null) {
    errors.push({
      field: "security_verdict",
      message: 'required field "security_verdict" is missing',
    });
  } else if (
    typeof verdict !== "string" ||
    !(VALID_VERDICTS as readonly string[]).includes(verdict)
  ) {
    errors.push({
      field: "security_verdict",
      message: `"security_verdict" must be one of: ${VALID_VERDICTS.join(", ")}`,
    });
  }

  // published_at: validate ISO 8601 date-time strictly
  // Date.parse() is too lenient (e.g. accepts "2026"), so use a regex instead.
  if (typeof m.published_at === "string" && m.published_at.length > 0) {
    const ISO8601_DATETIME =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    if (!ISO8601_DATETIME.test(m.published_at)) {
      errors.push({
        field: "published_at",
        message: '"published_at" must be a valid ISO 8601 date-time',
      });
    }
  }

  // Optional fields
  if (m.version !== undefined) {
    if (typeof m.version !== "string" || !SEMVER_PATTERN.test(m.version)) {
      errors.push({
        field: "version",
        message: '"version" must be a valid semver string',
      });
    }
  }

  if (m.license !== undefined) {
    if (typeof m.license !== "string") {
      errors.push({ field: "license", message: '"license" must be a string' });
    } else if (m.license.length > 64) {
      errors.push({
        field: "license",
        message: '"license" exceeds maximum length of 64',
      });
    }
  }

  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) {
      errors.push({ field: "tags", message: '"tags" must be an array' });
    } else {
      if (m.tags.length > 10) {
        errors.push({
          field: "tags",
          message: '"tags" has more than 10 items',
        });
      }
      const seen = new Set<string>();
      for (let i = 0; i < m.tags.length; i++) {
        const tag = m.tags[i];
        if (typeof tag !== "string") {
          errors.push({
            field: `tags[${i}]`,
            message: "tag must be a string",
          });
          continue;
        }
        if (tag.length > 32) {
          errors.push({
            field: `tags[${i}]`,
            message: `tag "${tag}" exceeds maximum length of 32`,
          });
        }
        if (!TAG_PATTERN.test(tag)) {
          errors.push({
            field: `tags[${i}]`,
            message: `tag "${tag}" does not match pattern (lowercase alphanumeric and hyphens)`,
          });
        }
        if (seen.has(tag)) {
          errors.push({
            field: `tags[${i}]`,
            message: `duplicate tag "${tag}"`,
          });
        }
        seen.add(tag);
      }
    }
  }

  if (m.checksum !== undefined) {
    if (typeof m.checksum !== "string" || !CHECKSUM_PATTERN.test(m.checksum)) {
      errors.push({
        field: "checksum",
        message: '"checksum" must match pattern sha256:<64-hex-chars>',
      });
    }
  }

  return errors;
}

// ─── Levenshtein Distance ───────────────────────────────────────────────────

/**
 * Compute the Levenshtein distance between two strings.
 * Used for typosquat detection.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Use two-row optimization for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ─── Typosquat Detection ────────────────────────────────────────────────────

export interface TyposquatMatch {
  existingName: string;
  distance: number;
}

/**
 * Check if a skill name is suspiciously similar to any existing names.
 * Returns matches within the specified Levenshtein distance threshold.
 */
export function detectTyposquats(
  newName: string,
  existingNames: string[],
  threshold: number = 2,
): TyposquatMatch[] {
  const matches: TyposquatMatch[] = [];

  for (const existing of existingNames) {
    if (newName === existing) continue;
    const distance = levenshtein(newName, existing);
    if (distance <= threshold) {
      matches.push({ existingName: existing, distance });
    }
  }

  return matches.sort((a, b) => a.distance - b.distance);
}

// ─── Author Identity Check ──────────────────────────────────────────────────

/**
 * Verify that a manifest's author field matches the expected GitHub username.
 * Comparison is case-insensitive because GitHub usernames are case-insensitive.
 */
export function checkAuthorIdentity(
  manifest: RegistryManifest,
  prAuthor: string,
): boolean {
  return manifest.author.toLowerCase() === prAuthor.toLowerCase();
}

// ─── Duplicate Detection ────────────────────────────────────────────────────

/**
 * Check if an identical manifest (same author, name, commit) already exists.
 */
export function isDuplicate(
  manifest: RegistryManifest,
  existingManifests: RegistryManifest[],
): boolean {
  return existingManifests.some(
    (existing) =>
      existing.author === manifest.author &&
      existing.name === manifest.name &&
      existing.commit === manifest.commit,
  );
}

// ─── Index Building ─────────────────────────────────────────────────────────

/**
 * Scan all manifest files in a manifests directory and build the index.
 * Directory structure: manifests/{author}/{name}.json
 */
export async function buildIndex(manifestsDir: string): Promise<RegistryIndex> {
  const manifests: RegistryManifest[] = [];

  let authors: string[];
  try {
    authors = await readdir(manifestsDir);
  } catch {
    return { generated_at: new Date().toISOString(), manifests: [] };
  }

  for (const author of authors) {
    const authorDir = join(manifestsDir, author);
    try {
      const s = await stat(authorDir);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const files = await readdir(authorDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(authorDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed: unknown = JSON.parse(content);
        const errors = validateManifest(parsed);
        if (errors.length > 0) {
          // Skip manifests that fail validation
          continue;
        }
        manifests.push(parsed as RegistryManifest);
      } catch {
        // Skip unparseable files
      }
    }
  }

  manifests.sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated_at: new Date().toISOString(),
    manifests,
  };
}
