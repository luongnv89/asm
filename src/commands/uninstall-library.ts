import { getLibraryLockPath, getLibrarySkillsDir, loadConfig } from "../config";
import { ansi } from "../formatter";
import { listLibrarySkills } from "../library";
import {
  assertManagedLibraryRemovalTarget,
  buildSideEffectNotice,
  describeCheckedScope,
  libraryDirectoryPresent,
  removeLibrarySkill,
  resolveLibraryEntryForRemoval,
  scanLibraryReferences,
  type LibraryCheckLocation,
  type LibraryReference,
  type LibraryReferenceScan,
} from "../library-uninstall";
import { basename, resolve } from "path";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

export type LibraryUninstallStatus =
  | "removed"
  | "removed-stale-lock-entry"
  | "blocked"
  | "aborted"
  | "failed"
  | "not-found";

/**
 * Structured `--json` result for `asm uninstall <entry> --library`.
 *
 * `warnings` and `checkedScope` are part of the contract, not diagnostics:
 * machine consumers must be able to see that the check was scoped and that a
 * clean scan is not proof of global non-use.
 */
export interface LibraryUninstallPayload {
  command: "uninstall";
  library: true;
  skill: string | null;
  name: string | null;
  status: LibraryUninstallStatus;
  libraryPath: string | null;
  removedDirectory: boolean;
  removedLockEntry: boolean;
  remaining: { directory: boolean; lockEntry: boolean } | null;
  references: LibraryReference[];
  unreadableLocations: LibraryCheckLocation[];
  warnings: string[];
  sideEffectNotice: string;
  checkedScope: {
    providerCount: number;
    locationCount: number;
    existingCount: number;
    missingCount: number;
    unreadableCount: number;
    providers: string[];
    locations: LibraryCheckLocation[];
  } | null;
  errors: string[];
}

function printLibraryUninstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm uninstall <library-entry-name> --library [options]

Remove one library original and its library-lock entry.

${ansi.yellow("Important:")} asm keeps no project or activation registry. Only the
global skill folders of configured providers (including disabled ones) and the
current project's skill folders are checked for activation links.

Other projects are NOT checked. Deleting a library original can break
activation links in other projects, which will then be unable to load the
skill. A clean check is not proof that the skill is unused elsewhere.

${ansi.bold("Options:")}
  -y, --yes          Skip the confirmation prompt (reference checks and the
                     side-effect notice still run and are still shown)
  --json             Output a structured result (warnings and checked scope
                     included)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Not supported with --library:")}
  -p, --tool <name>  Provider filter (library entries are provider-independent)
  -s, --scope <s>    Scope filter
  --all              Bulk removal
  --force            Bypass the reference check
  --machine          Use --json instead

${ansi.bold("Examples:")}
  asm uninstall brainstorming --library
  asm uninstall brainstorming --library --yes
  asm uninstall brainstorming --library --json
  asm deactivate brainstorming -p claude -s project   ${ansi.dim("Remove one activation link, keep the library copy")}`);
}

function printCheckedScope(scan: LibraryReferenceScan): void {
  const summary = describeCheckedScope(scan);
  console.error(
    `  Checked scope: ${summary.locationCount} location(s) across ${summary.providerCount} provider(s) — global skill folders and this project's skill folders.`,
  );

  for (const location of scan.locations) {
    if (location.status === "missing") continue;
    const marker =
      location.status === "unreadable"
        ? ansi.red("unreadable")
        : ansi.dim("checked");
    console.error(
      `    ${location.status === "unreadable" ? ansi.red("✗") : ansi.dim("•")} ${location.scope.padEnd(7)} ${location.provider.padEnd(12)} ${location.path} ${marker}`,
    );
  }

  if (summary.missingCount > 0) {
    console.error(
      ansi.dim(
        `    ${summary.missingCount} location(s) do not exist and were skipped.`,
      ),
    );
  }
}

/** Concrete `asm deactivate` invocation for one detected activation link. */
function deactivateCommandFor(reference: LibraryReference): string {
  return `asm deactivate ${basename(reference.linkPath)} -p ${reference.provider} -s ${reference.scope}`;
}

function printReferences(references: LibraryReference[]): void {
  console.error("");
  console.error(
    ansi.red(
      `Activation references to this library original found in the checked scope (${references.length}):`,
    ),
  );
  for (const reference of references) {
    const suffix = reference.dangling ? ansi.red(" [dangling]") : "";
    console.error(
      `  ${ansi.red("•")} ${reference.linkPath} → ${reference.target}${suffix} ${ansi.dim(`(${reference.provider}/${reference.scope})`)}`,
    );
    console.error(
      ansi.dim(
        `    ${deactivateCommandFor(reference)}   # remove this activation link, keep the library copy`,
      ),
    );
  }
}

