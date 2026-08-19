import {
  spawnSync as nodeSpawnSync,
  spawn as nodeSpawn,
} from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type {
  SpawnSyncOptions,
  SpawnOptions,
  SpawnSyncReturns,
  ChildProcess,
} from "node:child_process";

const requireFromHere = createRequire(import.meta.url);

let cachedTsxCli: string | null | undefined;
function resolveTsxCli(): string | null {
  if (cachedTsxCli === undefined) {
    try {
      cachedTsxCli = requireFromHere.resolve("tsx/cli");
    } catch {
      cachedTsxCli = null;
    }
  }
  return cachedTsxCli;
}

/**
 * Rewrite `npx tsx <file> …` to `<node> <tsx-cli> <file> …`.
 *
 * On Windows `npx` is `npx.cmd`, and Node's `spawn()` refuses to resolve
 * `.cmd`/`.bat` without `shell: true` — every `npx`-based test spawn dies with
 * ENOENT, which `spawnCollect` reports as exit code 127. Invoking tsx's own CLI
 * with the running `node` binary sidesteps the shim entirely; it is also faster
 * on every platform because it skips the npx package lookup.
 *
 * Falls back to the original argv when tsx can't be resolved, so the failure
 * mode stays the same as before instead of turning into a confusing error.
 */
function isBinShimForTsx(cmd: string): boolean {
  // `node_modules/.bin/tsx` (extensionless) is a shell script; on Windows the
  // real entry points are the sibling `tsx.cmd` / `tsx.ps1` shims, so spawning
  // the extensionless path fails with ENOENT there.
  return /(^|[\\/])node_modules[\\/]\.bin[\\/]tsx$/.test(cmd);
}

function normalizeArgv(argv: readonly string[]): string[] {
  const usesTsx =
    (argv[0] === "npx" && argv[1] === "tsx") || isBinShimForTsx(argv[0] ?? "");
  if (usesTsx) {
    const tsxCli = resolveTsxCli();
    if (tsxCli) {
      const rest = argv[0] === "npx" ? argv.slice(2) : argv.slice(1);
      return [process.execPath, tsxCli, ...rest];
    }
  }
  return [...argv];
}

/**
 * Keep a redirected `HOME` effective on Windows.
 *
 * Tests sandbox the CLI by spawning it with `env: { ...process.env, HOME: tmp }`,
 * but the product resolves its paths through `os.homedir()`, which on Windows
 * reads `USERPROFILE` and ignores `HOME` entirely. Without this, every such test
 * runs against the developer's REAL home directory: assertions fail, and worse,
 * `asm install` fixtures get written into `~/.claude/skills` for real.
 *
 * Mirroring `HOME` onto `USERPROFILE` (only when the caller actually redirected
 * it) makes the sandbox hold on Windows and changes nothing on POSIX.
 */
function normalizeEnv<T extends { env?: NodeJS.ProcessEnv }>(opts: T): T {
  let env = opts.env;
  if (env) {
    // Vitest setupFiles sets ASM_CONFIG_DIR for in-process tests. Spawned CLI
    // helpers copy process.env and then redirect HOME; drop the inherited
    // sandbox so the child uses $HOME/.config/agent-skill-manager unless the
    // caller set ASM_CONFIG_DIR itself.
    const redirectedHome = Boolean(env.HOME && env.HOME !== process.env.HOME);
    const inheritedSandbox =
      env.ASM_CONFIG_DIR !== undefined &&
      env.ASM_CONFIG_DIR === process.env.ASM_CONFIG_DIR;
    if (redirectedHome && inheritedSandbox) {
      env = { ...env };
      delete env.ASM_CONFIG_DIR;
      opts = { ...opts, env };
    }
  }

  if (process.platform !== "win32") return opts;
  env = opts.env;
  if (!env?.HOME || env.HOME === process.env.HOME) return opts;
  if (env.USERPROFILE && env.USERPROFILE !== process.env.USERPROFILE) {
    return opts;
  }
  return { ...opts, env: { ...env, USERPROFILE: env.HOME } };
}

/**
 * Thin argv-first wrapper around `child_process.spawnSync` for tests. Takes an
 * argv array (`[cmd, ...args]`) and returns the Node-shaped result directly.
 */
export function spawnSyncArgv(
  argv: readonly string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  const [cmd, ...args] = normalizeArgv(argv);
  return nodeSpawnSync(cmd, args, normalizeEnv(opts));
}

/**
 * Argv-first wrapper around `child_process.spawn`. Takes an argv array and
 * returns a Node `ChildProcess` whose `proc.stdout` / `proc.stderr` are read
 * as Node streams.
 */
export function spawnArgv(
  argv: readonly string[],
  opts: SpawnOptions = {},
): ChildProcess {
  const [cmd, ...args] = normalizeArgv(argv);
  return nodeSpawn(cmd, args, normalizeEnv(opts));
}

/**
 * Collect stdout/stderr and wait for exit, resolving to a
 * `{ exitCode, stdout, stderr }` shape that call sites assert against.
 */
export function spawnCollect(
  argv: readonly string[],
  opts: SpawnOptions & { stdin?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { stdin, ...spawnOpts } = opts;
  const stdio: ("pipe" | "ignore")[] =
    stdin !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"];
  return new Promise((resolve, reject) => {
    const child = spawnArgv(argv, { stdio, ...spawnOpts });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      // Mirror runCommand in src/utils/spawn.ts: a missing binary surfaces
      // as exitCode 127, not a rejection, so callers can guard on exitCode
      // without a try/catch.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        resolve({ exitCode: 127, stdout, stderr: err.message });
        return;
      }
      reject(err);
    });
    const onDisconnect = () => child.kill("SIGKILL");
    process.on("disconnect", onDisconnect);
    child.on("close", (code) => {
      process.off("disconnect", onDisconnect);
      if (settled) return;
      settled = true;
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Run an inline TS snippet under `tsx`.
 * Writes the snippet inside `opts.cwd` (or process.cwd()) so that relative
 * imports like `./src/registry` resolve against the project tree, then runs
 * it via `npx tsx` and cleans up.
 */
export async function runInlineTs(
  script: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const base = opts.cwd ?? process.cwd();
  // Write the snippet directly at the base (project root) so relative imports
  // like `./src/registry` resolve against the project tree.
  const file = join(
    base,
    `.asm-inline-ts-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
  );
  writeFileSync(file, script);
  try {
    return await spawnCollect(["npx", "tsx", file], opts);
  } finally {
    rmSync(file, { force: true });
  }
}
