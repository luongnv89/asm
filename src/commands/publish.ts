import { ansi } from "../formatter";
import { publishSkill, formatFallbackInstructions } from "../publisher";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printPublishHelp() {
  console.log(`${ansi.bold("Usage:")} asm publish [path] [options]

Validate a skill, run a security audit, generate a registry manifest,
and open a PR against the asm-registry.

${ansi.bold("Arguments:")}
  path                 Path to skill directory (default: current directory)

${ansi.bold("Options:")}
  --dry-run            Print generated manifest without opening a PR
  --force              Override 'warning' security verdict (blocks 'dangerous')
  -y, --yes            Skip confirmation prompts
  --json               Output result as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm publish                       ${ansi.dim("Publish skill in current directory")}
  asm publish ./my-skill            ${ansi.dim("Publish skill at the given path")}
  asm publish --dry-run             ${ansi.dim("Preview manifest without side effects")}
  asm publish --force               ${ansi.dim("Override warning-level security findings")}
  asm publish --json                ${ansi.dim("Output as JSON")}
  asm publish --machine             ${ansi.dim("Machine-readable v1 envelope output")}`);
}

export async function cmdPublish(args: ParsedArgs) {
  if (args.flags.help) {
    printPublishHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  const skillPath = args.subcommand || ".";

  try {
    const result = await publishSkill({
      path: skillPath,
      dryRun: args.flags.dryRun,
      force: args.flags.force,
      yes: args.flags.yes,
    });

    // Machine-readable output
    if (args.flags.machine) {
      restoreConsole?.();
      if (!result.success) {
        console.log(
          formatMachineError(
            "publish",
            ErrorCodes.PUBLISH_FAILED,
            result.error || "Publish failed",
            startTime,
            {
              manifest: result.manifest,
              security_verdict: result.securityVerdict,
              fallback: result.fallback ?? false,
            },
          ),
        );
        process.exit(1);
      }
      console.log(
        formatMachineOutput(
          "publish",
          {
            manifest: result.manifest,
            pr_url: result.prUrl,
            status: result.securityVerdict,
          },
          startTime,
        ),
      );
      return;
    }

    // JSON output
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            success: result.success,
            manifest: result.manifest,
            pr_url: result.prUrl,
            error: result.error,
            security_verdict: result.securityVerdict,
          },
          null,
          2,
        ),
      );
      if (!result.success) process.exit(1);
      return;
    }

    // Human-readable output
    if (!result.success) {
      error(result.error || "Publish failed.");
      process.exit(1);
    }

    // Dry run
    // Keep this branch ahead of the fallback renderer: previewing a manifest
    // must remain machine-consumable even when gh is unavailable.
    if (args.flags.dryRun) {
      console.error(ansi.dim("Dry run — no PR created.\n"));
      console.log(JSON.stringify(result.manifest, null, 2));
      return;
    }

    // Fallback path: no gh CLI
    if (result.fallback) {
      console.log(ansi.yellow("Manifest generated (gh CLI unavailable):"));
      console.log(formatFallbackInstructions(result));
      return;
    }

    // Success with PR
    if (result.prUrl) {
      console.error(ansi.green("Published successfully!"));
      console.error("");
      console.error(`  PR: ${result.prUrl}`);
      console.error(
        `  Manifest: manifests/${result.manifest?.author}/${result.manifest?.name}.json`,
      );
      console.error(`  Security: ${result.securityVerdict}`);
      console.error("");
      console.error(
        ansi.dim("The registry maintainers will review your submission."),
      );
    }
  } catch (err: any) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "publish",
          ErrorCodes.PUBLISH_FAILED,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            manifest: null,
            pr_url: null,
            error: err.message,
            security_verdict: null,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  }
}

// ─── Outdated & Update Commands ────────────────────────────────────────────
