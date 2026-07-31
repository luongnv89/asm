import { describe, expect, it } from "vitest";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runCommand } from "./spawn";

// The child process is the running `node` binary rather than shell builtins
// (`echo`, `false`, `sh -c`, `pwd`): those either don't exist as standalone
// executables on Windows or need a shell, which would test the platform rather
// than `runCommand`'s contract. `process.execPath` exercises the same contract
// — stdout capture, stderr separation, exit codes, cwd — on every platform.
const node = process.execPath;

describe("runCommand", () => {
  it("captures stdout from a successful command", async () => {
    const { stdout, exitCode } = await runCommand([
      node,
      "-e",
      "console.log('hello')",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("hello");
  });

  it("returns non-zero exit code on failure", async () => {
    const { exitCode } = await runCommand([node, "-e", "process.exit(1)"]);
    expect(exitCode).not.toBe(0);
  });

  it("captures stderr separately from stdout", async () => {
    const { stdout, stderr, exitCode } = await runCommand([
      node,
      "-e",
      "console.log('out'); console.error('err')",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("out");
    expect(stderr.trim()).toBe("err");
  });

  it("respects the cwd option", async () => {
    // macOS resolves /tmp to /private/tmp and Windows returns the short 8.3
    // form for some temp paths, so compare resolved paths, not literals.
    const dir = await realpath(tmpdir());
    const { stdout, exitCode } = await runCommand(
      [node, "-e", "console.log(process.cwd())"],
      { cwd: dir },
    );
    expect(exitCode).toBe(0);
    expect(await realpath(stdout.trim())).toBe(dir);
  });

  it("rejects when argv is empty", async () => {
    await expect(runCommand([])).rejects.toThrow(/non-empty argv/);
  });

  it("surfaces missing binary (ENOENT) as exit code 127", async () => {
    // checkGhCli() and similar graceful-fallback callers rely on an exitCode
    // guard — they must not see a rejected promise when the binary is absent.
    const { exitCode } = await runCommand([
      "asm-nonexistent-binary-for-test-xyz-42",
      "--version",
    ]);
    expect(exitCode).toBe(127);
  });
});
