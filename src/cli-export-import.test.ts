import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { printImportConflictDiffs, promptForImportConflict } from "./cli";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { runCLI, runCliInProcess, CLI_BIN } from "./cli-test-harness";
import type { ImportConflict, ImportResult } from "./utils/types";

// `asm export`/`asm import` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: export ────────────────────────────────────────────────

describe("CLI integration: export", () => {
  test("export outputs valid JSON manifest", async () => {
    const { stdout, exitCode } = await runCLI("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("exportedAt");
    expect(data).toHaveProperty("skills");
    expect(Array.isArray(data.skills)).toBe(true);
  });

  test("export manifest version is 1", async () => {
    const { stdout, exitCode } = await runCLI("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
  });

  test("export manifest has valid exportedAt timestamp", async () => {
    const { stdout } = await runCLI("export");
    const data = JSON.parse(stdout);
    const date = new Date(data.exportedAt);
    expect(date.getTime()).not.toBeNaN();
  });

  test("export skills include expected fields", async () => {
    const { stdout } = await runCLI("export");
    const data = JSON.parse(stdout);
    if (data.skills.length > 0) {
      const skill = data.skills[0];
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("version");
      expect(skill).toHaveProperty("dirName");
      expect(skill).toHaveProperty("provider");
      expect(skill).toHaveProperty("scope");
      expect(skill).toHaveProperty("path");
      expect(skill).toHaveProperty("isSymlink");
    }
  });

  test("export --scope global filters to global only", async () => {
    const { stdout, exitCode } = await runCLI("export", "--scope", "global");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data.skills) {
      expect(skill.scope).toBe("global");
    }
  });

  test("export --scope project filters to project only", async () => {
    const { stdout, exitCode } = await runCLI("export", "--scope", "project");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data.skills) {
      expect(skill.scope).toBe("project");
    }
  });

  test("main --help includes export command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("export");
  });

  test("main --help includes import command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("import");
  });
});

// ─── Import conflict CLI behavior ──────────────────────────────────────────

function makeImportConflict(
  newer: ImportConflict["newer"] = "local",
): ImportConflict {
  return {
    skillName: "test-skill",
    provider: "claude",
    scope: "global",
    targetDir: "/tmp/local",
    sourcePath: "/tmp/imported",
    localModified: "2026-01-02T00:00:00.000Z",
    importedModified: "2026-01-01T00:00:00.000Z",
    newer,
  };
}

describe("import conflict prompt", () => {
  test.each([
    ["k", "keep-local"],
    ["u", "use-imported"],
    ["s", "skip"],
  ] as const)("maps %s to %s", async (answer, expected) => {
    const choice = await promptForImportConflict(makeImportConflict(), {
      readAnswer: async () => answer,
      writeLine: () => {},
      writePrompt: () => {},
    });

    expect(choice).toBe(expected);
  });

  test("shows a diff for d, then prompts again for a resolution", async () => {
    const answers = ["d", "k"];
    const lines: string[] = [];
    const prompts: string[] = [];
    let renders = 0;

    const choice = await promptForImportConflict(makeImportConflict(), {
      readAnswer: async () => answers.shift() ?? "s",
      renderDiff: async () => {
        renders += 1;
        return "--- local/SKILL.md\n+++ imported/SKILL.md";
      },
      writeLine: (line) => lines.push(line),
      writePrompt: (prompt) => prompts.push(prompt),
    });

    expect(choice).toBe("keep-local");
    expect(renders).toBe(1);
    expect(lines.join("\n")).toContain("--- local/SKILL.md");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("[d] show diff");
    expect(prompts[1]).not.toContain("[d] show diff");
  });

  test.each([
    ["local", "local:", "imported:"],
    ["imported", "imported:", "local:"],
  ] as const)(
    "marks the %s side newer and the other side older",
    async (newer, newerLabel, olderLabel) => {
      const lines: string[] = [];
      await promptForImportConflict(makeImportConflict(newer), {
        readAnswer: async () => "s",
        writeLine: (line) => lines.push(line),
        writePrompt: () => {},
      });

      const newerLine = lines.find((line) => line.includes(newerLabel));
      const olderLine = lines.find((line) => line.includes(olderLabel));
      expect(newerLine).toContain("(newer)");
      expect(olderLine).toContain("(older)");
    },
  );

  test("--diff renders before prompting and hides the d choice", async () => {
    const lines: string[] = [];
    const prompts: string[] = [];
    await promptForImportConflict(makeImportConflict(), {
      showDiff: true,
      readAnswer: async () => "s",
      renderDiff: async () => "conflict diff",
      writeLine: (line) => lines.push(line),
      writePrompt: (prompt) => prompts.push(prompt),
    });

    expect(lines.join("\n")).toContain("conflict diff");
    expect(prompts[0]).not.toContain("[d] show diff");
  });
});

