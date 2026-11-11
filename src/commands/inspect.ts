import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import { loadLibrarySkills, partitionLibrarySkills } from "../library-skills";
import { formatSkillInspect, formatJSON, ansi } from "../formatter";
import { applySkillTagState, loadSkillTagState } from "../skill-tags";
import type { GetResult } from "../utils/types";

import { error, enrichWithHealth } from "./shared";
import type { ParsedArgs } from "../cli";

function printInspectHelp() {
  console.log(`${ansi.bold("Usage:")} asm inspect <skill-name> [options]

Show detailed information for a skill. The <skill-name> is the directory name.
Shows version, description, file count, and all provider installations.
Without --scope, includes library-only skills too.

${ansi.bold("Options:")}
  -s, --scope <s>    Search provider installations only: global, project, or both
  --json             Output as JSON object
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm inspect code-review           ${ansi.dim("Show details for code-review")}
  asm inspect code-review --json    ${ansi.dim("Output as JSON")}
  asm inspect code-review -s global ${ansi.dim("Global installations only")}`);
}

export async function cmdInspect(args: ParsedArgs) {
  if (args.flags.help) {
    printInspectHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing required argument: <skill-name>");
    console.error(`Run "asm inspect --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const scannedMatches = allSkills.filter((s) => s.dirName === skillName);
  let matches = scannedMatches;
  let textMatches = matches;

  if (!args.flags.scopeExplicit) {
    const library = await loadLibrarySkills();
    const libraryMatch = library.find((s) => s.dirName === skillName);
    if (scannedMatches.length === 0) {
      const { libraryOnly } = partitionLibrarySkills(
        library,
        new Set(allSkills.map((s) => s.realPath)),
      );
      matches = libraryOnly.filter((s) => s.dirName === skillName);
      textMatches = matches;
    } else if (libraryMatch) {
      // The library copy supplies text context without changing scanned JSON.
      textMatches = [...scannedMatches, libraryMatch];
    }
  }

  if (matches.length === 0) {
    error(`Skill "${skillName}" not found.`);
    console.error(
      ansi.dim(
        `Try ${ansi.bold("asm list")}${args.flags.scopeExplicit ? "" : ` or ${ansi.bold("asm library list")}`} to see all skills or ${ansi.bold(`asm search "${skillName}"`)} to search.`,
      ),
    );
    process.exit(1);
  }

  const outputMatches = args.flags.json ? matches : textMatches;
  await enrichWithHealth(outputMatches);
  applySkillTagState(outputMatches, await loadSkillTagState());

  if (args.flags.json) {
    console.log(formatJSON(matches.length === 1 ? matches[0] : matches));
  } else {
    console.log(await formatSkillInspect(textMatches));
  }
}

// ─── Get: zero-residency reference tier (issue #422) ────────────────────────
//
// `asm get` is deliberately the install path minus the write: it resolves a
// skill through the same ladder `asm install` uses, prints the SKILL.md body
// to stdout, and touches no provider directory and no library. The body is
// paid for once, at the point of use, instead of sitting resident in every
// system prompt.

/** Resolution outcome plus the cleanup hook for any temp clone it created. */
export interface GetResolution {
  result: GetResult;
  cleanup: (() => Promise<void>) | null;
  /** Directory the body was read from — still on disk until `cleanup` runs. */
  dir: string;
  /** The temp clone root for a remote source: the audit's boundary (#791). */
  boundary?: string;
  /** GitHub coordinates, when the body came from a remote source. */
  owner?: string;
  repo?: string;
}

/** A name that resolves to more than one skill — never guessed, always listed. */
export class AmbiguousGetError extends Error {
  candidates: string[];
  constructor(message: string, candidates: string[]) {
    super(message);
    this.name = "AmbiguousGetError";
    this.candidates = candidates;
  }
}

/** Human-readable risk label, matching the `asm install` preview wording. */