function printUnreadable(locations: LibraryCheckLocation[]): void {
  console.error("");
  console.error(
    ansi.red(
      `Reference check could not read ${locations.length} location(s). An unchecked location is not evidence of absence:`,
    ),
  );
  for (const location of locations) {
    console.error(
      `  ${ansi.red("•")} ${location.path} ${ansi.dim(`(${location.provider}/${location.scope})`)} — ${location.error ?? "unreadable"}`,
    );
  }
}

/**
 * `asm uninstall <library-entry-name> --library` — exact removal of one library
 * original plus its lock entry (issue #799).
 *
 * Ordering is part of the safety contract:
 *   1. reject incompatible flags,
 *   2. resolve exactly one library entry by its directory key,
 *   3. validate the removal target stays inside the managed library,
 *   4. check references across the checked scope,
 *   5. show the mandatory side-effect notice and the scope actually checked,
 *   6. confirm (unless `-y`, which never skips 4–5),
 *   7. remove the directory, then the lock entry.
 */
export async function cmdUninstallLibrary(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    printLibraryUninstallHelp();
    return;
  }

  const notice = buildSideEffectNotice();
  const payload: LibraryUninstallPayload = {
    command: "uninstall",
    library: true,
    skill: args.subcommand,
    name: null,
    status: "failed",
    libraryPath: null,
    removedDirectory: false,
    removedLockEntry: false,
    remaining: null,
    references: [],
    unreadableLocations: [],
    warnings: [notice],
    sideEffectNotice: notice,
    checkedScope: null,
    errors: [],
  };

  /** Emit the structured result when asked, then terminate with `code`. */
  const finish: (code: number) => never = (code) => {
    if (args.flags.json) {
      console.log(JSON.stringify(payload, null, 2));
    }
    process.exit(code);
  };

  const fail: (
    status: LibraryUninstallStatus,
    message: string,
    code: number,
  ) => never = (status, message, code) => {
    payload.status = status;
    payload.errors.push(message);
    error(message);
    return finish(code);
  };

  // ── 1. Incompatible flags ────────────────────────────────────────────────
  if (args.flags.providerExplicit) {
    const given = args.flags.provider ? ` ("${args.flags.provider}")` : "";
    fail(
      "failed",
      `--library cannot be combined with --tool/--provider${given}. Library entries are provider-independent.`,
      2,
    );
  }
  if (args.flags.scopeExplicit) {
    fail("failed", "--library cannot be combined with --scope.", 2);
  }
  if (args.flags.all) {
    fail("failed", "--library cannot be combined with --all.", 2);
  }
  if (args.flags.force) {
    fail(
      "failed",
      "--library cannot be combined with --force: reference checks cannot be bypassed.",
      2,
    );
  }
  if (args.flags.machine) {
    fail(
      "failed",
      "--machine is not supported with --library. Use --json instead.",
      2,
    );
  }

  const skillName = args.subcommand;
  if (!skillName) {
    fail(
      "failed",
      "Missing required argument: <library-entry-name>. Use: asm uninstall <library-entry-name> --library",
      2,
    );
  }
  if (args.positional.length > 0) {
    fail(
      "failed",
      `Only one library entry can be removed at a time (extra argument: "${args.positional[0]}").`,
      2,
    );
  }

  // ── 2. Resolve exactly one library entry ─────────────────────────────────
  // `fail()` must stay outside the try bodies: it terminates via
  // process.exit(), and in the in-process test harness that surfaces as a
  // thrown sentinel which a surrounding catch would swallow.
  let rows: Awaited<ReturnType<typeof listLibrarySkills>>;
  try {
    rows = await listLibrarySkills();
  } catch (err) {
    fail(
      "failed",
      `Could not read the library lock: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }

  const resolution = resolveLibraryEntryForRemoval(rows, skillName);
  if (!resolution.ok) {
    fail("not-found", resolution.reason, 1);
  }

  const entry = resolution.entry;
  const dirName = entry.dirName;
  payload.skill = dirName;
  payload.name = entry.name;
  payload.libraryPath = resolve(entry.libraryPath);
  payload.warnings = [notice];

  // ── 3. Validate the removal target before doing any work ─────────────────
  const skillsDir = getLibrarySkillsDir();
  try {
    await assertManagedLibraryRemovalTarget({ dirName, entry, skillsDir });
  } catch (err) {
    fail("failed", err instanceof Error ? err.message : String(err), 1);
  }

  // ── 4. Reference check over the checked scope ────────────────────────────
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig();
  } catch (err) {
    fail(
      "failed",
      `Could not load provider config: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }

  let scan: LibraryReferenceScan;
  try {
    scan = await scanLibraryReferences({
      libraryPath: payload.libraryPath!,
      providers: config.providers,
    });
  } catch (err) {
    fail(
      "failed",
      `Reference check failed and cannot be treated as "no references": ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }
  payload.references = scan.references;
  payload.unreadableLocations = scan.unreadableLocations;
  const summary = describeCheckedScope(scan);
  payload.checkedScope = { ...summary, locations: scan.locations };

  // ── 5. Mandatory notice + the scope actually checked ─────────────────────
  console.error("");
  console.error(ansi.yellow("⚠ Library removal side effects"));
  console.error(notice);
  console.error("");
  printCheckedScope(scan);

  if (scan.references.length > 0) {
    printReferences(scan.references);
  }
  if (scan.unreadableLocations.length > 0) {
    printUnreadable(scan.unreadableLocations);
  }

  if (scan.references.length > 0 || scan.unreadableLocations.length > 0) {
    const parts: string[] = [];
    if (scan.references.length > 0) {
      parts.push(
        `${scan.references.length} activation reference(s) in the checked scope`,
      );
    }
    if (scan.unreadableLocations.length > 0) {
      parts.push(`${scan.unreadableLocations.length} unchecked location(s)`);
    }
    const guidance =
      scan.references.length > 0
        ? ' Deactivate them first (e.g. "asm deactivate <name> -p <provider> -s <scope>").'
        : "";
    fail(
      "blocked",
      `Refusing to remove library skill "${dirName}": ${parts.join(" and ")}.${guidance}`,
      1,
    );
  }

  console.error("");
  console.error(
    `No activation references found in the checked scope (${summary.locationCount} location(s)).`,
  );
  console.error(
    ansi.yellow(
      "This is NOT proof the skill is unused: projects outside the checked scope were not checked.",
    ),
  );

  // ── 6. Removal plan + confirmation ───────────────────────────────────────
  // `entry.missing` only means SKILL.md is absent; the directory may still be
  // there. Check the directory itself so the plan states the real target.
  let directoryPresent: boolean;
  try {
    directoryPresent = await libraryDirectoryPresent(payload.libraryPath!);
  } catch (err) {
    fail(
      "failed",
      `Could not inspect library directory ${payload.libraryPath}: ${err instanceof Error ? err.message : String(err)}`,
      1,
    );
  }

  console.error("");
  console.error(ansi.bold("Removal plan:"));
  if (directoryPresent) {
    console.error(`  ${ansi.red("•")} ${payload.libraryPath}`);
    console.error(
      `  ${ansi.dim("•")} Remove the library-lock entry: ${dirName}`,
    );
  } else {
    console.error(
      `  ${ansi.yellow("•")} Library directory is already missing: ${payload.libraryPath}`,
    );
    console.error(
      `  ${ansi.dim("•")} Remove the stale library-lock entry: ${dirName}`,
    );
  }

  if (!args.flags.yes) {
    if (!process.stdin.isTTY) {
      fail(
        "failed",
        "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
        2,
      );
    }
    process.stderr.write(
      `\n${ansi.bold("Remove this library original? This cannot be undone.")} [y/N] `,
    );
    const answer = await readLine();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      payload.status = "aborted";
      console.error("Aborted.");
      finish(0);
    }
  }

  // ── 7. Directory first, then the lock entry ──────────────────────────────
  // Known, accepted window: the reference check above and this removal are not
  // atomic. An activation created in between is deleted out from under (it
  // becomes a dangling link), and a concurrent swap of the entry for a symlink
  // is not re-validated here — `fs.rm` unlinks the symlink itself, so there is
  // no traversal escalation. Closing this properly needs a library-wide lock,
  // which this change deliberately does not add.
  const outcome = await removeLibrarySkill({
    dirName,
    entry,
    skillsDir,
    lockPath: getLibraryLockPath(),
  });

  payload.removedDirectory = outcome.removedDirectory;
  payload.removedLockEntry = outcome.removedLockEntry;
  payload.remaining = {
    directory: outcome.directoryPresent,
    lockEntry: outcome.lockEntryPresent,
  };

  if (outcome.errors.length > 0) {
    for (const message of outcome.errors) {
      console.error(ansi.red(message));
    }
    console.error(
      ansi.yellow(
        `Remaining state for "${dirName}": directory ${outcome.directoryPresent ? "still present" : "removed"}, lock entry ${outcome.lockEntryPresent ? "still present" : "removed"}.`,
      ),
    );
    fail(
      "failed",
      `Library uninstall incomplete for "${dirName}". See the remaining state above.`,
      1,
    );
  }

  payload.status = outcome.removedDirectory
    ? "removed"
    : "removed-stale-lock-entry";

  if (args.flags.json) {
    finish(0);
  }

  if (outcome.removedDirectory) {
    console.log(
      `${ansi.green("✓")} removed library skill ${ansi.bold(dirName)} (${payload.libraryPath})`,
    );
  } else {
    console.log(
      `${ansi.green("✓")} removed stale library-lock entry ${ansi.bold(dirName)} (library directory was already missing)`,
    );
  }
}
