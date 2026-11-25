import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { basename, delimiter, dirname, join, relative } from "path";
import {
  isPlaceholderEmail,
  isReservedEmailDomain,
  resolveLinter,
  runLinter,
  scorePII,
  scoreScriptLint,
} from "./evaluator-pii-lint";
import { evaluateSkill } from "./evaluator";

// Issue #663 — shellcheck --format=json1 emits its JSON report on stdout,
// but runLinter parsed result.stderr (runCommand keeps the streams separate,
// see src/utils/spawn.ts), so every linted shell script collapsed into the
// generic "Linter exited with code" fallback instead of structured findings.
// runCommand is stubbed so the stream the parser reads is asserted directly.

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("./utils/spawn", () => ({
  runCommand: runCommandMock,
}));

const SH_FILE = "/tmp/skill/deploy.sh";

type LintFindings = Exclude<
  Awaited<ReturnType<typeof runLinter>>,
  { skipped: string }
>;

/**
 * An absolute folder holding executable `shellcheck` and `python3` stand-ins,
 * made the whole PATH. runLinter spawns only a linter it resolves from an
 * absolute PATH entry (#890), so the runCommand-mocked tests need one there.
 */
async function fakeLinterPath(base: string): Promise<string> {
  const bin = join(base, "linters");
  await mkdir(bin, { recursive: true });
  for (const name of ["shellcheck", "python3"]) {
    await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n");
    await chmod(join(bin, name), 0o755);
  }
  vi.stubEnv("PATH", bin);
  return bin;
}

