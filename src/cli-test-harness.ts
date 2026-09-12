import { vi } from "vitest";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { rm, lstat } from "fs/promises";
import { homedir } from "os";
import { setVerbose } from "./logger";
import { _resetMemo } from "./skill-index";
import { format } from "node:util";
import { runCLI as dispatchCLI } from "./cli";

// Helper: path to the CLI entry point — kept for tests that still spawn the
// real binary (see the readLine describe; runInlineTs needs a real child
// process because it pipes stdin, which cannot be faked in-process).
export const CLI_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "agent-skill-manager.ts",
);

/**
 * In-process CLI runner — the coverage-visible equivalent of spawning
 * `npx tsx bin/agent-skill-manager.ts …` (issue #673).
 *
 * v8 coverage cannot attribute lines executed inside a spawned tsx child, so
 * `src/commands/` reported ~10% despite the suite exercising it. Dispatching
 * `runCLI()` from src/cli.ts in-process — with stdout/stderr, process.exit,
 * env, and cwd virtualised for the duration of the call — makes the same
 * assertions count toward coverage. The command graph is import-safe: this
 * file already imports ./cli (and transitively every cmd* module) at the top.
 *
 * Semantics preserved from the spawn path:
 *  - NO_COLOR=1 applies to every call (the old helpers always passed it).
 *  - A HOME override additionally mirrors USERPROFILE and drops the inherited
 *    ASM_CONFIG_DIR sandbox unless the caller set it explicitly — the same
 *    rules test-spawn's normalizeEnv() applied to spawned children, so a
 *    fake HOME keeps its own ~/.config/agent-skill-manager.
 *  - process.exit() throws a CliExit sentinel carrying the exit code; any
 *    other throw is reported like the bin wrapper does
 *    ("Fatal error: …" on stderr, exit code 1).
 *  - Per-process globals a subprocess never shared are reset after the call:
 *    __CLI_NO_COLOR, the logger verbose flag, and the skill-index memo.
 *  - stdout/stderr capture both console.* calls and direct
 *    process.stdout/stderr.write() writes, in order, into per-stream buffers.
 */
export class CliExit extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Accepts either a plain arg list (`["list", "--json"]`) or the historical
 * spawn argv (`["npx", "tsx", CLI_BIN, "list", …]` /
 * `[<tsx-bin-shim>, CLI_BIN, …]`) — the latter keeps converted call sites
 * byte-identical apart from the callee name.
 */
function normalizeCliArgv(argv: string[]): string[] {
  const binIdx = argv.indexOf(CLI_BIN);
  return binIdx >= 0 ? argv.slice(binIdx + 1) : argv;
}

/**
 * Accepts either a small env delta (`{ HOME: dir }`) or the historical
 * full-env object (`{ ...process.env, HOME: dir, NO_COLOR: "1" }`); the
 * latter is reduced to just the keys that differ from the ambient env,
 * which is exactly what the spawn actually changed for the child.
 */
function normalizeCliEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const delta: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value !== process.env[key]) delta[key] = value;
  }
  return delta;
}

