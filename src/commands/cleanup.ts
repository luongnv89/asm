import type { ParsedArgs } from "../cli";
import { cleanupGetBorrow } from "../get-borrows";
import {
  formatCleanupHelp,
  formatGetBorrowCleanup,
  formatJSON,
} from "../formatter";
import {
  ErrorCodes,
  formatMachineError,
  formatMachineOutput,
} from "../utils/machine";
import { error } from "./shared";

export async function cmdCleanup(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    console.log(formatCleanupHelp());
    return;
  }
  const startTime = performance.now();
  if (!args.subcommand || args.positional.length) {
    const message =
      "Expected exactly one argument: <borrowed-path>. Run asm cleanup --help for usage.";
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "cleanup",
          ErrorCodes.INVALID_ARGUMENT,
          message,
          startTime,
        ),
      );
    } else {
      error(message);
    }
    process.exitCode = 2;
    return;
  }

  const result = await cleanupGetBorrow(args.subcommand);
  if (args.flags.machine) {
    console.log(
      result.status === "refused"
        ? formatMachineError(
            "cleanup",
            ErrorCodes.INVALID_ARGUMENT,
            formatGetBorrowCleanup(result),
            startTime,
            result,
          )
        : formatMachineOutput("cleanup", result, startTime),
    );
  } else if (args.flags.json) {
    console.log(formatJSON(result));
  } else if (result.status === "refused") {
    error(formatGetBorrowCleanup(result));
  } else {
    console.log(formatGetBorrowCleanup(result));
  }
  if (result.status === "refused") process.exitCode = 1;
}