describe("runLinter", () => {
  let linters: string;
  let linterBase: string;

  beforeEach(async () => {
    runCommandMock.mockReset();
    linterBase = await mkdtemp(join(tmpdir(), "lint-890-bin-"));
    linters = await fakeLinterPath(linterBase);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(linterBase, { recursive: true, force: true });
  });

  it("extracts file/line/severity/message from shellcheck JSON on stdout", async () => {
    const payload = [
      {
        file: "deploy.sh",
        line: 12,
        endLine: 12,
        column: 5,
        endColumn: 9,
        level: "error",
        code: 2148,
        message: "Tips depend on target shell and yours is unknown.",
      },
      {
        file: "deploy.sh",
        line: 20,
        endLine: 20,
        column: 10,
        endColumn: 16,
        level: "warning",
        code: 2086,
        message: "Double quote to prevent globbing and word splitting.",
      },
      {
        file: "deploy.sh",
        line: 30,
        endLine: 30,
        column: 1,
        endColumn: 5,
        level: "info",
        code: 1091,
        message: "Not following: file not specified.",
      },
    ];
    // shellcheck --format=json1 wraps the comments array in an object:
    // {"comments": [...]} — a bare array is the legacy --format=json shape.
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({ comments: payload }),
      stderr: "",
    });

    const findings = await runLinter(SH_FILE, ".sh");

    // --norc: no .shellcheckrc can enable external sources (#825); never -x.
    expect(runCommandMock).toHaveBeenCalledWith([
      join(linters, "shellcheck"),
      "--norc",
      "--format=json1",
      SH_FILE,
    ]);
    expect(findings).toEqual([
      {
        file: SH_FILE,
        line: 12,
        severity: "error",
        message: "Tips depend on target shell and yours is unknown.",
      },
      {
        file: SH_FILE,
        line: 20,
        severity: "warning",
        message: "Double quote to prevent globbing and word splitting.",
      },
      {
        file: SH_FILE,
        line: 30,
        severity: "info",
        message: "Not following: file not specified.",
      },
    ]);
  });

  it("maps short level codes the same as full names", async () => {
    const payload = [
      { line: 1, level: "e", message: "err" },
      { line: 2, level: "w", message: "warn" },
      { line: 3, level: "style", message: "style note" },
    ];
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({ comments: payload }),
      stderr: "",
    });

    const findings = (await runLinter(SH_FILE, ".sh")) as LintFindings;

    expect(findings.map((f) => f.severity)).toEqual([
      "error",
      "warning",
      "info",
    ]);
  });

  it("falls back to a single warning finding when stdout is not JSON", async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 2,
      stdout: "not json",
      stderr: "",
    });

    const findings = (await runLinter(SH_FILE, ".sh")) as LintFindings;

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toMatch(/Linter exited with code 2/);
    expect(findings[0].message).toContain("not json");
  });

  it("returns no findings when the linter exits cleanly", async () => {
    runCommandMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    expect(await runLinter(SH_FILE, ".sh")).toEqual([]);
  });

  // Issue #884 — runCommand resolves a missing binary as exit 127 with
  // stderr "spawn <cmd> ENOENT"; it never rejects with ENOENT.
  it("skips when runCommand reports the linter as not installed", async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 127,
      stdout: "",
      stderr: "spawn shellcheck ENOENT",
    });

    expect(await runLinter(SH_FILE, ".sh")).toEqual({
      skipped: "shellcheck is not installed",
    });
  });

  it.each([
    [".sh", "a bad flag", 3, "", "shellcheck: unrecognized option `--bogus'"],
    [".sh", "a crash", 2, "", "shellcheck: internal error"],
    [".sh", "a signal kill", -1, "", ""],
    [".py", "a bad flag", 2, "", "unknown option -I"],
    [".py", "a signal kill", -1, "", ""],
  ])(
    "still reports a %s linter that is installed but exits non-zero for %s",
    async (ext, _label, exitCode, stdout, stderr) => {
      const file = `/tmp/skill/script${ext}`;
      runCommandMock.mockResolvedValue({ exitCode, stdout, stderr });

      const findings = await runLinter(file, ext);

      expect(findings).toEqual([
        {
          file,
          line: 0,
          severity: "warning",
          message: `Linter exited with code ${exitCode}: ${stderr}`,
        },
      ]);
    },
  );

  it("skips when the linter cannot be spawned (ENOENT)", async () => {
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("spawn shellcheck ENOENT"), { code: "ENOENT" }),
    );

    expect(await runLinter(SH_FILE, ".sh")).toEqual({
      skipped: "shellcheck is not installed",
    });
  });

  // Issue #884 re-review — libuv's PATH search rejects with EACCES, not
  // ENOENT, when the linter is absent and some PATH entry is unsearchable
  // (Docker `USER nonroot` with /root/.local/bin on PATH). runLinter looks
  // the command up on PATH itself before it reports a spawn failure.
  describe("a spawn rejection other than ENOENT (#884)", () => {
    let base: string;
    let bin: string;

    beforeEach(async () => {
      base = await mkdtemp(join(tmpdir(), "lint-884-path-"));
      bin = join(base, "bin");
      await mkdir(bin);
      // An entry that is not a directory and one that does not exist: both
      // are ignored by the lookup.
      await writeFile(join(base, "file"), "");
      vi.stubEnv(
        "PATH",
        [join(base, "file"), join(base, "missing"), bin].join(delimiter),
      );
    });

    afterEach(async () => {
      await rm(base, { recursive: true, force: true });
    });

    function reject(code: string): void {
      runCommandMock.mockRejectedValue(
        Object.assign(new Error(`spawn shellcheck ${code}`), { code }),
      );
    }

    it.each(["EACCES", "EPERM", "ENOEXEC", "EMFILE"])(
      "skips as not installed on %s when PATH has no shellcheck",
      async (code) => {
        reject(code);

        expect(await runLinter(SH_FILE, ".sh")).toEqual({
          skipped: "shellcheck is not installed",
        });
      },
    );

    it("ignores a directory of that name on PATH", async () => {
      await mkdir(join(bin, "shellcheck"));
      reject("EACCES");

      expect(await runLinter(SH_FILE, ".sh")).toEqual({
        skipped: "shellcheck is not installed",
      });
    });

    it.each(["EACCES", "EPERM", "ENOEXEC"])(
      "reports %s when a shellcheck file is on PATH but cannot be run",
      async (code) => {
        await writeFile(join(bin, "shellcheck"), "not a program");
        await chmod(join(bin, "shellcheck"), 0o644);
        reject(code);

        expect(await runLinter(SH_FILE, ".sh")).toEqual([
          {
            file: SH_FILE,
            line: 0,
            severity: "warning",
            message: `Linter could not be run: ${code}`,
          },
        ]);
      },
    );

    it.each(["EMFILE", "ENFILE", "EAGAIN", "ENOMEM", "ERR_MODULE_NOT_FOUND"])(
      "skips without a deduction on %s when shellcheck is on PATH",
      async (code) => {
        await writeFile(join(bin, "shellcheck"), "");
        reject(code);

        expect(await runLinter(SH_FILE, ".sh")).toEqual({
          skipped: `could not start shellcheck: ${code}`,
        });
      },
    );

    it("skips a throw that carries no errno code", async () => {
      await writeFile(join(bin, "shellcheck"), "");
      runCommandMock.mockRejectedValue("boom");

      expect(await runLinter(SH_FILE, ".sh")).toEqual({
        skipped: "could not start shellcheck: boom",
      });
    });

    it("clips a long non-errno message by code point", async () => {
      await writeFile(join(bin, "shellcheck"), "");
      runCommandMock.mockRejectedValue(new Error("x" + "😀".repeat(300)));

      const result = (await runLinter(SH_FILE, ".sh")) as { skipped: string };
      const text = result.skipped.replace("could not start shellcheck: ", "");

      expect(Array.from(text)).toHaveLength(200);
      expect(text).toBe("Error: x" + "😀".repeat(192));
    });
  });

  it("clips the exited-with-code text by code point, never mid-pair", async () => {
    // "a" puts every emoji at an odd UTF-16 offset, so a 200-unit slice
    // would end on a lone high surrogate.
    runCommandMock.mockResolvedValue({
      exitCode: 2,
      stdout: "",
      stderr: "a" + "😀".repeat(300),
    });

    const findings = (await runLinter(SH_FILE, ".sh")) as LintFindings;

    expect(findings[0].message).toBe(
      "Linter exited with code 2: a" + "😀".repeat(199),
    );
    expect(findings[0].message).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });

  it("skips extensions without a configured linter", async () => {
    expect(await runLinter("/tmp/skill/app.js", ".js")).toEqual({
      skipped: "no linter for .js",
    });
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("still parses Python compile errors from stderr", async () => {
    const pyFile = "/tmp/skill/broken.py";
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: `  File "${pyFile}", line 3\n    def broken(\n             ^\nSyntaxError: invalid syntax\n`,
    });

    const findings = await runLinter(pyFile, ".py");

    // Issue #823 — an in-memory compile, not `-m py_compile` (which writes
    // __pycache__ next to the source).
    expect(runCommandMock).toHaveBeenCalledWith([
      join(linters, "python3"),
      "-I",
      "-B",
      "-c",
      expect.stringContaining("source_to_code"),
      pyFile,
    ]);
    expect(findings).toEqual([
      {
        file: pyFile,
        line: 3,
        severity: "error",
        message: "SyntaxError: invalid syntax",
      },
    ]);
  });
});

