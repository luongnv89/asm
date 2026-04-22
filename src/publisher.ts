/**
 * Publish pipeline for submitting skills to the asm-registry.
 *
 * Validates a skill, runs SecurityAuditor, generates a manifest, and
 * optionally opens a PR against luongnv89/asm-registry via the gh CLI.
 */

import { readFile, stat, realpath } from "fs/promises";
import { join, resolve, relative } from "path";
import { parseFrontmatter, resolveVersion } from "./utils/frontmatter";
import { auditSkillSecurity } from "./security-auditor";
import { validateManifest } from "./registry";
import type { RegistryManifest } from "./registry";
import type { SecurityVerdict, SecurityAuditReport } from "./utils/types";
import type { PublishResult } from "./utils/types";
import { debug } from "./logger";
import { runCommand } from "./utils/spawn";

// ─── Sanitization ──────────────────────────────────────────────────────────

/**
 * Strip ANSI escape sequences and ASCII control characters from a string.
 * Prevents terminal escape injection when displaying untrusted data like
 * skill names parsed from SKILL.md frontmatter.
 */
export function stripControlChars(s: string): string {
  // Remove ANSI escape sequences (CSI, OSC, etc.)
  // eslint-disable-next-line no-control-regex
  return (
    s
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b[^[\]]/g, "")
      // Remove remaining ASCII control characters (0x00-0x1F, 0x7F) except \n and \t
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
  );
}

/**
 * Escape markdown special characters in untrusted text so it renders
 * as literal content rather than being interpreted as markdown syntax.
 * Covers backticks, square brackets, angle brackets, and pipe characters.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "\\|");
}

/**
 * Sanitize an untrusted string for safe embedding in markdown.
 * Strips control characters first, then escapes markdown syntax.
 */
export function sanitizeForMarkdown(s: string): string {
  return escapeMarkdown(stripControlChars(s));
}

// ─── Constants ──────────────────────────────────────────────────────────────

const REGISTRY_REPO = "luongnv89/asm-registry";

// ─── Skill Metadata ─────────────────────────────────────────────────────────

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  license: string;
  creator: string;
  tags: string[];
}

/**
 * Locate and parse SKILL.md in the target directory.
 * Throws if SKILL.md is not found or is missing required fields.
 */
export async function parseSkillMetadata(
  skillDir: string,
): Promise<SkillMetadata> {
  const skillMdPath = join(skillDir, "SKILL.md");

  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    throw new Error(
      `No SKILL.md found in ${skillDir}. Run "asm init" to create one.`,
    );
  }

  const fm = parseFrontmatter(content);

  if (!fm.name) {
    throw new Error("SKILL.md is missing required field: name");
  }
  if (!fm.description) {
    throw new Error("SKILL.md is missing required field: description");
  }

  const version = resolveVersion(fm);
  const tags = fm.tags
    ? fm.tags
        .split(/[\s,]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];

  return {
    name: fm.name,
    description: fm.description.replace(/\s*\n\s*/g, " ").trim(),
    version,
    license: fm.license || "MIT",
    creator: fm.creator || "",
    tags,
  };
}

// ─── Git Helpers ────────────────────────────────────────────────────────────

/**
 * Check that the target directory is inside a git repository.
 */
export async function checkIsGitRepo(dir: string): Promise<void> {
  const { exitCode } = await runCommand(["git", "rev-parse", "--git-dir"], {
    cwd: dir,
  });
  if (exitCode !== 0) {
    throw new Error(`${dir} is not inside a git repository.`);
  }
}

/**
 * Get the current HEAD commit SHA.
 */
export async function getHeadCommit(dir: string): Promise<string> {
  const { stdout, exitCode } = await runCommand(["git", "rev-parse", "HEAD"], {
    cwd: dir,
  });
  if (exitCode !== 0) {
    throw new Error("Failed to get HEAD commit. Is this a git repository?");
  }
  return stdout.trim();
}

/**
 * Get the root directory of the git repository containing dir.
 */
