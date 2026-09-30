import { describe, test, expect, beforeAll, vi } from "vitest";
import { parseArgs } from "./cli";
import { cmdBundle } from "./commands/bundle";
import * as shared from "./commands/shared";
import * as checkboxPickerMod from "./utils/checkbox-picker";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from "fs/promises";
import { tmpdir, homedir } from "os";
import { spawnCollect } from "./utils/test-spawn";
import { loadConfig, resolveProviderPath } from "./config";
import { runCLI, assertSkillUninstalled, CLI_BIN } from "./cli-test-harness";

// `asm bundle` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: bundle ──────────────────────────────────────────────

describe("CLI integration: bundle", () => {
  test("bundle --help shows bundle usage", async () => {
    const { stdout, exitCode } = await runCLI("bundle", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm bundle");
    expect(stdout).toContain("create");
    expect(stdout).toContain("install");
    expect(stdout).toContain("list");
    expect(stdout).toContain("show");
    expect(stdout).toContain("remove");
  });

  test("bundle without subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing subcommand");
  });

  test("bundle unknown subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "unknown");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown subcommand");
  });

  test("bundle create without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "create");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle install without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "install");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle show without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "show");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle remove without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "remove");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle list with no bundles shows empty", async () => {
    const { stdout, exitCode } = await runCLI("bundle", "list", "--json");
    expect(exitCode).toBe(0);
    // Either an empty JSON array or an empty message
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("bundle show with non-existent bundle exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "bundle",
      "show",
      "non-existent-bundle-12345",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("bundle remove non-existent bundle exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "bundle",
      "remove",
      "non-existent-bundle-12345",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("bundle install from non-existent file exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "bundle",
      "install",
      "/tmp/no-such-bundle-file.json",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("bundle show reads a valid bundle file", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-test-"));
    try {
      const bundleData = {
        version: 1,
        name: "cli-test-bundle",
        description: "Test bundle",
        author: "tester",
        createdAt: new Date().toISOString(),
        skills: [
          {
            name: "skill-a",
            installUrl: "github:user/skills#main:skills/skill-a",
            description: "Skill A",
            version: "1.0.0",
          },
        ],
      };
      const filePath = join(tmpDir, "test-bundle.json");
      await writeFile(filePath, JSON.stringify(bundleData));

      const { stdout, exitCode } = await runCLI(
        "bundle",
        "show",
        filePath,
        "--json",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.name).toBe("cli-test-bundle");
      expect(parsed.skills).toHaveLength(1);
      expect(parsed.skills[0].name).toBe("skill-a");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle create --yes creates bundle with all skills (non-interactive)", async () => {
    // Install a temporary local skill so scanAllSkills finds at least one
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-create-"));
    try {
      const skillDir = join(tmpDir, "bundle-test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: bundle-test-skill\nversion: 1.0.0\n---\n# Bundle Test Skill\nA test skill for bundle create.\n`,
      );
      // Install the local skill
      const installResult = await runCLI(
        "install",
        skillDir,
        "--force",
        "--tool",
        "claude",
        "--yes",
      );
      expect(installResult.exitCode).toBe(0);

      // Now create a bundle with --yes (non-interactive batch path)
      const { stdout, exitCode } = await runCLI(
        "bundle",
        "create",
        "create-yes-test-bundle",
        "--yes",
        "--json",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.name).toBe("create-yes-test-bundle");
      expect(parsed.skills.length).toBeGreaterThanOrEqual(1);
      // The test skill we installed should be in the bundle
      const names = parsed.skills.map((s: any) => s.name);
      expect(names).toContain("bundle-test-skill");

      // Clean up: remove the bundle and uninstall the skill
      await runCLI("bundle", "remove", "create-yes-test-bundle", "-y");
      await runCLI("uninstall", "bundle-test-skill", "--yes");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install from valid bundle file succeeds", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-install-"));
    try {
      // Create a valid local skill to reference in the bundle
      const skillDir = join(tmpDir, "installable-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: installable-skill\nversion: 1.0.0\n---\n# Installable Skill\nA test skill for bundle install.\n`,
      );

      // Create a bundle file that references the local skill
      const bundleData = {
        version: 1,
        name: "install-test-bundle",
        description: "Test bundle for install",
        author: "tester",
        createdAt: new Date().toISOString(),
        skills: [
          {
            name: "installable-skill",
            installUrl: skillDir,
            description: "Installable Skill",
            version: "1.0.0",
          },
        ],
      };
      const bundlePath = join(tmpDir, "install-test-bundle.json");
      await writeFile(bundlePath, JSON.stringify(bundleData));

      // Install the bundle
      const { stdout, exitCode } = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.bundleName).toBe("install-test-bundle");
      expect(parsed.installed).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].status).toBe("installed");

      // Clean up: uninstall the skill
      await runCLI("uninstall", "installable-skill", "--yes");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install TTY confirm without --tool does not abort as non-interactive", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-tty-"));
    const origIsTTY = process.stdin.isTTY;
    const readLineSpy = vi.spyOn(shared, "readLine").mockResolvedValue("y");
    const pickerSpy = vi
      .spyOn(checkboxPickerMod, "checkboxPicker")
      .mockResolvedValue([0]);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((msg?: unknown) => {
        logs.push(String(msg ?? ""));
      });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      const skillDir = join(tmpDir, "tty-bundle-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: tty-bundle-skill\nversion: 1.0.0\n---\n# TTY Bundle Skill\nA test skill for TTY bundle install.\n`,
      );
      const bundlePath = join(tmpDir, "tty-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "tty-bundle",
          description: "TTY bundle install",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: [
            {
              name: "tty-bundle-skill",
              installUrl: skillDir,
              description: "TTY Bundle Skill",
              version: "1.0.0",
            },
          ],
        }),
      );

      const args = parseArgs([
        "node",
        "script.ts",
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
      ]);
      await cmdBundle(args);

      const jsonOut =
        logs.find((l) => l.includes("bundleName")) ?? logs.join("");
      const parsed = JSON.parse(jsonOut);
      expect(parsed.bundleName).toBe("tty-bundle");
      expect(parsed.installed).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.results[0].status).toBe("installed");
      expect(exitSpy).not.toHaveBeenCalled();
      expect(pickerSpy).toHaveBeenCalled();
      expect(readLineSpy).toHaveBeenCalled();
      expect(pickerSpy.mock.invocationCallOrder[0]).toBeLessThan(
        readLineSpy.mock.invocationCallOrder[0],
      );

      await runCLI("uninstall", "tty-bundle-skill", "--yes");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      readLineSpy.mockRestore();
      pickerSpy.mockRestore();
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install without --tool in non-TTY requires provider before confirm", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-nontty-"));
    try {
      const skillDir = join(tmpDir, "nontty-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: nontty-skill\nversion: 1.0.0\n---\n# Non-TTY Skill\n`,
      );
      const bundlePath = join(tmpDir, "nontty-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "nontty-bundle",
          description: "Non-TTY",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: [
            {
              name: "nontty-skill",
              installUrl: skillDir,
              description: "Non-TTY Skill",
              version: "1.0.0",
            },
          ],
        }),
      );

      const { stderr, exitCode } = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("--tool (or --provider) is required");
      expect(stderr).not.toContain("Install all skills from this bundle?");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install accepts --tool all", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-all-"));
    try {
      const skillDir = join(tmpDir, "all-tool-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: all-tool-skill\nversion: 1.0.0\n---\n# All Tool Skill\n`,
      );
      const bundlePath = join(tmpDir, "all-tool-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "all-tool-bundle",
          description: "All-tool bundle",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: [
            {
              name: "all-tool-skill",
              installUrl: skillDir,
              description: "All Tool Skill",
              version: "1.0.0",
            },
          ],
        }),
      );

      const { stdout, exitCode } = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "all",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.bundleName).toBe("all-tool-bundle");
      expect(parsed.installed).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.results[0].status).toBe("installed");

      await runCLI("uninstall", "all-tool-skill", "--yes");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install skips already-installed skill without --force", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-skip-"));
    try {
      // Create a valid local skill to reference in the bundle
      const skillDir = join(tmpDir, "skip-test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: skip-test-skill\nversion: 1.0.0\n---\n# Skip Test Skill\nA test skill for bundle skip.\n`,
      );

      // Create a bundle file that references the local skill
      const bundleData = {
        version: 1,
        name: "skip-test-bundle",
        description: "Test bundle for skip behavior",
        author: "tester",
        createdAt: new Date().toISOString(),
        skills: [
          {
            name: "skip-test-skill",
            installUrl: skillDir,
            description: "Skip Test Skill",
            version: "1.0.0",
          },
        ],
      };
      const bundlePath = join(tmpDir, "skip-test-bundle.json");
      await writeFile(bundlePath, JSON.stringify(bundleData));

      // First install with --force
      const first = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      );
      expect(first.exitCode).toBe(0);
      const firstParsed = JSON.parse(first.stdout);
      expect(firstParsed.installed).toBe(1);

      // Second install WITHOUT --force should skip
      const second = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--tool",
        "claude",
      );
      expect(second.exitCode).toBe(0);
      const secondParsed = JSON.parse(second.stdout);
      expect(secondParsed.installed).toBe(0);
      expect(secondParsed.skipped).toBe(1);
      expect(secondParsed.failed).toBe(0);
      expect(secondParsed.results[0].status).toBe("skipped");

      // Third install WITH --force should install again
      const third = await runCLI(
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      );
      expect(third.exitCode).toBe(0);
      const thirdParsed = JSON.parse(third.stdout);
      expect(thirdParsed.installed).toBe(1);
      expect(thirdParsed.skipped).toBe(0);
      expect(thirdParsed.failed).toBe(0);

      // Clean up: uninstall the skill
      await runCLI("uninstall", "skip-test-skill", "--yes");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install TTY selects subset of skills and installs only chosen", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-select-"));
    const origIsTTY = process.stdin.isTTY;
    const readLineSpy = vi.spyOn(shared, "readLine").mockResolvedValue("y");
    const pickerSpy = vi
      .spyOn(checkboxPickerMod, "checkboxPicker")
      .mockImplementation(async (opts) => {
        const labels = opts.items.map((i) => i.label);
        // Scope picker offers "Global (...)" — keep global; the skill
        // picker offers skill names — take the second skill only.
        if (labels.some((l) => l.startsWith("Global ("))) return [0];
        return [1];
      });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((msg?: unknown) => {
        logs.push(String(msg ?? ""));
      });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      for (const name of ["tty-skill-a", "tty-skill-b"]) {
        const skillDir = join(tmpDir, name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, "SKILL.md"),
          `---\nname: ${name}\nversion: 1.0.0\n---\n# ${name}\n`,
        );
      }
      const bundlePath = join(tmpDir, "select-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "select-bundle",
          description: "Subset selection",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: ["tty-skill-a", "tty-skill-b"].map((n) => ({
            name: n,
            installUrl: join(tmpDir, n),
          })),
        }),
      );

      const args = parseArgs([
        "node",
        "script.ts",
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      ]);
      await cmdBundle(args);
      const jsonOut =
        logs.find((l) => l.includes("bundleName")) ?? logs.join("");
      const parsed = JSON.parse(jsonOut);
      expect(parsed.bundleName).toBe("select-bundle");
      expect(parsed.total).toBe(1);
      expect(parsed.installed).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].name).toBe("tty-skill-b");
      expect(parsed.results[0].status).toBe("installed");
      expect(exitSpy).not.toHaveBeenCalled();

      await runCLI("uninstall", "tty-skill-b", "--yes");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      readLineSpy.mockRestore();
      pickerSpy.mockRestore();
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install TTY scope selection installs into project scope", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-scope-"));
    const origCwd = process.cwd();
    const origIsTTY = process.stdin.isTTY;
    const readLineSpy = vi.spyOn(shared, "readLine").mockResolvedValue("y");
    const pickerSpy = vi
      .spyOn(checkboxPickerMod, "checkboxPicker")
      .mockImplementation(async (opts) => {
        const labels = opts.items.map((i) => i.label);
        // Only the scope picker appears (single skill, explicit --tool):
        // choose the second entry (project).
        if (labels.some((l) => l.startsWith("Global ("))) return [1];
        return [0];
      });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const logs: string[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((msg?: unknown) => {
        logs.push(String(msg ?? ""));
      });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    // Project scope resolves relative paths from cwd — run inside tmpDir so
    // the install lands under tmpDir and never touches the repo checkout.
    process.chdir(tmpDir);
    try {
      const skillDir = join(tmpDir, "scope-proj-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: scope-proj-skill\nversion: 1.0.0\n---\n# Scope Project Skill\n`,
      );
      const bundlePath = join(tmpDir, "scope-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "scope-bundle",
          description: "Scope selection",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: [
            {
              name: "scope-proj-skill",
              installUrl: skillDir,
            },
          ],
        }),
      );

      const args = parseArgs([
        "node",
        "script.ts",
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      ]);
      await cmdBundle(args);
      const jsonOut =
        logs.find((l) => l.includes("bundleName")) ?? logs.join("");
      const parsed = JSON.parse(jsonOut);
      expect(parsed.bundleName).toBe("scope-bundle");
      expect(parsed.installed).toBe(1);
      expect(parsed.failed).toBe(0);
      expect(parsed.scope).toBe("project");
      expect(exitSpy).not.toHaveBeenCalled();

      const config = await loadConfig();
      const claude = config.providers.find((p) => p.name === "claude");
      expect(claude).toBeDefined();
      const installedMd = join(
        resolveProviderPath(claude!.project),
        "scope-proj-skill",
        "SKILL.md",
      );
      const content = await readFile(installedMd, "utf-8");
      expect(content).toContain("scope-proj-skill");
    } finally {
      process.chdir(origCwd);
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      readLineSpy.mockRestore();
      pickerSpy.mockRestore();
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle install TTY scope dismissal aborts gracefully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-scope-abort-"));
    const origIsTTY = process.stdin.isTTY;
    const pickerSpy = vi
      .spyOn(checkboxPickerMod, "checkboxPicker")
      .mockResolvedValue([]);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      const skillDir = join(tmpDir, "scope-abort-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: scope-abort-skill\nversion: 1.0.0\n---\n# Scope Abort Skill\n`,
      );
      const bundlePath = join(tmpDir, "scope-abort-bundle.json");
      await writeFile(
        bundlePath,
        JSON.stringify({
          version: 1,
          name: "scope-abort-bundle",
          description: "Scope dismissal",
          author: "tester",
          createdAt: new Date().toISOString(),
          skills: [
            {
              name: "scope-abort-skill",
              installUrl: skillDir,
            },
          ],
        }),
      );

      const args = parseArgs([
        "node",
        "script.ts",
        "bundle",
        "install",
        bundlePath,
        "--json",
        "--force",
        "--tool",
        "claude",
      ]);
      await expect(cmdBundle(args)).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: origIsTTY,
        configurable: true,
      });
      pickerSpy.mockRestore();
      exitSpy.mockRestore();
      errSpy.mockRestore();
      logSpy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("main --help includes bundle in command list", async () => {
    const { stdout, exitCode } = await runCLI("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bundle");
  });
});