export async function runCliInProcess(
  argv: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<CliRunResult> {
  const args = normalizeCliArgv(argv);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const asText = (chunk: unknown): string =>
    typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk as Uint8Array).toString("utf8");
  const writeSpyImpl = (chunks: string[]) =>
    ((chunk: unknown, encOrCb?: unknown, cb?: unknown) => {
      chunks.push(asText(chunk));
      const done =
        typeof encOrCb === "function"
          ? encOrCb
          : typeof cb === "function"
            ? cb
            : undefined;
      if (done) (done as (err?: Error | null) => void)();
      return true;
    }) as typeof process.stdout.write;

  let exitCode = 0;
  let exitThrew = false;

  // Env delta — NO_COLOR always; a HOME override mirrors USERPROFILE and
  // drops the inherited ASM_CONFIG_DIR sandbox (normalizeEnv parity) so the
  // redirected home keeps its own config dir.
  const envDelta = normalizeCliEnv(opts.env);
  if (envDelta.HOME !== undefined && envDelta.USERPROFILE === undefined) {
    envDelta.USERPROFILE = envDelta.HOME;
  }
  const dropConfigDir =
    envDelta.HOME !== undefined && envDelta.ASM_CONFIG_DIR === undefined;
  const envKeys = new Set(Object.keys(envDelta));
  if (dropConfigDir) envKeys.add("ASM_CONFIG_DIR");
  const savedEnv = new Map<string, string | undefined>();

  const savedNoColor = globalThis.__CLI_NO_COLOR;
  const savedExitCodeProp = process.exitCode;
  let savedCwd: string | null = null;

  const spies = [
    vi
      .spyOn(process.stdout, "write")
      .mockImplementation(writeSpyImpl(stdoutChunks)),
    vi
      .spyOn(process.stderr, "write")
      .mockImplementation(writeSpyImpl(stderrChunks)),
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      stdoutChunks.push(`${format(...a)}\n`);
    }),
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => {
      stdoutChunks.push(`${format(...a)}\n`);
    }),
    vi.spyOn(console, "debug").mockImplementation((...a: unknown[]) => {
      stdoutChunks.push(`${format(...a)}\n`);
    }),
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      stderrChunks.push(`${format(...a)}\n`);
    }),
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      stderrChunks.push(`${format(...a)}\n`);
    }),
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      exitThrew = true;
      throw new CliExit(exitCode);
    }) as typeof process.exit),
  ];

  try {
    for (const key of envKeys) savedEnv.set(key, process.env[key]);
    for (const [key, value] of Object.entries(envDelta)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (dropConfigDir) delete process.env.ASM_CONFIG_DIR;
    process.exitCode = undefined;
    savedCwd = process.cwd();
    if (opts.cwd) process.chdir(opts.cwd);

    _resetMemo();
    await dispatchCLI(["node", "asm", ...args]);
  } catch (err) {
    if (!(err instanceof CliExit)) {
      // Mirror bin/agent-skill-manager.ts's catch-all.
      stderrChunks.push(`${format("Fatal error:", err)}\n`);
      if (exitCode === 0) exitCode = 1;
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (savedCwd !== null && opts.cwd) {
      try {
        process.chdir(savedCwd);
      } catch {
        // savedCwd deleted mid-call — nothing sane to restore to.
      }
    }
    globalThis.__CLI_NO_COLOR = savedNoColor;
    // Commands also signal failure via `process.exitCode = N` (no throw) —
    // e.g. get.ts under --machine, deps.ts, cleanup.ts. A subprocess exits
    // with it; here it must be read, then restored, per call.
    if (!exitThrew && typeof process.exitCode === "number") {
      exitCode = process.exitCode;
    }
    process.exitCode = savedExitCodeProp;
    setVerbose(false);
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

// Helper: run the CLI in-process, returns { stdout, stderr, exitCode }.
export async function runCLI(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await runCliInProcess(args);
  return {
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim(),
    exitCode: res.exitCode,
  };
}

// Helper: assert that a globally installed skill directory was actually removed.
// `asm install <dir>` installs to ~/.claude/skills/<basename(dir)>, and the
// uninstaller looks up by that same basename. When a test's source directory
// basename does not match the skill's frontmatter `name`, the uninstall step
// silently fails to match and leaks the install (issue #288). This helper, run
// in each test's `finally`, catches regressions of that bug class.
export async function assertSkillUninstalled(
  installedDirName: string,
): Promise<void> {
  const installedPath = join(homedir(), ".claude", "skills", installedDirName);
  let leaked = false;
  try {
    await lstat(installedPath);
    leaked = true;
  } catch {
    // ENOENT — expected: uninstall removed it.
  }
  if (leaked) {
    await rm(installedPath, { recursive: true, force: true });
    throw new Error(
      `Test leaked installed skill at ${installedPath} — uninstall did not remove it.`,
    );
  }
}
