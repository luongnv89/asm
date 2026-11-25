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
  NO_HOOKS_GIT_PARAMETER,
  NO_PROGRAM_PATH,
  runCommand,
  untrustedRepoGitEnv,
} from "./spawn";
import { execFileSync } from "node:child_process";

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

// Issue #897 — a relative `core.hooksPath` in the user's git config resolves
// inside a clone asm makes, so git ran a hook the cloned repo ships.
describe("untrustedRepoGitEnv (#897)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds core.hooksPath=/dev/null when no git config is inherited", () => {
    const env = untrustedRepoGitEnv({
      PATH: "/usr/bin",
      GIT_SSH_COMMAND: "ssh -i /k",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      GIT_SSH_COMMAND: "ssh -i /k",
      GIT_CONFIG_PARAMETERS: NO_HOOKS_GIT_PARAMETER,
    });
  });

  it("appends to inherited -c config and leaves numbered pairs alone", () => {
    const base = {
      PATH: "/usr/bin",
      GIT_CONFIG_PARAMETERS: "'http.extraheader'='X: 1'",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "/usr/bin/helper",
    };
    const env = untrustedRepoGitEnv(base);
    expect(env).toEqual({
      ...base,
      GIT_CONFIG_PARAMETERS: `'http.extraheader'='X: 1' ${NO_HOOKS_GIT_PARAMETER}`,
    });
    // The input object is not modified.
    expect(base.GIT_CONFIG_PARAMETERS).toBe("'http.extraheader'='X: 1'");
  });

  it.skipIf(process.platform === "win32")(
    "keeps only the absolute PATH entries, as absolutePathEnv does",
    () => {
      expect(untrustedRepoGitEnv({ PATH: `.${delimiter}/usr/bin` }).PATH).toBe(
        "/usr/bin",
      );
    },
  );

  it("disables hooks on Windows too, where PATH is left alone", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const env = untrustedRepoGitEnv({ PATH: `.${delimiter}C:\\bin` });
      expect(env).toEqual({
        PATH: `.${delimiter}C:\\bin`,
        GIT_CONFIG_PARAMETERS: NO_HOOKS_GIT_PARAMETER,
      });
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("defaults to process.env", () => {
    vi.stubEnv("ASM_SPAWN_ENV_TEST", "default-base");
    expect(untrustedRepoGitEnv().ASM_SPAWN_ENV_TEST).toBe("default-base");
  });

  // git reads GIT_CONFIG_COUNT pairs, then GIT_CONFIG_PARAMETERS, and the
  // last value wins: the entry must beat a hooksPath set either way.
  it("wins over a core.hooksPath set by inherited env config, per real git", () => {
    const env = untrustedRepoGitEnv({
      ...process.env,
      GIT_CONFIG_PARAMETERS: "'core.hooksPath=.githooks'",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: ".githooks",
    });
    const read = (args: string[]) =>
      execFileSync("git", args, { env, encoding: "utf-8" }).trim();
    expect(read(["config", "--get", "core.hooksPath"])).toBe("/dev/null");
    // The other inherited entries still apply.
    expect(read(["config", "--get-all", "core.hooksPath"]).split("\n")).toEqual(
      [".githooks", ".githooks", "/dev/null"],
    );
  });
});
