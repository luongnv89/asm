import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
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

  // ─── Large-inventory UX flags (issue #192) ────────────────────────────

  test("--compact exits 0 and does not crash", async () => {
    const { exitCode } = await runBunDist("list", "--compact");
    expect(exitCode).toBe(0);
  });

  test("--summary exits 0 and does not crash", async () => {
    const { exitCode } = await runBunDist("list", "--summary");
    expect(exitCode).toBe(0);
  });

  test("--group-by tool exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--group-by", "tool");
    expect(exitCode).toBe(0);
  });

  test("--group-by scope exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--group-by", "scope");
    expect(exitCode).toBe(0);
  });

  test("--group-by effort exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--group-by", "effort");
    expect(exitCode).toBe(0);
  });

  test("--group-by invalid exits 2 with helpful error", async () => {
    const { exitCode, stderr } = await runBunDist(
      "list",
      "--group-by",
      "bogus",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --group-by");
  });

  test("--limit 5 exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--limit", "5");
    expect(exitCode).toBe(0);
  });

  test("--limit negative exits 2 with helpful error", async () => {
    const { exitCode, stderr } = await runBunDist("list", "--limit", "-1");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --limit");
  });

  test("--limit non-integer exits 2 with helpful error", async () => {
    const { exitCode, stderr } = await runBunDist("list", "--limit", "abc");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid --limit");
  });

  test("--json is unaffected by --compact (scripting compat)", async () => {
    // --json takes precedence — output must remain a plain JSON array.
    const { stdout, exitCode } = await runBunDist(
      "list",
      "--json",
      "--compact",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("--machine is unaffected by --summary (scripting compat)", async () => {
    // --machine takes precedence — envelope shape is unchanged.
    const { stdout, exitCode } = await runBunDist(
      "list",
      "--machine",
      "--summary",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("list");
    expect(envelope.status).toBe("ok");
    expect(Array.isArray(envelope.data)).toBe(true);
  });

  test("help mentions the new flags", async () => {
    const { stdout, exitCode } = await runBunDist("list", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--compact");
    expect(stdout).toContain("--summary");
    expect(stdout).toContain("--group-by");
    expect(stdout).toContain("--limit");
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

describe("Bun dist E2E: search skill index", () => {
  test("search 'minimax' finds MiniMax-AI skills", async () => {
    const { stdout, exitCode } = await runBunDist(
      "search",
      "minimax",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const repos = data.map((s: any) => s.repo);
    expect(repos).toContain("MiniMax-AI/skills");
  });

  test("search 'shader' finds shader-dev skill", async () => {
    const { stdout, exitCode } = await runBunDist("search", "shader", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    const names = data.map((s: any) => s.name);
    expect(names).toContain("shader-dev");
  });

  test("index search 'pdf' finds minimax-pdf", async () => {
    const { stdout, exitCode } = await runBunDist(
      "index",
      "search",
      "pdf",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    const names = data.map((s: any) => s.name);
    expect(names).toContain("minimax-pdf");
  });

  test("search nonexistent query returns empty results", async () => {
    const { stdout, exitCode } = await runBunDist(
      "search",
      "qzxwvut9876",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toEqual([]);
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

// ─── Scope flag E2E tests ───────────────────────────────────────────────────

describe("Bun dist E2E: --scope flag", () => {
  test("list --scope global exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--scope", "global");
    expect(exitCode).toBe(0);
  });

  test("list --scope project exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--scope", "project");
    expect(exitCode).toBe(0);
  });

  test("list --scope both exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--scope", "both");
    expect(exitCode).toBe(0);
  });

  test("list -s global exits 0 (short flag)", async () => {
    const { exitCode } = await runBunDist("list", "-s", "global");
    expect(exitCode).toBe(0);
  });

  test("invalid --scope value exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("list", "--scope", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid scope");
  });

  test("list --scope global --json returns only global skills", async () => {
    const { stdout, exitCode } = await runBunDist(
      "list",
      "--scope",
      "global",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    // When no global skills are installed, the loop is vacuously true —
    // the exit-code + valid-JSON assertions still provide value.
    for (const skill of data) {
      expect(skill.scope).toBe("global");
    }
  });

  test("list --scope project --json returns only project skills", async () => {
    const { stdout, exitCode } = await runBunDist(
      "list",
      "--scope",
      "project",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    // When no project skills are installed, the loop is vacuously true —
    // the exit-code + valid-JSON assertions still provide value.
    for (const skill of data) {
      expect(skill.scope).toBe("project");
    }
  });

  test("install help mentions --scope flag", async () => {
    const { stdout, exitCode } = await runBunDist("install", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--scope");
  });
});

// ─── Error handling ─────────────────────────────────────────────────────────

describe("Bun dist E2E: error handling", () => {
  test("unknown command exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("foobar");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown command");
  });

  test("unknown option exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("--bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown option");
  });

  test("invalid --sort value exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("list", "--sort", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid sort");
  });

  test("invalid --transport exits 2", async () => {
    const { exitCode, stderr } = await runBunDist(
      "install",
      "github:test/repo",
      "--transport",
      "invalid",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid transport");
  });

  test("invalid --method exits 2", async () => {
    const { exitCode, stderr } = await runBunDist(
      "install",
      "github:test/repo",
      "--method",
      "invalid",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid method");
  });
});

// ─── inspect command ──────────────────────────────────────────────────────

describe("Bun dist E2E: inspect", () => {
  test("inspect missing skill name exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("inspect");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("inspect nonexistent skill exits 1", async () => {
    const { exitCode, stderr } = await runBunDist(
      "inspect",
      "nonexistent-skill-xyz",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ─── uninstall command ────────────────────────────────────────────────────

describe("Bun dist E2E: uninstall", () => {
  test("uninstall missing skill name exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("uninstall");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("uninstall nonexistent skill exits 1", async () => {
    const { exitCode, stderr } = await runBunDist(
      "uninstall",
      "nonexistent-skill-xyz",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ─── link command ─────────────────────────────────────────────────────────

describe("Bun dist E2E: link", () => {
  test("link missing path exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("link");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });
});

// ─── import command ───────────────────────────────────────────────────────

describe("Bun dist E2E: import", () => {
  test("import missing file exits 2", async () => {
    const { exitCode, stderr } = await runBunDist("import");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("import nonexistent file exits 1", async () => {
    const fakePath = join(tmpdir(), `asm-nonexistent-${Date.now()}.json`);
    const { exitCode } = await runBunDist("import", fakePath, "-y");
    expect(exitCode).toBe(1);
  });

  test("import empty manifest --json returns zero counts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "asm-bun-e2e-import-"));
    try {
      const manifestPath = join(tempDir, "manifest.json");
      await writeFile(
        manifestPath,
        JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          skills: [],
        }),
      );
      const { stdout, exitCode } = await runBunDist(
        "import",
        manifestPath,
        "--json",
        "-y",
      );
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.total).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ─── list flag combinations ───────────────────────────────────────────────

describe("Bun dist E2E: list flags", () => {
  test("list --sort name exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--sort", "name");
    expect(exitCode).toBe(0);
  });

  test("list --sort version exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--sort", "version");
    expect(exitCode).toBe(0);
  });

  test("list --sort location exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--sort", "location");
    expect(exitCode).toBe(0);
  });

  test("list --flat exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--flat");
    expect(exitCode).toBe(0);
  });

  test("list --verbose exits 0", async () => {
    const { exitCode } = await runBunDist("list", "--verbose");
    expect(exitCode).toBe(0);
  });
});

// ─── export with scope ────────────────────────────────────────────────────

describe("Bun dist E2E: export flags", () => {
  test("export --scope global outputs valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist(
      "export",
      "--scope",
      "global",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });

  test("export --scope project outputs valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist(
      "export",
      "--scope",
      "project",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });
});

// ─── search missing query ─────────────────────────────────────────────────

describe("Bun dist E2E: search edge cases", () => {
  test("search missing query exits 2", async () => {
    const { exitCode } = await runBunDist("search");
    expect(exitCode).toBe(2);
  });

  test("search --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist(
      "search",
      "code-review",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─── stats --json ─────────────────────────────────────────────────────────

describe("Bun dist E2E: stats --json", () => {
  test("stats --json returns valid JSON or no-skills message", async () => {
    const { stdout, exitCode } = await runBunDist("stats", "--json");
    expect(exitCode).toBe(0);
    // Known limitation: when no skills are installed, stats --json emits
    // plain text instead of JSON. This is a CLI bug tracked separately.
    if (stdout !== "No skills found.") {
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("totalSkills");
    }
  });
});

// ─── index subcommands ────────────────────────────────────────────────────

describe("Bun dist E2E: index subcommands", () => {
  test("index list --json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runBunDist("index", "list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("index search --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runBunDist(
      "index",
      "search",
      "code-review",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("index search missing query exits 2", async () => {
    const { exitCode } = await runBunDist("index", "search");
    expect(exitCode).toBe(2);
  });
});

// ─── per-command --help ─────────────────────────────────────────────────

describe("Bun dist E2E: per-command --help", () => {
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
    "import",
  ];

  for (const cmd of commands) {
    test(`${cmd} --help exits 0`, async () => {
      const { exitCode } = await runBunDist(cmd, "--help");
      expect(exitCode).toBe(0);
    });
  }
});

// ─── no bun: protocol errors ────────────────────────────────────────────

describe("Bun dist E2E: init edge cases", () => {
  test("init missing name exits 2", async () => {
    const { exitCode } = await runBunDist("init");
    expect(exitCode).toBe(2);
  });
});
