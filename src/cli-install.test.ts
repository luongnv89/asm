import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  lstat,
  readlink,
  realpath,
  chmod,
} from "fs/promises";
import { tmpdir } from "os";
import { runInlineTs } from "./utils/test-spawn";
import { runCLI, runCliInProcess, CLI_BIN } from "./cli-test-harness";
import * as checkboxPickerMod from "./utils/checkbox-picker";

// `asm install` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: install ──────────────────────────────────────────────

describe("CLI integration: install", () => {
  test("install --help shows usage", async () => {
    const { stdout, exitCode } = await runCLI("install", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm install");
    expect(stdout).toContain("github:owner/repo");
    expect(stdout).toContain("https://github.com/owner/repo");
    expect(stdout).toContain("--tool");
    expect(stdout).toContain("--name");
    expect(stdout).toContain("--path");
    expect(stdout).toContain("--skill");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--transport");
    expect(stdout).toContain("--method");
    expect(stdout).toContain("Vercel");
  });

  test("install with missing source exits 2", async () => {
    const { stderr, exitCode } = await runCLI("install");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("main --help includes install command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("install");
  });
});

// ─── CLI integration: install --library ─────────────────────────────────────

describe("CLI integration: install --library", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-install-library-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("installs selected local skills into the neutral library", async () => {
    const sourceDir = join(tempDir, "source");
    await mkdir(join(sourceDir, "one"), { recursive: true });
    await mkdir(join(sourceDir, "two"), { recursive: true });
    await writeFile(
      join(sourceDir, "one", "SKILL.md"),
      `---\nname: one\nversion: 1.0.0\n---\n# One\n`,
    );
    await writeFile(
      join(sourceDir, "two", "SKILL.md"),
      `---\nname: two\nversion: 1.0.0\n---\n# Two\n`,
    );

    const homeDir = join(tempDir, "home");
    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceDir,
        "--library",
        "--all",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(0);
    const jsonStart = res.stdout.lastIndexOf("[\n  {");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const payload = JSON.parse(res.stdout.slice(jsonStart).trim());
    expect(payload.map((r: { name: string }) => r.name).sort()).toEqual([
      "one",
      "two",
    ]);

    const librarySkillsDir = join(
      homeDir,
      ".config",
      "agent-skill-manager",
      "library",
      "skills",
    );
    await expect(
      readFile(join(librarySkillsDir, "one", "SKILL.md"), "utf-8"),
    ).resolves.toContain("# One");
    await expect(
      readFile(join(librarySkillsDir, "two", "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Two");
    await expect(
      readFile(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "library-lock.json",
        ),
        "utf-8",
      ),
    ).resolves.toContain('"one"');
    await expect(
      lstat(join(homeDir, ".claude", "skills", "one")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("library list --json returns centrally installed skills", async () => {
    const source = join(tempDir, "source");
    await mkdir(join(source, "skills", "one"), { recursive: true });
    await writeFile(
      join(source, "skills", "one", "SKILL.md"),
      "---\nname: one\nversion: 1.0.0\n---\n# One\n",
    );

    const homeDir = join(tempDir, "home");
    await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        source,
        "--library",
        "--all",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    const res = await runCliInProcess(
      ["npx", "tsx", CLI_BIN, "library", "list", "--json"],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(0);
    const rows = JSON.parse(res.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dirName: "one",
      name: "one",
      version: "1.0.0",
      source: "local:" + source,
      skillPath: "skills/one",
    });
  });

  test("library update refreshes a local-source skill and outputs JSON summary", async () => {
    const source = join(tempDir, "source");
    const sourceSkillDir = join(source, "skills", "brainstorming");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Old\n",
    );

    const homeDir = join(tempDir, "home");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        source,
        "--library",
        "--all",
        "-y",
        "--json",
      ],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );
    expect(installRes.exitCode).toBe(0);

    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 2.0.0\n---\n# New\n",
    );

    const updateRes = await runCliInProcess(
      ["npx", "tsx", CLI_BIN, "library", "update", "brainstorming", "--json"],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(updateRes.exitCode).toBe(0);
    const payload = JSON.parse(updateRes.stdout);
    expect(payload.results[0]).toMatchObject({
      name: "brainstorming",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });
    await expect(
      readFile(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "skills",
          "brainstorming",
          "SKILL.md",
        ),
        "utf-8",
      ),
    ).resolves.toContain("# New");
  });

  test("install --library records a root skillPath that library update can refresh", async () => {
    const sourceSkillDir = join(tempDir, "root-skill");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: root-skill\nversion: 1.0.0\n---\n# Old Root\n",
    );

    const homeDir = join(tempDir, "home-root-library");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "-y",
        "--json",
      ],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );
    expect(installRes.exitCode).toBe(0);
    const lock = JSON.parse(
      await readFile(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "library-lock.json",
        ),
        "utf-8",
      ),
    );
    expect(lock.skills["root-skill"]).toMatchObject({
      name: "root-skill",
      skillPath: "",
    });

    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: root-skill\nversion: 2.0.0\n---\n# New Root\n",
    );

    const updateRes = await runCliInProcess(
      ["npx", "tsx", CLI_BIN, "library", "update", "root-skill", "--json"],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(updateRes.exitCode).toBe(0);
    const payload = JSON.parse(updateRes.stdout);
    expect(payload.results[0]).toMatchObject({
      name: "root-skill",
      status: "updated",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });
    await expect(
      readFile(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "skills",
          "root-skill",
          "SKILL.md",
        ),
        "utf-8",
      ),
    ).resolves.toContain("# New Root");
  });

  test("library update unknown skill suggests library list and exits 1 with JSON summary", async () => {
    const homeDir = join(tempDir, "home");
    const res = await runCliInProcess(
      ["npx", "tsx", CLI_BIN, "library", "update", "missing", "--json"],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(res.exitCode).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.failedCount).toBe(1);
    expect(payload.results[0]).toMatchObject({
      name: "missing",
      status: "failed",
      reason: 'Library skill "missing" not found. Run "asm library list".',
    });
  });

  test("library update --all --json reports partial failures with counts", async () => {
    const source = join(tempDir, "source");
    await mkdir(join(source, "skills", "good"), { recursive: true });
    await mkdir(join(source, "skills", "bad"), { recursive: true });
    await writeFile(
      join(source, "skills", "good", "SKILL.md"),
      "---\nname: good\nversion: 1.0.0\n---\n# Good Old\n",
    );
    await writeFile(
      join(source, "skills", "bad", "SKILL.md"),
      "---\nname: bad\nversion: 1.0.0\n---\n# Bad Old\n",
    );

    const homeDir = join(tempDir, "home");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        source,
        "--library",
        "--all",
        "-y",
        "--json",
      ],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );
    expect(installRes.exitCode).toBe(0);

    await writeFile(
      join(source, "skills", "good", "SKILL.md"),
      "---\nname: good\nversion: 2.0.0\n---\n# Good New\n",
    );
    await rm(join(source, "skills", "bad", "SKILL.md"), { force: true });

    const updateRes = await runCliInProcess(
      ["npx", "tsx", CLI_BIN, "library", "update", "--all", "--json"],
      { env: { ...process.env, HOME: homeDir, NO_COLOR: "1" } },
    );

    expect(updateRes.exitCode).toBe(1);
    const payload = JSON.parse(updateRes.stdout);
    expect(payload.updatedCount).toBe(1);
    expect(payload.failedCount).toBe(1);
    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "good", status: "updated" }),
        expect.objectContaining({ name: "bad", status: "failed" }),
      ]),
    );
  });

  test("activate links a library skill into a project provider", async () => {
    const source = join(tempDir, "source");
    const sourceSkillDir = join(source, "skills", "brainstorming");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Brainstorming\n",
    );

    const homeDir = join(tempDir, "home");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );
    expect(installRes.exitCode).toBe(0);

    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });
    const activateRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "activate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
        "--json",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(activateRes.exitCode).toBe(0);
    const payload = JSON.parse(activateRes.stdout);
    expect(payload.name).toBe("brainstorming");

    const targetPath = join(projectDir, ".codex", "skills", "brainstorming");
    const libraryPath = join(
      homeDir,
      ".config",
      "agent-skill-manager",
      "library",
      "skills",
      "brainstorming",
    );
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
    await expect(readlink(targetPath)).resolves.toBe(libraryPath);
  });

  test("activate unknown library skill exits with actionable message", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "activate",
        "missing-skill",
        "-p",
        "codex",
        "-s",
        "project",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Library skill "missing-skill" not found');
    expect(res.stderr).toContain("asm library list");
  });

  test("activate refuses existing target without force", async () => {
    const source = join(tempDir, "source");
    const sourceSkillDir = join(source, "skills", "brainstorming");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Brainstorming\n",
    );

    const homeDir = join(tempDir, "home");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );
    expect(installRes.exitCode).toBe(0);

    const projectDir = join(tempDir, "project");
    const targetPath = join(projectDir, ".codex", "skills", "brainstorming");
    await mkdir(targetPath, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "activate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Target already exists");
    expect(res.stderr).toContain("--force");
  });

  test("deactivate removes a project activation symlink after install+activate", async () => {
    const source = join(tempDir, "source");
    const sourceSkillDir = join(source, "skills", "brainstorming");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Brainstorming\n",
    );

    const homeDir = join(tempDir, "home");
    const installRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );
    expect(installRes.exitCode).toBe(0);

    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });
    const activateRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "activate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
        "--json",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );
    expect(activateRes.exitCode).toBe(0);

    const targetPath = join(projectDir, ".codex", "skills", "brainstorming");
    expect((await lstat(targetPath)).isSymbolicLink()).toBe(true);
    const resolvedProjectDir = await realpath(projectDir);
    const resolvedTargetPath = join(
      resolvedProjectDir,
      ".codex",
      "skills",
      "brainstorming",
    );

    const deactivateRes = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "deactivate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
        "--json",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(deactivateRes.exitCode).toBe(0);
    const payload = JSON.parse(deactivateRes.stdout);
    expect(payload).toMatchObject({
      name: "brainstorming",
      provider: "codex",
      scope: "project",
      path: resolvedTargetPath,
    });
    await expect(lstat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "skills",
          "brainstorming",
          "SKILL.md",
        ),
        "utf-8",
      ),
    ).resolves.toContain("# Brainstorming");
  });

  test("deactivate refuses a real provider directory", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    const targetPath = join(projectDir, ".codex", "skills", "brainstorming");
    await mkdir(targetPath, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "deactivate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("Refusing to deactivate non-symlink target");
    expect(res.stderr).not.toMatch(/\n\s+at\s+/);
    await expect(lstat(targetPath)).resolves.toBeTruthy();
  });

  test("deactivate reports missing activation", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "deactivate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Skill "brainstorming" is not active');
    expect(res.stderr).not.toMatch(/\n\s+at\s+/);
  });

  test("deactivate missing activation --json returns structured error", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "deactivate",
        "brainstorming",
        "-p",
        "codex",
        "-s",
        "project",
        "--json",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      error: 'Skill "brainstorming" is not active for codex/project.',
    });
    expect(res.stderr).not.toMatch(/\n\s+at\s+/);
  });

  test("deactivate unknown provider exits 2 with usage error", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "deactivate",
        "brainstorming",
        "-p",
        "no-such-provider",
        "-s",
        "project",
        "--json",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Unknown provider");
    expect(res.stdout).toBe("");
    expect(res.stderr).not.toMatch(/\n\s+at\s+/);
  });

  // Dismissing the interactive scope picker (Esc, or Enter with nothing
  // checked) makes resolveInstallScope throw. Like `asm install`, activate
  // and deactivate must render that as a clean "Error:" line — not a
  // "Fatal error:" stack dump from the bin-level catch.
  test("activate exits 1 cleanly when the scope picker is dismissed", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

    const librarySkillDir = join(
      homeDir,
      ".config",
      "agent-skill-manager",
      "library",
      "skills",
      "brainstorming",
    );
    await mkdir(librarySkillDir, { recursive: true });
    await writeFile(
      join(librarySkillDir, "SKILL.md"),
      "---\nname: brainstorming\nversion: 1.0.0\n---\n# Brainstorming\n",
    );
    await writeFile(
      join(
        homeDir,
        ".config",
        "agent-skill-manager",
        "library",
        "library-lock.json",
      ),
      JSON.stringify(
        {
          version: 1,
          skills: {
            brainstorming: {
              name: "brainstorming",
              version: "1.0.0",
              source: "local:/existing",
              sourceType: "local",
              commitHash: "unknown",
              ref: "main",
              skillPath: "brainstorming",
              libraryPath: librarySkillDir,
              installedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

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
        ["npx", "tsx", CLI_BIN, "activate", "brainstorming", "-p", "codex"],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
        },
      );

      expect(pickerSpy).toHaveBeenCalled();
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("No scope selected. Aborting.");
      expect(res.stderr).not.toContain("Fatal error");
      expect(res.stderr).not.toMatch(/\n\s+at\s+/);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      pickerSpy.mockRestore();
    }
  });

  test("deactivate exits 1 cleanly when the scope picker is dismissed", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

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
        ["npx", "tsx", CLI_BIN, "deactivate", "brainstorming", "-p", "codex"],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
        },
      );

      expect(pickerSpy).toHaveBeenCalled();
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("No scope selected. Aborting.");
      expect(res.stderr).not.toContain("Fatal error");
      expect(res.stderr).not.toMatch(/\n\s+at\s+/);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      pickerSpy.mockRestore();
    }
  });

  test("deactivate --json emits a structured error when the scope picker is dismissed", async () => {
    const homeDir = join(tempDir, "home");
    const projectDir = join(tempDir, "project");
    await mkdir(projectDir, { recursive: true });

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
        [
          "npx",
          "tsx",
          CLI_BIN,
          "deactivate",
          "brainstorming",
          "-p",
          "codex",
          "--json",
        ],
        {
          cwd: projectDir,
          env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
        },
      );

      expect(pickerSpy).toHaveBeenCalled();
      expect(res.exitCode).toBe(1);
      expect(JSON.parse(res.stdout)).toEqual({
        error: "No scope selected. Aborting.",
      });
      expect(res.stderr).not.toContain("Fatal error");
      expect(res.stderr).not.toMatch(/\n\s+at\s+/);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      pickerSpy.mockRestore();
    }
  });

  test("does not overwrite an existing library skill when only provider install exists", async () => {
    const homeDir = join(tempDir, "home");
    const providerSkillDir = join(homeDir, ".claude", "skills", "foo");
    await mkdir(providerSkillDir, { recursive: true });
    await writeFile(
      join(providerSkillDir, "SKILL.md"),
      `---\nname: foo\nversion: 1.0.0\n---\n# Existing provider\n`,
    );

    const librarySkillDir = join(
      homeDir,
      ".config",
      "agent-skill-manager",
      "library",
      "skills",
      "foo",
    );
    await mkdir(librarySkillDir, { recursive: true });
    await writeFile(
      join(librarySkillDir, "SKILL.md"),
      `---\nname: foo\nversion: 1.0.0\n---\n# Existing library\n`,
    );
    await mkdir(join(homeDir, ".config", "agent-skill-manager", "library"), {
      recursive: true,
    });
    await writeFile(
      join(
        homeDir,
        ".config",
        "agent-skill-manager",
        "library",
        "library-lock.json",
      ),
      JSON.stringify(
        {
          version: 1,
          skills: {
            foo: {
              name: "foo",
              version: "1.0.0",
              source: "local:/existing",
              sourceType: "local",
              commitHash: "unknown",
              ref: "main",
              skillPath: "foo",
              libraryPath: librarySkillDir,
              installedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const sourceSkillDir = join(tempDir, "source", "foo");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      `---\nname: foo\nversion: 2.0.0\n---\n# New source\n`,
    );

    const res = await runCliInProcess(
      [
        "npx",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "-y",
        "--json",
      ],
      {
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(res.exitCode).not.toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toMatch(
      /Library skill already exists|--force/,
    );
    const librarySkillMd = await readFile(
      join(librarySkillDir, "SKILL.md"),
      "utf-8",
    );
    expect(librarySkillMd).toContain("# Existing library");
    expect(librarySkillMd).not.toContain("# New source");
  });

  test("rejects Vercel method for library installs before provider delegation", async () => {
    const homeDir = join(tempDir, "home");

    const sourceSkillDir = join(tempDir, "source-vercel", "foo");
    await mkdir(sourceSkillDir, { recursive: true });
    await writeFile(
      join(sourceSkillDir, "SKILL.md"),
      `---\nname: foo\nversion: 2.0.0\n---\n# New source\n`,
    );

    const fakeBinDir = join(tempDir, "fake-bin");
    await mkdir(fakeBinDir, { recursive: true });
    const fakeNpx = join(fakeBinDir, "npx");
    await writeFile(
      fakeNpx,
      `#!/bin/sh
	if [ "$1" = "--version" ]; then
	  echo "10.0.0"
	  exit 0
	fi
	echo "unexpected npx delegate"
	exit 42
	`,
    );
    await chmod(fakeNpx, 0o755);

    const res = await runCliInProcess(
      [
        process.env.npm_node_execpath || process.execPath,
        "--import",
        "tsx",
        CLI_BIN,
        "install",
        sourceSkillDir,
        "--library",
        "--method",
        "vercel",
        "-y",
        "--json",
      ],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          NO_COLOR: "1",
          PATH: `${fakeBinDir}:${process.env.PATH}`,
        },
      },
    );

    expect(
      res.exitCode,
      `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    ).not.toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toContain(
      "--library cannot be combined with --method vercel",
    );
    expect(`${res.stdout}\n${res.stderr}`).not.toContain(
      "unexpected npx delegate",
    );
    await expect(
      lstat(join(homeDir, ".claude", "skills", "foo")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(
        join(
          homeDir,
          ".config",
          "agent-skill-manager",
          "library",
          "skills",
          "foo",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ─── CLI integration: install registry resolution ─────────────────────────

describe("CLI integration: install registry resolution", () => {
  test("bare name resolves via registry when fetch returns a valid index", async () => {
    // We run a subprocess that:
    //   1. Starts a tiny HTTP server serving a fake registry index
    //   2. Overrides REGISTRY_INDEX_URL via env so the CLI hits our server
    //   3. Invokes cmdInstall logic with a bare name
    //   4. Verifies the constructed source string matches the registry entry
    const script = `
      import http from "node:http";
      import { resolveFromRegistry } from "./src/registry";

      // Spin up a local server that returns a valid registry index
      const manifest = {
        name: "my-test-skill",
        author: "testauthor",
        description: "A test skill",
        repository: "https://github.com/testauthor/my-test-repo",
        commit: "${"a".repeat(40)}",
        security_verdict: "pass",
        published_at: "2026-01-01T00:00:00Z",
      };
      const index = { generated_at: "2026-01-01T00:00:00Z", manifests: [manifest] };

      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(index));
      });

      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      // Monkey-patch the registry module's fetch to hit our local server
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        // Redirect registry URL to local server
        if (typeof url === "string" && url.includes("asm-registry")) {
          return origFetch("http://127.0.0.1:" + port + "/index.json", opts);
        }
        return origFetch(url, opts);
      };

      try {
        const result = await resolveFromRegistry("my-test-skill", { noCache: true });
        if (!result.resolved) {
          process.stderr.write("FAIL: expected resolved to be non-null");
          process.exit(1);
        }
        const m = result.resolved.manifest;
        const sourceStr = "github:" + m.repository.replace("https://github.com/", "") + "#" + m.commit;
        process.stdout.write(sourceStr);
      } finally {
        globalThis.fetch = origFetch;
        server.close();
      }
    `;

    const { stdout, stderr, exitCode } = await runInlineTs(script, {
      env: { ...process.env, NO_COLOR: "1" },
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toBe(`github:testauthor/my-test-repo#${"a".repeat(40)}`);
    // No errors on stderr
    expect(stderr).not.toContain("FAIL");
  });
});

