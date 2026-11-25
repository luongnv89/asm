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
 * Every hook event githooks(5) lists (git 2.56), for `hook.<event>.enabled`.
 */
export const GIT_HOOK_EVENTS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
] as const;

/**
 * One GIT_CONFIG_PARAMETERS entry, in the `'key=value'` form every git
 * version parses (the newer `'key'='value'` form needs git 2.31).
 */
export function gitConfigParameter(key: string, value: string): string {
  return `'${`${key}=${value}`.replace(/'/g, "'\\''")}'`;
}

/**
 * A `core.hooksPath` no hook can be found under. `/dev/null` is a device,
 * not a folder. Git for Windows would read `/dev/null` as `\dev\null` on the
 * current drive, a folder any user can create at the drive root, so Windows
 * gets the node binary instead: a regular file, so not a folder either.
 */
export function noHooksPath(): string {
  return process.platform === "win32" ? process.execPath : "/dev/null";
}

/**
 * The GIT_CONFIG_PARAMETERS entries that turn off every hook (#897):
 * `core.hooksPath` for the hooks folder, and `hook.<event>.enabled=false`,
 * which git 2.55+ applies to hooks defined in config (`hook.<name>.command`,
 * git 2.54+) as well. Older git ignores the `hook.*` keys.
 */
export function noHooksGitParameters(): string {
  return [
    gitConfigParameter("core.hooksPath", noHooksPath()),
    ...GIT_HOOK_EVENTS.map((event) =>
      gitConfigParameter(`hook.${event}.enabled`, "false"),
    ),
  ].join(" ");
}

/**
 * absolutePathEnv(base), plus git config that runs no hook, for any child
 * that runs git against a repo asm does not own: a clone, fetch or checkout
 * of a remote, a command inside such a clone, npx (`skills add` clones), and
 * npm, which `--allow-git=none` stops from cloning only where its version
 * knows that flag (#897). The user's `core.hooksPath` can be relative (such
 * as `.githooks`), and git resolves it inside the new clone, so it would run
 * a hook the repo ships before any audit. A hook command in the user's config
 * with a relative path would do the same.
 *
 * The settings go in GIT_CONFIG_PARAMETERS, appended the way `git -c`
 * appends, rather than in GIT_CONFIG_COUNT/KEY_n/VALUE_n:
 * - git reads GIT_CONFIG_PARAMETERS after GIT_CONFIG_COUNT, so the last
 *   entry wins over both an inherited `-c` and inherited numbered pairs;
 * - git before 2.31 ignores GIT_CONFIG_COUNT, and asm supports git 2.20+.
 * The user's own entries stay in place, ahead of these.
 */
export function untrustedRepoGitEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = absolutePathEnv(base);
  const inherited = env.GIT_CONFIG_PARAMETERS;
  const noHooks = noHooksGitParameters();
  return {
    ...env,
    GIT_CONFIG_PARAMETERS: inherited ? `${inherited} ${noHooks}` : noHooks,
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
