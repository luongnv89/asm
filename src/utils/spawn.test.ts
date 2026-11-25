import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  absolutePathEntries,
  absolutePathEnv,
  DEFAULT_PATH,
  NO_PROGRAM_PATH,
  runCommand,
} from "./spawn";

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

  it("passes the env option to the child", async () => {
    const { stdout, exitCode } = await runCommand(
      [node, "-e", "console.log(process.env.ASM_SPAWN_ENV_TEST ?? 'unset')"],
      { env: { ...process.env, ASM_SPAWN_ENV_TEST: "from-option" } },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("from-option");
  });

  it("inherits the parent's environment without an env option", async () => {
    process.env.ASM_SPAWN_ENV_TEST = "from-parent";
    try {
      const { stdout } = await runCommand([
        node,
        "-e",
        "console.log(process.env.ASM_SPAWN_ENV_TEST ?? 'unset')",
      ]);
      expect(stdout.trim()).toBe("from-parent");
    } finally {
      delete process.env.ASM_SPAWN_ENV_TEST;
    }
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

// Issue #894 — git and gh were started with the user's full PATH, so an
// empty, `.` or relative entry let git's filter lookup (git-lfs) or the spawn
// itself run a file shipped by the repo asm had just cloned into the cwd.
describe("absolutePathEnv (#894)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const abs = "/opt/asm894/bin";
  it.skipIf(process.platform === "win32").each([
    [".:<abs>", `.${delimiter}${abs}`],
    ["::<abs>", `${delimiter}${delimiter}${abs}`],
    ["<abs>:", `${abs}${delimiter}`],
    ["rel:<abs>", `rel${delimiter}${abs}`],
    ["../x:<abs>:~/bin", `../x${delimiter}${abs}${delimiter}~/bin`],
  ])("keeps only the absolute entries of PATH %s", (_label, path) => {
    expect(absolutePathEnv({ PATH: path }).PATH).toBe(abs);
    expect(absolutePathEntries(path)).toEqual([abs]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the order and the rest of the environment",
    () => {
      const env = absolutePathEnv({
        PATH: ["/b", ".", "/a"].join(delimiter),
        GIT_SSH_COMMAND: "ssh -i /k",
      });
      expect(env).toEqual({
        PATH: ["/b", "/a"].join(delimiter),
        GIT_SSH_COMMAND: "ssh -i /k",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses a directory that cannot exist when no entry is absolute",
    () => {
      // An empty PATH would be read as the cwd by node, sh, env and git.
      expect(absolutePathEnv({ PATH: `.${delimiter}bin` }).PATH).toBe(
        NO_PROGRAM_PATH,
      );
      expect(absolutePathEnv({ PATH: "" }).PATH).toBe(NO_PROGRAM_PATH);
    },
  );

  it.skipIf(process.platform === "win32")(
    "uses libuv's default search path when PATH is unset",
    () => {
      expect(absolutePathEnv({}).PATH).toBe(DEFAULT_PATH);
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not modify the environment it is given",
    () => {
      const base = { PATH: `.${delimiter}/usr/bin` };
      absolutePathEnv(base);
      expect(base.PATH).toBe(`.${delimiter}/usr/bin`);
    },
  );

  it("returns the environment unchanged on Windows", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const base = { PATH: `.${delimiter}C:\\bin` };
      expect(absolutePathEnv(base)).toBe(base);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("defaults to process.env", () => {
    vi.stubEnv("ASM_SPAWN_ENV_TEST", "default-base");
    expect(absolutePathEnv().ASM_SPAWN_ENV_TEST).toBe("default-base");
  });
});

describe.skipIf(process.platform === "win32" || !existsSync("/bin/sh"))(
  "runCommand child PATH (#894)",
  () => {
    let dir: string;
    afterEach(async () => {
      vi.unstubAllEnvs();
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    /** A cwd shipping an executable `name` that writes a marker. */
    async function cwdShipping(name: string): Promise<string> {
      dir = await realpath(await mkdtemp(join(tmpdir(), "asm-894-spawn-")));
      await writeFile(
        join(dir, name),
        `#!/bin/sh\necho EXECUTED > '${join(dir, "MARKER")}'\n`,
      );
      await chmod(join(dir, name), 0o755);
      return dir;
    }

    it("gives the child only the absolute PATH entries", async () => {
      vi.stubEnv("PATH", [".", "", "rel", "/usr/bin", "/bin"].join(delimiter));
      const { stdout } = await runCommand([
        node,
        "-e",
        "process.stdout.write(process.env.PATH)",
      ]);
      expect(stdout).toBe(["/usr/bin", "/bin"].join(delimiter));
    });

    it("filters the PATH of an env option too", async () => {
      const { stdout } = await runCommand(
        [node, "-e", "process.stdout.write(process.env.PATH)"],
        { env: { ...process.env, PATH: `.${delimiter}/bin` } },
      );
      expect(stdout).toBe("/bin");
    });

    it.each([["."], [""], [`.${delimiter}rel`]])(
      "never runs the cwd's program when PATH is %j (exit 127 instead)",
      async (path) => {
        const cwd = await cwdShipping("asm894-tool");
        vi.stubEnv("PATH", path);
        const { exitCode } = await runCommand(["asm894-tool"], { cwd });
        expect(exitCode).toBe(127);
        expect(existsSync(join(cwd, "MARKER"))).toBe(false);
      },
    );

    it("never runs a program the cwd ships through the child's own lookup", async () => {
      const cwd = await cwdShipping("asm894-tool");
      vi.stubEnv("PATH", [".", "/usr/bin", "/bin"].join(delimiter));
      const { exitCode } = await runCommand(["/bin/sh", "-c", "asm894-tool"], {
        cwd,
      });
      expect(exitCode).toBe(127);
      expect(existsSync(join(cwd, "MARKER"))).toBe(false);
      // Control: the same lookup with the unfiltered PATH does run it.
      await runCommand(["/bin/sh", "-c", "PATH=.:$PATH asm894-tool"], { cwd });
      expect(await readFile(join(cwd, "MARKER"), "utf-8")).toBe("EXECUTED\n");
    });
  },
);
