import { ansi } from "../formatter";
import {
  checkOutdated,
  updateSkills,
  formatOutdatedTable,
  formatOutdatedJSON,
  formatUpdateJSON,
} from "../updater";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printOutdatedHelp() {
  console.log(`${ansi.bold("Usage:")} asm outdated [options]

Show which installed skills have newer versions available.

${ansi.bold("Options:")}
  --json               Output as JSON
  --machine            Output in stable machine-readable format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm outdated                       ${ansi.dim("Show outdated skills")}
  asm outdated --json                ${ansi.dim("Output as JSON")}
  asm outdated --machine             ${ansi.dim("Machine-readable output")}`);
}

export async function cmdOutdated(args: ParsedArgs) {
  if (args.flags.help) {
    printOutdatedHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  try {
    const summary = await checkOutdated();

    if (args.flags.machine) {
      restoreConsole?.();
      const data = summary.entries.map((e) => ({
        name: e.name,
        installed_commit: e.installedCommit,
        latest_commit: e.latestCommit,
        source: e.sourceType,
        status: e.status,
      }));
      console.log(formatMachineOutput("outdated", data, startTime));
      return;
    }

    if (args.flags.json) {
      console.log(formatOutdatedJSON(summary));
      return;
    }

    // Human-readable table
    const useColor = !args.flags.noColor && process.stdout.isTTY !== false;
    console.log(formatOutdatedTable(summary, useColor));

    if (summary.outdatedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "outdated",
          ErrorCodes.UNKNOWN_ERROR,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

function printUpdateHelp() {
  console.log(`${ansi.bold("Usage:")} asm update [name...] [options]

Update outdated skills to their latest version with security re-audit.

${ansi.bold("Arguments:")}
  name          Specific skill(s) to update (default: all outdated)

${ansi.bold("Options:")}
  -y, --yes            Skip confirmation prompts
  --json               Output as JSON
  --machine            Output in stable machine-readable format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm update                         ${ansi.dim("Update all outdated skills")}
  asm update code-review             ${ansi.dim("Update a specific skill")}
  asm update --yes                   ${ansi.dim("Skip confirmation prompts")}
  asm update --json                  ${ansi.dim("Output as JSON")}`);
}

export async function cmdUpdate(args: ParsedArgs) {
  if (args.flags.help) {
    printUpdateHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  // Collect skill names from subcommand and positional args
  const names: string[] = [];
  if (args.subcommand) names.push(args.subcommand);
  names.push(...args.positional);

  try {
    const summary = await updateSkills(
      names.length > 0 ? names : null,
      args.flags.yes,
    );

    if (args.flags.machine) {
      restoreConsole?.();
      const data = summary.results.map((r) => ({
        name: r.name,
        status: r.status,
        reason: r.reason || null,
        old_commit: r.oldCommit || null,
        new_commit: r.newCommit || null,
        security_verdict: r.securityVerdict || null,
      }));
      console.log(formatMachineOutput("update", data, startTime));
      return;
    }

    if (args.flags.json) {
      console.log(formatUpdateJSON(summary));
      return;
    }

    // Human-readable output

    // Warn that scope detection is not yet supported
    if (summary.results.length > 0) {
      console.error(
        ansi.yellow(
          "Note: project-scoped skill detection is not yet supported. All updates target the global skill path.",
        ),
      );
    }

    // Warn about skills not found in the lock file
    if (summary.warnings && summary.warnings.length > 0) {
      for (const w of summary.warnings) {
        console.error(
          ansi.yellow(`Warning: skill "${w}" not found in lock file — skipped`),
        );
      }
    }

    if (summary.results.length === 0) {
      console.log("All skills are up to date.");
      return;
    }

    for (const result of summary.results) {
      switch (result.status) {
        case "updated":
          console.log(
            `${ansi.green("✓")} ${result.name} ${ansi.dim(result.oldCommit || "")} → ${result.newCommit || ""}`,
          );
          if (result.securityVerdict === "warning") {
            console.error(
              ansi.yellow(
                `  ⚠ Security audit returned warning for ${result.name} — updated because --yes was supplied`,
              ),
            );
          }
          break;
        case "skipped":
          console.log(
            `${ansi.yellow("○")} ${result.name} ${ansi.dim(result.reason || "skipped")}`,
          );
          break;
        case "failed":
          console.log(
            `${ansi.red("✗")} ${result.name} ${ansi.dim(result.reason || "failed")}`,
          );
          break;
      }
    }

    console.log("");
    const parts: string[] = [];
    if (summary.updatedCount > 0)
      parts.push(ansi.green(`${summary.updatedCount} updated`));
    if (summary.skippedCount > 0)
      parts.push(ansi.yellow(`${summary.skippedCount} skipped`));
    if (summary.failedCount > 0)
      parts.push(ansi.red(`${summary.failedCount} failed`));
    console.log(parts.join(", "));

    if (summary.failedCount > 0) {
      process.exitCode = 1;
    }
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "update",
          ErrorCodes.UNKNOWN_ERROR,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

// ─── Main CLI dispatcher ────────────────────────────────────────────────────
