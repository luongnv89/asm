// ─── `asm inspect <path>`: a skill folder that is not installed (#829) ──────
//
// `asm inspect` takes its argument as a path when it contains `/` (or `\` on
// Windows), is `.` or `..`, or starts with `.` and names a folder holding a
// SKILL.md. Anything else is looked up as an installed skill name first; a
// dot-named argument that is not installed but exists on disk then gets the
// path error (see `isInspectPathFallback`).
// The folder is read under the skill-folder boundary of
// docs/security/symlink-rule.md, the same rule as `asm eval` and
// `asm audit security`: SKILL.md is read only through `readSkillMd` (a link
// that leaves the folder is refused unread), and the File Count is the
// confined `countFiles` walk. A folder that is itself a link is followed and
// its real path announced.

import { existsSync, statSync } from "fs";
import {
  access,
  constants,
  lstat,
  readlink,
  realpath,
  stat,
} from "fs/promises";
import { basename, join, resolve, sep } from "path";
import { cacheSkillMdContent, skillFieldsFromSkillMd } from "../scanner";
import {
  readSkillMd,
  SkillMdOutsideLinkError,
  unreadLinkFinding,
} from "../evaluator-files";
import { stripControlBytes } from "../security-auditor-scan";
import { estimateTokenCount } from "../utils/token-count";
import {
  ErrorCodes,
  formatMachineError,
  formatMachineOutput,
  type ErrorCode,
} from "../utils/machine";
import { formatSkillInspect, formatJSON, ansi } from "../formatter";
import { applySkillTagState, loadSkillTagState } from "../skill-tags";
import type { SkillInfo } from "../utils/types";
import { error, enrichWithHealth } from "./shared";
import type { ParsedArgs } from "../cli";

/** What a field that only an installed skill has shows in text output. */
export const NOT_INSTALLED = "not installed";

/**
 * True when `asm inspect` takes `arg` as a folder path rather than an
 * installed skill name: it contains `/` (or the platform separator), is `.` or
 * `..`, or starts with `.` and `resolve(cwd, arg)` is a folder (or a link to
 * one) that holds a `SKILL.md`. Any other dot-named argument (a file, an empty
 * folder, a dangling link, nothing at all) is looked up by name first, so an
 * installed `.hidden-skill` resolves as before. A bare name that also exists
 * as a folder in the working directory stays a name.
 */
export function isInspectPathArg(arg: string, cwd = process.cwd()): boolean {
  if (arg.includes("/") || arg.includes(sep)) return true;
  if (arg === "." || arg === "..") return true;
  return arg.startsWith(".") && holdsSkillMd(resolve(cwd, arg));
}

/**
 * True when a dot-named argument that `isInspectPathArg` left to the name
 * lookup, and that matched no installed skill, names something on disk: the
 * caller then reports the path error ("is not a folder", "No SKILL.md in …",
 * "Cannot read …") instead of `Skill "<x>" not found.`
 */
export function isInspectPathFallback(
  arg: string,
  cwd = process.cwd(),
): boolean {
  return arg.startsWith(".") && existsSync(resolve(cwd, arg));
}

function holdsSkillMd(dir: string): boolean {
  try {
    return (
      statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true &&
      existsSync(join(dir, "SKILL.md"))
    );
  } catch {
    return false;
  }
}

/** A path that cannot be inspected, with its `--machine` error code. */
export class InspectPathError extends Error {
  readonly code: ErrorCode;
  constructor(message: string, code: ErrorCode = ErrorCodes.SKILL_NOT_FOUND) {
    super(message);
    this.name = "InspectPathError";
    this.code = code;
  }
}

const NEEDS_SKILL_FOLDER =
  "asm inspect <path> needs a skill folder that holds a SKILL.md.";

/**
 * Read the skill folder at `arg` into the `SkillInfo` shape the installed
 * scan produces. Fields only an installation has are empty: `provider`,
 * `providerLabel` and `location` are `""`, `scope` is `null`. Throws an
 * `InspectPathError` when the folder or its SKILL.md cannot be read.
 */
