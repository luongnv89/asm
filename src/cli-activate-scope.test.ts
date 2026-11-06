import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, lstat, readlink } from "fs/promises";
import { tmpdir } from "os";
import { runCliInProcess } from "./cli-test-harness";
import * as checkboxPickerMod from "./utils/checkbox-picker";

// `asm activate`/`asm deactivate` with an explicit `-s both` — issue #801.
//
// The shared `-s/--scope` flag accepted `both`, but activate fell back to a
// single scope (global for non-TTY/--yes, a picker in a TTY). Explicit both
// must now link into the provider's global and project folders.

const LIBRARY_SKILL = "brainstorming";

describe("CLI integration: activate -s both", () => {
  let tempDir: string;
  let homeDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-activate-both-"));
    homeDir = join(tempDir, "home");
    projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    // Install one skill into the sandboxed library.
    const sourceSkillDir = join(tempDir, "source", "skills", LIBRARY_SKILL);
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      `---\nname: ${LIBRARY_SKILL}\nversion: 1.0.0\n---\n# Brainstorming\n`,
    );
    const installRes = await runCliInProcess(
      [
        "install",
        join(tempDir, "source", "skills", LIBRARY_SKILL),
        "--library",
        "-y",
        "--json",
      ],
      { env: { HOME: homeDir, NO_COLOR: "1" } },
    );
    expect(installRes.exitCode).toBe(0);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const libraryPath = () =>
    join(
      homeDir,
      ".config",
      "agent-skill-manager",
      "library",
      "skills",
      LIBRARY_SKILL,
    );
  const globalLink = () => join(homeDir, ".codex", "skills", LIBRARY_SKILL);
  const projectLink = () => join(projectDir, ".codex", "skills", LIBRARY_SKILL);

  test("-s both links into the global and the project folder", async () => {
    const res = await runCliInProcess(
      ["activate", LIBRARY_SKILL, "-p", "codex", "-s", "both", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.linked.length).toBe(2);
    expect(
      payload.linked.map((entry: { scope: string }) => entry.scope).sort(),
    ).toEqual(["global", "project"]);
    for (const entry of payload.linked) {
      expect(entry.name).toBe(LIBRARY_SKILL);
      expect(entry.skill).toBe(LIBRARY_SKILL);
      expect(entry.provider).toBe("codex");
      expect(entry.target).toBe(libraryPath());
    }

    expect((await lstat(globalLink())).isSymbolicLink()).toBe(true);
    expect((await lstat(projectLink())).isSymbolicLink()).toBe(true);
    expect(await readlink(globalLink())).toBe(libraryPath());
    expect(await readlink(projectLink())).toBe(libraryPath());
  });

  test("-s both with --yes links both scopes without prompting", async () => {
    const res = await runCliInProcess(
      [
        "activate",
        LIBRARY_SKILL,
        "-p",
        "codex",
        "-s",
        "both",
        "--yes",
        "--json",
      ],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout).linked.length).toBe(2);
    expect((await lstat(globalLink())).isSymbolicLink()).toBe(true);
    expect((await lstat(projectLink())).isSymbolicLink()).toBe(true);
  });

  test("both scopes succeed independently when one target conflicts", async () => {
    // A real directory at the global target: --force must refuse it, while
    // the project scope still gets its link.
    await mkdir(globalLink(), { recursive: true });
    await writeFile(join(globalLink(), "keep.txt"), "precious");

    const res = await runCliInProcess(
      [
        "activate",
        LIBRARY_SKILL,
        "-p",
        "codex",
        "-s",
        "both",
        "--force",
        "--json",
      ],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);
    expect(payload.linked.length).toBe(1);
    expect(payload.linked[0].scope).toBe("project");
    expect(payload.failures.length).toBe(1);
    expect(payload.failures[0].scope).toBe("global");
    expect(payload.failures[0].path).toBe(globalLink());
    expect(payload.failures[0].error).toContain("Refusing to overwrite");

    // The real directory and its contents are untouched.
    expect((await lstat(globalLink())).isDirectory()).toBe(true);
    expect(await readlink(projectLink())).toBe(libraryPath());
  });

  test("explicit -s both skips the interactive scope picker", async () => {
    const origIsTTY = process.stdin.isTTY;
    const pickerSpy = vi
      .spyOn(checkboxPickerMod, "checkboxPicker")
      .mockResolvedValue([]);
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      const res = await runCliInProcess(
        ["activate", LIBRARY_SKILL, "-p", "codex", "-s", "both", "--json"],
        { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
      );

      // An explicit both needs no scope decision, so no picker is shown.
      expect(pickerSpy).not.toHaveBeenCalled();
      expect(res.exitCode).toBe(0);
      expect(JSON.parse(res.stdout).linked.length).toBe(2);
      expect((await lstat(globalLink())).isSymbolicLink()).toBe(true);
      expect((await lstat(projectLink())).isSymbolicLink()).toBe(true);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      pickerSpy.mockRestore();
    }
  });

  test("omitted scope keeps the previous single-scope behaviour", async () => {
    const res = await runCliInProcess(
      ["activate", LIBRARY_SKILL, "-p", "codex", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout);
    // Single-scope payload is unchanged: the activate six-field object.
    expect(payload.scope).toBe("global");
    expect(payload.path).toBe(globalLink());
    expect((await lstat(globalLink())).isSymbolicLink()).toBe(true);
    await expect(lstat(projectLink())).rejects.toThrow();
  });

  test("deactivate -s both removes both links", async () => {
    const activateRes = await runCliInProcess(
      ["activate", LIBRARY_SKILL, "-p", "codex", "-s", "both", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );
    expect(activateRes.exitCode).toBe(0);

    const res = await runCliInProcess(
      ["deactivate", LIBRARY_SKILL, "-p", "codex", "-s", "both", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(0);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(true);
    expect(payload.linked.length).toBe(2);
    await expect(lstat(globalLink())).rejects.toThrow();
    await expect(lstat(projectLink())).rejects.toThrow();
  });

  test("deactivate -s both reports a scope that was not active", async () => {
    // Only the global link exists.
    await runCliInProcess(
      ["activate", LIBRARY_SKILL, "-p", "codex", "-s", "global", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    const res = await runCliInProcess(
      ["deactivate", LIBRARY_SKILL, "-p", "codex", "-s", "both", "--json"],
      { cwd: projectDir, env: { HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.success).toBe(false);
    expect(payload.linked.length).toBe(1);
    expect(payload.linked[0].scope).toBe("global");
    expect(payload.failures.length).toBe(1);
    expect(payload.failures[0].scope).toBe("project");
    await expect(lstat(globalLink())).rejects.toThrow();
  });
});