// Issue #884 — a missing shellcheck cost each .sh file a point ("Linter
// exited with code 127: spawn shellcheck ENOENT"), so a clean skill scored
// differently depending on whether the host had shellcheck installed.

describe("scoreScriptLint without shellcheck installed (#884)", () => {
  let base: string;

  async function writeShSkill(
    dir: string,
    script = "wait.sh",
    body = "#!/bin/bash\necho hi\n",
  ): Promise<void> {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: p4\ndescription: "Use when testing."\nlicense: MIT\n---\n\n# P4\n\n1. Run \`scripts/${script}\`.\n`,
    );
    await writeFile(join(dir, "scripts", script), body);
  }

  let linters: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "lint-884-"));
    runCommandMock.mockReset();
    linters = await fakeLinterPath(base);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  it.each([
    ["wait.sh", "#!/bin/bash\necho hi\n", "shellcheck", "bash/shell"],
    ["ok.py", 'print("hi")\n', "python3", "python"],
  ])(
    "scores a clean %s skill 10 and says the lint was skipped",
    async (script, body, linter, lang) => {
      const dir = join(base, "p4");
      await writeShSkill(dir, script, body);
      runCommandMock.mockResolvedValue({
        exitCode: 127,
        stdout: "",
        stderr: `spawn ${linter} ENOENT`,
      });

      const result = await scoreScriptLint(dir);

      expect(runCommandMock.mock.calls[0][0][0]).toBe(join(linters, linter));
      expect(result.score).toBe(10);
      expect(result.findings).toEqual([
        `[${lang}] scripts/${script}: lint skipped — ${linter} is not installed`,
        "No script was linted: no linter is installed for these scripts.",
      ]);
      expect(result.findings.join("\n")).not.toMatch(/WARNING|code 127/);
    },
  );

  it("skips through the real runCommand when PATH has no shellcheck", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    const emptyBin = join(base, "empty-bin");
    await mkdir(emptyBin);
    vi.stubEnv("PATH", emptyBin);
    const { runCommand } =
      await vi.importActual<typeof import("./utils/spawn")>("./utils/spawn");
    runCommandMock.mockImplementation(
      (argv: string[], opts?: { cwd?: string }) => runCommand(argv, opts),
    );

    const result = await scoreScriptLint(dir);

    // Not resolved on PATH (#890): skipped before anything is spawned.
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(result.score).toBe(10);
    expect(result.findings[0]).toBe(
      "[bash/shell] scripts/wait.sh: lint skipped — shellcheck is not installed",
    );
  });

  it("still deducts for real shellcheck warnings and errors", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    runCommandMock.mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({
        comments: [
          { line: 2, level: "warning", message: "Double quote this." },
          { line: 3, level: "error", message: "Broken syntax." },
        ],
      }),
      stderr: "",
    });

    const result = await scoreScriptLint(dir);

    expect(result.score).toBe(6);
    expect(result.findings).toContain(
      "[WARNING] scripts/wait.sh:2 — Double quote this.",
    );
    expect(result.findings).toContain(
      "[ERROR] scripts/wait.sh:3 — Broken syntax.",
    );
  });

  it("still deducts when an installed linter exits non-zero for another reason", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    runCommandMock.mockResolvedValue({
      exitCode: 3,
      stdout: "",
      stderr: "shellcheck: unrecognized option",
    });

    const result = await scoreScriptLint(dir);

    expect(result.score).toBe(9);
    expect(result.findings).toContain(
      "[WARNING] scripts/wait.sh:* — Linter exited with code 3: shellcheck: unrecognized option",
    );
  });

  it("skips without a deduction when the linter could not be started", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    const bin = join(base, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "shellcheck"), "");
    vi.stubEnv("PATH", bin);
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("spawn shellcheck EMFILE"), { code: "EMFILE" }),
    );

    const result = await scoreScriptLint(dir);

    expect(result.score).toBe(10);
    expect(result.findings).toEqual([
      "[bash/shell] scripts/wait.sh: lint skipped — could not start shellcheck: EMFILE",
      "No script was linted: see the skipped scripts above.",
    ]);
  });

  // libuv reported EACCES here (#884); the lookup is now asm's own (#890),
  // so the unsearchable entry is passed over and nothing is spawned.
  it("skips as not installed when only an unsearchable PATH entry precedes", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    const locked = join(base, "locked");
    await mkdir(locked);
    await chmod(locked, 0o000);
    vi.stubEnv("PATH", [locked, join(base, "empty-bin")].join(delimiter));

    const result = await scoreScriptLint(dir).finally(() =>
      chmod(locked, 0o700),
    );

    expect(runCommandMock).not.toHaveBeenCalled();
    expect(result.score).toBe(10);
    expect(result.findings).toEqual([
      "[bash/shell] scripts/wait.sh: lint skipped — shellcheck is not installed",
      "No script was linted: no linter is installed for these scripts.",
    ]);
  });

  it("keeps the summary truthful when skip reasons are mixed", async () => {
    const dir = join(base, "p4");
    await writeShSkill(dir);
    await writeFile(join(dir, "scripts", "ok.py"), 'print("hi")\n');
    runCommandMock.mockImplementation(async (argv: string[]) => {
      if (basename(argv[0]) === "python3")
        return { exitCode: 127, stdout: "", stderr: "spawn python3 ENOENT" };
      throw Object.assign(new Error("spawn shellcheck EMFILE"), {
        code: "EMFILE",
      });
    });
    const bin = join(base, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "shellcheck"), "");
    await writeFile(join(bin, "python3"), "");
    vi.stubEnv("PATH", bin);

    const result = await scoreScriptLint(dir);

    expect(result.score).toBe(10);
    expect(result.findings).toContain(
      "[bash/shell] scripts/wait.sh: lint skipped — could not start shellcheck: EMFILE",
    );
    expect(result.findings).toContain(
      "[python] scripts/ok.py: lint skipped — python3 is not installed",
    );
    expect(result.findings.at(-1)).toBe(
      "No script was linted: see the skipped scripts above.",
    );
  });

  it("leaves a skill with no scripts at 10 without running a linter", async () => {
    const dir = join(base, "noscripts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: n\n---\n# N\n");

    const result = await scoreScriptLint(dir);

    expect(runCommandMock).not.toHaveBeenCalled();
    expect(result.score).toBe(10);
    expect(result.findings).toEqual(["No bundled scripts found to lint."]);
  });
});

