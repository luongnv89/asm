import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { runCLI, runCliInProcess, CLI_BIN } from "./cli-test-harness";

// `asm stats` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: stats --tokens (issue #421)", () => {
  test("--tokens exits 0 and reports the attention budget", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--tokens");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Attention Budget");
  });

  test("--tokens --json returns resident and body totals separately", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--tokens", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("totalResidentTokens");
    expect(data).toHaveProperty("totalBodyTokens");
    expect(data).toHaveProperty("medianResidentTokens");
    expect(Array.isArray(data.byProvider)).toBe(true);
    expect(Array.isArray(data.byScope)).toBe(true);
    expect(Array.isArray(data.heaviestResident)).toBe(true);
  });

  test("--tokens --machine emits the v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--tokens", "--machine");
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("stats tokens");
    expect(envelope.status).toBe("ok");
    expect(envelope.data).toHaveProperty("totalResidentTokens");
  });

  test("--machine is honoured by the plain dashboard too", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--machine");
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("stats");
    expect(envelope.data).toHaveProperty("totalResidentTokens");
  });

  test("stats --help documents the new flags", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--tokens");
    expect(stdout).toContain("--machine");
  });
});

describe("CLI integration: stats with nothing installed", () => {
  let emptyHome: string;
  let emptyCwd: string;

  beforeEach(async () => {
    emptyHome = await mkdtemp(join(tmpdir(), "asm-empty-home-"));
    emptyCwd = await mkdtemp(join(tmpdir(), "asm-empty-cwd-"));
  });

  afterEach(async () => {
    await rm(emptyHome, { recursive: true, force: true });
    await rm(emptyCwd, { recursive: true, force: true });
  });

  const runEmpty = (...args: string[]) =>
    runCliInProcess(["npx", "tsx", CLI_BIN, ...args], {
      cwd: emptyCwd,
      env: { ...process.env, HOME: emptyHome, NO_COLOR: "1" },
    });

  test("--json emits a parseable report, not the human sentence", async () => {
    const { stdout, exitCode } = await runEmpty("stats", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.totalSkills).toBe(0);
    expect(data.totalResidentTokens).toBe(0);
    expect(data.totalBodyTokens).toBe(0);
    expect(data).not.toHaveProperty("perSkillDiskBytes");
  });

  test("--json --verbose keeps perSkillDiskBytes even when empty", async () => {
    const { stdout, exitCode } = await runEmpty("stats", "--json", "--verbose");
    expect(exitCode).toBe(0);
    const start = stdout.indexOf("{");
    const data = JSON.parse(stdout.slice(start));
    expect(data).toHaveProperty("perSkillDiskBytes");
  });

  test("--machine emits the v1 envelope", async () => {
    const { stdout, exitCode } = await runEmpty("stats", "--machine");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).data.totalSkills).toBe(0);
  });

  test("the human dashboard still degrades to a sentence", async () => {
    const { stdout, exitCode } = await runEmpty("stats");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("No installed skills.");
  });

  test("--tokens and audit residency both report an empty set", async () => {
    const budget = await runEmpty("stats", "--tokens");
    expect(budget.exitCode).toBe(0);
    expect(budget.stdout).toContain("No installed skills");

    const residency = await runEmpty("audit", "residency");
    expect(residency.exitCode).toBe(0);
    expect(residency.stdout).toContain("No installed skills");

    const overlap = await runEmpty("audit", "overlap");
    expect(overlap.exitCode).toBe(0);
    expect(overlap.stdout).toContain("No installed skills.");
  });
});

// ─── CLI integration: stats ─────────────────────────────────────────────────

describe("CLI integration: stats", () => {
  test("stats exits 0", async () => {
    const { exitCode } = await runCLI("stats");
    expect(exitCode).toBe(0);
  });

  test("stats --json returns valid JSON with expected fields", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--json");
    expect(exitCode).toBe(0);
    // If no skills, the human dashboard degrades to this sentence.
    if (stdout.trim() === "No installed skills.") return;
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("byProvider");
    expect(data).toHaveProperty("byScope");
    expect(data).toHaveProperty("totalDiskBytes");
    expect(data).toHaveProperty("duplicateGroups");
  });

  test("stats --json --verbose includes perSkillDiskBytes", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--json", "--verbose");
    expect(exitCode).toBe(0);
    if (stdout.trim() === "No installed skills.") return;
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("perSkillDiskBytes");
  });

  test("stats --json without verbose omits perSkillDiskBytes", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--json");
    expect(exitCode).toBe(0);
    if (stdout.trim() === "No installed skills.") return;
    const data = JSON.parse(stdout);
    expect(data).not.toHaveProperty("perSkillDiskBytes");
  });

  test("stats --scope global works", async () => {
    const { exitCode } = await runCLI("stats", "--scope", "global");
    expect(exitCode).toBe(0);
  });

  test("main --help includes stats command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("stats");
  });
});
