import { readFile, writeFile, readdir, access, mkdir, rm } from "fs/promises";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { debug } from "./logger";
import { readLock } from "./utils/lock";
import type {
  BundleManifest,
  BundleSkillRef,
  BundleValidation,
  SkillInfo,
} from "./utils/types";

// ─── Constants ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUNDLE_DIR = join(homedir(), ".config", "agent-skill-manager", "bundles");

/**
 * Path to the shipped (predefined) bundles directory bundled with ASM.
 * In dev (src/): __dirname is src/, data/bundles/ is at ../data/bundles/
 * In dist/ build: __dirname is dist/, data/bundles/ is at ../data/bundles/
 */
const PREDEFINED_BUNDLE_DIR = resolve(__dirname, "..", "data", "bundles");

// ─── Validation ────────────────────────────────────────────────────────────

export function validateBundle(data: unknown): BundleValidation {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: ["Bundle must be a JSON object."] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    errors.push(
      `Unsupported bundle version: ${JSON.stringify(obj.version)}. Expected 1.`,
    );
  }

  if (typeof obj.name !== "string" || !obj.name) {
    errors.push("Missing or empty 'name' field.");
  }

  if (typeof obj.description !== "string" || !obj.description) {
    errors.push("Missing or empty 'description' field.");
  }

  if (typeof obj.author !== "string" || !obj.author) {
    errors.push("Missing or empty 'author' field.");
  }

  if (typeof obj.createdAt !== "string") {
    errors.push("Missing or invalid 'createdAt' field.");
  }

  if (!Array.isArray(obj.skills)) {
    errors.push("Missing or invalid 'skills' array.");
    return { valid: false, errors };
  }

  if (obj.skills.length === 0) {
    errors.push("Bundle must contain at least one skill.");
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
    if (typeof s.installUrl !== "string" || !s.installUrl) {
      errors.push(`skills[${i}]: missing or empty 'installUrl'.`);
    }
  }

  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      errors.push("'tags' must be an array of strings if provided.");
    } else if (obj.tags.some((t: unknown) => typeof t !== "string")) {
      errors.push("'tags' must contain only strings.");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Build Bundle ──────────────────────────────────────────────────────────

export function buildBundle(
  name: string,
  description: string,
  author: string,
  skills: BundleSkillRef[],
  tags?: string[],
): BundleManifest {
  return {
    version: 1,
    name,
    description,
    author,
    createdAt: new Date().toISOString(),
    skills,
    tags,
  };
}

/**
 * Build bundle skill refs from installed SkillInfo entries.
 * Consults the lock file to recover the original remote source URL so that
 * bundles are portable across machines. Falls back to the local path only
 * for symlinked (linked) skills or when no lock entry exists.
 */
export async function skillInfoToRef(
  skill: SkillInfo,
  lockData?: Awaited<ReturnType<typeof readLock>>,
): Promise<BundleSkillRef> {
  // Use provided lock data or read it fresh
  const lock = lockData ?? (await readLock());
  const lockEntry = lock.skills[skill.name] || lock.skills[skill.dirName];

  let installUrl: string;
  if (skill.isSymlink && skill.symlinkTarget) {
    // Linked skills always use the symlink target (local path)
    installUrl = skill.symlinkTarget;
  } else if (lockEntry?.source) {
    // Use the original remote source recorded at install time
    installUrl = lockEntry.source;
  } else {
    // Fallback to the local install path
    installUrl = skill.path;
  }

  return {
    name: skill.name,
    installUrl,
    description: skill.description || undefined,
    version: skill.version || undefined,
  };
}

// ─── Bundle Storage ────────────────────────────────────────────────────────

export function getBundleDir(): string {
  return BUNDLE_DIR;
}

export async function ensureBundleDir(): Promise<void> {
  await mkdir(BUNDLE_DIR, { recursive: true });
}

function sanitizeBundleName(name: string): string {
  let sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Strip leading and trailing dots to prevent names like ".." producing "...json"
  sanitized = sanitized.replace(/^\.+|\.+$/g, "");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error(
      "Invalid bundle name: results in an empty filename after sanitization.",
    );
  }
  return sanitized;
}

