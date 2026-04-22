/**
 * Cross-runtime command spawner.
 *
 * Bun and Node expose incompatible spawn APIs. Call sites in the CLI
 * (publisher, evaluator) must work under both, since `asm` ships with
 * `#!/usr/bin/env node` but still runs under Bun when the TUI re-execs.
 *
 * Under Bun we use Bun.spawn (faster, fewer allocations). Under Node we
 * fall back to child_process.spawn. The surface area is deliberately
 * narrow — only what publisher/evaluator actually need.
 */

export interface RunCommandOptions {
  cwd?: string;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export async function runCommand(
  argv: string[],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  if (argv.length === 0) {
    throw new Error("runCommand requires a non-empty argv");
  }

  if (isBun) {
    return runWithBun(argv, opts);
  }
  return runWithNode(argv, opts);
}

async function runWithBun(
  argv: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  const BunApi = (globalThis as { Bun: { spawn: Function } }).Bun;
  const proc = BunApi.spawn(argv, {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // Bun returns null when the child was signal-killed; surface that as
  // non-zero so callers' `exitCode !== 0` guards fire.
  return { exitCode: exitCode ?? -1, stdout, stderr };
}

async function runWithNode(
  argv: string[],
  opts: RunCommandOptions,
): Promise<RunCommandResult> {
  const { spawn } = await import("child_process");
  const [cmd, ...args] = argv;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      rejectPromise(err);
    });
    child.on("close", (code) => {
      // Node returns null when the child was signal-killed; surface that as
      // non-zero so callers' `exitCode !== 0` guards fire.
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