// ─── CLI integration: install error paths ───────────────────────────────────

describe("CLI integration: install error paths", () => {
  test("install with invalid source format exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "install",
      "not-a-valid-source",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("install refuses a `..` hidden in the ref before clone", async () => {
    const { stderr, exitCode } = await runCLI(
      "install",
      "github:acme/skills#main/../../x",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("escapes the repository");
    expect(stderr).not.toContain("Cloning repository");
  });

  test("install with invalid --transport exits 2", async () => {
    const { stderr, exitCode } = await runCLI(
      "install",
      "github:user/repo",
      "--transport",
      "ftp",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid transport");
  });
});

// ─── CLI integration: install --path/--all subpath discovery ───────────────
//
// Issues #251 / #252: when a subpath is supplied (via --path or
// `<source>#ref:subpath`) along with --all, the installer should treat the
// subpath as a collection of skills and scope dedupe detection to that
// subpath. Bare --all against a whole repo with name collisions must still
// error so install never silently picks one of two same-named skills.
describe("CLI integration: install --path/--all subpath discovery", () => {
  // Helper: spawn the CLI with HOME overridden so global installs land in a
  // throwaway temp dir instead of the user's real ~/.claude/skills.
  async function runCLIWithHome(
    home: string,
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const res = await runCliInProcess(["npx", "tsx", CLI_BIN, ...args], {
      env: { ...process.env, NO_COLOR: "1", HOME: home },
    });
    return {
      stdout: res.stdout.trim(),
      stderr: res.stderr.trim(),
      exitCode: res.exitCode,
    };
  }

  test("--all on subpath collection (no SKILL.md at subpath, but skills in subdirs) discovers them (issue #251)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "asm-install-251-"));
    try {
      // Layout:
      //   src/dist/skills/foo/SKILL.md
      //   src/dist/skills/bar/SKILL.md
      // No SKILL.md at src/dist/skills itself.
      const src = join(tmpDir, "src");
      await mkdir(join(src, "dist", "skills", "foo"), { recursive: true });
      await mkdir(join(src, "dist", "skills", "bar"), { recursive: true });
      await writeFile(
        join(src, "dist", "skills", "foo", "SKILL.md"),
        "---\nname: foo\nversion: 1.0.0\ndescription: Foo skill\n---\n# Foo\n",
      );
      await writeFile(
        join(src, "dist", "skills", "bar", "SKILL.md"),
        "---\nname: bar\nversion: 1.0.0\ndescription: Bar skill\n---\n# Bar\n",
      );

      const { stdout, stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--path",
        "dist/skills",
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      // Discovery should have found both skills (no "No SKILL.md" abort).
      const all = stdout + "\n" + stderr;
      expect(all).not.toContain('No SKILL.md found at path "dist/skills"');
      expect(exitCode).toBe(0);
      // Both skills installed under the throwaway HOME.
      expect(all).toMatch(/foo/);
      expect(all).toMatch(/bar/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--all with --path scopes duplicate detection to the subpath, ignoring collisions outside it (issue #252)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "asm-install-252-scoped-"));
    try {
      // Layout: two skills named `widget` in different roots.
      //   src/dist/skills/widget/SKILL.md
      //   src/src/skills/widget/SKILL.md
      // Bare --all sees both and errors; --path dist/skills --all only sees
      // the dist one and succeeds.
      const src = join(tmpDir, "src");
      await mkdir(join(src, "dist", "skills", "widget"), { recursive: true });
      await mkdir(join(src, "src", "skills", "widget"), { recursive: true });
      await writeFile(
        join(src, "dist", "skills", "widget", "SKILL.md"),
        "---\nname: widget\nversion: 1.0.0\ndescription: Widget dist\n---\n# Widget\n",
      );
      await writeFile(
        join(src, "src", "skills", "widget", "SKILL.md"),
        "---\nname: widget\nversion: 0.5.0\ndescription: Widget source\n---\n# Widget\n",
      );

      const { stdout, stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--path",
        "dist/skills",
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      const all = stdout + "\n" + stderr;
      expect(all).not.toContain("Duplicate skill names");
      expect(exitCode).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--all on repo with root SKILL.md and nested skills discovers all (issue #305)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "asm-install-305-"));
    try {
      const src = join(tmpDir, "src");
      await mkdir(join(src, "skills", "nested-one"), { recursive: true });
      await writeFile(
        join(src, "SKILL.md"),
        "---\nname: root-index\nversion: 1.0.0\ndescription: Root\n---\n# Root\n",
      );
      await writeFile(
        join(src, "skills", "nested-one", "SKILL.md"),
        "---\nname: nested-one\nversion: 1.0.0\ndescription: Nested\n---\n# Nested\n",
      );

      const { stdout, stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      const all = stdout + "\n" + stderr;
      expect(all).not.toContain("Invalid skill name");
      expect(all).not.toContain("Duplicate skill names");
      expect(exitCode).toBe(0);
      expect(all).toMatch(/root-index/);
      expect(all).toMatch(/nested-one/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--all blocks two skills that share a target dir basename even with distinct frontmatter names (issue #305 regression)", async () => {
    // Both skills live in a directory named `tool`, so both would install to
    // skills/tool and silently overwrite. Distinct frontmatter names
    // (alpha/beta) must NOT mask the real collision — dedup keys on basename.
    const tmpDir = await mkdtemp(join(tmpdir(), "asm-install-305-basename-"));
    try {
      const src = join(tmpDir, "src");
      await mkdir(join(src, "a", "tool"), { recursive: true });
      await mkdir(join(src, "b", "tool"), { recursive: true });
      await writeFile(
        join(src, "a", "tool", "SKILL.md"),
        "---\nname: alpha\nversion: 1.0.0\ndescription: Alpha\n---\n# Alpha\n",
      );
      await writeFile(
        join(src, "b", "tool", "SKILL.md"),
        "---\nname: beta\nversion: 1.0.0\ndescription: Beta\n---\n# Beta\n",
      );

      const { stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Duplicate skill names");
      expect(stderr).toContain("tool");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--all installs two skills with distinct basenames even when their frontmatter names collide (issue #305 regression)", async () => {
    // foo/ and bar/ install to distinct target dirs, so a shared frontmatter
    // name is NOT a real collision and must not be falsely blocked.
    const tmpDir = await mkdtemp(
      join(tmpdir(), "asm-install-305-frontmatter-"),
    );
    try {
      const src = join(tmpDir, "src");
      await mkdir(join(src, "foo"), { recursive: true });
      await mkdir(join(src, "bar"), { recursive: true });
      await writeFile(
        join(src, "foo", "SKILL.md"),
        "---\nname: shared\nversion: 1.0.0\ndescription: Foo\n---\n# Foo\n",
      );
      await writeFile(
        join(src, "bar", "SKILL.md"),
        "---\nname: shared\nversion: 1.0.0\ndescription: Bar\n---\n# Bar\n",
      );

      const { stdout, stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      const all = stdout + "\n" + stderr;
      expect(all).not.toContain("Duplicate skill names");
      expect(exitCode).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bare --all (no subpath) on a repo with name collisions still errors (regression guard)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "asm-install-252-regress-"));
    try {
      // Same dual `widget` layout as above; without --path, both must be
      // surfaced as a duplicate-name error.
      const src = join(tmpDir, "src");
      await mkdir(join(src, "dist", "skills", "widget"), { recursive: true });
      await mkdir(join(src, "src", "skills", "widget"), { recursive: true });
      await writeFile(
        join(src, "dist", "skills", "widget", "SKILL.md"),
        "---\nname: widget\nversion: 1.0.0\n---\n# Widget\n",
      );
      await writeFile(
        join(src, "src", "skills", "widget", "SKILL.md"),
        "---\nname: widget\nversion: 0.5.0\n---\n# Widget\n",
      );

      const { stderr, exitCode } = await runCLIWithHome(
        tmpDir,
        "install",
        src,
        "--all",
        "-y",
        "-p",
        "claude",
        "--scope",
        "global",
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Duplicate skill names");
      expect(stderr).toContain("widget");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
