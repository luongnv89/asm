/**
 * Pure tag aggregation for `asm tag list` (PR2).
 *
 * Accounting rules for `asm tag list`:
 *  - unit of counting: the skill DIRECTORY, deduplicated by `realPath`;
 *  - classes with priority ACTIVATED > LIBRARY_ONLY > MISSING:
 *      ACTIVATED    skills `asm list` can see (disabled included; a
 *                   deactivated skill is no longer ACTIVATED);
 *      LIBRARY_ONLY in the library, not activated into a provider;
 *      MISSING      `skill-tags.json` records whose skill directory is gone
 *                   (term borrowed from `library list`), tags = added − removed;
 *  - ALL = ACTIVATED + LIBRARY_ONLY, and never includes MISSING;
 *  - default counts every class; `--activated` or any `-s`/`-p` counts
 *    ACTIVATED only and the table shrinks to TAG / ACTIVATED;
 *  - sort: `all` desc, then `missing` desc, then tag name asc;
 *  - `tagCount` includes tags that appear only on missing records (= table
 *    row count).
 *
 * This module performs no IO. The caller has already:
 *   1. scanned `ACTIVATED` skills (`asm list` visibility, including disabled
 *      rows reconstructed from skill-state) for the requested scope/provider;
 *   2. loaded library skills and partitioned out the ones the scan already
 *      covers (`loadLibrarySkills` + `partitionLibrarySkills`);
 *   3. probed each `skill-tags.json` key's directory and collected the ones
 *      whose directory no longer exists (only that existence check needs IO).
 *
 * Consequently the input is three already-classified row sets. Classification
 * is still applied defensively by realPath, with the documented priority, so a
 * caller that passes an unpartitioned library list still gets correct counts.
 *
 * Tag resolution: activated and library-only rows carry frontmatter tags only;
 * the local overlay (`skill-tags.json`) is applied here through
 * `effectiveSkillTags`. Applying the overlay twice is idempotent, so callers
 * that already applied it are unaffected. Missing records have no frontmatter
 * to read, so the caller passes `added − removed` directly (the same result as
 * `effectiveSkillTags(undefined, state.skills[realPath])`).
 */
import { effectiveSkillTags } from "./skill-tags";
import { normalizeTags } from "./utils/frontmatter";
import type { Scope, SkillInfo, SkillTagStateFile } from "./utils/types";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The fields this module needs from a skill; a full `SkillInfo` is assignable. */
export type TagInventorySkill = Pick<SkillInfo, "realPath" | "tags">;

/**
 * A `skill-tags.json` record whose skill directory no longer exists.
 *
 * `tags` is the effective overlay after tombstones: `added − removed`.
 * `realPath` is the state-file key; records are deduplicated by it.
 */
export interface MissingSkillRecord {
  realPath: string;
  tags: string[];
}

export interface TagInventoryInput {
  /** Skills visible to `asm list` for the requested scope/provider. */
  activated: TagInventorySkill[];
  /** Library skills not activated into any provider. */
  libraryOnly: TagInventorySkill[];
  /** Tag records whose directories are gone (caller probed the filesystem). */
  missing: MissingSkillRecord[];
  /** Local tag overlay, keyed by `realPath` (`skillTagKey`). */
  state: SkillTagStateFile;
  /** `--activated` / any `-s`/`-p`: count ACTIVATED only. */
  activatedOnly: boolean;
  /** Echoed into the JSON payload; rows are expected pre-filtered. */
  scope: Scope;
  /** Echoed into the JSON payload; `null` when no `-p` was given. */
  provider: string | null;
}

export interface TagCountRow {
  tag: string;
  /** ACTIVATED + LIBRARY_ONLY; never includes MISSING. */
  all: number;
  activated: number;
  libraryOnly: number;
  missing: number;
}

export interface TagClassCounts {
  /** ACTIVATED + LIBRARY_ONLY. */
  all: number;
  activated: number;
  libraryOnly: number;
}