export async function getGitRoot(dir: string): Promise<string> {
  const { stdout, exitCode } = await runCommand(
    ["git", "rev-parse", "--show-toplevel"],
    { cwd: dir },
  );
  if (exitCode !== 0) {
    throw new Error("Failed to determine git repository root.");
  }
  return stdout.trim();
}

/**
 * Get the remote origin URL.
 */
export async function getRemoteOrigin(dir: string): Promise<string> {
  const { stdout, exitCode } = await runCommand(
    ["git", "remote", "get-url", "origin"],
    { cwd: dir },
  );
  if (exitCode !== 0) {
    throw new Error(
      "No remote origin found. Add one with: git remote add origin <url>",
    );
  }
  const raw = stdout.trim();
  // Normalize SSH URLs to HTTPS
  const sshMatch = raw.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }
  // Strip trailing .git from HTTPS URLs
  return raw.replace(/\.git$/, "");
}

// ─── gh CLI Helpers ─────────────────────────────────────────────────────────

/**
 * Check if gh CLI is available and authenticated.
 * Returns { available, authenticated, login }.
 */
export async function checkGhCli(): Promise<{
  available: boolean;
  authenticated: boolean;
  login: string | null;
}> {
  const { exitCode: versionExit } = await runCommand(["gh", "--version"]);
  if (versionExit !== 0) {
    return { available: false, authenticated: false, login: null };
  }

  const { exitCode: authExit } = await runCommand(["gh", "auth", "status"]);
  if (authExit !== 0) {
    return { available: true, authenticated: false, login: null };
  }

  const { stdout: loginOut, exitCode: loginExit } = await runCommand([
    "gh",
    "api",
    "user",
    "--jq",
    ".login",
  ]);
  const login = loginExit === 0 ? loginOut.trim() : null;

  return { available: true, authenticated: true, login };
}

// ─── Verdict Mapping ────────────────────────────────────────────────────────

/**
 * Map SecurityAuditor verdict to registry-compatible verdict.
 * SecurityAuditor produces: safe | caution | warning | dangerous
 * Registry expects: pass | warning | dangerous
 */
export function mapVerdict(
  verdict: SecurityVerdict,
): "pass" | "warning" | "dangerous" {
  switch (verdict) {
    case "safe":
    case "caution":
      return "pass";
    case "warning":
      return "warning";
    case "dangerous":
      return "dangerous";
  }
}

// ─── Manifest Generation ────────────────────────────────────────────────────

export interface GenerateManifestOptions {
  metadata: SkillMetadata;
  author: string;
  commit: string;
  repository: string;
  skillPath?: string;
  securityVerdict: "pass" | "warning" | "dangerous";
}

/**
 * Generate a registry manifest from skill metadata and publish context.
 * Pure function for testability.
 */
export function generateManifest(
  opts: GenerateManifestOptions,
): RegistryManifest {
  const manifest: RegistryManifest = {
    name: opts.metadata.name,
    author: opts.author,
    description: opts.metadata.description,
    repository: opts.repository,
    commit: opts.commit,
    security_verdict: opts.securityVerdict,
    published_at: new Date().toISOString(),
  };

  if (opts.skillPath) {
    manifest.skill_path = opts.skillPath;
  }

  if (
    opts.metadata.version &&
    opts.metadata.version !== "0.0.0" &&
    /^\d+\.\d+\.\d+/.test(opts.metadata.version)
  ) {
    manifest.version = opts.metadata.version;
  }

  if (opts.metadata.license) {
    manifest.license = opts.metadata.license;
  }

  if (opts.metadata.tags && opts.metadata.tags.length > 0) {
    manifest.tags = opts.metadata.tags.slice(0, 10);
  }

  return manifest;
}

// ─── Fallback Helper ───────────────────────────────────────────────────────

interface FallbackOptions {
  metadata: SkillMetadata;
  commit: string;
  repository: string;
  registryVerdict: "pass" | "warning" | "dangerous";
  securityReport: SecurityAuditReport;
  fallbackReason: string;
}

/**
 * Build a PublishResult for fallback paths (gh unavailable or not authenticated).
 * Generates and validates the manifest before returning.
 */
