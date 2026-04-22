import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
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
    // Vacuously true when empty — exit-code + valid-JSON still tested
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

describe("Node E2E: search skill index", () => {
  test("search 'minimax' finds MiniMax-AI skills", async () => {
    const { stdout, exitCode } = await runNode("search", "minimax", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const repos = data.map((s: any) => s.repo);
    expect(repos).toContain("MiniMax-AI/skills");
  });

  test("search 'shader' finds shader-dev skill", async () => {
    const { stdout, exitCode } = await runNode("search", "shader", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    const names = data.map((s: any) => s.name);
    expect(names).toContain("shader-dev");
  });

  test("search 'frontend-dev' returns results", async () => {
    const { stdout, exitCode } = await runNode(
      "search",
      "frontend-dev",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test("search nonexistent query returns empty results", async () => {
    const { stdout, exitCode } = await runNode(
      "search",
      "qzxwvut9876",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toEqual([]);
  });

  test("index search 'pdf' finds minimax-pdf", async () => {
    const { stdout, exitCode } = await runNode(
      "index",
      "search",
      "pdf",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.length).toBeGreaterThanOrEqual(1);
    const names = data.map((s: any) => s.name);
    expect(names).toContain("minimax-pdf");
  });

  test("index search 'android' finds android-native-dev", async () => {
    const { stdout, exitCode } = await runNode(
      "index",
      "search",
      "android",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    const names = data.map((s: any) => s.name);
    expect(names).toContain("android-native-dev");
  });

  test("search results include installCommand field", async () => {
    const { stdout, exitCode } = await runNode(
      "search",
      "shader-dev",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    const shader = data.find((s: any) => s.name === "shader-dev");
    expect(shader).toBeDefined();
    expect(shader.installCommand).toContain("asm install");
    expect(shader.installCommand).toContain("MiniMax-AI/skills");
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
    // Known limitation: when no skills are installed, stats --json emits
    // plain text instead of JSON. This is a CLI bug tracked separately.
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

  test("no ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING in stderr (Node.js v25+)", async () => {
    const { stderr } = await runNode("--version");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
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
    "import",
    "eval",
    "publish",
  ];

  for (const cmd of commands) {
    test(`${cmd} --help exits 0`, async () => {
      const { exitCode } = await runNode(cmd, "--help");
      expect(exitCode).toBe(0);
    });
  }
});

// Regression: `eval --fix` and `publish` previously called `Bun.spawn` directly,
// which threw `ReferenceError: Bun is not defined` on Node. Both code paths now
// route through `runCommand()` (src/utils/spawn.ts) so they must not blow up
// with a Bun reference error when invoked under Node.
describe("Node E2E: bun-free CLI execution (issue #221)", () => {
  test("eval --fix invokes detectGitAuthor without ReferenceError", async () => {
    // `--fix` is the path that calls detectGitAuthor() → runCommand().
    // The missing skill path will fail later in applyFix, but only after
    // detectGitAuthor has exercised runCommand's Node branch.
    const { stderr, exitCode } = await runNode(
      "eval",
      "/tmp/asm-does-not-exist-xyz",
      "--fix",
      "--dry-run",
    );
    expect(stderr).not.toContain("Bun is not defined");
    expect(stderr).not.toContain("ReferenceError");
    expect(exitCode).not.toBe(0);
  });

  test("publish --dry-run on non-repo exits cleanly without ReferenceError", async () => {
    // /tmp is intentionally not a git repo; publish should fail cleanly via
    // its own error path, not via a Bun ReferenceError from a spawn site.
    const { stderr, exitCode } = await runNode("publish", "/tmp", "--dry-run");
    expect(stderr).not.toContain("Bun is not defined");
    expect(stderr).not.toContain("ReferenceError");
    expect(exitCode).not.toBe(0);
  });
});

// ─── inspect command ──────────────────────────────────────────────────────

describe("Node E2E: inspect", () => {
  test("inspect missing skill name exits 2", async () => {
    const { exitCode, stderr } = await runNode("inspect");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("inspect nonexistent skill exits 1", async () => {
    const { exitCode, stderr } = await runNode(
      "inspect",
      "nonexistent-skill-xyz",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ─── uninstall command ────────────────────────────────────────────────────

describe("Node E2E: uninstall", () => {
  test("uninstall missing skill name exits 2", async () => {
    const { exitCode, stderr } = await runNode("uninstall");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("uninstall nonexistent skill exits 1", async () => {
    const { exitCode, stderr } = await runNode(
      "uninstall",
      "nonexistent-skill-xyz",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ─── link command ─────────────────────────────────────────────────────────

describe("Node E2E: link", () => {
  test("link missing path exits 2", async () => {
    const { exitCode, stderr } = await runNode("link");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });
});

// ─── import command ───────────────────────────────────────────────────────

describe("Node E2E: import", () => {
  test("import missing file exits 2", async () => {
    const { exitCode, stderr } = await runNode("import");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("import nonexistent file exits 1", async () => {
    const fakePath = join(tmpdir(), `asm-nonexistent-${Date.now()}.json`);
    const { exitCode } = await runNode("import", fakePath, "-y");
    expect(exitCode).toBe(1);
  });

  test("import empty manifest --json returns zero counts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "asm-e2e-import-"));
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
      const { stdout, exitCode } = await runNode(
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

describe("Node E2E: list flags", () => {
  test("list --sort name exits 0", async () => {
    const { exitCode } = await runNode("list", "--sort", "name");
    expect(exitCode).toBe(0);
  });

  test("list --sort version exits 0", async () => {
    const { exitCode } = await runNode("list", "--sort", "version");
    expect(exitCode).toBe(0);
  });

  test("list --sort location exits 0", async () => {
    const { exitCode } = await runNode("list", "--sort", "location");
    expect(exitCode).toBe(0);
  });

  test("list --flat exits 0", async () => {
    const { exitCode } = await runNode("list", "--flat");
    expect(exitCode).toBe(0);
  });

  test("list --scope project --json filters correctly", async () => {
    const { stdout, exitCode } = await runNode(
      "list",
      "--scope",
      "project",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    // Vacuously true when empty — exit-code + valid-JSON still tested
    for (const skill of data) {
      expect(skill.scope).toBe("project");
    }
  });

  test("list --verbose exits 0", async () => {
    const { exitCode } = await runNode("list", "--verbose");
    expect(exitCode).toBe(0);
  });
});

// ─── export with scope ────────────────────────────────────────────────────

describe("Node E2E: export flags", () => {
  test("export --scope global outputs valid JSON", async () => {
    const { stdout, exitCode } = await runNode("export", "--scope", "global");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });

  test("export --scope project outputs valid JSON", async () => {
    const { stdout, exitCode } = await runNode("export", "--scope", "project");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });
});

// ─── invalid flag values ──────────────────────────────────────────────────

describe("Node E2E: invalid flag values", () => {
  test("invalid --transport exits 2", async () => {
    const { exitCode, stderr } = await runNode(
      "install",
      "github:test/repo",
      "--transport",
      "invalid",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid transport");
  });

  test("invalid --method exits 2", async () => {
    const { exitCode, stderr } = await runNode(
      "install",
      "github:test/repo",
      "--method",
      "invalid",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid method");
  });
});

// ─── index subcommands ────────────────────────────────────────────────────

describe("Node E2E: index subcommands", () => {
  test("index search --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runNode(
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
    const { exitCode } = await runNode("index", "search");
    expect(exitCode).toBe(2);
  });

  test("index with --has filter exits 0", async () => {
    const { exitCode } = await runNode(
      "index",
      "search",
      "code",
      "--has",
      "description",
      "--json",
    );
    expect(exitCode).toBe(0);
  });
});