export async function saveBundle(bundle: BundleManifest): Promise<string> {
  await ensureBundleDir();
  const filename = `${sanitizeBundleName(bundle.name)}.json`;
  const filePath = join(BUNDLE_DIR, filename);
  await writeFile(filePath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
  debug(`bundle: saved to ${filePath}`);
  return filePath;
}

export async function readBundleFile(
  filePath: string,
): Promise<BundleManifest> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(`Bundle file not found: ${filePath}`);
    }
    throw new Error(`Failed to read bundle file: ${err.message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Bundle file is not valid JSON.");
  }

  const validation = validateBundle(data);
  if (!validation.valid) {
    throw new Error(`Invalid bundle:\n  ${validation.errors.join("\n  ")}`);
  }

  return data as BundleManifest;
}

/**
 * Load a bundle by name (looks in the bundles directory) or by file path.
 * Falls back to the shipped predefined bundles in data/bundles/ when the
 * name is not found in the user bundles directory.
 */
export async function loadBundle(nameOrPath: string): Promise<BundleManifest> {
  // If it looks like a file path (has extension or path separator), read directly
  if (
    nameOrPath.includes("/") ||
    nameOrPath.includes("\\") ||
    nameOrPath.endsWith(".json")
  ) {
    const absPath = resolve(nameOrPath);
    return readBundleFile(absPath);
  }

  // Look in the user bundles directory first
  const filename = `${sanitizeBundleName(nameOrPath)}.json`;
  const filePath = join(BUNDLE_DIR, filename);

  try {
    return await readBundleFile(filePath);
  } catch (err: any) {
    // If not found in user dir, fall back to predefined (shipped) bundles
    if (err?.message?.includes("Bundle file not found")) {
      const predefinedPath = join(PREDEFINED_BUNDLE_DIR, filename);
      try {
        return await readBundleFile(predefinedPath);
      } catch (predefinedErr: any) {
        if (predefinedErr?.message?.includes("Bundle file not found")) {
          throw new Error(`Bundle file not found: ${filePath}`);
        }
        throw predefinedErr;
      }
    }
    throw err;
  }
}

/**
 * List all pre-defined (shipped) bundles from the data/bundles/ directory.
 */
export async function listPredefinedBundles(): Promise<BundleManifest[]> {
  const bundles: BundleManifest[] = [];

  try {
    await access(PREDEFINED_BUNDLE_DIR);
  } catch {
    return bundles;
  }

  let entries: string[];
  try {
    entries = await readdir(PREDEFINED_BUNDLE_DIR);
  } catch {
    return bundles;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(PREDEFINED_BUNDLE_DIR, entry);
    try {
      const bundle = await readBundleFile(filePath);
      bundles.push(bundle);
    } catch {
      debug(`bundle: skipping invalid predefined file ${filePath}`);
    }
  }

  bundles.sort((a, b) => a.name.localeCompare(b.name));
  return bundles;
}

/**
 * List all saved bundles from the bundles directory.
 */
export async function listBundles(): Promise<BundleManifest[]> {
  const bundles: BundleManifest[] = [];

  try {
    await access(BUNDLE_DIR);
  } catch {
    return bundles;
  }

  let entries: string[];
  try {
    entries = await readdir(BUNDLE_DIR);
  } catch {
    return bundles;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(BUNDLE_DIR, entry);
    try {
      const bundle = await readBundleFile(filePath);
      bundles.push(bundle);
    } catch {
      debug(`bundle: skipping invalid file ${filePath}`);
    }
  }

  bundles.sort((a, b) => a.name.localeCompare(b.name));
  return bundles;
}

/**
 * Remove a saved bundle by name.
 */
export async function removeBundle(name: string): Promise<boolean> {
  const filename = `${sanitizeBundleName(name)}.json`;
  const filePath = join(BUNDLE_DIR, filename);

  try {
    await rm(filePath);
    debug(`bundle: removed ${filePath}`);
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}