// Issue #890 — the linters were spawned by bare name, so a PATH with an
// empty, `.` or relative entry made `asm eval` run a `shellcheck` or
// `python3` the evaluated skill ships when the cwd was the skill folder.
// runLinter now spawns only a linter resolved from an absolute PATH entry.

describe.skipIf(process.platform === "win32")(
  "linter lookup ignores cwd-relative PATH entries (#890)",
  () => {
    let base: string;
    let skill: string;
    let abs: string;
    let prevCwd: string;

    /** An executable that leaves `marker` behind and prints `out`. */
    async function writeTrap(
      path: string,
      marker: string,
      out: string,
      exitCode = 0,
    ): Promise<void> {
      await writeFile(
        path,
        `#!/bin/sh\necho EXECUTED > '${marker}'\nprintf '%s' '${out}'\nexit ${exitCode}\n`,
      );
      await chmod(path, 0o755);
    }

    beforeEach(async () => {
      base = await mkdtemp(join(tmpdir(), "lint-890-"));
      skill = join(base, "skill");
      abs = join(base, "abs-bin");
      await mkdir(join(skill, "scripts"), { recursive: true });
      await mkdir(join(skill, "bin"));
      await mkdir(abs);
      await writeFile(
        join(skill, "SKILL.md"),
        '---\nname: cwdlint\ndescription: "Run a deploy check when the user asks."\n---\n# cwdlint\n',
      );
      await writeFile(join(skill, "scripts", "a.sh"), "#!/bin/bash\necho hi\n");
      await writeFile(join(skill, "scripts", "a.py"), 'print("hi")\n');
      // The skill ships both linters at its root and under bin/.
      for (const dir of [skill, join(skill, "bin")]) {
        await writeTrap(join(dir, "shellcheck"), join(base, "MARKER"), "[]");
        await writeTrap(join(dir, "python3"), join(base, "MARKER"), "");
      }
      prevCwd = process.cwd();
      process.chdir(skill);
      runCommandMock.mockReset();
      const { runCommand } =
        await vi.importActual<typeof import("./utils/spawn")>("./utils/spawn");
      runCommandMock.mockImplementation(
        (argv: string[], opts?: { cwd?: string }) => runCommand(argv, opts),
      );
    });

    afterEach(async () => {
      process.chdir(prevCwd);
      vi.unstubAllEnvs();
      await rm(base, { recursive: true, force: true });
    });

    async function markerWritten(): Promise<boolean> {
      return (await readdir(base)).includes("MARKER");
    }

    const forms: [string, (a: string) => string][] = [
      [".:<abs>", (a) => [".", a].join(delimiter)],
      ["::<abs>", (a) => ["", "", a].join(delimiter)],
      ["<abs>:", (a) => [a, ""].join(delimiter)],
      ["bin:<abs>", (a) => ["bin", a].join(delimiter)],
    ];

    it.each(forms)(
      "never runs the skill's shellcheck or python3 with PATH %s",
      async (_form, pathOf) => {
        vi.stubEnv("PATH", pathOf(abs));

        const result = await scoreScriptLint(skill);

        expect(await markerWritten()).toBe(false);
        expect(runCommandMock).not.toHaveBeenCalled();
        expect(result.score).toBe(10);
        expect(result.findings).toEqual([
          "[python] scripts/a.py: lint skipped — python3 is not installed",
          "[bash/shell] scripts/a.sh: lint skipped — shellcheck is not installed",
          "No script was linted: no linter is installed for these scripts.",
        ]);
      },
    );

    it.each(forms)(
      "lints with the linters in the absolute entry under PATH %s",
      async (_form, pathOf) => {
        const used = join(base, "ABS-USED");
        await writeTrap(
          join(abs, "shellcheck"),
          used,
          JSON.stringify({
            comments: [{ line: 2, level: "warning", message: "Quote this." }],
          }),
          1,
        );
        await writeTrap(join(abs, "python3"), used, "");
        vi.stubEnv("PATH", pathOf(abs));

        const result = await scoreScriptLint(skill);

        expect(await markerWritten()).toBe(false);
        expect(runCommandMock.mock.calls.map((c) => c[0][0]).sort()).toEqual([
          join(abs, "python3"),
          join(abs, "shellcheck"),
        ]);
        expect(result.score).toBe(9);
        expect(result.findings).toContain(
          "[WARNING] scripts/a.sh:2 — Quote this.",
        );
      },
    );

    it("runs the linter outside the skill folder", async () => {
      const cwdFile = join(base, "LINTER-CWD");
      await writeFile(
        join(abs, "shellcheck"),
        `#!/bin/sh\npwd > '${cwdFile}'\necho '[]'\n`,
      );
      await chmod(join(abs, "shellcheck"), 0o755);
      vi.stubEnv("PATH", [".", abs, "/usr/bin", "/bin"].join(delimiter));

      await scoreScriptLint(skill);

      const { readFile, realpath } = await import("fs/promises");
      const linterCwd = (await readFile(cwdFile, "utf8")).trim();
      expect(relative(await realpath(skill), linterCwd)).toMatch(/^\.\./);
      expect(basename(linterCwd)).toMatch(/^asm-lint-/);
    });

    // A linter that is a script finding its interpreter on PATH (`env bash`,
    // pyenv/asdf shims) must not pick up one the skill ships.
    it.skipIf(!existsSync("/usr/bin/env"))(
      "never runs a program the skill ships through the linter's own PATH lookup",
      async () => {
        await writeTrap(join(skill, "asm890-interp"), join(base, "MARKER"), "");
        await writeFile(
          join(abs, "shellcheck"),
          "#!/usr/bin/env asm890-interp\n",
        );
        await chmod(join(abs, "shellcheck"), 0o755);
        vi.stubEnv("PATH", [".", abs, "/usr/bin", "/bin"].join(delimiter));

        await scoreScriptLint(skill);

        expect(runCommandMock.mock.calls.map((c) => c[0][0])).toContain(
          join(abs, "shellcheck"),
        );
        expect(await markerWritten()).toBe(false);
      },
    );

    it("still lints when TMPDIR is a relative path", async () => {
      // The fake opens its file argument the way a real linter does.
      await writeFile(
        join(abs, "shellcheck"),
        `#!/bin/sh\ntest -f "$3" || { echo "no such file: $3" >&2; exit 9; }\necho '[]'\n`,
      );
      await chmod(join(abs, "shellcheck"), 0o755);
      await mkdir(join(base, "rel-tmp"));
      process.chdir(base);
      vi.stubEnv("TMPDIR", "rel-tmp");
      vi.stubEnv("PATH", abs);

      const result = await scoreScriptLint(skill);

      expect(result.score).toBe(10);
      expect(result.findings).toContain(
        "Linted 1 script(s) — no issues found.",
      );
    });

    it("resolves each linter once per run", async () => {
      await writeFile(join(skill, "scripts", "b.sh"), "#!/bin/bash\necho b\n");
      await writeTrap(join(abs, "shellcheck"), join(base, "ABS-USED"), "[]");
      vi.stubEnv("PATH", abs);

      const result = await scoreScriptLint(skill);

      expect(runCommandMock.mock.calls.map((c) => c[0][0])).toEqual([
        join(abs, "shellcheck"),
        join(abs, "shellcheck"),
      ]);
      expect(result.findings).toContain(
        "[python] scripts/a.py: lint skipped — python3 is not installed",
      );
    });

    it("still finds a linter behind an unsearchable PATH entry", async () => {
      const locked = join(base, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      await writeTrap(join(abs, "shellcheck"), join(base, "ABS-USED"), "[]");
      vi.stubEnv("PATH", [locked, ".", abs].join(delimiter));

      try {
        expect(await resolveLinter("shellcheck")).toBe(join(abs, "shellcheck"));
      } finally {
        await chmod(locked, 0o700);
      }
    });

    it("prefers the first executable file, like execvp", async () => {
      const first = join(base, "first");
      await mkdir(first);
      await writeFile(join(first, "shellcheck"), "not a program");
      await chmod(join(first, "shellcheck"), 0o644);
      await writeTrap(join(abs, "shellcheck"), join(base, "ABS-USED"), "[]");
      vi.stubEnv("PATH", [first, abs].join(delimiter));

      expect(await resolveLinter("shellcheck")).toBe(join(abs, "shellcheck"));
    });

    it("falls back to a non-executable file so the spawn reports EACCES", async () => {
      await writeFile(join(abs, "shellcheck"), "not a program");
      await chmod(join(abs, "shellcheck"), 0o644);
      vi.stubEnv("PATH", [".", abs].join(delimiter));

      expect(await resolveLinter("shellcheck")).toBe(join(abs, "shellcheck"));
      const findings = await runLinter(join(skill, "scripts", "a.sh"), ".sh");
      expect(findings).toEqual([
        {
          file: join(skill, "scripts", "a.sh"),
          line: 0,
          severity: "warning",
          message: "Linter could not be run: EACCES",
        },
      ]);
      expect(await markerWritten()).toBe(false);
    });

    it("ignores a directory named like the linter", async () => {
      await mkdir(join(abs, "shellcheck"));
      vi.stubEnv("PATH", abs);

      expect(await resolveLinter("shellcheck")).toBeNull();
    });

    it("searches /usr/bin:/bin when PATH is unset, as libuv does", async () => {
      vi.stubEnv("PATH", undefined);

      expect(["/usr/bin/sh", "/bin/sh"]).toContain(await resolveLinter("sh"));
    });
  },
);

// Issue #823 — `python3 -m py_compile` wrote __pycache__/<name>.cpython-*.pyc
// into the evaluated skill's folder (PYTHONDONTWRITEBYTECODE does not stop
// it). These tests run the real interpreter through the real runCommand.

const HAS_PYTHON =
  spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;

type Snapshot = Record<string, { type: string; size: number; mtimeMs: number }>;

async function snapshotTree(root: string): Promise<Snapshot> {
  const out: Snapshot = {};
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      const full = join(dir, entry);
      const s = await lstat(full);
      out[relative(root, full)] = {
        type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other",
        size: s.isDirectory() ? 0 : s.size,
        mtimeMs: s.mtimeMs,
      };
      if (s.isDirectory()) await walk(full);
    }
  }
  const rootStat = await lstat(root);
  out["."] = { type: "dir", size: 0, mtimeMs: rootStat.mtimeMs };
  await walk(root);
  return out;
}

