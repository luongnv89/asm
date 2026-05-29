/**
 * Skill enable/disable state management.
 *
 * Disabling a skill instance renames its `<skillDir>/SKILL.md` to
 * `<skillDir>/SKILL.md.disabled` so that both asm's scanner (which requires
 * `SKILL.md` to recognize a skill) and any external agent stop seeing it,
 * while the directory and name stay intact. The persisted state file
 * (`skill-state.json`) is the source of truth for what asm disabled; the
 * on-disk rename is the enforcement.
 */

import {
  readFile,
  writeFile,
  mkdir,
  rename,
  copyFile,
  access,
  realpath,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { getSkillStatePath } from "./config";
import { debug } from "./logger";
import type { SkillInfo, SkillStateFile } from "./utils/types";

export type Scope = "global" | "project";

/** Returns an empty, valid state object. */
export function emptyState(): SkillStateFile {
  return { version: 1, disabled: {} };
}

/**
 * Loads the skill-state file. Returns an empty state on ENOENT, and on a
 * corrupted/unparseable/structurally-invalid file backs it up to `.bak`,
 * warns, and returns empty. Mirrors the resilience of `src/utils/lock.ts`.
 */
export async function loadSkillState(path?: string): Promise<SkillStateFile> {
  const statePath = path ?? getSkillStatePath();

  let raw: string;
  try {
    raw = await readFile(statePath, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      debug("skill-state: file not found, returning empty state");
      return emptyState();
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      typeof parsed.disabled !== "object" ||
      parsed.disabled === null
    ) {
      throw new Error("invalid schema");
    }
    return parsed as SkillStateFile;
  } catch {
    const backupPath = statePath + ".bak";
    debug(`skill-state: parse error, backing up to ${backupPath}`);
    try {
      await copyFile(statePath, backupPath);
    } catch {
      // best-effort backup
    }
    console.error(
      `Warning: skill-state.json was corrupted. Backup saved to ${backupPath}. Starting fresh.`,
    );
    return emptyState();
  }
}

/** Persists the skill-state file, creating the parent directory if needed. */
export async function saveSkillState(
  state: SkillStateFile,
  path?: string,
): Promise<void> {
  const statePath = path ?? getSkillStatePath();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Reports whether a given (dirName, provider, scope) is recorded as disabled. */
export function isDisabled(
  state: SkillStateFile,
  dirName: string,
  provider: string,
  scope: Scope,
): boolean {
  return state.disabled[dirName]?.[provider]?.[scope] === true;
}

/** Records a (dirName, provider, scope) as disabled (mutates `state`). */
export function setDisabled(
  state: SkillStateFile,
  dirName: string,
  provider: string,
  scope: Scope,
): void {
  const byProvider = (state.disabled[dirName] ??= {});
  const byScope = (byProvider[provider] ??= {});
  byScope[scope] = true;
}

/** Clears the disabled record for a (dirName, provider, scope) (mutates). */
export function clearDisabled(
  state: SkillStateFile,
  dirName: string,
  provider: string,
  scope: Scope,
): void {
  const byProvider = state.disabled[dirName];
  if (!byProvider) return;
  const byScope = byProvider[provider];
  if (!byScope) return;
  delete byScope[scope];
  if (Object.keys(byScope).length === 0) delete byProvider[provider];
  if (Object.keys(byProvider).length === 0) delete state.disabled[dirName];
}

/** Escapes regex metacharacters except `*`, which becomes a wildcard. */
function escapeForGlob(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export interface CompiledTarget {
  kind: "all" | "exact" | "wildcard" | "prefix";
  test: (name: string) => boolean;
}

/**
 * Compiles a user-supplied target string into a matcher.
 *
 * - `"*"` or `"all"` matches everything (kind `"all"`).
 * - A target containing `*` is a glob (`*` matches any run of characters).
 * - A target ending in `:` or `-` is a prefix match (the trailing char is part
 *   of the prefix, e.g. `openspec:` matches `openspec:apply`).
 * - Otherwise it is an exact match. A bare token never implies a prefix.
 *
 * Matching is case-sensitive.
 */
export function compileTarget(target: string): CompiledTarget {
  if (target === "*" || target === "all") {
    return { kind: "all", test: () => true };
  }
  if (target.includes("*")) {
    const re = new RegExp(
      "^" + escapeForGlob(target).replace(/\*/g, ".*") + "$",
    );
    return { kind: "wildcard", test: (name) => re.test(name) };
  }
  if (target.endsWith(":") || target.endsWith("-")) {
    return { kind: "prefix", test: (name) => name.startsWith(target) };
  }
  return { kind: "exact", test: (name) => name === target };
}

/**
 * Returns the subset of `skills` whose `name` OR `dirName` matches `target`.
 *
 * Use `"*"` or `"all"` to match everything; otherwise the target follows the
 * exact / glob / prefix rules of {@link compileTarget}.
 */
export function matchSkills<T extends Pick<SkillInfo, "name" | "dirName">>(
  skills: T[],
  target: string,
): T[] {
  const compiled = compileTarget(target);
  return skills.filter(
    (s) => compiled.test(s.name) || compiled.test(s.dirName),
  );
}

/** Path to a skill instance's active marker file. */
export function skillFilePath(skillDir: string): string {
  return join(skillDir, "SKILL.md");
}

/** Path to a skill instance's disabled marker file. */
export function disabledFilePath(skillDir: string): string {
  return join(skillDir, "SKILL.md.disabled");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a skill directory to its canonical on-disk source.
 *
 * `asm install` copies a skill into one primary provider and **symlinks** every
 * other provider's directory at that copy (see `executeInstallAllProviders`),
 * so symlinked siblings share a single `SKILL.md`. Renaming through a symlink
 * path mutates the shared file — disabling the skill for every sibling — which
 * is exactly the "honest shared semantics" the CLI surfaces. Resolving the real
 * directory first makes the rename deterministic (it never depends on which
 * sibling path was passed) and idempotent across siblings. Falls back to the
 * given path if it can't be resolved (e.g. it does not exist yet).
 */
async function canonicalSkillDir(skillDir: string): Promise<string> {
  try {
    return await realpath(skillDir);
  } catch {
    return skillDir;
  }
}

/**
 * Disables a skill instance by renaming SKILL.md → SKILL.md.disabled on the
 * canonical source directory (see {@link canonicalSkillDir}). For a skill
 * symlinked across providers this disables it for every sibling — one shared
 * `SKILL.md`, one rename; the CLI records state for and warns about all of them.
 *
 * If SKILL.md is already absent but SKILL.md.disabled is present, this is a
 * no-op (already disabled). Returns `true` if a rename was performed.
 */
export async function disableSkillInstance(skillDir: string): Promise<boolean> {
  const dir = await canonicalSkillDir(skillDir);
  const active = skillFilePath(dir);
  const disabled = disabledFilePath(dir);
  if (!(await pathExists(active)) && (await pathExists(disabled))) {
    return false; // already disabled
  }
  await rename(active, disabled);
  return true;
}

/**
 * Enables a skill instance by renaming SKILL.md.disabled → SKILL.md on the
 * canonical source directory (see {@link canonicalSkillDir}). For a skill
 * symlinked across providers this re-enables it for every sibling.
 *
 * If SKILL.md.disabled is absent but SKILL.md is present, this is a no-op
 * (already enabled). Returns `true` if a rename was performed.
 */
export async function enableSkillInstance(skillDir: string): Promise<boolean> {
  const dir = await canonicalSkillDir(skillDir);
  const active = skillFilePath(dir);
  const disabled = disabledFilePath(dir);
  if (!(await pathExists(disabled)) && (await pathExists(active))) {
    return false; // already enabled
  }
  await rename(disabled, active);
  return true;
}
