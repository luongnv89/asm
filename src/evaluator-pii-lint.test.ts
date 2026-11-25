import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "child_process";
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
import { basename, dirname, join, relative } from "path";
import {
  isPlaceholderEmail,
  isReservedEmailDomain,
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

describe("runLinter", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
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
      "shellcheck",
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

    const findings = await runLinter(SH_FILE, ".sh");

    expect(findings?.map((f) => f.severity)).toEqual([
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

    const findings = await runLinter(SH_FILE, ".sh");

    expect(findings).toHaveLength(1);
    expect(findings?.[0].severity).toBe("warning");
    expect(findings?.[0].message).toMatch(/Linter exited with code 2/);
    expect(findings?.[0].message).toContain("not json");
  });

  it("returns no findings when the linter exits cleanly", async () => {
    runCommandMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    expect(await runLinter(SH_FILE, ".sh")).toEqual([]);
  });

  // Issue #884 — runCommand resolves a missing binary as exit 127 with
  // stderr "spawn <cmd> ENOENT"; it never rejects with ENOENT.
  it("returns null when runCommand reports the linter as not installed", async () => {
    runCommandMock.mockResolvedValue({
      exitCode: 127,
      stdout: "",
      stderr: "spawn shellcheck ENOENT",
    });

    expect(await runLinter(SH_FILE, ".sh")).toBeNull();
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

  it("returns null when the linter cannot be spawned", async () => {
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("spawn shellcheck ENOENT"), { code: "ENOENT" }),
    );

    expect(await runLinter(SH_FILE, ".sh")).toBeNull();
  });

  it("reports a linter that is installed but cannot be run", async () => {
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("spawn shellcheck EACCES"), { code: "EACCES" }),
    );

    expect(await runLinter(SH_FILE, ".sh")).toEqual([
      {
        file: SH_FILE,
        line: 0,
        severity: "warning",
        message: "Linter could not be run: EACCES",
      },
    ]);
  });

  it("returns null for extensions without a configured linter", async () => {
    expect(await runLinter("/tmp/skill/app.js", ".js")).toBeNull();
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
      "python3",
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

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "lint-884-"));
    runCommandMock.mockReset();
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

      expect(runCommandMock.mock.calls[0][0][0]).toBe(linter);
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
    runCommandMock.mockImplementation((argv: string[]) => runCommand(argv));

    const result = await scoreScriptLint(dir);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock.mock.calls[0][0][0]).toBe("shellcheck");
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