// Broken and clean sources covering each stderr shape py_compile prints:
// a located SyntaxError, the "Sorry: <Error>: …" form for SyntaxError
// subclasses, an unlocated SyntaxError, an encoding error, a warning on a
// clean compile, and a clean file.
const PY_SOURCES: Record<string, string> = {
  "unclosed.py": "def broken(\n    # Missing closing paren\n",
  "indent.py": "def f():\nreturn 1\n",
  "tabs.py": "if 1:\n\tx = 1\n        y = 2\n",
  "nul.py": "x = 1\0\n",
  "coding.py": "# -*- coding: bogus -*-\nx = 1\n",
  "outside.py": "return 5\n",
  "warn.py": 'x = "\\d"\n',
  "ok.py": "print('hi')\n",
};

async function writePySkill(dir: string, name: string): Promise<void> {
  await mkdir(join(dir, "scripts"), { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: "Use when testing. Prints hi."\nlicense: MIT\n---\n\n# ${name}\n\nRun \`python3 scripts/ok.py\`.\n`,
  );
  for (const [file, src] of Object.entries(PY_SOURCES)) {
    await writeFile(join(dir, "scripts", file), src);
  }
}

describe.skipIf(!HAS_PYTHON)(
  "Python syntax lint leaves the skill folder unchanged (#823)",
  () => {
    let base: string;
    let realRunCommand: typeof import("./utils/spawn").runCommand;

    beforeEach(async () => {
      base = await mkdtemp(join(tmpdir(), "lint-823-"));
      realRunCommand = (
        await vi.importActual<typeof import("./utils/spawn")>("./utils/spawn")
      ).runCommand;
      runCommandMock.mockReset();
      runCommandMock.mockImplementation((argv: string[]) =>
        realRunCommand(argv),
      );
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await chmod(base, 0o755).catch(() => {});
      for (const entry of await readdir(base, { recursive: true })) {
        await chmod(join(base, entry), 0o755).catch(() => {});
      }
      await rm(base, { recursive: true, force: true });
    });

    it.each([
      ["without PYTHONDONTWRITEBYTECODE", undefined],
      ["with PYTHONDONTWRITEBYTECODE=1", "1"],
    ])(
      "asm eval writes nothing into the skill dir (%s)",
      async (_label, dontWrite) => {
        if (dontWrite === undefined) {
          vi.stubEnv("PYTHONDONTWRITEBYTECODE", undefined);
        } else {
          vi.stubEnv("PYTHONDONTWRITEBYTECODE", dontWrite);
        }
        const dir = join(base, "s1");
        await writePySkill(dir, "s1");
        const before = await snapshotTree(dir);

        const report = await evaluateSkill(dir);

        expect(await snapshotTree(dir)).toEqual(before);
        const lint = report.categories.find((c) => c.id === "script-lint")!;
        expect(lint.findings.join("\n")).not.toMatch(/skipped/);
        expect(runCommandMock).toHaveBeenCalled();
      },
    );

    it("reports the same findings and score as `python3 -m py_compile`", async () => {
      const legacyDir = join(base, "legacy", "s1");
      const currentDir = join(base, "current", "s1");
      await writePySkill(legacyDir, "s1");
      await writePySkill(currentDir, "s1");

      // Legacy: the pre-#823 command line, run on its own copy of the skill.
      // `-E` keeps the shell's PYTHON* vars (PYTHONWARNINGS, PYTHONPATH, …)
      // out of it, as `-I` does for the current command, so the comparison
      // does not depend on the developer's environment.
      // The linter is handed a private copy of each script (#831), named as
      // the script; map it back to the script it copies.
      const asScript = (file: string) => join("scripts", basename(file));
      const legacyRuns: Record<string, unknown> = {};
      runCommandMock.mockImplementation(async (argv: string[]) => {
        const file = argv[argv.length - 1];
        const result = await realRunCommand([
          "python3",
          "-E",
          "-m",
          "py_compile",
          file,
        ]);
        legacyRuns[asScript(file)] = {
          exitCode: result.exitCode,
          stderr: result.stderr.split(dirname(file)).join("<skill>/scripts"),
        };
        return result;
      });
      const legacy = await scoreScriptLint(legacyDir);

      const currentRuns: Record<string, unknown> = {};
      runCommandMock.mockImplementation(async (argv: string[]) => {
        const file = argv[argv.length - 1];
        const result = await realRunCommand(argv);
        currentRuns[asScript(file)] = {
          exitCode: result.exitCode,
          stderr: result.stderr.split(dirname(file)).join("<skill>/scripts"),
        };
        return result;
      });
      const current = await scoreScriptLint(currentDir);

      expect(Object.keys(currentRuns).sort()).toEqual(
        Object.keys(PY_SOURCES)
          .map((f) => join("scripts", f))
          .sort(),
      );
      expect(currentRuns).toEqual(legacyRuns);
      expect(current).toEqual(legacy);
      // The broken file still yields its located finding and costs score.
      expect(current.findings).toContain(
        "[ERROR] scripts/unclosed.py:1 — SyntaxError: '(' was never closed",
      );
      expect(current.score).toBeLessThan(10);
    });

    it("scores a read-only skill the same as a writable copy", async () => {
      const writable = join(base, "rw", "s1");
      const readOnly = join(base, "ro", "s1");
      await writePySkill(writable, "s1");
      await writePySkill(readOnly, "s1");
      for (const entry of await readdir(readOnly, { recursive: true })) {
        await chmod(join(readOnly, entry), 0o555);
      }
      await chmod(readOnly, 0o555);
      const before = await snapshotTree(readOnly);

      const rw = await evaluateSkill(writable);
      const ro = await evaluateSkill(readOnly);

      expect(await snapshotTree(readOnly)).toEqual(before);
      expect(ro.overallScore).toBe(rw.overallScore);
      expect(ro.categories).toEqual(rw.categories);
    });
  },
);

// Issue #772 — addresses on domains reserved for documentation and testing
// (RFC 2606 / RFC 6761) are placeholders, not PII, so the email check must
// ignore them while still flagging real-looking addresses and look-alikes.

const IGNORED_EMAILS = [
  "email@example.com",
  "Your Name <you@EXAMPLE.org>",
  "ops@example.net",
  "dev@mail.example.com",
  "a@b.example",
  "x@foo.test",
  "nobody@host.invalid",
  "svc@app.localhost",
  // Never matched by the email regex (it needs a dotted TLD), so this case
  // passes with or without the placeholder filter; bare `localhost` is
  // covered by the isPlaceholderEmail assertion only.
  "dev@localhost",
];

const FLAGGED_EMAILS = [
  "jane.doe@acme-corp.io",
  "user@example.com.evil.io",
  "user@notexample.com",
  "user@example.co",
  "luongnv89@gmail.com",
  "admin@test.com",
  // A non-ASCII letter, combining mark or digit ends the ASCII-only match
  // early (`contact@team.test`, `user@example.com`); a match followed
  // directly by one of those is not exempted as a placeholder.
  "contact@team.testé.fr",
  "user@example.comévil.io",
  // Decomposed accent: U+0301 COMBINING ACUTE ACCENT (\p{M}) after `example`.
  "contact@team.example\u0301.fr",
  // Non-BMP letter: U+1D49C MATHEMATICAL SCRIPT CAPITAL A, a surrogate pair.
  "user@example.com\u{1D49C}",
];

describe("isReservedEmailDomain", () => {
  it.each([
    "example.com",
    "EXAMPLE.ORG",
    "example.net",
    "sub.example.com",
    "b.example",
    "foo.test",
    "host.invalid",
    "app.localhost",
    "localhost",
    "example.com.",
  ])("treats %s as reserved", (domain) => {
    expect(isReservedEmailDomain(domain)).toBe(true);
  });

  it.each([
    "acme-corp.io",
    "example.com.evil.io",
    "notexample.com",
    "example.co",
    "gmail.com",
    "test.com",
    "example.community",
    "localhost.com",
    "mytest",
  ])("does not treat %s as reserved", (domain) => {
    expect(isReservedEmailDomain(domain)).toBe(false);
  });

  it("isPlaceholderEmail checks the domain after the last @", () => {
    expect(isPlaceholderEmail("user@example.com")).toBe(true);
    expect(isPlaceholderEmail("dev@localhost")).toBe(true);
    expect(isPlaceholderEmail("user@example.com.evil.io")).toBe(false);
    expect(isPlaceholderEmail("no-at-sign")).toBe(false);
  });
});

describe("scorePII reserved email domains (#772)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pii-772-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(body: string, extra?: [string, string]) {
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: pii-772\ndescription: Test skill.\n---\n# Test\n\n${body}\n`,
    );
    if (extra) await writeFile(join(dir, extra[0]), extra[1]);
  }

  it.each(IGNORED_EMAILS)("ignores %s", async (email) => {
    await writeSkill(`Contact: ${email}`);
    const pii = await scorePII(dir);
    expect(pii.score).toBe(10);
    expect(pii.findings).toEqual(["No PII detected in skill files."]);
  });

  it.each(FLAGGED_EMAILS)("still flags %s", async (email) => {
    await writeSkill(`Contact: ${email}`);
    const pii = await scorePII(dir);
    expect(pii.score).toBe(8);
    expect(pii.findings).toContain("[email] SKILL.md:7 — found 1 match(es)");
  });

  it("ignores the skill-creator scaffold placeholder in a script", async () => {
    await writeSkill("Clean body.", [
      "init_skill.py",
      'TEMPLATE = """\n  author: [TODO: Your Name <email@example.com>]\n"""\n',
    ]);
    const pii = await scorePII(dir);
    expect(pii.score).toBe(10);
  });

  it("counts only real addresses on a line that mixes both", async () => {
    await writeSkill(
      "Write to you@example.com or jane.doe@acme-corp.io or dev@foo.test",
    );
    const pii = await scorePII(dir);
    expect(pii.score).toBe(8);
    expect(pii.findings).toContain("[email] SKILL.md:7 — found 1 match(es)");
  });
});

