import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST_BIN = join(ROOT, "dist", "agent-skill-manager.js");

// Helper: run the built dist via Node.js as a subprocess
async function runNode(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["node", DIST_BIN, ...args], {
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

describe("Node E2E: --version", () => {
  test("prints version and exits 0", async () => {
    const { stdout, exitCode } = await runNode("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });

  test("-v is alias for --version", async () => {
    const { stdout, exitCode } = await runNode("-v");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });
});

describe("Node E2E: --help", () => {
  test("prints help and exits 0", async () => {
    const { stdout, exitCode } = await runNode("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("list");
    expect(stdout).toContain("search");
    expect(stdout).toContain("inspect");
    expect(stdout).toContain("config");
  });

  test("-h is alias for --help", async () => {
    const { stdout, exitCode } = await runNode("-h");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });
});

describe("Node E2E: list", () => {
  test("exits 0", async () => {
    const { exitCode } = await runNode("list");
    expect(exitCode).toBe(0);
  });

  test("--json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runNode("list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("--scope global --json filters correctly", async () => {
    const { stdout, exitCode } = await runNode(
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
});

describe("Node E2E: config", () => {
  test("config show prints valid JSON", async () => {
    const { stdout, exitCode } = await runNode("config", "show");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("providers");
  });

  test("config path prints a path string", async () => {
    const { stdout, exitCode } = await runNode("config", "path");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("config.json");
  });
});

// ─── Tier 2: core features ─────────────────────────────────────────────────

describe("Node E2E: search", () => {
  test("search with query exits 0", async () => {
    const { exitCode } = await runNode("search", "code-review");
    expect(exitCode).toBe(0);
  });

  test("search --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runNode(
      "search",
      "code-review",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("missing query exits 2", async () => {
    const { exitCode } = await runNode("search");
    expect(exitCode).toBe(2);
  });
});

describe("Node E2E: audit", () => {
  test("audit exits 0", async () => {
    const { exitCode } = await runNode("audit");
    expect(exitCode).toBe(0);
  });

  test("audit --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runNode("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("duplicateGroups");
  });
});

describe("Node E2E: export", () => {
  test("export outputs valid JSON", async () => {
    const { stdout, exitCode } = await runNode("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("skills");
    expect(Array.isArray(data.skills)).toBe(true);
  });
});

describe("Node E2E: stats", () => {
  test("stats exits 0", async () => {
    const { exitCode } = await runNode("stats");
    expect(exitCode).toBe(0);
  });

  test("stats --json returns valid JSON or no-skills message", async () => {
    const { stdout, exitCode } = await runNode("stats", "--json");
    expect(exitCode).toBe(0);
    if (stdout !== "No skills found.") {
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("totalSkills");
    }
  });
});

describe("Node E2E: index", () => {
  test("index list exits 0", async () => {
    const { exitCode } = await runNode("index", "list");
    expect(exitCode).toBe(0);
  });

  test("index list --json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runNode("index", "list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("index search exits 0", async () => {
    const { exitCode } = await runNode("index", "search", "code-review");
    expect(exitCode).toBe(0);
  });
});

// ─── Tier 2: init with temp directory ───────────────────────────────────────

describe("Node E2E: init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-e2e-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("init scaffolds skill directory", async () => {
    const skillDir = join(tempDir, "test-skill");
    const { exitCode } = await runNode(
      "init",
      "test-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(0);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: test-skill");
    expect(content).toContain("version: 0.1.0");
  });

  test("init missing name exits 2", async () => {
    const { exitCode } = await runNode("init");
    expect(exitCode).toBe(2);
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("Node E2E: error handling", () => {
  test("unknown command exits 2", async () => {
    const { stderr, exitCode } = await runNode("foobar");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown command");
  });

  test("unknown option exits 2", async () => {
    const { stderr, exitCode } = await runNode("--bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown option");
  });

  test("invalid --scope exits 2", async () => {
    const { stderr, exitCode } = await runNode("list", "--scope", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid scope");
  });

  test("invalid --sort exits 2", async () => {
    const { stderr, exitCode } = await runNode("list", "--sort", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid sort");
  });
});

// ─── Regression: no Node.js protocol errors ─────────────────────────────────

describe("Node E2E: no Node.js protocol errors", () => {
  test("no ERR_UNSUPPORTED_ESM_URL_SCHEME in stderr (issue #35)", async () => {
    const { stderr } = await runNode("--version");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_ESM_URL_SCHEME");
  });

  test("no bun: protocol references in error output", async () => {
    const { stderr } = await runNode("list", "--json");
    expect(stderr).not.toContain("bun:");
  });
});

// ─── Per-command --help ─────────────────────────────────────────────────────

describe("Node E2E: per-command --help", () => {
  const commands = [
    "list",
    "search",
    "inspect",
    "install",
    "uninstall",
    "audit",
    "config",
    "export",
    "init",
    "stats",
    "link",
    "index",
  ];

  for (const cmd of commands) {
    test(`${cmd} --help exits 0`, async () => {
      const { exitCode } = await runNode(cmd, "--help");
      expect(exitCode).toBe(0);
    });
  }
});
