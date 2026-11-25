/**
 * Node-only command spawner. Used by publisher/evaluator/doctor to shell out
 * to `git`, `gh`, npm, etc.
 */

import { delimiter, isAbsolute } from "path";

/**
 * The search path libuv uses when PATH is unset (glibc and macOS
 * `_PATH_DEFPATH`), so an unset PATH finds the same programs as before.
 */
export const DEFAULT_PATH = "/usr/bin:/bin";

/**
 * The child PATH when the parent's has no absolute entry. An empty PATH is
 * no answer: node, sh, env and git all read it as one empty entry, which is
 * the cwd. A directory that does not exist makes every lookup fail with
 * ENOENT (node reports ENOTDIR as a synchronous throw, so `/dev/null` is out),
 * and only root can create a directory under `/`.
 */
export const NO_PROGRAM_PATH = "/nonexistent";

/** The absolute entries of `path`, in order (#890, #894). */
export function absolutePathEntries(
  path: string = process.env.PATH ?? DEFAULT_PATH,
): string[] {
  return path.split(delimiter).filter(isAbsolute);
}

/**
 * `base` with PATH cut down to its absolute entries (#890, #894), for any
 * child asm starts: git, gh, a linter, npm. An empty, `.` or relative entry
 * names the child's cwd or a folder under it, which can be a repo asm just
 * cloned, so git's filter or alias lookup, a shebang's `env bash` or the
 * spawn itself would run a file the repo ships. The rest of `base` is passed
 * through unchanged.
 *
 * Windows returns `base` unchanged: its lookup adds PATHEXT extensions and
 * starts in the cwd whatever PATH holds, which this filter does not model.
 */
export function absolutePathEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (process.platform === "win32") return base;
  const entries = absolutePathEntries(base.PATH ?? DEFAULT_PATH);
  return {
    ...base,
    PATH: entries.length > 0 ? entries.join(delimiter) : NO_PROGRAM_PATH,
  };
}

export interface RunCommandOptions {
  cwd?: string;
  /**
   * The child's environment. Omitted: the parent's `process.env`. Either way
   * its PATH goes through absolutePathEnv.
   */
  env?: NodeJS.ProcessEnv;
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
      env: absolutePathEnv(opts.env),
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
