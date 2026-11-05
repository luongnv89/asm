import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  isPlaceholderEmail,
  isReservedEmailDomain,
  runLinter,
  scorePII,
} from "./evaluator-pii-lint";

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

    expect(runCommandMock).toHaveBeenCalledWith([
      "shellcheck",
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

  it("returns null when the linter cannot be spawned", async () => {
    runCommandMock.mockRejectedValue(
      Object.assign(new Error("spawn shellcheck ENOENT"), { code: "ENOENT" }),
    );

    expect(await runLinter(SH_FILE, ".sh")).toBeNull();
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

    expect(runCommandMock).toHaveBeenCalledWith([
      "python3",
      "-m",
      "py_compile",
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
  // A non-ASCII letter ends the ASCII-only match early (`contact@team.test`,
  // `user@example.com`); a truncated match is never exempted as a placeholder.
  "contact@team.testé.fr",
  "user@example.comévil.io",
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
