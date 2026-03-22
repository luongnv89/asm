import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST_BIN = join(ROOT, "dist", "agent-skill-manager.js");

// Helper: run the built dist via Bun as a subprocess
async function runBunDist(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", DIST_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
    cwd: ROOT,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ─── Tier 1: must work after install ────────────────────────────────────────

describe("Bun dist E2E: --version", () => {
  test("prints version and exits 0", async () => {
    const { stdout, exitCode } = await runBunDist("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });
});

describe("Bun dist E2E: --help", () => {
  test("prints help and exits 0", async () => {
    const { stdout, exitCode } = await runBunDist("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("list");
    expect(stdout).toContain("search");
  });
});

describe("Bun dist E2E: list", () => {
  test("exits 0", async () => {
    const { exitCode } = await runBunDist("list");
    expect(exitCode).toBe(0);
  });

  test("--json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runBunDist("list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("Bun dist E2E: config", () => {
  test("config show prints valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist("config", "show");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
  });

  test("config path prints a path string", async () => {
    const { stdout, exitCode } = await runBunDist("config", "path");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("config.json");
  });
});

// ─── Tier 2: core features ─────────────────────────────────────────────────

describe("Bun dist E2E: search", () => {
  test("search exits 0", async () => {
    const { exitCode } = await runBunDist("search", "code-review");
    expect(exitCode).toBe(0);
  });
});

describe("Bun dist E2E: audit", () => {
  test("audit exits 0", async () => {
    const { exitCode } = await runBunDist("audit");
    expect(exitCode).toBe(0);
  });

  test("audit --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
  });
});

describe("Bun dist E2E: export", () => {
  test("export outputs valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });
});

describe("Bun dist E2E: stats", () => {
  test("stats exits 0", async () => {
    const { exitCode } = await runBunDist("stats");
    expect(exitCode).toBe(0);
  });
});

describe("Bun dist E2E: index", () => {
  test("index list exits 0", async () => {
    const { exitCode } = await runBunDist("index", "list");
    expect(exitCode).toBe(0);
  });

  test("index search exits 0", async () => {
    const { exitCode } = await runBunDist("index", "search", "code-review");
    expect(exitCode).toBe(0);
  });
});

// ─── init with temp directory ───────────────────────────────────────────────

describe("Bun dist E2E: init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-bun-e2e-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("init scaffolds skill directory", async () => {
    const skillDir = join(tempDir, "test-skill");
    const { exitCode } = await runBunDist(
      "init",
      "test-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(0);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: test-skill");
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("Bun dist E2E: error handling", () => {
  test("unknown command exits 2", async () => {
    const { exitCode } = await runBunDist("foobar");
    expect(exitCode).toBe(2);
  });

  test("unknown option exits 2", async () => {
    const { exitCode } = await runBunDist("--bogus");
    expect(exitCode).toBe(2);
  });
});
