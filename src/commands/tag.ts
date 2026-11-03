import { stat } from "fs/promises";
import { loadConfig } from "../config";
import {
  ansi,
  formatJSON,
  formatTagList,
  formatTagUpdates,
} from "../formatter";
import { loadLibrarySkills, partitionLibrarySkills } from "../library-skills";
import { scanAllSkills } from "../scanner";
import {
  addSkillTags,
  effectiveSkillTags,
  loadSkillTagState,
  parseTagInputs,
  removeSkillTags,
  saveSkillTagState,
  skillTagKey,
} from "../skill-tags";
import { buildTagInventory, type MissingSkillRecord } from "../tag-inventory";
import { formatMachineOutput, redirectConsoleToStderr } from "../utils/machine";
import { loadSkillState, matchSkills } from "../skill-state";
import type { Scope } from "../utils/types";
import type { ParsedArgs } from "../cli";
import type { TagUpdateResult } from "../formatter";
import { error, groupBySource } from "./shared";
import { reconstructDisabledSkills } from "./toggle";

function printTagHelp(): void {
  console.log(`${ansi.bold("Usage:")} asm tag add <skill> <tag> [tag...]
       asm tag remove <skill> <tag> [tag...]
       asm tag list [--activated] [options]

Edit local tags for installed or library skills without changing their SKILL.md
files. With no --scope/--tool filter, unactivated library skills are matched too.
Tags are lowercase identifiers and may also be comma-separated.

${ansi.bold("tag list")} counts tagged skill directories across three classes:
  ACTIVATED     skills visible to "asm list" (including disabled ones)
  LIBRARY_ONLY  skills in the local library that are not activated
  MISSING       skill-tags.json records whose skill directory no longer exists
ALL is ACTIVATED + LIBRARY_ONLY; MISSING records are reported separately.

${ansi.bold("Options:")}
  -s, --scope <s>      Limit matches to global, project, or both
  -p, --tool <p>       Limit matches to one tool/provider
  --activated          Count activated skills only (implied by -s/--tool)
  --json               Output updated skills, or the tag inventory, as JSON
  --machine            Output a stable machine-readable v1 envelope

${ansi.bold("Examples:")}
  asm tag add code-review testing cli
  asm tag add code-review testing,automation
  asm tag remove code-review automation
  asm tag list
  asm tag list --activated --json`);
}

/**
 * `asm tag list` — the tag inventory.
 *
 * Counts tagged skill DIRECTORIES (deduplicated by realPath across providers)
 * and splits them into the three classes from the settled design:
 *
 *  - ACTIVATED    exactly what `asm list` shows, disabled rows included;
 *  - LIBRARY_ONLY in the local library but not activated into a provider;
 *  - MISSING      skill-tags.json records whose skill directory is gone.
 *
 * ALL is ACTIVATED + LIBRARY_ONLY; MISSING is reported in its own column and
 * never counted into ALL. `--activated` — or any explicit `-s`/`-p` filter —
 * narrows the whole report to ACTIVATED, because the other two classes have no
 * scope or provider to filter on.
 */
async function cmdTagList(args: ParsedArgs): Promise<void> {
  if (args.positional.length > 0) {
    error(
      `Unexpected argument(s): ${args.positional.join(" ")}. Usage: asm tag list [--activated]`,
    );
    process.exitCode = 2;
    return;
  }

  const startedAt = performance.now();
  // Keep stdout clean for the envelope when --machine is active.
  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  // An explicit scope counts even when its value is the default "both": the
  // user asked for a scope-filtered view, which only ACTIVATED can honor.
  const activatedOnly =
    args.flags.activated ||
    args.flags.scopeExplicit ||
    args.flags.provider !== null;

  const config = await loadConfig();
  const scope: Scope = args.flags.scope;

  // ACTIVATED mirrors `asm list`: scanned skills plus disabled ones
  // reconstructed from skill-state (their SKILL.md was renamed, so the
  // scanner cannot see them).
  let activated = await scanAllSkills(config, scope);
  const skillState = await loadSkillState();
  const activeKeys = new Set(
    activated.map((s) => `${s.dirName}||${s.provider}||${s.scope}`),
  );
  const disabled = await reconstructDisabledSkills(
    config,
    skillState,
    scope,
    args.flags.provider,
    activeKeys,
  );
  activated = [...activated, ...disabled];
  if (args.flags.provider) {
    activated = activated.filter((s) => s.provider === args.flags.provider);
  }

  const state = await loadSkillTagState();

  // Library-only and missing are only counted in the full view; skip the IO
  // when the report is narrowed to ACTIVATED anyway.
  const libraryOnly = activatedOnly
    ? []
    : await loadLibraryOnlySkills(activated);
  const missing = activatedOnly
    ? []
    : await findMissingTagRecords(state, activated, libraryOnly);

  const inventory = buildTagInventory({
    activated,
    libraryOnly,
    missing,
    state,
    activatedOnly,
    scope,
    provider: args.flags.provider,
  });

  restoreConsole?.();
  if (args.flags.machine) {
    console.log(formatMachineOutput("tag list", inventory, startedAt));
  } else if (args.flags.json) {
    console.log(formatJSON(inventory));
  } else {
    console.log(formatTagList(inventory));
  }
}

