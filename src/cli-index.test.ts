import { describe, test, expect } from "vitest";
import { runCLI } from "./cli-test-harness";

// `asm index` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: index ─────────────────────────────────────────────────

describe("CLI integration: index", () => {
  test("index with no subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("index");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing subcommand");
  });

  test("index unknown subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("index", "bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown subcommand");
  });

  test("index list exits 0", async () => {
    const { exitCode } = await runCLI("index", "list");
    expect(exitCode).toBe(0);
  });

  test("index list --json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runCLI("index", "list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("index search with no query exits 2", async () => {
    const { stderr, exitCode } = await runCLI("index", "search");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("index search with query exits 0", async () => {
    const { exitCode } = await runCLI("index", "search", "code-review");
    expect(exitCode).toBe(0);
  });

  test("index search --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runCLI(
      "index",
      "search",
      "code-review",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("index search with multi-word query works", async () => {
    const { exitCode } = await runCLI("index", "search", "code", "review");
    expect(exitCode).toBe(0);
  });

  test("index ingest with no repo exits 2", async () => {
    const { stderr, exitCode } = await runCLI("index", "ingest");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("index remove with no arg exits 2", async () => {
    const { stderr, exitCode } = await runCLI("index", "remove");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("index remove with invalid format exits 2", async () => {
    const { stderr, exitCode } = await runCLI(
      "index",
      "remove",
      "invalid-no-slash",
      "--yes",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid format");
  });

  test("index remove non-existent repo exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "index",
      "remove",
      "fake/nonexistent-repo-999",
      "--yes",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("main --help includes index command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("index");
  });

  test("index overlap exits 0", async () => {
    const { exitCode } = await runCLI("index", "overlap");
    expect(exitCode).toBe(0);
  });

  test("index overlap --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runCLI("index", "overlap", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(typeof data).toBe("object");
    expect(data).toHaveProperty("groups");
    expect(data).toHaveProperty("pairs");
    expect(data).toHaveProperty("totalSkills");
  });

  test("index overlap --threshold 0.6 exits 0", async () => {
    const { exitCode } = await runCLI("index", "overlap", "--threshold", "0.6");
    expect(exitCode).toBe(0);
  });
});