function buildFallbackResult(opts: FallbackOptions): PublishResult {
  const manifest = generateManifest({
    metadata: opts.metadata,
    author: opts.metadata.creator || "unknown",
    commit: opts.commit,
    repository: opts.repository,
    securityVerdict: opts.registryVerdict,
  });

  const validationErrors = validateManifest(manifest);
  if (validationErrors.length > 0) {
    return {
      success: false,
      manifest,
      prUrl: null,
      error: `Manifest validation failed: ${validationErrors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      securityVerdict: opts.registryVerdict,
      securityReport: opts.securityReport,
    };
  }

  return {
    success: true,
    manifest,
    prUrl: null,
    error: null,
    securityVerdict: opts.registryVerdict,
    securityReport: opts.securityReport,
    fallback: true,
    fallbackReason: opts.fallbackReason,
  };
}

// ─── Publish Pipeline ───────────────────────────────────────────────────────

export interface PublishOptions {
  path: string;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
  /** @internal Override the security audit function (for testing). */
  _auditFn?: (
    skillPath: string,
    skillName: string,
  ) => Promise<import("./utils/types").SecurityAuditReport>;
  /** @internal Override the gh CLI check function (for testing). */
  _checkGhCliFn?: () => Promise<{
    available: boolean;
    authenticated: boolean;
    login: string | null;
  }>;
}

/**
 * Run the full publish pipeline:
 * 1. Locate and validate SKILL.md
 * 2. Run SecurityAuditor
 * 3. Detect author via gh
 * 4. Generate manifest
 * 5. Optionally fork registry, create branch, write manifest, open PR
 */
export async function publishSkill(
  opts: PublishOptions,
): Promise<PublishResult> {
  const skillDir = resolve(opts.path);
  debug(`publish: starting for ${skillDir}`);

  // Step 1: Validate git repo
  await checkIsGitRepo(skillDir);

  // Step 2: Parse SKILL.md metadata
  const metadata = await parseSkillMetadata(skillDir);
  debug(`publish: parsed metadata for "${metadata.name}"`);

  // Step 3: Run SecurityAuditor
  const auditFn = opts._auditFn ?? auditSkillSecurity;
  const securityReport = await auditFn(skillDir, metadata.name);
  const registryVerdict = mapVerdict(securityReport.verdict);

  // Step 4: Check security verdict
  if (registryVerdict === "dangerous") {
    return {
      success: false,
      manifest: null,
      prUrl: null,
      error: `Security audit verdict: dangerous. ${securityReport.verdictReason}`,
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  if (registryVerdict === "warning" && !opts.force) {
    return {
      success: false,
      manifest: null,
      prUrl: null,
      error:
        "Security audit verdict: warning. Use --force to override warnings.",
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  // Step 5: Get git info
  const commit = await getHeadCommit(skillDir);
  const repository = await getRemoteOrigin(skillDir);
  const gitRoot = await getGitRoot(skillDir);
  // git rev-parse --show-toplevel resolves symlinks (e.g. /var → /private/var on macOS),
  // so resolve skillDir the same way before computing the relative path.
  const realSkillDir = await realpath(skillDir);
  const relativeSkillPath = relative(gitRoot, realSkillDir);
  // Only set skill_path when the skill is in a subdirectory (not the repo root)
  const skillPath =
    relativeSkillPath && relativeSkillPath !== "."
      ? relativeSkillPath
      : undefined;

  // Step 6: Detect author via gh CLI
  const checkGhCliFn = opts._checkGhCliFn ?? checkGhCli;
  const ghStatus = await checkGhCliFn();

  if (!ghStatus.available || !ghStatus.authenticated) {
    const fallbackReason = !ghStatus.available
      ? "gh CLI not found"
      : "gh CLI not authenticated";
    return buildFallbackResult({
      metadata,
      commit,
      repository,
      registryVerdict,
      securityReport,
      fallbackReason,
    });
  }

  if (!ghStatus.login) {
    throw new Error(
      "Could not determine GitHub username. The gh CLI is authenticated but the API call failed. Check your network connection and try again.",
    );
  }
  const author = ghStatus.login;

  // Step 7: Generate manifest
  const manifest = generateManifest({
    metadata,
    author,
    commit,
    repository,
    skillPath,
    securityVerdict: registryVerdict,
  });

  // Validate manifest against registry schema
  const validationErrors = validateManifest(manifest);
  if (validationErrors.length > 0) {
    return {
      success: false,
      manifest,
      prUrl: null,
      error: `Manifest validation failed: ${validationErrors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  // Step 8: Dry run check
  if (opts.dryRun) {
    return {
      success: true,
      manifest,
      prUrl: null,
      error: null,
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  // Step 8b: Confirmation prompt (unless --yes)
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      return {
        success: false,
        manifest,
        prUrl: null,
        error:
          "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
        securityVerdict: registryVerdict,
        securityReport,
      };
    }
    const safeName = stripControlChars(metadata.name);
    const safeAuthor = stripControlChars(author);
    process.stderr.write(
      `\nAbout to publish "${safeName}" by ${safeAuthor} to ${REGISTRY_REPO}.\n` +
        `Security verdict: ${registryVerdict}\n\n` +
        `Proceed? [y/N] `,
    );
    const answer = await new Promise<string>((resolve) => {
      let data = "";
      const onData = (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          resolve(data.trim());
        }
      };
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      return {
        success: false,
        manifest,
        prUrl: null,
        error: "Publish aborted by user.",
        securityVerdict: registryVerdict,
        securityReport,
      };
    }
  }

  // Step 9: Fork registry
  debug(`publish: forking ${REGISTRY_REPO}`);
  await runCommand(["gh", "repo", "fork", REGISTRY_REPO, "--clone=false"]);
  // Fork may already exist, that's fine

  // Step 10: Create branch and write manifest via gh API
  const branchName = `publish/${author}/${metadata.name}`;
  const manifestPath = `manifests/${author}/${metadata.name}.json`;
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  const encodedContent = Buffer.from(manifestContent, "utf-8").toString(
    "base64",
  );

  // Get the default branch SHA from the fork
  const { stdout: refOut, exitCode: refExit } = await runCommand([
    "gh",
    "api",
    `repos/${author}/asm-registry/git/refs/heads/main`,
    "--jq",
    ".object.sha",
  ]);

  if (refExit !== 0) {
    return {
      success: false,
      manifest,
      prUrl: null,
      error:
        "Failed to read fork's main branch. Ensure the fork exists at " +
        `${author}/asm-registry.`,
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  const baseSha = refOut.trim();

  // Create branch in the fork
  const { exitCode: createRefExit } = await runCommand([
    "gh",
    "api",
    `repos/${author}/asm-registry/git/refs`,
    "-X",
    "POST",
    "-f",
    `ref=refs/heads/${branchName}`,
    "-f",
    `sha=${baseSha}`,
  ]);

  if (createRefExit !== 0) {
    // Branch may already exist — try to update it
    await runCommand([
      "gh",
      "api",
      `repos/${author}/asm-registry/git/refs/heads/${branchName}`,
      "-X",
      "PATCH",
      "-f",
      `sha=${baseSha}`,
      "-f",
      "force=true",
    ]);
  }

  // Write manifest file to the branch
  const { stderr: putFileStderr, exitCode: putFileExit } = await runCommand([
    "gh",
    "api",
    `repos/${author}/asm-registry/contents/${manifestPath}`,
    "-X",
    "PUT",
    "-f",
    `message=Publish ${author}/${metadata.name}`,
    "-f",
    `content=${encodedContent}`,
    "-f",
    `branch=${branchName}`,
  ]);

  if (putFileExit !== 0) {
    // File may already exist — try updating with SHA
    const { stdout: getFileOut, exitCode: getFileExit } = await runCommand([
      "gh",
      "api",
      `repos/${author}/asm-registry/contents/${manifestPath}?ref=${branchName}`,
      "-q",
      ".sha",
    ]);
    const fileSha = getFileOut.trim();

    if (getFileExit === 0 && fileSha) {
      const { exitCode: updateExit } = await runCommand([
        "gh",
        "api",
        `repos/${author}/asm-registry/contents/${manifestPath}`,
        "-X",
        "PUT",
        "-f",
        `message=Update ${author}/${metadata.name}`,
        "-f",
        `content=${encodedContent}`,
        "-f",
        `branch=${branchName}`,
        "-f",
        `sha=${fileSha}`,
      ]);
      if (updateExit !== 0) {
        return {
          success: false,
          manifest,
          prUrl: null,
          error: "Failed to write manifest to registry fork.",
          securityVerdict: registryVerdict,
          securityReport,
        };
      }
    } else {
      return {
        success: false,
        manifest,
        prUrl: null,
        error: `Failed to write manifest to registry fork. ${putFileStderr}`,
        securityVerdict: registryVerdict,
        securityReport,
      };
    }
  }

  // Step 11: Open PR
  const safeName = sanitizeForMarkdown(metadata.name);
  const safeDescription = sanitizeForMarkdown(metadata.description);
  const safeLicense = sanitizeForMarkdown(metadata.license);
  const prTitle = `Publish ${author}/${stripControlChars(metadata.name)}`;
  const prBody = [
    `## Skill: ${safeName}`,
    "",
    `**Author:** ${author}`,
    `**Version:** ${metadata.version}`,
    `**Description:** ${safeDescription}`,
    `**License:** ${safeLicense}`,
    `**Repository:** ${repository}`,
    `**Commit:** \`${commit}\``,
    `**Security verdict:** ${registryVerdict}`,
    "",
    "---",
    "",
    "*This PR was generated by `asm publish`.*",
  ].join("\n");

  const {
    stdout: prOut,
    stderr: prStderr,
    exitCode: prExit,
  } = await runCommand([
    "gh",
    "pr",
    "create",
    "--repo",
    REGISTRY_REPO,
    "--head",
    `${author}:${branchName}`,
    "--title",
    prTitle,
    "--body",
    prBody,
  ]);

  let prUrl: string | null = null;
  if (prExit === 0) {
    prUrl = prOut.trim();
  } else {
    // PR may already exist
    const existingMatch = prStderr.match(
      /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
    );
    if (existingMatch) {
      prUrl = existingMatch[0];
    }
  }

  if (!prUrl) {
    return {
      success: false,
      manifest,
      prUrl: null,
      error: `Failed to create PR against ${REGISTRY_REPO}. ${prStderr}`,
      securityVerdict: registryVerdict,
      securityReport,
    };
  }

  return {
    success: true,
    manifest,
    prUrl,
    error: null,
    securityVerdict: registryVerdict,
    securityReport,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a publish result for machine-readable output (v1 envelope).
 *
 * @deprecated Superseded by the centralized machine envelope in utils/machine.ts.
 * Retained for backward compatibility with external consumers. Use formatMachineOutput() instead.
 */
export function formatPublishMachine(result: PublishResult): string {
  return JSON.stringify(
    {
      version: 1,
      type: "publish",
      success: result.success,
      manifest: result.manifest,
      pr_url: result.prUrl,
      error: result.error,
      security_verdict: result.securityVerdict,
      fallback: result.fallback ?? false,
      fallback_reason: result.fallbackReason ?? null,
    },
    null,
    2,
  );
}

/**
 * Format fallback instructions when gh is unavailable.
 */
export function formatFallbackInstructions(result: PublishResult): string {
  const manifest = result.manifest;
  if (!manifest) return "";

  const lines = [
    "",
    `  gh CLI is unavailable (${result.fallbackReason}).`,
    "  To publish manually:",
    "",
    `  1. Fork ${REGISTRY_REPO} on GitHub`,
    `  2. Create branch: publish/${manifest.author}/${manifest.name}`,
    `  3. Add file: manifests/${manifest.author}/${manifest.name}.json`,
    "  4. Paste the manifest below into that file",
    `  5. Open a PR against ${REGISTRY_REPO}`,
    "",
    `  Run "asm doctor" to fix your environment.`,
    "",
    "  Generated manifest:",
    JSON.stringify(manifest, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  ];

  return lines.join("\n");
}
