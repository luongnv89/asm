/**
 * Node-only command spawner. Used by publisher/evaluator/doctor to shell out
 * to `git`, `gh`, npm, etc.
 */

export interface RunCommandOptions {
  cwd?: string;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  argv: string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  if (argv.length === 0) {
    throw new Error("runCommand requires a non-empty argv");
  }

  const { spawn } = await import("child_process");
  const [cmd, ...args] = argv;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      // Missing binary should surface as a non-zero exit code, not a
      // rejection — callers like checkGhCli() rely on an exitCode guard to
      // fall back gracefully when `gh` isn't installed.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        resolvePromise({ exitCode: 127, stdout, stderr: err.message });
        return;
      }
      rejectPromise(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      // Node returns null when the child was signal-killed; surface that as
      // non-zero so callers' `exitCode !== 0` guards fire.
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
