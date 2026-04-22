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
 * Thin argv-first wrapper around `child_process.spawnSync` for tests that used
 * to call `Bun.spawnSync(argv, opts)`. Returns the Node-shaped result directly.
 */
export function spawnSyncArgv(
  argv: readonly string[],
  opts: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  const [cmd, ...args] = argv;
  return nodeSpawnSync(cmd, args, opts);
}

/**
 * Argv-first wrapper around `child_process.spawn`. Test code that previously
 * called `Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", cwd })` now uses
 * this, and then reads `proc.stdout` / `proc.stderr` as Node streams.
 */
export function spawnArgv(
  argv: readonly string[],
  opts: SpawnOptions = {},
): ChildProcess {
  const [cmd, ...args] = argv;
  return nodeSpawn(cmd, args, opts);
}

/**
 * Collect stdout/stderr and wait for exit. Mirrors the `{ exitCode, stdout,
 * stderr }` shape that Bun.spawn / `await new Response(proc.stdout).text()`
 * produced, so call sites can keep the same assertions.
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
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Run an inline TS snippet under `tsx` (replacement for `bun -e <script>`).
 * Writes the snippet to a temp .ts file, runs it, cleans up.
 */
export async function runInlineTs(
  script: string,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), "asm-inline-ts-"));
  const file = join(dir, "snippet.ts");
  writeFileSync(file, script);
  try {
    return await spawnCollect(["npx", "tsx", file], opts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
