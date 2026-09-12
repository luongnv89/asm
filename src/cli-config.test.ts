import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";
import { writeFile, readFile } from "fs/promises";
import { runCLI } from "./cli-test-harness";

// `asm config` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: config", () => {
  test("config show prints valid JSON", async () => {
    const { stdout, exitCode } = await runCLI("config", "show");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("providers");
    expect(Array.isArray(data.providers)).toBe(true);
  });

  test("config path prints a file path", async () => {
    const { stdout, exitCode } = await runCLI("config", "path");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("config.json");
    expect(stdout).toContain("agent-skill-manager");
  });

  test("config with no subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("config");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing subcommand");
  });

  test("config with unknown subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("config", "bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown config subcommand");
  });
});

// ─── CLI integration: config reset ──────────────────────────────────────────

describe("CLI integration: config reset", () => {
  // NOTE: Config path is hardcoded in config.ts (no env var override), so these
  // tests must save/restore the real config. afterEach ensures restoration even
  // if a test assertion fails (unlike afterAll which only runs at suite end).
  let savedConfig: string | null = null;
  let configPath: string;

  beforeAll(async () => {
    const { stdout } = await runCLI("config", "path");
    configPath = stdout.trim();
  });

  beforeEach(async () => {
    try {
      savedConfig = await readFile(configPath, "utf-8");
    } catch {
      savedConfig = null;
    }
  });

  afterEach(async () => {
    // Restore original config after every test to prevent leaking reset state
    if (savedConfig !== null) {
      await writeFile(configPath, savedConfig, "utf-8");
    }
  });

  test("config reset without --yes in non-TTY exits 2", async () => {
    const { stderr, exitCode } = await runCLI("config", "reset");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("non-interactive");
  });

  test("config reset --yes succeeds", async () => {
    const { stderr, exitCode } = await runCLI("config", "reset", "--yes");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Config reset to defaults");
  });

  test("config show after reset matches defaults", async () => {
    // Reset first
    await runCLI("config", "reset", "--yes");
    const { stdout, exitCode } = await runCLI("config", "show");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.providers.length).toBeGreaterThanOrEqual(4);
  });
});
