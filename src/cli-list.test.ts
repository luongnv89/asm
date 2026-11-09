import { describe, test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { compareSemver } from "./scanner";
import { runCLI, runCliInProcess } from "./cli-test-harness";

// `asm list` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: list", () => {
  test("lists skills as table", async () => {
    const { stdout, exitCode } = await runCLI("list");
    expect(exitCode).toBe(0);
    // Output depends on whether skills are installed on the host
    if (stdout !== "No skills found.") {
      expect(stdout).toContain("Name");
      expect(stdout).toContain("Version");
      expect(stdout).toContain("Tool");
    }
  });

  test("lists skills as JSON with --json", async () => {
    const { stdout, exitCode } = await runCLI("list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("version");
      expect(data[0]).toHaveProperty("path");
    }
    for (const skill of data) {
      expect(skill).not.toHaveProperty("_skillMdContent");
    }
  });

  test("--scope global filters to global only", async () => {
    const { stdout, exitCode } = await runCLI(
      "list",
      "--scope",
      "global",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data) {
      expect(skill.scope).toBe("global");
    }
  });

  test("--scope project filters to project only", async () => {
    const { stdout, exitCode } = await runCLI(
      "list",
      "--scope",
      "project",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data) {
      expect(skill.scope).toBe("project");
    }
  });

  test("--sort version sorts by version", async () => {
    const { stdout, exitCode } = await runCLI(
      "list",
      "--sort",
      "version",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    if (data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        expect(compareSemver(data[i].version, data[i - 1].version) >= 0).toBe(
          true,
        );
      }
    }
  });
});

// ─── CLI integration: list additional flags ─────────────────────────────────

describe("CLI integration: list --flat", () => {
  test("list --flat exits 0 and produces output", async () => {
    const { stdout, exitCode } = await runCLI("list", "--flat");
    expect(exitCode).toBe(0);
    if (stdout !== "No skills found.") {
      expect(stdout).toContain("Name");
    }
  });
});

describe("CLI integration: list --tool", () => {
  test("--tool claude filters by provider in JSON", async () => {
    const { stdout, exitCode } = await runCLI(
      "list",
      "--tool",
      "claude",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data) {
      expect(skill.provider).toBe("claude");
    }
  });

  test("-p codex filters by provider in JSON", async () => {
    const { stdout, exitCode } = await runCLI("list", "-p", "codex", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data) {
      expect(skill.provider).toBe("codex");
    }
  });

  test("--provider alias works same as --tool", async () => {
    const { stdout, exitCode } = await runCLI(
      "list",
      "--provider",
      "claude",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data) {
      expect(skill.provider).toBe("claude");
    }
  });
});

// ─── CLI integration: list from HOME (#806) ─────────────────────────────────

describe("CLI integration: list with cwd = HOME (#806)", () => {
  test("lists each global skill once, as global, and counts it once", async () => {
    // A fresh home inside the src/test-setup.ts sandbox, never the real home.
    const home = await mkdtemp(join(homedir(), "home-806-"));
    try {
      const skillDir = join(home, ".claude", "skills", "s1");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: s1\ndescription: test\n---\n# s1\n",
      );
      const opts = { env: { HOME: home }, cwd: home };

      const table = await runCliInProcess(["list"], opts);
      expect(table.exitCode).toBe(0);
      expect(table.stdout.trim().split("\n").pop()).toBe(
        "1 skills (1 unique) across 1 tools | 1 global, 0 project",
      );

      const json = await runCliInProcess(["list", "--json"], opts);
      expect(json.exitCode).toBe(0);
      const data = JSON.parse(json.stdout);
      expect(
        data.map((s: { name: string; scope: string }) => [s.name, s.scope]),
      ).toEqual([["s1", "global"]]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
