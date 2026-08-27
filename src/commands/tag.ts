import { loadConfig } from "../config";
import { ansi, formatJSON, formatTagUpdates } from "../formatter";
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
import { formatMachineOutput } from "../utils/machine";
import { matchSkills } from "../skill-state";
import type { ParsedArgs } from "../cli";
import type { TagUpdateResult } from "../formatter";
import { error, groupBySource } from "./shared";

function printTagHelp(): void {
  console.log(`${ansi.bold("Usage:")} asm tag add <skill> <tag> [tag...]
       asm tag remove <skill> <tag> [tag...]

Edit local tags for installed skills without changing their SKILL.md files.
Tags are lowercase identifiers and may also be comma-separated.

${ansi.bold("Options:")}
  -s, --scope <s>      Limit matches to global, project, or both
  -p, --tool <p>       Limit matches to one tool/provider
  --json               Output updated skills as JSON
  --machine            Output a stable machine-readable v1 envelope

${ansi.bold("Examples:")}
  asm tag add code-review testing cli
  asm tag add code-review testing,automation
  asm tag remove code-review automation`);
}

export async function cmdTag(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    printTagHelp();
    return;
  }

  const action = args.subcommand;
  if (action !== "add" && action !== "remove") {
    error('Missing or invalid action. Use "tag add" or "tag remove".');
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
  let skills = await scanAllSkills(config, args.flags.scope);
  if (args.flags.provider) {
    skills = skills.filter((skill) => skill.provider === args.flags.provider);
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
    results.push({
      name: skill.name,
      path: skill.realPath,
      tags,
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
