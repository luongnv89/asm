import { readFile, access, mkdir, cp, rm } from "fs/promises";
import { join, basename } from "path";
import { resolveProviderPath, loadConfig } from "./config";
import { scanAllSkills } from "./scanner";
import { debug } from "./logger";
import type {
  ExportManifest,
  ExportedSkill,
  ImportResult,
  ImportSummary,
  AppConfig,
  SkillInfo,
} from "./utils/types";

// ─── Manifest Validation ────────────────────────────────────────────────────

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
}

export function validateManifest(data: unknown): ManifestValidation {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: ["Manifest must be a JSON object."] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push(
      `Unsupported manifest version: ${JSON.stringify(obj.version)}. Expected 1.`,
    );
  }

  if (typeof obj.exportedAt !== "string") {
    errors.push("Missing or invalid 'exportedAt' field.");
  }

  if (!Array.isArray(obj.skills)) {
    errors.push("Missing or invalid 'skills' array.");
    return { valid: false, errors };
  }

  for (let i = 0; i < obj.skills.length; i++) {
    const skill = obj.skills[i];
    if (typeof skill !== "object" || skill === null) {
      errors.push(`skills[${i}]: must be an object.`);
      continue;
    }
    const s = skill as Record<string, unknown>;
    if (typeof s.name !== "string" || !s.name) {
      errors.push(`skills[${i}]: missing or empty 'name'.`);
    }
    if (typeof s.provider !== "string" || !s.provider) {
      errors.push(`skills[${i}]: missing or empty 'provider'.`);
    }
    if (s.scope !== "global" && s.scope !== "project") {
      errors.push(
        `skills[${i}]: invalid 'scope' "${String(s.scope)}". Must be "global" or "project".`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Manifest Reading ───────────────────────────────────────────────────────

export async function readManifestFile(
  filePath: string,
): Promise<ExportManifest> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Manifest file not found: ${filePath}`);
    }
    throw new Error(`Failed to read manifest file: ${err.message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Manifest file is not valid JSON.");
  }

  const validation = validateManifest(data);
  if (!validation.valid) {
    throw new Error(`Invalid manifest:\n  ${validation.errors.join("\n  ")}`);
  }

  return data as ExportManifest;
}

// ─── Import Logic ───────────────────────────────────────────────────────────

/**
 * Check whether a skill already exists at the target directory.
 */
async function skillExists(targetDir: string): Promise<boolean> {
  try {
    await access(targetDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a provider config by name from the app config.
 */
function findProvider(config: AppConfig, providerName: string) {
  return config.providers.find((p) => p.name === providerName && p.enabled);
}

/**
 * Resolve the target directory for a skill based on provider and scope.
 */
function resolveTargetDir(
  config: AppConfig,
  providerName: string,
  scope: "global" | "project",
  dirName: string,
): string | null {
  const provider = findProvider(config, providerName);
  if (!provider) return null;

  const pathTemplate = scope === "global" ? provider.global : provider.project;
  const baseDir = resolveProviderPath(pathTemplate);

  // Sanitize dirName to prevent path traversal (e.g., "../../.bashrc")
  const safeDirName = basename(dirName);
  if (!safeDirName || safeDirName === "." || safeDirName === "..") {
    return null;
  }
  return join(baseDir, safeDirName);
}

/**
 * Find the source directory for a skill in the currently installed skills.
 */
function findInstalledSkill(
  installedSkills: SkillInfo[],
  exportedSkill: ExportedSkill,
): SkillInfo | null {
  // Match by dirName and provider
  const match = installedSkills.find(
    (s) =>
      s.dirName === exportedSkill.dirName &&
      s.provider === exportedSkill.provider,
  );
  if (match) return match;

  // Match by dirName only (different provider is still a valid source)
  return (
    installedSkills.find((s) => s.dirName === exportedSkill.dirName) || null
  );
}

/**
 * Import skills from a manifest into the local environment.
 *
 * Strategy:
 * - For each skill in the manifest, check if it already exists at the target location.
 * - If it exists, skip (unless force=true).
 * - If a matching skill is found in any installed location, copy it to the target.
 * - If no source is found, report as failed with guidance.
 */
export async function importSkills(
  manifest: ExportManifest,
  options: {
    force: boolean;
    dryRun: boolean;
    scopeFilter: "global" | "project" | "both";
  },
  /** @internal – dependency overrides for testing */
  _deps?: {
    config: AppConfig;
    installedSkills: SkillInfo[];
  },
): Promise<ImportSummary> {
  const config = _deps?.config ?? (await loadConfig());
  const installedSkills =
    _deps?.installedSkills ?? (await scanAllSkills(config, "both"));
  const results: ImportResult[] = [];

  for (const skill of manifest.skills) {
    // Apply scope filter
    if (options.scopeFilter !== "both" && skill.scope !== options.scopeFilter) {
      debug(
        `import: skipping "${skill.name}" — scope "${skill.scope}" filtered out`,
      );
      continue;
    }

    const targetDir = resolveTargetDir(
      config,
      skill.provider,
      skill.scope,
      skill.dirName,
    );

    if (!targetDir) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason: `Provider "${skill.provider}" not found or not enabled.`,
      });
      continue;
    }

    // Check if already installed at target
    const exists = await skillExists(targetDir);
    if (exists && !options.force) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "skipped",
        reason: "Already installed.",
        path: targetDir,
      });
      continue;
    }

    // Dry run: report what would happen
    if (options.dryRun) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "dry-run",
        reason: exists ? "Would overwrite (--force)." : "Would install.",
        path: targetDir,
      });
      continue;
    }

    // Try to find a source to copy from
    const source = findInstalledSkill(installedSkills, skill);
    if (!source) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason:
          "No installed source found. Install the skill first with: asm install <source>",
      });
      continue;
    }

    // Copy skill to target
    try {
      await mkdir(join(targetDir, ".."), { recursive: true });
      if (exists) {
        // Force mode: remove existing and re-copy
        await rm(targetDir, { recursive: true, force: true });
      }
      await cp(source.realPath, targetDir, { recursive: true });
      debug(
        `import: copied "${skill.name}" from ${source.realPath} to ${targetDir}`,
      );

      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "installed",
        path: targetDir,
      });
    } catch (err: any) {
      results.push({
        skillName: skill.name,
        provider: skill.provider,
        scope: skill.scope,
        status: "failed",
        reason: `Copy failed: ${err.message}`,
      });
    }
  }

  const installed = results.filter((r) => r.status === "installed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    total: results.length,
    installed,
    skipped,
    failed,
    results,
  };
}