/** Exactly the `--json` / `--machine` payload contract from Appendix C. */
export interface TagInventory {
  activatedOnly: boolean;
  scope: Scope;
  provider: string | null;
  /** Distinct tags across all classes, including missing-only tags. */
  tagCount: number;
  /** Total tag-skill pairs in ALL (== sum of every row's `all`). */
  tagSkillPairCount: number;
  /** Skills carrying at least one effective tag. MISSING is not a skill class here. */
  taggedSkillCount: TagClassCounts;
  /** Skills carrying no effective tags. MISSING is not a skill class here. */
  untaggedSkillCount: TagClassCounts;
  /** Number of missing skill directories (records), not tags. */
  missingRecordCount: number;
  tags: TagCountRow[];
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface TagCounts {
  activated: number;
  libraryOnly: number;
  missing: number;
}

/** Resolve effective tags per canonical path; first occurrence wins. */
function collectSkills(
  skills: TagInventorySkill[],
  state: SkillTagStateFile,
): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const skill of skills) {
    if (byPath.has(skill.realPath)) continue;
    byPath.set(
      skill.realPath,
      effectiveSkillTags(skill.tags, state.skills[skill.realPath]),
    );
  }
  return byPath;
}

function countTagged(byPath: Map<string, string[]>): number {
  let tagged = 0;
  for (const tags of byPath.values()) {
    if (tags.length > 0) tagged += 1;
  }
  return tagged;
}

function bump(
  counts: Map<string, TagCounts>,
  tag: string,
  skillClass: keyof TagCounts,
): void {
  const row = counts.get(tag) ?? {
    activated: 0,
    libraryOnly: 0,
    missing: 0,
  };
  row[skillClass] += 1;
  counts.set(tag, row);
}

export function buildTagInventory(input: TagInventoryInput): TagInventory {
  const activated = collectSkills(input.activated, input.state);

  // Priority ACTIVATED > LIBRARY_ONLY: a row the scan already covers must not
  // be counted a second time when the caller passes an unpartitioned library.
  const libraryOnlyAll = collectSkills(input.libraryOnly, input.state);
  const libraryOnly = input.activatedOnly
    ? new Map<string, string[]>()
    : new Map(
        [...libraryOnlyAll].filter(([realPath]) => !activated.has(realPath)),
      );

  // Priority ... > MISSING: a directory that still exists in a higher class is
  // not a missing record. `--activated` drops the class entirely.
  const missing = new Map<string, string[]>();
  if (!input.activatedOnly) {
    for (const record of input.missing) {
      if (
        activated.has(record.realPath) ||
        libraryOnly.has(record.realPath) ||
        missing.has(record.realPath)
      ) {
        continue;
      }
      missing.set(record.realPath, normalizeTags(record.tags));
    }
  }

  const counts = new Map<string, TagCounts>();
  for (const tags of activated.values()) {
    for (const tag of tags) bump(counts, tag, "activated");
  }
  for (const tags of libraryOnly.values()) {
    for (const tag of tags) bump(counts, tag, "libraryOnly");
  }
  for (const tags of missing.values()) {
    for (const tag of tags) bump(counts, tag, "missing");
  }

  const tags: TagCountRow[] = [...counts.entries()]
    .map(([tag, row]) => ({
      tag,
      all: row.activated + row.libraryOnly,
      activated: row.activated,
      libraryOnly: row.libraryOnly,
      missing: row.missing,
    }))
    .sort(
      (a, b) =>
        b.all - a.all ||
        b.missing - a.missing ||
        // Bytewise, locale-independent ascending — `--json` consumers see the
        // same order everywhere (ICU collation can reorder `-` vs `_`).
        (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
    );

  const activatedTagged = countTagged(activated);
  const libraryOnlyTagged = countTagged(libraryOnly);

  return {
    activatedOnly: input.activatedOnly,
    scope: input.scope,
    provider: input.provider,
    tagCount: tags.length,
    // ALL excludes MISSING, so this is the sum of the per-tag `all` column.
    tagSkillPairCount: tags.reduce((total, row) => total + row.all, 0),
    taggedSkillCount: {
      all: activatedTagged + libraryOnlyTagged,
      activated: activatedTagged,
      libraryOnly: libraryOnlyTagged,
    },
    untaggedSkillCount: {
      all:
        activated.size -
        activatedTagged +
        (libraryOnly.size - libraryOnlyTagged),
      activated: activated.size - activatedTagged,
      libraryOnly: libraryOnly.size - libraryOnlyTagged,
    },
    missingRecordCount: missing.size,
    tags,
  };
}