export async function readSkillFolder(arg: string): Promise<SkillInfo> {
  const abs = resolve(arg);
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new InspectPathError(
        `Cannot read ${abs} (permission denied).`,
        ErrorCodes.SKILL_DIR_UNREADABLE,
      );
    }
    throw new InspectPathError(`No folder at "${arg}" (${abs}).`);
  }
  if (!(await stat(real)).isDirectory()) {
    throw new InspectPathError(
      `"${arg}" is not a folder. ${NEEDS_SKILL_FOLDER}`,
    );
  }
  try {
    await access(real, constants.R_OK | constants.X_OK);
  } catch {
    throw new InspectPathError(
      `Cannot read ${abs} (permission denied).`,
      ErrorCodes.SKILL_DIR_UNREADABLE,
    );
  }

  let content: string | null;
  try {
    content = await readSkillMd(join(abs, "SKILL.md"));
  } catch (err) {
    if (err instanceof SkillMdOutsideLinkError) {
      throw new InspectPathError(
        `${unreadLinkFinding(err.link)}. asm inspect reads nothing outside the skill folder.`,
        ErrorCodes.SKILL_MD_OUTSIDE_LINK,
      );
    }
    throw new InspectPathError(
      err instanceof Error ? err.message : String(err),
    );
  }
  if (content === null) {
    throw new InspectPathError(`No SKILL.md in ${abs}. ${NEEDS_SKILL_FOLDER}`);
  }

  let isSymlink = false;
  let symlinkTarget: string | null = null;
  try {
    if ((await lstat(abs)).isSymbolicLink()) {
      isSymlink = true;
      symlinkTarget = await readlink(abs);
    }
  } catch {
    // not a symlink
  }

  const dirName = basename(abs) || abs;
  const skill: SkillInfo = {
    ...skillFieldsFromSkillMd(content, dirName),
    dirName,
    path: abs,
    originalPath: arg,
    location: "",
    // `scope` is "global" | "project" for an installation; a folder has none.
    scope: null as unknown as SkillInfo["scope"],
    provider: "",
    providerLabel: "",
    isSymlink,
    symlinkTarget,
    realPath: real,
    tokenCount: estimateTokenCount(content),
  };
  cacheSkillMdContent(skill, content);
  return skill;
}

/** `asm inspect <path>`: print a skill folder that is not installed. */
export async function cmdInspectPath(args: ParsedArgs, arg: string) {
  const startTime = performance.now();
  let skill: SkillInfo;
  try {
    skill = await readSkillFolder(arg);
  } catch (err) {
    // The message carries the argument and resolved paths: strip control
    // bytes so a folder name cannot write escape sequences to the terminal.
    const message = stripControlBytes(
      err instanceof Error ? err.message : String(err),
    );
    const code =
      err instanceof InspectPathError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    if (args.flags.machine) {
      console.log(formatMachineError("inspect", code, message, startTime));
    } else {
      error(message);
    }
    process.exit(1);
  }

  await enrichWithHealth([skill]);
  applySkillTagState([skill], await loadSkillTagState());

  if (args.flags.machine) {
    console.log(formatMachineOutput("inspect", skill, startTime));
    return;
  }
  if (args.flags.json) {
    console.log(formatJSON(skill));
    return;
  }

  const lines: string[] = [];
  if (skill.realPath !== skill.path) {
    lines.push(
      `${ansi.dim("Resolved:")} ${stripControlBytes(skill.realPath)} ${ansi.dim(
        skill.isSymlink
          ? "(target is a symlink; followed)"
          : "(a parent folder is a symlink; followed)",
      )}`,
    );
  }
  lines.push(
    await formatSkillInspect([
      {
        ...skill,
        providerLabel: NOT_INSTALLED,
        location: NOT_INSTALLED,
        scope: NOT_INSTALLED as SkillInfo["scope"],
      },
    ]),
  );
  console.log(lines.join("\n"));
}
