import { ansi } from "../formatter";
import type { ParsedArgs } from "../cli";
import { runAllChecks, formatDoctorReport, formatDoctorJSON } from "../doctor";
import { formatMachineOutput } from "../utils/machine";

function printDoctorHelp() {
  console.log(`${ansi.bold("Usage:")} asm doctor [options]

Run environment health checks and diagnostics. Validates all
prerequisites for using asm — git, GitHub CLI, Node.js, config,
lock file, registry, installed skills, and disk space.

${ansi.bold("Options:")}
  --json               Output as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm doctor                        ${ansi.dim("Run all health checks")}
  asm doctor --json                 ${ansi.dim("Output as JSON")}
  asm doctor --machine              ${ansi.dim("Machine-readable v1 envelope output")}`);
}

export async function cmdDoctor(args: ParsedArgs) {
  if (args.flags.help) {
    printDoctorHelp();
    return;
  }

  const startTime = performance.now();
  const report = await runAllChecks();

  if (args.flags.machine) {
    const data = {
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
      passed: report.passed,
      warnings: report.warnings,
      failures: report.failures,
    };
    console.log(formatMachineOutput("doctor", data, startTime));
  } else if (args.flags.json) {
    console.log(formatDoctorJSON(report));
  } else {
    console.log(formatDoctorReport(report));
  }

  if (report.failures > 0) {
    process.exit(1);
  }
}

// ─── Eval ───────────────────────────────────────────────────────────────────