describe("non-interactive import conflict diffs", () => {
  test("prints every collected conflict and skips non-conflict results", async () => {
    const conflict = makeImportConflict();
    const results: ImportResult[] = [
      {
        skillName: "test-skill",
        provider: "claude",
        scope: "global",
        status: "skipped",
        conflict,
      },
      {
        skillName: "unchanged-skill",
        provider: "claude",
        scope: "global",
        status: "skipped",
      },
    ];
    const lines: string[] = [];

    await printImportConflictDiffs(
      results,
      async () => "--- local/SKILL.md\n+++ imported/SKILL.md",
      (line) => lines.push(line),
    );

    expect(lines.join("\n")).toContain("Conflict diff: test-skill");
    expect(lines.join("\n")).toContain("local -> imported");
    expect(lines.join("\n")).toContain("+++ imported/SKILL.md");
    expect(lines.join("\n")).not.toContain("unchanged-skill");
  });
});

// ─── CLI integration: import ────────────────────────────────────────────────

describe("CLI integration: import", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "import-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("import without argument shows error", async () => {
    const { stderr, exitCode } = await runCLI("import");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("import nonexistent file shows error", async () => {
    const { stderr, exitCode } = await runCLI(
      "import",
      "/tmp/nonexistent-manifest-xyz.json",
      "--yes",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Manifest file not found");
  });

  test("import rejects --force with --diff before reading the manifest", async () => {
    const { stderr, exitCode } = await runCLI(
      "import",
      "/tmp/nonexistent-manifest-xyz.json",
      "--force",
      "--diff",
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("--force and --diff cannot be used together");
    expect(stderr).toContain("Run without --force to inspect conflicts");
    expect(stderr).not.toContain("Manifest file not found");
  });

  test("import --diff prints a collected conflict in non-interactive mode", async () => {
    const homeDir = join(tempDir, "home");
    const sourceDir = join(homeDir, ".claude", "skills", "diff-skill");
    const targetDir = join(tempDir, ".claude", "skills", "diff-skill");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: diff-skill\ndescription: imported\n---\n# Imported\n",
    );
    await writeFile(
      join(targetDir, "SKILL.md"),
      "---\nname: diff-skill\ndescription: local\n---\n# Local\n",
    );
    const manifestPath = join(tempDir, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: [
          {
            name: "diff-skill",
            version: "1.0.0",
            dirName: "diff-skill",
            provider: "claude",
            scope: "project",
            path: sourceDir,
            isSymlink: false,
            symlinkTarget: null,
          },
        ],
      }),
    );

    const result = await runCliInProcess(
      [
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        CLI_BIN,
        "import",
        manifestPath,
        "--yes",
        "--diff",
      ],
      {
        cwd: tempDir,
        env: { ...process.env, HOME: homeDir, NO_COLOR: "1" },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Conflict diff: diff-skill");
    expect(result.stderr).toContain("local -> imported");
    expect(result.stderr).toContain("-# Local");
    expect(result.stderr).toContain("+# Imported");
    expect(await readFile(join(targetDir, "SKILL.md"), "utf-8")).toContain(
      "# Local",
    );
  });

  test("import invalid JSON shows error", async () => {
    const badFile = join(tempDir, "bad.json");
    await writeFile(badFile, "not json");
    const { stderr, exitCode } = await runCLI("import", badFile, "--yes");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not valid JSON");
  });

  test("import invalid manifest schema shows error", async () => {
    const badFile = join(tempDir, "bad-schema.json");
    await writeFile(badFile, JSON.stringify({ version: 99, skills: "wrong" }));
    const { stderr, exitCode } = await runCLI("import", badFile, "--yes");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid manifest");
  });

  test("import empty manifest shows nothing to import", async () => {
    const emptyFile = join(tempDir, "empty.json");
    await writeFile(
      emptyFile,
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: [],
      }),
    );
    const { stdout, exitCode } = await runCLI("import", emptyFile, "--yes");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no skills");
  });

  test("import with --json outputs valid JSON", async () => {
    // First export, then import
    const { stdout: exportOut } = await runCLI("export");
    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, exportOut);

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("installed");
    expect(data).toHaveProperty("skipped");
    expect(data).toHaveProperty("failed");
    expect(data).toHaveProperty("results");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("import existing skills are skipped", async () => {
    const { stdout: exportOut } = await runCLI("export");
    const data = JSON.parse(exportOut);
    if (data.skills.length === 0) return; // no skills to test with

    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, exportOut);

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // Importing an export of the host's own state: nothing should install,
    // every result is either skipped (provider present, already installed) or
    // failed (provider missing on this host). The per-host failed count is not
    // stable — it depends on which providers are configured — so we assert on
    // the invariant instead: no results outside {skipped, failed}.
    expect(result.installed).toBe(0);
    for (const r of result.results) {
      expect(["skipped", "failed"]).toContain(r.status);
    }
  });

  test("import --scope global filters to global only", async () => {
    const { stdout: exportOut } = await runCLI("export");
    const data = JSON.parse(exportOut);
    // Create a manifest with both global and project skills
    const manifest = {
      ...data,
      skills: [
        ...(data.skills.length > 0
          ? [{ ...data.skills[0], scope: "global" }]
          : []),
        {
          name: "fake-project-skill",
          version: "1.0.0",
          dirName: "fake-project-skill",
          provider: "claude",
          scope: "project",
          path: "/fake/path",
          isSymlink: false,
          symlinkTarget: null,
        },
      ],
    };

    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, JSON.stringify(manifest));

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
      "--scope",
      "global",
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // No project-scoped skills should appear in results
    for (const r of result.results) {
      expect(r.scope).toBe("global");
    }
  });
});
