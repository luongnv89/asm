import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getSkillTagsPath } from "./config";
import { debug } from "./logger";
import { normalizeTag, normalizeTags } from "./utils/frontmatter";
import type { SkillInfo, SkillTagStateFile } from "./utils/types";

export function emptySkillTagState(): SkillTagStateFile {
  return { version: 1, skills: {} };
}

function normalizeEntry(value: unknown): {
  added: string[];
  removed: string[];
} {
  if (!value || typeof value !== "object") return { added: [], removed: [] };
  const candidate = value as { added?: unknown; removed?: unknown };
  const removed = normalizeTags(
    Array.isArray(candidate.removed)
      ? candidate.removed.filter(
          (tag): tag is string => typeof tag === "string",
        )
      : [],
  );
  const removedSet = new Set(removed);
  const added = normalizeTags(
    Array.isArray(candidate.added)
      ? candidate.added.filter((tag): tag is string => typeof tag === "string")
      : [],
  ).filter((tag) => !removedSet.has(tag));
  return { added, removed };
}

/** Load local tag edits, recovering from malformed state like skill-state.ts. */
export async function loadSkillTagState(
  path?: string,
): Promise<SkillTagStateFile> {
  const statePath = path ?? getSkillTagsPath();
  let raw: string;
  try {
    raw = await readFile(statePath, "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptySkillTagState();
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as { version?: unknown; skills?: unknown };
    if (
      !parsed ||
      parsed.version !== 1 ||
      !parsed.skills ||
      typeof parsed.skills !== "object" ||
      Array.isArray(parsed.skills)
    ) {
      throw new Error("invalid schema");
    }

    const state = emptySkillTagState();
    for (const [key, value] of Object.entries(parsed.skills)) {
      const entry = normalizeEntry(value);
      if (entry.added.length > 0 || entry.removed.length > 0) {
        state.skills[key] = entry;
      }
    }
    return state;
  } catch {
    const backupPath = `${statePath}.bak`;
    debug(`skill-tags: parse error, backing up to ${backupPath}`);
    try {
      await copyFile(statePath, backupPath);
    } catch {
      // Best-effort backup; an unreadable state file must not break listing.
    }
    return emptySkillTagState();
  }
}

export async function saveSkillTagState(
  state: SkillTagStateFile,
  path?: string,
): Promise<void> {
  const statePath = path ?? getSkillTagsPath();
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function skillTagKey(skill: Pick<SkillInfo, "realPath">): string {
  return skill.realPath;
}

export function parseTagInputs(inputs: string[]): {
  tags: string[];
  invalid: string[];
} {
  const values = inputs.flatMap((input) => input.split(","));
  const invalid = values.filter((value) => normalizeTag(value) === null);
  return { tags: normalizeTags(values), invalid };
}

export function matchesAllTags(
  skillTags: string[] | undefined,
  requestedTags: string[],
): boolean {
  const available = new Set(normalizeTags(skillTags || []));
  return normalizeTags(requestedTags).every((tag) => available.has(tag));
}

export function effectiveSkillTags(
  frontmatterTags: string[] | undefined,
  entry?: { added: string[]; removed: string[] },
): string[] {
  const removed = new Set(normalizeTags(entry?.removed || []));
  return normalizeTags([
    ...normalizeTags(frontmatterTags || []).filter((tag) => !removed.has(tag)),
    ...normalizeTags(entry?.added || []).filter((tag) => !removed.has(tag)),
  ]);
}

export function applySkillTagState(
  skills: SkillInfo[],
  state: SkillTagStateFile,
): void {
  for (const skill of skills) {
    skill.tags = effectiveSkillTags(
      skill.tags,
      state.skills[skillTagKey(skill)],
    );
  }
}

function pruneEntry(state: SkillTagStateFile, key: string): void {
  const entry = state.skills[key];
  if (entry && entry.added.length === 0 && entry.removed.length === 0) {
    delete state.skills[key];
  }
}

/** Add normalized tags, clearing frontmatter-removal tombstones when needed. */
export function addSkillTags(
  state: SkillTagStateFile,
  key: string,
  frontmatterTags: string[] | undefined,
  tags: string[],
): string[] {
  const base = new Set(normalizeTags(frontmatterTags || []));
  const entry = (state.skills[key] ??= { added: [], removed: [] });
  const added = new Set(normalizeTags(entry.added));
  const removed = new Set(normalizeTags(entry.removed));

  for (const tag of normalizeTags(tags)) {
    removed.delete(tag);
    if (!base.has(tag)) added.add(tag);
  }

  entry.added = [...added];
  entry.removed = [...removed];
  pruneEntry(state, key);
  return effectiveSkillTags(frontmatterTags, state.skills[key]);
}

/** Remove local additions or tombstone authoritative frontmatter tags. */
export function removeSkillTags(
  state: SkillTagStateFile,
  key: string,
  frontmatterTags: string[] | undefined,
  tags: string[],
): string[] {
  const base = new Set(normalizeTags(frontmatterTags || []));
  const entry = (state.skills[key] ??= { added: [], removed: [] });
  const added = new Set(normalizeTags(entry.added));
  const removed = new Set(normalizeTags(entry.removed));

  for (const tag of normalizeTags(tags)) {
    added.delete(tag);
    if (base.has(tag)) removed.add(tag);
  }

  entry.added = [...added];
  entry.removed = [...removed];
  pruneEntry(state, key);
  return effectiveSkillTags(frontmatterTags, state.skills[key]);
}
