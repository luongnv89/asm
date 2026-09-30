import { describe, test, expect } from "vitest";
import { runCLI } from "./cli-test-harness";

// `asm search` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: search", () => {
  test("missing query exits 2", async () => {
    const { stderr, exitCode } = await runCLI("search");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("search returns filtered results or no-match message", async () => {
    const { stdout, stderr, exitCode } = await runCLI("search", "code-review");
    expect(exitCode).toBe(0);
    // On machines with skills/index: stdout contains results with "code-review"
    // On clean CI: no results, stderr contains "No skills matching"
    const combined = (stdout + stderr).toLowerCase();
    expect(combined).toContain("code-review");
  });

  test("search with --json returns JSON array", async () => {
    const { stdout, exitCode } = await runCLI(
      "search",
      "code-review",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("search with no installed matches returns empty table", async () => {
    const { stderr, exitCode } = await runCLI(
      "search",
      "zzz-nonexistent-skill-xyz-99999",
      "--installed",
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("No skills matching");
  });

  test("search with no installed matches returns empty JSON array", async () => {
    const { stdout, exitCode } = await runCLI(
      "search",
      "zzz-nonexistent-skill-xyz-99999",
      "--installed",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toEqual([]);
  });

  test("unified search includes status field in JSON", async () => {
    const { stdout, exitCode } = await runCLI(
      "search",
      "skill-creator",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    for (const item of data) {
      expect(["installed", "available"]).toContain(item.status);
    }
  });
});

// ─── CLI integration: search additional flags ───────────────────────────────

describe("CLI integration: search additional flags", () => {
  test("search --available --json returns only available skills", async () => {
    const { stdout, exitCode } = await runCLI(
      "search",
      "code",
      "--available",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const item of data) {
      expect(item.status).toBe("available");
    }
  });

  test("search --installed --flat works", async () => {
    const { exitCode } = await runCLI(
      "search",
      "code",
      "--installed",
      "--flat",
    );
    expect(exitCode).toBe(0);
  });
});
