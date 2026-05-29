import {
  spawnSync as nodeSpawnSync,
  spawn as nodeSpawn,
} from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  SpawnSyncOptions,
  SpawnOptions,
  SpawnSyncReturns,
  ChildProcess,
} from "node:child_process";

/**
 * Thin argv-first wrapper around `child_process.spawnSync` for tests. Takes an
 * argv array (`[cmd, ...args]`) and returns the Node-shaped result directly.
 */
export function spawnSyncArgv(
  argv: readonly string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  const [cmd, ...args] = argv;
  return nodeSpawnSync(cmd, args, opts);
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
  const [cmd, ...args] = argv;
  return nodeSpawn(cmd, args, opts);
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