// Issue #841 — a versioned file name or package spec (`web@0.4.1.js`,
// `lib@3.7.1.min.js`) has the `local@domain.tld` shape, so the email regex
// matched it and a skill pinning a CDN file lost 2 pii points. Specs without
// an alphabetic tail (`pkg@1.2.3`, `pkg@latest`, `/name@0/`) never matched
// the regex; they are listed so both shapes stay covered.

const VERSION_SPECS = [
  "web@0.4.1.js",
  "https://ui-sdk.dev/web@0.4.1.js",
  "name@1.2.3.js",
  "name@0.js",
  "lib@3.7.1.min.js",
  "pkg@1.2.3-beta.rc",
  "styles@2.0.css",
  "/name@0/",
  "https://cdn.example.dev/npm/web@0/dist/web.js",
  "pkg@1.2.3",
  "@scope/pkg@1.2.3",
  "pkg@^1.2",
  "pkg@latest",
  "react@19.0.0",
];

const REAL_EMAILS = [
  "jane.doe@acme-corp.io",
  "a+b@sub.example.co.uk",
  "[Mail me](mailto:jane.doe@acme-corp.io)",
  "<jane.doe@acme-corp.io>",
  // Digit-led domains are real mail providers, not versions.
  "user@163.com",
  "user@126.net",
  "ops@1and1.com",
];

