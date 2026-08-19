import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import { ansi } from "../formatter";
import { buildManifest } from "../exporter";
import {
  readManifestFile,
  importSkills,
  renderConflictDiff,
} from "../importer";
import type {
  ImportConflict,
  ImportConflictChoice,
  ImportResult,
} from "../utils/types";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printExportHelp() {
  console.log(`${ansi.bold("Usage:")} asm export [options]

Export skill inventory as a portable JSON manifest. Useful for backup,
sharing, or scripting.

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm export                        ${ansi.dim("Export all skills")}
  asm export -s global              ${ansi.dim("Export global skills only")}
  asm export > skills.json          ${ansi.dim("Save to file")}`);
}

export async function cmdExport(args: ParsedArgs) {
  if (args.flags.help) {
    printExportHelp();
    return;
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const manifest = buildManifest(allSkills);
  console.log(JSON.stringify(manifest, null, 2));
}

// ─── Import ─────────────────────────────────────────────────────────────────

function printImportHelp() {
  console.log(`${ansi.bold("Usage:")} asm import <file> [options]

Import skills from a previously exported JSON manifest. Recreates skill
installations based on the manifest metadata.

Skills that already exist with identical content are skipped. When an
existing skill differs from the imported version, the conflict is reported
with which side is newer; in a terminal you can resolve each conflict
(keep local, use imported, or skip), optionally viewing a diff. --force
overwrites all conflicts without asking. Skills whose source files cannot
be found locally are reported as failed — install them first with
"asm install".

${ansi.bold("Options:")}
  -s, --scope <s>    Filter: global, project, or both (default: both)
  -f, --force        Overwrite existing skills without conflict prompts
  --diff             Show unified diffs (cannot be combined with --force)
  -y, --yes          Skip prompts (conflicts are skipped and reported)
  --json             Output results as JSON (includes conflict details)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm import skills.json              ${ansi.dim("Import from manifest")}
  asm import skills.json --diff       ${ansi.dim("Show diffs for conflicting skills")}
  asm import skills.json --force      ${ansi.dim("Overwrite existing skills")}
  asm import skills.json -s global    ${ansi.dim("Import only global skills")}
  asm export > backup.json            ${ansi.dim("Export first, then import later")}
  asm import backup.json              ${ansi.dim("Restore from backup")}`);
}

type ImportConflictPromptOptions = {
  showDiff?: boolean;
  readAnswer?: () => Promise<string>;
  renderDiff?: (conflict: ImportConflict) => Promise<string>;
  writeLine?: (text: string) => void;
  writePrompt?: (text: string) => void;
};

/** Prompt for one import conflict. Dependencies are injectable for CLI tests. */

export async function promptForImportConflict(
  conflict: ImportConflict,
  options: ImportConflictPromptOptions = {},
): Promise<ImportConflictChoice> {
  const {
    showDiff = false,
    readAnswer = readLine,
    renderDiff = renderConflictDiff,
    writeLine = console.error,
    writePrompt = (text) => process.stderr.write(text),
  } = options;
  const mark = (side: "local" | "imported") =>
    conflict.newer === side
      ? ` ${ansi.green("(newer)")}`
      : conflict.newer === "same"
        ? ""
        : ` ${ansi.dim("(older)")}`;
  writeLine("");
  writeLine(
    `${ansi.bold("Conflict:")} ${conflict.skillName} (${conflict.provider}/${conflict.scope})`,
  );
  writeLine(`  local:    ${conflict.localModified}${mark("local")}`);
  writeLine(`  imported: ${conflict.importedModified}${mark("imported")}`);

  let diffShown = false;
  if (showDiff) {
    const diff = await renderDiff(conflict);
    writeLine(diff ? `\n${diff}\n` : "  (no textual differences found)");
    diffShown = true;
  }

  for (;;) {
    writePrompt(
      `  [k] keep local  [u] use imported  [s] skip${diffShown ? "" : "  [d] show diff"}  ${ansi.dim("[s]")} `,
    );
    const answer = (await readAnswer()).trim().toLowerCase();
    if (answer === "k" || answer === "keep") return "keep-local";
    if (answer === "u" || answer === "use") return "use-imported";
    if (answer === "" || answer === "s" || answer === "skip") return "skip";
    if (answer === "d" || answer === "diff") {
      const diff = await renderDiff(conflict);
      writeLine(diff ? `\n${diff}\n` : "  (no textual differences found)");
      diffShown = true;
    }
  }
}

/** Print conflict diffs collected by a non-interactive import. */

export async function printImportConflictDiffs(
  results: ImportResult[],
  renderDiff: (
    conflict: ImportConflict,
  ) => Promise<string> = renderConflictDiff,
  writeLine: (text: string) => void = console.error,
): Promise<void> {
  for (const result of results) {
    if (!result.conflict) continue;
    const diff = await renderDiff(result.conflict);
    writeLine(
      `\n${ansi.bold(`Conflict diff: ${result.skillName} (${result.provider}/${result.scope})`)} ${ansi.dim("local -> imported")}`,
    );
    writeLine(diff || "  (no textual differences found)");
  }
}

export async function cmdImport(args: ParsedArgs) {
  if (args.flags.help) {
    printImportHelp();
    return;
  }

  const filePath = args.subcommand;
  if (!filePath) {
    error("Missing required argument: <file>");
    console.error(`Run "asm import --help" for usage.`);
    process.exit(2);
  }
  if (args.flags.force && args.flags.diff) {
    error(
      "--force and --diff cannot be used together. Run without --force to inspect conflicts, or omit --diff to overwrite them.",
    );
    process.exit(2);
  }

  // Resolve to absolute path
  const { resolve: resolvePath } = await import("path");
  const absPath = resolvePath(filePath);

  // Read and validate manifest
  let manifest;
  try {
    manifest = await readManifestFile(absPath);
  } catch (err: any) {
    error(err.message);
    process.exit(1);
  }

  const skillCount = manifest.skills.length;
  if (skillCount === 0) {
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            total: 0,
            installed: 0,
            skipped: 0,
            failed: 0,
            conflicts: 0,
            results: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.log("Manifest contains no skills. Nothing to import.");
    }
    return;
  }

  // Show summary before importing
  const scopeLabel =
    args.flags.scope === "both" ? "all scopes" : args.flags.scope;
  console.error(
    `${ansi.bold("Importing")} ${skillCount} skill${skillCount > 1 ? "s" : ""} from ${ansi.dim(absPath)}`,
  );
  console.error(`  Scope filter: ${scopeLabel}`);
  if (args.flags.force) {
    console.error(
      `  ${ansi.yellow("Force mode: existing skills will be overwritten")}`,
    );
  }

  // Confirm unless --yes
  if (!args.flags.yes && process.stdin.isTTY) {
    process.stderr.write(`\n${ansi.bold("Proceed?")} [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  // Conflicts (existing skill with different content) are resolved
  // interactively on a TTY unless --force or --yes was given; otherwise
  // they are skipped and reported.
  const interactive =
    !args.flags.force && !args.flags.yes && !!process.stdin.isTTY;
  const showDiff = args.flags.diff;

  // Run import
  const summary = await importSkills(manifest, {
    force: args.flags.force,
    dryRun: false,
    scopeFilter: args.flags.scope,
    onConflict: interactive
      ? (conflict) => promptForImportConflict(conflict, { showDiff })
      : undefined,
  });

  // Non-interactive --diff: print the diff for each detected conflict so the
  // user can inspect before deciding on an interactive run.
  if (showDiff && !interactive) {
    await printImportConflictDiffs(summary.results);
  }

  // Output results
  if (args.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Human-readable output
  if (summary.total === 0) {
    console.error(
      `\nNothing to import after scope filtering (--scope ${args.flags.scope}). All skills in the manifest were excluded.`,
    );
    return;
  }
  console.error("");
  for (const result of summary.results) {
    const icon =
      result.status === "installed"
        ? ansi.green("+++")
        : result.status === "skipped"
          ? ansi.yellow("---")
          : result.status === "dry-run"
            ? ansi.cyan("~~~")
            : ansi.red("!!!");
    const detail = result.reason ? ` ${ansi.dim(result.reason)}` : "";
    const pathInfo = result.path ? ` ${ansi.dim(result.path)}` : "";
    console.error(
      `  ${icon} ${result.skillName} (${result.provider}/${result.scope})${detail}${pathInfo}`,
    );
  }

  console.error("");
  const conflictsPart =
    summary.conflicts > 0
      ? `, ${ansi.yellow(String(summary.conflicts))} conflicts`
      : "";
  console.error(
    `${ansi.bold("Summary:")} ${summary.total} total, ` +
      `${ansi.green(String(summary.installed))} installed, ` +
      `${ansi.yellow(String(summary.skipped))} skipped, ` +
      `${ansi.red(String(summary.failed))} failed${conflictsPart}`,
  );

  if (summary.conflicts > 0 && !interactive && !args.flags.force) {
    console.error(
      ansi.dim(
        "Conflicts were skipped. Re-run in a terminal to resolve each one, add --diff to inspect, or --force to overwrite all.",
      ),
    );
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────