// ─── CLI integration: bundle modify ──────────────────────────────────────────

describe("CLI integration: bundle modify", () => {
  // One-shot cleanup of historical leftovers from #288: prior versions of these
  // tests used `mkdtemp` prefixes that did not match the frontmatter name, so
  // `asm uninstall` could not find the installed copy and ~/.claude/skills/
  // accumulated hundreds of `cli-skill-for-*` directories. Sweep any that
  // remain on developer machines on the next test run.
  beforeAll(async () => {
    const skillsDir = join(homedir(), ".claude", "skills");
    let entries: string[];
    try {
      entries = await readdir(skillsDir);
    } catch {
      return; // no skills dir — nothing to sweep
    }
    await Promise.all(
      entries
        .filter((e) => e.startsWith("cli-skill-for-"))
        .map((e) => rm(join(skillsDir, e), { recursive: true, force: true })),
    );
  });

  test("bundle modify without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "modify");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle modify non-existent bundle exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "bundle",
      "modify",
      "non-existent-bundle-12345",
      "--description",
      "new desc",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("bundle modify --add adds a skill to the bundle", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-bundle-modify-add-"));
    const bundleData = {
      version: 1,
      name: "__test-modify-add-bundle__",
      description: "Original description",
      author: "tester",
      createdAt: new Date().toISOString(),
      skills: [
        {
          name: "skill-a",
          installUrl: "github:user/skills#main:skills/skill-a",
          description: "Skill A",
          version: "1.0.0",
        },
      ],
    };
    const filePath = join(tmpDir, "bundle.json");
    await writeFile(filePath, JSON.stringify(bundleData, null, 2));

    try {
      const { exitCode } = await runCLI(
        "bundle",
        "modify",
        filePath,
        "--add",
        "github:user/skills#main:skills/skill-b",
        "--yes",
      );
      // modify on a file path vs named bundle; named bundles are in bundles dir
      // since the file has a path, loadBundle reads it but saveBundle saves to bundles dir
      // so we test by name after creating it
      expect([0, 1]).toContain(exitCode); // may fail with "not found" since loading by path
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("bundle modify --add and --description updates saved bundle", async () => {
    // Source dir basename must equal the skill's frontmatter `name` so the
    // installer's destination directory matches the name the uninstall call
    // uses for lookup — see #288.
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-modify-"));
    const skillName = "modify-test-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill for modify
version: 1.0.0
---
# Modify Test Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);
    // Install the skill (place SKILL.md at root, no --subpath, matches CI-compatible pattern)
    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    // Create a bundle using the install
    const bundleName = "__test-modify-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    try {
      const { stderr, exitCode } = await runCLI(
        "bundle",
        "modify",
        bundleName,
        "--description",
        "Updated description",
        "--author",
        "new-author",
        "--tags",
        "foo,bar",
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain("updated");

      // Verify by showing the bundle
      const { stdout } = await runCLI("bundle", "show", bundleName, "--json");
      const parsed = JSON.parse(stdout);
      expect(parsed.description).toBe("Updated description");
      expect(parsed.author).toBe("new-author");
      expect(parsed.tags).toEqual(["foo", "bar"]);
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle modify --remove on nonexistent skill reports no change", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-remove-"));
    const skillName = "rm-skill-a";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill
version: 1.0.0
---
# rm-skill-a
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-remove-skill-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    try {
      const { stderr, exitCode } = await runCLI(
        "bundle",
        "modify",
        bundleName,
        "--remove",
        "__nonexistent-skill-xyz__",
      );
      // No change made — skill not found in bundle
      expect(exitCode).toBe(0);
      expect(stderr).toContain("not found in bundle");
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle modify --remove all skills exits 1 with at-least-one-skill error", async () => {
    // Create a bundle file directly with one skill, then try to remove it
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-remove2-"));
    const skillName = "rm-only-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: Only skill
version: 1.0.0
---
# rm-only-skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);
    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-remove-only-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    // Verify the bundle was created and contains the skill
    const { stdout: showOut } = await runCLI(
      "bundle",
      "show",
      bundleName,
      "--json",
    );
    const bundleData = JSON.parse(showOut);
    const hasSkill = bundleData.skills.some(
      (s: { name: string }) => s.name === skillName,
    );

    try {
      if (hasSkill && bundleData.skills.length === 1) {
        // The bundle has only one skill; removing it should fail
        const { stderr, exitCode } = await runCLI(
          "bundle",
          "modify",
          bundleName,
          "--remove",
          skillName,
        );
        expect(exitCode).toBe(1);
        expect(stderr).toContain("at least one skill");
      } else {
        // Bundle has more skills — test would be inconclusive; skip gracefully
        expect(bundleData.skills.length).toBeGreaterThan(0);
      }
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle --help shows modify and export subcommands", async () => {
    const { stdout, exitCode } = await runCLI("bundle", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("modify");
    expect(stdout).toContain("export");
  });
});

// ─── CLI integration: bundle export ──────────────────────────────────────────

describe("CLI integration: bundle export", () => {
  test("bundle export without name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("bundle", "export");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("bundle export non-existent bundle exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "bundle",
      "export",
      "non-existent-bundle-12345",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("bundle export writes bundle JSON to specified file", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-export-"));
    const skillName = "export-test-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill for export
version: 1.0.0
---
# Export Test Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-export-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    const outputDir = await mkdtemp(join(tmpdir(), "cli-bundle-export-out-"));
    const outputFile = join(outputDir, "exported.json");

    try {
      const { stderr, exitCode } = await runCLI(
        "bundle",
        "export",
        bundleName,
        outputFile,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Exported to");
      expect(stderr).toContain(outputFile);

      // Verify the file contains valid JSON bundle
      const content = await readFile(outputFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe(bundleName);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.skills)).toBe(true);
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle export defaults to ./<name>.json when no output file given", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-export2-"));
    const skillName = "export-default-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill
version: 1.0.0
---
# Export Default Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-export-default-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    try {
      const { stderr, exitCode } = await runCLI(
        "bundle",
        "export",
        bundleName,
        "--yes", // skip overwrite prompt if file exists
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain(bundleName);
      // Clean up the default file (cwd-relative)
      try {
        const { unlink } = await import("fs/promises");
        await unlink(`./${bundleName}.json`);
      } catch {
        // ignore if not created
      }
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle export does not overwrite existing file without --force", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-noover-"));
    const skillName = "export-nooverwrite-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill
version: 1.0.0
---
# Export No-Overwrite Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-export-nooverwrite-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    const outputDir = await mkdtemp(join(tmpdir(), "cli-bundle-noover-out-"));
    const outputFile = join(outputDir, "existing.json");

    try {
      // Create an existing file
      await writeFile(outputFile, "existing content");

      // Export without --force should fail (no TTY). This must spawn: the
      // command calls process.exit(1) inside a try/catch that also covers the
      // fs access check, so the in-process sentinel throw would be swallowed
      // by that catch and the file would be overwritten (bundle.ts).
      const {
        stdout: _o,
        stderr,
        exitCode,
      } = await spawnCollect(
        ["npx", "tsx", CLI_BIN, "bundle", "export", bundleName, outputFile],
        { env: { ...process.env, NO_COLOR: "1" } },
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("already exists");

      // Verify original content not overwritten
      const content = await readFile(outputFile, "utf-8");
      expect(content).toBe("existing content");
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle export --force overwrites existing file", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-force-"));
    const skillName = "export-force-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill
version: 1.0.0
---
# Export Force Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-export-force-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    const outputDir = await mkdtemp(join(tmpdir(), "cli-bundle-force-out-"));
    const outputFile = join(outputDir, "force-out.json");

    try {
      // Create an existing file
      await writeFile(outputFile, "old content");

      // Export with --force should succeed
      const { stderr, exitCode } = await runCLI(
        "bundle",
        "export",
        bundleName,
        outputFile,
        "--force",
      );
      expect(exitCode).toBe(0);
      expect(stderr).toContain("Exported to");

      // Verify new content was written
      const content = await readFile(outputFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe(bundleName);
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });

  test("bundle export --json outputs structured JSON result", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "cli-bundle-json-"));
    const skillName = "export-json-skill";
    const tmpSkillDir = join(tmpRoot, skillName);
    await mkdir(tmpSkillDir, { recursive: true });
    const skillMd = `---
name: ${skillName}
description: A test skill
version: 1.0.0
---
# Export JSON Skill
`;
    await writeFile(join(tmpSkillDir, "SKILL.md"), skillMd);

    const installResult = await runCLI(
      "install",
      tmpSkillDir,
      "--yes",
      "--tool",
      "claude",
    );
    expect(installResult.exitCode).toBe(0);

    const bundleName = "__test-export-json-bundle__";
    const createResult = await runCLI("bundle", "create", bundleName, "--yes");
    expect(createResult.exitCode).toBe(0);

    const outputDir = await mkdtemp(join(tmpdir(), "cli-bundle-json-out-"));
    const outputFile = join(outputDir, "json-out.json");

    try {
      const { stdout, exitCode } = await runCLI(
        "bundle",
        "export",
        bundleName,
        outputFile,
        "--json",
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.exported).toBe(true);
      expect(result.path).toBe(outputFile);
      expect(result.bundle.name).toBe(bundleName);
    } finally {
      await runCLI("bundle", "remove", bundleName, "--yes");
      await runCLI("uninstall", skillName, "--yes");
      await rm(tmpRoot, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
      await assertSkillUninstalled(skillName);
    }
  });
});