/** Library skills that no scanned provider instance already covers. */
async function loadLibraryOnlySkills(
  activated: Awaited<ReturnType<typeof scanAllSkills>>,
) {
  const library = await loadLibrarySkills();
  const { libraryOnly } = partitionLibrarySkills(
    library,
    new Set(activated.map((skill) => skill.realPath)),
  );
  return libraryOnly;
}

/**
 * Tag records whose skill directory no longer exists.
 *
 * A state key is kept even after its skill is uninstalled (the file is only
 * pruned when an entry becomes empty), so a stale key is the only trace left of
 * a tag that once applied. Keys that still exist on disk are skipped: their
 * directory was merely not scanned (other scope, disabled provider), which is
 * not the same as missing.
 */
async function findMissingTagRecords(
  state: Awaited<ReturnType<typeof loadSkillTagState>>,
  activated: Awaited<ReturnType<typeof scanAllSkills>>,
  libraryOnly: Awaited<ReturnType<typeof loadLibraryOnlySkills>>,
): Promise<MissingSkillRecord[]> {
  const known = new Set(
    [...activated, ...libraryOnly].map((skill) => skill.realPath),
  );
  const keys = Object.keys(state.skills).filter((key) => !known.has(key));
  const results = await Promise.all(
    keys.map(async (realPath): Promise<MissingSkillRecord | null> => {
      if (await pathExists(realPath)) return null;
      // No SKILL.md to read, so only the local overlay can contribute tags.
      return {
        realPath,
        tags: effectiveSkillTags(undefined, state.skills[realPath]),
      };
    }),
  );
  return results.filter(
    (record): record is MissingSkillRecord => record !== null,
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function cmdTag(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    printTagHelp();
    return;
  }

  const action = args.subcommand;
  if (action === "list") {
    await cmdTagList(args);
    return;
  }
  if (action !== "add" && action !== "remove") {
    error(
      'Missing or invalid action. Use "tag add", "tag remove", or "tag list".',
    );
    process.exitCode = 2;
    return;
  }

  const target = args.positional[0];
  const parsedTags = parseTagInputs(args.positional.slice(1));
  if (parsedTags.invalid.length > 0) {
    const shown = parsedTags.invalid
      .map((tag) => JSON.stringify(tag))
      .join(", ");
    error(
      `Invalid tag value(s): ${shown}. Use 1-32 lowercase letters, numbers, hyphens, or underscores.`,
    );
    process.exitCode = 2;
    return;
  }
  if (!target || parsedTags.tags.length === 0) {
    error(`Usage: asm tag ${action} <skill> <tag> [tag...]`);
    process.exitCode = 2;
    return;
  }

  const startedAt = performance.now();
  const config = await loadConfig();
  const scanned = await scanAllSkills(config, args.flags.scope);
  let skills = scanned;
  if (args.flags.provider) {
    // An explicit tool filter means "only what that tool can see"; library
    // skills have no provider activation and stay out of the match pool.
    skills = scanned.filter((skill) => skill.provider === args.flags.provider);
  } else if (args.flags.scope === "both") {
    // Library coverage: with the default both-scope and no tool filter, a
    // skill that only exists in the ASM library is taggable too. An activated
    // library skill is symlinked into a provider, so `scanAllSkills` already
    // returned it under the same canonical realPath as its library copy and
    // partitionLibrarySkills drops the library row — one group, one record.
    // That also keeps the scanned row as the group representative, which is
    // what the pre-existing paths expect.
    const library = await loadLibrarySkills();
    const { libraryOnly } = partitionLibrarySkills(
      library,
      new Set(scanned.map((skill) => skill.realPath)),
    );
    skills = [...scanned, ...libraryOnly];
  }
  const matched = matchSkills(skills, target);
  if (matched.length === 0) {
    error(`Skill not found: "${target}".`);
    process.exitCode = 1;
    return;
  }

  const state = await loadSkillTagState();
  const results: TagUpdateResult[] = [];
  for (const group of groupBySource(matched, skills)) {
    const skill = group.representative;
    const key = skillTagKey(skill);
    const before = effectiveSkillTags(skill.tags, state.skills[key]);
    const tags =
      action === "add"
        ? addSkillTags(state, key, skill.tags, parsedTags.tags)
        : removeSkillTags(state, key, skill.tags, parsedTags.tags);
    const applied =
      action === "add"
        ? tags.filter((tag) => !before.includes(tag))
        : before.filter((tag) => !tags.includes(tag));
    results.push({
      name: skill.name,
      path: skill.realPath,
      tags,
      applied,
      changed: JSON.stringify(before) !== JSON.stringify(tags),
    });
  }
  await saveSkillTagState(state);

  if (args.flags.machine) {
    console.log(formatMachineOutput("tag", results, startedAt));
  } else if (args.flags.json) {
    console.log(formatJSON(results));
  } else {
    console.log(formatTagUpdates(action, results));
  }
}
