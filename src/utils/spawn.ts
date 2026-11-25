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

/**
 * `git -c core.hooksPath=/dev/null`, as one GIT_CONFIG_PARAMETERS entry
 * (#897). No hook can live under `/dev/null`, so git runs none.
 */
export const NO_HOOKS_GIT_PARAMETER = "'core.hooksPath=/dev/null'";

/**
 * absolutePathEnv(base), plus git config that runs no hook, for any child
 * that runs git against a repo asm does not own: a clone, fetch or checkout
 * of a remote, a command inside such a clone, and npm or npx, which can
 * clone in turn (#897). The user's `core.hooksPath` can be relative (such as
 * `.githooks`), and git resolves it inside the new clone, so it would run a
 * hook the repo ships before any audit.
 *
 * The setting goes in GIT_CONFIG_PARAMETERS, appended the way `git -c`
 * appends, rather than in GIT_CONFIG_COUNT/KEY_n/VALUE_n:
 * - git reads GIT_CONFIG_PARAMETERS after GIT_CONFIG_COUNT, so the last
 *   entry wins over both an inherited `-c` and inherited numbered pairs;
 * - git before 2.31 ignores GIT_CONFIG_COUNT, and asm supports git 2.20+;
 * - the `'key=value'` entry form is the one every git version parses.
 * The user's own entries stay in place, ahead of this one.
 */
export function untrustedRepoGitEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = absolutePathEnv(base);
  const inherited = env.GIT_CONFIG_PARAMETERS;
  return {
    ...env,
    GIT_CONFIG_PARAMETERS: inherited
      ? `${inherited} ${NO_HOOKS_GIT_PARAMETER}`
      : NO_HOOKS_GIT_PARAMETER,
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