describe("scorePII versioned file names and package specs (#841)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pii-841-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(body: string) {
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: pii-841\ndescription: Test skill.\n---\n# Test\n\n${body}\n`,
    );
  }

  it.each(VERSION_SPECS)("does not report %s as an email", async (spec) => {
    await writeSkill(`Load \`${spec}\` before rendering.`);
    const pii = await scorePII(dir);
    expect(pii.score).toBe(10);
    expect(pii.findings).toEqual(["No PII detected in skill files."]);
  });

  it("scores the issue's reproduction line as clean", async () => {
    await writeSkill(
      "Load `https://ui-sdk.dev/web@0.4.1.js` and pin `react@19.0.0`.",
    );
    const pii = await scorePII(dir);
    expect(pii.score).toBe(10);
    expect(pii.findings).toEqual(["No PII detected in skill files."]);
  });

  it.each(REAL_EMAILS)("still reports %s as an email", async (email) => {
    await writeSkill(`Contact: ${email}`);
    const pii = await scorePII(dir);
    expect(pii.score).toBe(8);
    expect(pii.findings).toContain("[email] SKILL.md:7 — found 1 match(es)");
  });

  it("counts only the real address on a line that mixes both", async () => {
    await writeSkill(
      "Pin `web@0.4.1.js` and `lib@3.7.1.min.js`, then mail jane.doe@acme-corp.io",
    );
    const pii = await scorePII(dir);
    expect(pii.score).toBe(8);
    expect(pii.findings).toContain("[email] SKILL.md:7 — found 1 match(es)");
  });

  it("leaves the other PII categories unchanged", async () => {
    await writeSkill("Pin `web@0.4.1.js` or call 555-123-4567.");
    const pii = await scorePII(dir);
    expect(pii.score).toBe(8);
    expect(pii.findings).toContain("[phone] SKILL.md:7 — found 1 match(es)");
    expect(pii.findings.some((f) => f.startsWith("[email]"))).toBe(false);
  });
});
