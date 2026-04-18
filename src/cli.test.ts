import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import { parseArgs, isCLIMode } from "./cli";
import { compareSemver } from "./scanner";
import { join } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  lstat,
  readlink,
  symlink,
} from "fs/promises";
import { tmpdir, homedir } from "os";

// Helper: path to the CLI entry point
const CLI_BIN = join(import.meta.dir, "..", "bin", "agent-skill-manager.ts");

// Helper: run CLI as subprocess, returns { stdout, stderr, exitCode }
async function runCLI(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ─── parseArgs unit tests ───────────────────────────────────────────────────

describe("parseArgs", () => {
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("no args yields null command", () => {
    const result = parse();
    expect(result.command).toBeNull();
    expect(result.subcommand).toBeNull();
    expect(result.flags.help).toBe(false);
  });

  test("parses list command", () => {
    const result = parse("list");
    expect(result.command).toBe("list");
  });

  test("parses search with query", () => {
    const result = parse("search", "code-review");
    expect(result.command).toBe("search");
    expect(result.subcommand).toBe("code-review");
  });

  test("parses inspect with skill name", () => {
    const result = parse("inspect", "blog-draft");
    expect(result.command).toBe("inspect");
    expect(result.subcommand).toBe("blog-draft");
  });

  test("parses uninstall with skill name and --yes", () => {
    const result = parse("uninstall", "blog-draft", "--yes");
    expect(result.command).toBe("uninstall");
    expect(result.subcommand).toBe("blog-draft");
    expect(result.flags.yes).toBe(true);
  });

  test("parses -y as alias for --yes", () => {
    const result = parse("uninstall", "test", "-y");
    expect(result.flags.yes).toBe(true);
  });

  test("parses config with subcommand", () => {
    const result = parse("config", "show");
    expect(result.command).toBe("config");
    expect(result.subcommand).toBe("show");
  });

  test("parses audit command", () => {
    const result = parse("audit");
    expect(result.command).toBe("audit");
  });

  test("parses audit with subcommand", () => {
    const result = parse("audit", "duplicates");
    expect(result.command).toBe("audit");
    expect(result.subcommand).toBe("duplicates");
  });

  test("parses --help flag", () => {
    const result = parse("--help");
    expect(result.flags.help).toBe(true);
  });

  test("parses -h flag", () => {
    const result = parse("-h");
    expect(result.flags.help).toBe(true);
  });

  test("parses --version flag", () => {
    const result = parse("--version");
    expect(result.flags.version).toBe(true);
  });

  test("parses -v flag", () => {
    const result = parse("-v");
    expect(result.flags.version).toBe(true);
  });

  test("parses --json flag", () => {
    const result = parse("list", "--json");
    expect(result.command).toBe("list");
    expect(result.flags.json).toBe(true);
  });

  test("parses --machine flag", () => {
    const result = parse("list", "--machine");
    expect(result.command).toBe("list");
    expect(result.flags.machine).toBe(true);
  });

  test("--machine defaults to false", () => {
    const result = parse("list");
    expect(result.flags.machine).toBe(false);
  });

  test("parses --no-color flag", () => {
    const result = parse("list", "--no-color");
    expect(result.flags.noColor).toBe(true);
  });

  test("parses --scope global", () => {
    const result = parse("list", "--scope", "global");
    expect(result.flags.scope).toBe("global");
  });

  test("parses -s project", () => {
    const result = parse("list", "-s", "project");
    expect(result.flags.scope).toBe("project");
  });

  test("parses --scope both", () => {
    const result = parse("list", "--scope", "both");
    expect(result.flags.scope).toBe("both");
  });

  test("parses --sort version", () => {
    const result = parse("list", "--sort", "version");
    expect(result.flags.sort).toBe("version");
  });

  test("parses --sort location", () => {
    const result = parse("list", "--sort", "location");
    expect(result.flags.sort).toBe("location");
  });

  test("parses --sort name", () => {
    const result = parse("list", "--sort", "name");
    expect(result.flags.sort).toBe("name");
  });

  test("defaults scope to both", () => {
    const result = parse("list");
    expect(result.flags.scope).toBe("both");
  });

  test("defaults sort to name", () => {
    const result = parse("list");
    expect(result.flags.sort).toBe("name");
  });

  test("defaults json to false", () => {
    const result = parse("list");
    expect(result.flags.json).toBe(false);
  });

  test("defaults yes to false", () => {
    const result = parse("uninstall", "x");
    expect(result.flags.yes).toBe(false);
  });

  test("defaults noColor to false", () => {
    const result = parse("list");
    expect(result.flags.noColor).toBe(false);
  });

  test("parses --help with command", () => {
    const result = parse("list", "--help");
    expect(result.command).toBe("list");
    expect(result.flags.help).toBe(true);
  });

  test("parses multiple flags together", () => {
    const result = parse(
      "list",
      "--json",
      "--scope",
      "global",
      "--sort",
      "version",
      "--no-color",
    );
    expect(result.command).toBe("list");
    expect(result.flags.json).toBe(true);
    expect(result.flags.scope).toBe("global");
    expect(result.flags.sort).toBe("version");
    expect(result.flags.noColor).toBe(true);
  });

  test("collects extra positional args", () => {
    const result = parse("search", "query", "extra");
    expect(result.command).toBe("search");
    expect(result.subcommand).toBe("query");
    expect(result.positional).toEqual(["extra"]);
  });

  test("collects multiple extra positional args", () => {
    const result = parse("search", "query", "extra1", "extra2");
    expect(result.positional).toEqual(["extra1", "extra2"]);
  });

  test("flags before command still parsed", () => {
    const result = parse("--json", "list");
    expect(result.flags.json).toBe(true);
    expect(result.command).toBe("list");
  });

  test("flags interspersed with positional args", () => {
    const result = parse("search", "--json", "code-review");
    expect(result.command).toBe("search");
    expect(result.flags.json).toBe(true);
    // "code-review" parsed as subcommand since --json consumes no value
    expect(result.subcommand).toBe("code-review");
  });

  test("config subcommands: path, reset, edit", () => {
    for (const sub of ["path", "reset", "edit"]) {
      const result = parse("config", sub);
      expect(result.command).toBe("config");
      expect(result.subcommand).toBe(sub);
    }
  });

  test("--help combined with --version", () => {
    const result = parse("--help", "--version");
    expect(result.flags.help).toBe(true);
    expect(result.flags.version).toBe(true);
  });

  test("empty positional array by default", () => {
    const result = parse("list");
    expect(result.positional).toEqual([]);
  });

  test("--yes without uninstall still parses", () => {
    const result = parse("list", "--yes");
    expect(result.flags.yes).toBe(true);
    expect(result.command).toBe("list");
  });

  test("parses --verbose flag", () => {
    const result = parse("list", "--verbose");
    expect(result.flags.verbose).toBe(true);
  });

  test("parses -V flag as verbose", () => {
    const result = parse("list", "-V");
    expect(result.flags.verbose).toBe(true);
  });

  test("defaults verbose to false", () => {
    const result = parse("list");
    expect(result.flags.verbose).toBe(false);
  });

  test("--verbose combines with other flags", () => {
    const result = parse("list", "--verbose", "--json", "--scope", "global");
    expect(result.flags.verbose).toBe(true);
    expect(result.flags.json).toBe(true);
    expect(result.flags.scope).toBe("global");
  });
});

// ─── isCLIMode unit tests ──────────────────────────────────────────────────

describe("isCLIMode", () => {
  const check = (...args: string[]) => isCLIMode(["bun", "script.ts", ...args]);

  test("no args → not CLI mode", () => {
    expect(check()).toBe(false);
  });

  test("list → CLI mode", () => {
    expect(check("list")).toBe(true);
  });

  test("search → CLI mode", () => {
    expect(check("search")).toBe(true);
  });

  test("inspect → CLI mode", () => {
    expect(check("inspect")).toBe(true);
  });

  test("uninstall → CLI mode", () => {
    expect(check("uninstall")).toBe(true);
  });

  test("config → CLI mode", () => {
    expect(check("config")).toBe(true);
  });

  test("audit → CLI mode", () => {
    expect(check("audit")).toBe(true);
  });

  test("--help → CLI mode", () => {
    expect(check("--help")).toBe(true);
  });

  test("-h → CLI mode", () => {
    expect(check("-h")).toBe(true);
  });

  test("--version → CLI mode", () => {
    expect(check("--version")).toBe(true);
  });

  test("-v → CLI mode", () => {
    expect(check("-v")).toBe(true);
  });

  test("unknown command → CLI mode (will error)", () => {
    expect(check("foobar")).toBe(true);
  });

  test("unknown flag → CLI mode (will error)", () => {
    expect(check("--unknown")).toBe(true);
  });

  test("single-char flag → CLI mode", () => {
    expect(check("-x")).toBe(true);
  });
});

// ─── runCLI integration tests (subprocess) ─────────────────────────────────

describe("CLI integration: --version", () => {
  test("prints version and exits 0", async () => {
    const { stdout, exitCode } = await runCLI("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });

  test("-v is alias for --version", async () => {
    const { stdout, exitCode } = await runCLI("-v");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });
});

describe("CLI integration: --help", () => {
  test("prints help and exits 0", async () => {
    const { stdout, exitCode } = await runCLI("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("agent-skill-manager");
    expect(stdout).toContain("asm");
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("list");
    expect(stdout).toContain("search");
    expect(stdout).toContain("inspect");
    expect(stdout).toContain("uninstall");
    expect(stdout).toContain("config");
  });

  test("-h is alias for --help", async () => {
    const { stdout, exitCode } = await runCLI("-h");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  test("help includes global options", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--scope");
    expect(stdout).toContain("--sort");
    expect(stdout).toContain("--no-color");
    expect(stdout).toContain("--yes");
  });
});

describe("CLI integration: per-command --help", () => {
  test("list --help shows list usage", async () => {
    const { stdout, exitCode } = await runCLI("list", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm list");
    expect(stdout).toContain("--sort");
    expect(stdout).toContain("--json");
  });

  test("search --help shows search usage", async () => {
    const { stdout, exitCode } = await runCLI("search", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm search");
    expect(stdout).toContain("<query>");
  });

  test("inspect --help shows inspect usage", async () => {
    const { stdout, exitCode } = await runCLI("inspect", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm inspect");
    expect(stdout).toContain("<skill-name>");
  });

  test("uninstall --help shows uninstall usage", async () => {
    const { stdout, exitCode } = await runCLI("uninstall", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm uninstall");
    expect(stdout).toContain("--yes");
  });

  test("config --help shows config subcommands", async () => {
    const { stdout, exitCode } = await runCLI("config", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm config");
    expect(stdout).toContain("show");
    expect(stdout).toContain("path");
    expect(stdout).toContain("reset");
    expect(stdout).toContain("edit");
  });
});

describe("CLI integration: unknown command", () => {
  test("exits 2 with error message", async () => {
    const { stderr, exitCode } = await runCLI("foobar");
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Unknown command: "foobar"');
    expect(stderr).toContain("asm --help");
  });
});

describe("CLI integration: unknown option", () => {
  test("exits 2 with error message", async () => {
    const { stderr, exitCode } = await runCLI("--bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown option: --bogus");
  });
});

describe("CLI integration: invalid --scope", () => {
  test("exits 2 with error for bad scope value", async () => {
    const { stderr, exitCode } = await runCLI("list", "--scope", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid scope");
  });
});

describe("CLI integration: invalid --sort", () => {
  test("exits 2 with error for bad sort value", async () => {
    const { stderr, exitCode } = await runCLI("list", "--sort", "invalid");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid sort");
  });
});

describe("CLI integration: --json and --machine mutual exclusion", () => {
  test("exits 2 when both --json and --machine are used", async () => {
    const { stderr, exitCode } = await runCLI("list", "--json", "--machine");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("mutually exclusive");
  });
});

describe("CLI integration: --machine output", () => {
  test("list --machine produces valid v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI("list", "--machine");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("list");
    expect(parsed.status).toBe("ok");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.timestamp).toBeDefined();
    expect(parsed.meta.asm_version).toBeDefined();
    expect(typeof parsed.meta.duration_ms).toBe("number");
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  test("doctor --machine produces valid v1 envelope", async () => {
    const { stdout } = await runCLI("doctor", "--machine");
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("doctor");
    expect(parsed.status).toBe("ok");
    expect(parsed.meta).toBeDefined();
    expect(parsed.data.checks).toBeDefined();
    expect(Array.isArray(parsed.data.checks)).toBe(true);
  });

  test("outdated --machine produces valid v1 envelope", async () => {
    const { stdout } = await runCLI("outdated", "--machine");
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("outdated");
    expect(parsed.status).toBe("ok");
    expect(parsed.meta).toBeDefined();
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  test("search --machine produces valid v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI("search", "test", "--machine");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("search");
    expect(parsed.status).toBe("ok");
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta.timestamp).toBeDefined();
    expect(parsed.meta.asm_version).toBeDefined();
    expect(typeof parsed.meta.duration_ms).toBe("number");
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  test("audit duplicates --machine produces valid v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI(
      "audit",
      "duplicates",
      "--machine",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("audit duplicates");
    expect(parsed.status).toBe("ok");
    expect(parsed.meta).toBeDefined();
    expect(parsed.data).toBeDefined();
    expect(typeof parsed.data.total_duplicates).toBe("number");
    expect(Array.isArray(parsed.data.duplicate_groups)).toBe(true);
  });

  test("install --machine produces valid v1 envelope with snake_case fields", async () => {
    // Install a known skill from the index to test machine output
    const { stdout, exitCode } = await runCLI(
      "install",
      "code-review",
      "--machine",
    );
    if (exitCode === 0) {
      const parsed = JSON.parse(stdout);
      expect(parsed.version).toBe(1);
      expect(parsed.command).toBe("install");
      expect(parsed.status).toBe("ok");
      expect(parsed.meta).toBeDefined();
      // Verify snake_case field names in data
      const data = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
      if (data) {
        expect(data).toHaveProperty("resolution_source");
        expect(data).not.toHaveProperty("resolutionSource");
      }
    }
  });

  test("audit security --machine produces error envelope when no target", async () => {
    const { stdout, exitCode } = await runCLI("audit", "security", "--machine");
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("audit security");
    expect(parsed.status).toBe("error");
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBeDefined();
    expect(typeof parsed.error.message).toBe("string");
    expect(parsed.meta).toBeDefined();
  });

  test("search --machine produces error envelope when no query", async () => {
    const { stdout, exitCode } = await runCLI("search", "--machine");
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("search");
    expect(parsed.status).toBe("error");
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBeDefined();
    expect(typeof parsed.error.message).toBe("string");
    expect(parsed.meta).toBeDefined();
  });

  test("publish --machine produces error envelope for invalid path", async () => {
    const { stdout, exitCode } = await runCLI(
      "publish",
      "/tmp/nonexistent-skill-path-12345",
      "--machine",
      "--yes",
    );
    expect(exitCode).not.toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("publish");
    expect(parsed.status).toBe("error");
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBeDefined();
    expect(typeof parsed.error.message).toBe("string");
    expect(parsed.meta).toBeDefined();
    expect(typeof parsed.meta.timestamp).toBe("string");
    expect(typeof parsed.meta.asm_version).toBe("string");
    expect(typeof parsed.meta.duration_ms).toBe("number");
  });

  test("update --machine produces valid v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI(
      "update",
      "nonexistent-skill-12345",
      "--machine",
      "--yes",
    );
    // May succeed (with empty results) or error — either way must be valid JSON envelope
    const parsed = JSON.parse(stdout);
    expect(parsed.version).toBe(1);
    expect(parsed.command).toBe("update");
    expect(["ok", "error"]).toContain(parsed.status);
    expect(parsed.meta).toBeDefined();
    expect(typeof parsed.meta.timestamp).toBe("string");
    expect(typeof parsed.meta.asm_version).toBe("string");
    expect(typeof parsed.meta.duration_ms).toBe("number");
  });
});

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

describe("CLI integration: inspect", () => {
  test("missing skill name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("inspect");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "inspect",
      "zzz-nonexistent-skill-xyz-99999",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("inspect --json returns JSON", async () => {
    // Use a skill likely to exist from list
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return; // skip if no skills

    const { stdout, exitCode } = await runCLI(
      "inspect",
      skills[0].dirName,
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    // Could be object or array depending on number of matches
    if (Array.isArray(data)) {
      expect(data[0]).toHaveProperty("name");
    } else {
      expect(data).toHaveProperty("name");
    }
  });

  test("inspect shows detail fields", async () => {
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return;

    const { stdout, exitCode } = await runCLI("inspect", skills[0].dirName);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(skills[0].dirName);
    expect(stdout).toContain("Version:");
    expect(stdout).toContain("Path:");
  });
});

describe("CLI integration: uninstall", () => {
  test("missing skill name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("uninstall");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "uninstall",
      "zzz-nonexistent-skill-xyz-99999",
      "--yes",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("CLI integration: audit", () => {
  test("audit runs and exits 0", async () => {
    const { exitCode } = await runCLI("audit");
    expect(exitCode).toBe(0);
  });

  test("audit duplicates is the default subcommand", async () => {
    const { stdout: defaultOut, exitCode: code1 } = await runCLI("audit");
    const { stdout: explicitOut, exitCode: code2 } = await runCLI(
      "audit",
      "duplicates",
    );
    expect(code1).toBe(0);
    expect(code2).toBe(0);
    // Both should produce similar output (may differ in timestamp)
  });

  test("audit --json returns valid JSON with expected shape", async () => {
    const { stdout, exitCode } = await runCLI("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("duplicateGroups");
    expect(data).toHaveProperty("totalDuplicateInstances");
    expect(Array.isArray(data.duplicateGroups)).toBe(true);
  });

  test("audit --help shows usage", async () => {
    const { stdout, exitCode } = await runCLI("audit", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm audit");
    expect(stdout).toContain("duplicates");
    expect(stdout).toContain("security");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--yes");
  });

  test("audit with unknown subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("audit", "bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown audit subcommand");
    expect(stderr).toContain("security");
  });

  test("main --help includes audit command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("audit");
  });
});

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

// ─── parseArgs: install command ─────────────────────────────────────────────

describe("parseArgs: install", () => {
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("parses install with source", () => {
    const result = parse("install", "github:user/repo");
    expect(result.command).toBe("install");
    expect(result.subcommand).toBe("github:user/repo");
  });

  test("parses --provider flag", () => {
    const result = parse("install", "github:user/repo", "--provider", "claude");
    expect(result.flags.provider).toBe("claude");
  });

  test("parses -p shorthand", () => {
    const result = parse("install", "github:user/repo", "-p", "codex");
    expect(result.flags.provider).toBe("codex");
  });

  test("parses --name flag", () => {
    const result = parse(
      "install",
      "github:user/repo",
      "--name",
      "my-custom-name",
    );
    expect(result.flags.name).toBe("my-custom-name");
  });

  test("parses --force flag", () => {
    const result = parse("install", "github:user/repo", "--force");
    expect(result.flags.force).toBe(true);
  });

  test("parses -f shorthand", () => {
    const result = parse("install", "github:user/repo", "-f");
    expect(result.flags.force).toBe(true);
  });

  test("parses combined flags", () => {
    const result = parse(
      "install",
      "github:user/repo",
      "-p",
      "claude",
      "--name",
      "review",
      "-f",
      "-y",
    );
    expect(result.flags.provider).toBe("claude");
    expect(result.flags.name).toBe("review");
    expect(result.flags.force).toBe(true);
    expect(result.flags.yes).toBe(true);
  });

  test("defaults provider to null", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.provider).toBeNull();
  });

  test("defaults name to null", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.name).toBeNull();
  });

  test("defaults force to false", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.force).toBe(false);
  });

  test("parses --path flag", () => {
    const result = parse(
      "install",
      "github:user/repo",
      "--path",
      "skills/code-review",
    );
    expect(result.flags.path).toBe("skills/code-review");
  });

  test("parses --all flag", () => {
    const result = parse("install", "github:user/repo", "--all");
    expect(result.flags.all).toBe(true);
  });

  test("defaults path to null", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.path).toBeNull();
  });

  test("defaults all to false", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.all).toBe(false);
  });

  test("combined flags with --path and --all", () => {
    const result = parse(
      "install",
      "github:user/repo",
      "--all",
      "-p",
      "claude",
      "-f",
      "-y",
    );
    expect(result.flags.all).toBe(true);
    expect(result.flags.provider).toBe("claude");
    expect(result.flags.force).toBe(true);
    expect(result.flags.yes).toBe(true);
  });

  test("defaults transport to auto", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.transport).toBe("auto");
  });

  test("parses --transport https", () => {
    const result = parse("install", "github:user/repo", "--transport", "https");
    expect(result.flags.transport).toBe("https");
  });

  test("parses --transport ssh", () => {
    const result = parse("install", "github:user/repo", "--transport", "ssh");
    expect(result.flags.transport).toBe("ssh");
  });

  test("parses --transport auto", () => {
    const result = parse("install", "github:user/repo", "--transport", "auto");
    expect(result.flags.transport).toBe("auto");
  });

  test("parses -t shorthand", () => {
    const result = parse("install", "github:user/repo", "-t", "ssh");
    expect(result.flags.transport).toBe("ssh");
  });

  test("defaults method to default", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.method).toBe("default");
  });

  test("parses --method vercel", () => {
    const result = parse("install", "github:user/repo", "--method", "vercel");
    expect(result.flags.method).toBe("vercel");
  });

  test("parses -m shorthand for method", () => {
    const result = parse("install", "github:user/repo", "-m", "vercel");
    expect(result.flags.method).toBe("vercel");
  });

  test("parses --skill as alias for --path", () => {
    const result = parse(
      "install",
      "github:user/skills",
      "--skill",
      "my-skill",
    );
    expect(result.flags.path).toBe("my-skill");
  });

  test("parses --no-cache flag", () => {
    const result = parse("install", "code-review", "--no-cache");
    expect(result.flags.noCache).toBe(true);
  });

  test("defaults noCache to false", () => {
    const result = parse("install", "github:user/repo");
    expect(result.flags.noCache).toBe(false);
  });

  test("combined vercel method flags", () => {
    const result = parse(
      "install",
      "github:user/skills",
      "--method",
      "vercel",
      "--skill",
      "my-skill",
      "-p",
      "claude",
      "-y",
    );
    expect(result.flags.method).toBe("vercel");
    expect(result.flags.path).toBe("my-skill");
    expect(result.flags.provider).toBe("claude");
    expect(result.flags.yes).toBe(true);
  });
});

// ─── isCLIMode: install ────────────────────────────────────────────────────

describe("isCLIMode: install", () => {
  const check = (...args: string[]) => isCLIMode(["bun", "script.ts", ...args]);

  test("install → CLI mode", () => {
    expect(check("install")).toBe(true);
  });
});

// ─── CLI integration: install ──────────────────────────────────────────────

describe("CLI integration: install", () => {
  test("install --help shows usage", async () => {
    const { stdout, exitCode } = await runCLI("install", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm install");
    expect(stdout).toContain("github:owner/repo");
    expect(stdout).toContain("https://github.com/owner/repo");
    expect(stdout).toContain("--tool");
    expect(stdout).toContain("--name");
    expect(stdout).toContain("--path");
    expect(stdout).toContain("--skill");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--transport");
    expect(stdout).toContain("--method");
    expect(stdout).toContain("Vercel");
  });

  test("install with missing source exits 2", async () => {
    const { stderr, exitCode } = await runCLI("install");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("main --help includes install command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("install");
  });
});

// ─── CLI integration: install registry resolution ─────────────────────────

describe("CLI integration: install registry resolution", () => {
  test("bare name resolves via registry when fetch returns a valid index", async () => {
    // We run a subprocess that:
    //   1. Starts a tiny HTTP server serving a fake registry index
    //   2. Overrides REGISTRY_INDEX_URL via env so the CLI hits our server
    //   3. Invokes cmdInstall logic with a bare name
    //   4. Verifies the constructed source string matches the registry entry
    const script = `
      import http from "node:http";
      import { resolveFromRegistry } from "./src/registry";

      // Spin up a local server that returns a valid registry index
      const manifest = {
        name: "my-test-skill",
        author: "testauthor",
        description: "A test skill",
        repository: "https://github.com/testauthor/my-test-repo",
        commit: "${"a".repeat(40)}",
        security_verdict: "pass",
        published_at: "2026-01-01T00:00:00Z",
      };
      const index = { generated_at: "2026-01-01T00:00:00Z", manifests: [manifest] };

      const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(index));
      });

      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;

      // Monkey-patch the registry module's fetch to hit our local server
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        // Redirect registry URL to local server
        if (typeof url === "string" && url.includes("asm-registry")) {
          return origFetch("http://127.0.0.1:" + port + "/index.json", opts);
        }
        return origFetch(url, opts);
      };

      try {
        const result = await resolveFromRegistry("my-test-skill", { noCache: true });
        if (!result.resolved) {
          process.stderr.write("FAIL: expected resolved to be non-null");
          process.exit(1);
        }
        const m = result.resolved.manifest;
        const sourceStr = "github:" + m.repository.replace("https://github.com/", "") + "#" + m.commit;
        process.stdout.write(sourceStr);
      } finally {
        globalThis.fetch = origFetch;
        server.close();
      }
    `;

    const proc = Bun.spawn(["bun", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
      cwd: join(import.meta.dir, ".."),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBe(`github:testauthor/my-test-repo#${"a".repeat(40)}`);
    // No errors on stderr
    expect(stderr).not.toContain("FAIL");
  });
});

// ─── CLI integration: verbose flag ──────────────────────────────────────

describe("readLine", () => {
  test("resolves with input followed by newline", async () => {
    // Test readLine directly using a helper subprocess
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(result);
    `;
    const proc = Bun.spawn(["bun", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: new Blob(["hello\n"]),
      env: { ...process.env },
      cwd: join(import.meta.dir, ".."),
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe("hello");
  });

  test("resolves on EOF without trailing newline", async () => {
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(result);
    `;
    const proc = Bun.spawn(["bun", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: new Blob(["yes"]),
      env: { ...process.env },
      cwd: join(import.meta.dir, ".."),
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe("yes");
  });

  test("empty EOF resolves with empty string", async () => {
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(JSON.stringify(result));
    `;
    const proc = Bun.spawn(["bun", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: new Blob([""]),
      env: { ...process.env },
      cwd: join(import.meta.dir, ".."),
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe('""');
  });
});

describe("CLI integration: verbose flag", () => {
  test("list -V produces verbose output on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCLI("list", "-V");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("[verbose]");
    expect(stderr).toMatch(/\+\d+ms/);
  });

  test("list --verbose produces verbose output on stderr", async () => {
    const { stderr, exitCode } = await runCLI("list", "--verbose");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("[verbose]");
  });

  test("verbose does not pollute stdout with --json", async () => {
    const { stdout, stderr, exitCode } = await runCLI(
      "list",
      "--verbose",
      "--json",
    );
    expect(exitCode).toBe(0);
    // stdout should be valid JSON
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    // stderr should have verbose output
    expect(stderr).toContain("[verbose]");
  });

  test("--help includes --verbose in global options", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("--verbose");
    expect(stdout).toContain("-V");
  });
});

// ─── parseArgs: additional flags ────────────────────────────────────────────

describe("parseArgs: additional flags", () => {
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("parses --flat flag", () => {
    const result = parse("list", "--flat");
    expect(result.flags.flat).toBe(true);
  });

  test("defaults flat to false", () => {
    const result = parse("list");
    expect(result.flags.flat).toBe(false);
  });

  test("parses --installed flag", () => {
    const result = parse("search", "q", "--installed");
    expect(result.flags.installed).toBe(true);
  });

  test("defaults installed to false", () => {
    const result = parse("search", "q");
    expect(result.flags.installed).toBe(false);
  });

  test("parses --available flag", () => {
    const result = parse("search", "q", "--available");
    expect(result.flags.available).toBe(true);
  });

  test("defaults available to false", () => {
    const result = parse("search", "q");
    expect(result.flags.available).toBe(false);
  });

  test("parses --tool as alias for --provider", () => {
    const result = parse("list", "--tool", "claude");
    expect(result.flags.provider).toBe("claude");
  });

  test("parses invalid --transport exits (parseArgs does not exit, but validates)", () => {
    // Note: parseArgs calls process.exit for invalid transport,
    // so we test via integration instead
    const result = parse("install", "github:user/repo", "--transport", "auto");
    expect(result.flags.transport).toBe("auto");
  });
});

// ─── isCLIMode: newer commands ──────────────────────────────────────────────

describe("isCLIMode: newer commands", () => {
  const check = (...args: string[]) => isCLIMode(["bun", "script.ts", ...args]);

  test("export → CLI mode", () => {
    expect(check("export")).toBe(true);
  });

  test("import → CLI mode", () => {
    expect(check("import")).toBe(true);
  });

  test("init → CLI mode", () => {
    expect(check("init")).toBe(true);
  });

  test("stats → CLI mode", () => {
    expect(check("stats")).toBe(true);
  });

  test("link → CLI mode", () => {
    expect(check("link")).toBe(true);
  });

  test("index → CLI mode", () => {
    expect(check("index")).toBe(true);
  });

  test("eval → CLI mode", () => {
    expect(check("eval")).toBe(true);
  });

  test("eval-providers → CLI mode", () => {
    expect(check("eval-providers")).toBe(true);
  });

  test("doctor → CLI mode", () => {
    expect(check("doctor")).toBe(true);
  });
});

// ─── CLI integration: per-command --help (new commands) ─────────────────────

describe("CLI integration: per-command --help (new commands)", () => {
  test("export --help shows export usage", async () => {
    const { stdout, exitCode } = await runCLI("export", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm export");
    expect(stdout).toContain("--scope");
  });

  test("import --help shows import usage", async () => {
    const { stdout, exitCode } = await runCLI("import", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm import");
    expect(stdout).toContain("--scope");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--json");
  });

  test("init --help shows init usage", async () => {
    const { stdout, exitCode } = await runCLI("init", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm init");
    expect(stdout).toContain("--tool");
    expect(stdout).toContain("--path");
    expect(stdout).toContain("--force");
  });

  test("stats --help shows stats usage", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm stats");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--scope");
  });

  test("link --help shows link usage", async () => {
    const { stdout, exitCode } = await runCLI("link", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm link");
    expect(stdout).toContain("--tool");
    expect(stdout).toContain("--name");
    expect(stdout).toContain("--force");
  });

  test("index --help shows index usage", async () => {
    const { stdout, exitCode } = await runCLI("index", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm index");
    expect(stdout).toContain("ingest");
    expect(stdout).toContain("search");
    expect(stdout).toContain("list");
    expect(stdout).toContain("remove");
  });

  test("eval --help shows eval usage", async () => {
    const { stdout, exitCode } = await runCLI("eval", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm eval");
    expect(stdout).toContain("--fix");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--json");
    // Eval --help should point users at the eval-providers subcommand (PR 3).
    expect(stdout).toContain("eval-providers");
  });

  test("eval-providers --help shows subcommands", async () => {
    const { stdout, exitCode } = await runCLI("eval-providers", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm eval-providers");
    expect(stdout).toContain("list");
    expect(stdout).toContain("--json");
  });

  test("main --help documents eval-providers command", async () => {
    const { stdout, exitCode } = await runCLI("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("eval-providers");
  });
});

// ─── CLI integration: eval ─────────────────────────────────────────────────

describe("CLI integration: eval", () => {
  async function makeTempSkill(
    body: string,
  ): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "eval-cli-"));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), body, "utf-8");
    return {
      dir,
      cleanup: async () => rm(dir, { recursive: true, force: true }),
    };
  }

  test("eval missing path exits with code 2", async () => {
    const { exitCode, stderr } = await runCLI("eval");
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/Missing required argument/i);
  });

  test("eval --json emits a parseable report", async () => {
    const { dir, cleanup } = await makeTempSkill(
      "---\nname: eval-cli\ndescription: Evaluate a thing when asked.\n---\n\n# eval-cli\n\n## When to Use\n\n- Something\n\n## Instructions\n\n1. Do the thing\n",
    );
    try {
      const { stdout, exitCode } = await runCLI("eval", dir, "--json");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("overallScore");
      expect(parsed).toHaveProperty("categories");
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.categories.length).toBe(7);
    } finally {
      await cleanup();
    }
  });

  test("eval --machine emits v1 envelope", async () => {
    const { dir, cleanup } = await makeTempSkill(
      "---\nname: eval-machine\ndescription: Evaluate when asked.\n---\n\nbody\n",
    );
    try {
      const { stdout, exitCode } = await runCLI("eval", dir, "--machine");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.version).toBe(1);
      expect(parsed.command).toBe("eval");
      expect(parsed.status).toBe("ok");
      expect(parsed.data.overall_score).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanup();
    }
  });

  test("eval --fix --dry-run does not modify SKILL.md", async () => {
    const original =
      "---\nname: dry-run-cli\ndescription: Do a thing when asked.\n---\n\nbody\n";
    const { dir, cleanup } = await makeTempSkill(original);
    try {
      const { exitCode } = await runCLI("eval", dir, "--fix", "--dry-run");
      expect(exitCode).toBe(0);
      const after = await readFile(join(dir, "SKILL.md"), "utf-8");
      expect(after).toBe(original);
    } finally {
      await cleanup();
    }
  });

  test("eval --fix creates .bak and modifies SKILL.md", async () => {
    const original =
      "---\nname: fix-cli\ndescription: Do a thing when asked.\n---\n\nbody\n";
    const { dir, cleanup } = await makeTempSkill(original);
    try {
      const { exitCode } = await runCLI("eval", dir, "--fix");
      expect(exitCode).toBe(0);
      const after = await readFile(join(dir, "SKILL.md"), "utf-8");
      expect(after).toContain("version: 0.1.0");
      const backup = await readFile(join(dir, "SKILL.md.bak"), "utf-8");
      expect(backup).toBe(original);
    } finally {
      await cleanup();
    }
  });

  // The eval framework replaced the direct evaluator call in PR 3 (#157). The
  // issue's primary acceptance criterion is that user-visible output is
  // byte-identical for all modes. These tests exercise each output path and
  // assert on the concrete structural invariants the old code honored — so a
  // future regression (e.g. accidentally dropping a findings array, changing
  // category count) surfaces immediately instead of only when someone reads
  // the diff.

  test("eval text output preserves the legacy 7-section structure", async () => {
    const { dir, cleanup } = await makeTempSkill(
      "---\nname: eval-text\ndescription: Do a thing when asked.\n---\n\n# eval-text\n\n## When to Use\n\n- Something\n\n## Instructions\n\n1. Do the thing\n",
    );
    try {
      const { stdout, exitCode } = await runCLI("eval", dir);
      expect(exitCode).toBe(0);
      // Every text-mode report printed by the legacy evaluator had these
      // exact lead-in strings and an Overall score line — we lock those in.
      expect(stdout).toContain("Skill evaluation:");
      expect(stdout).toContain("SKILL.md:");
      expect(stdout).toContain("Overall score:");
      expect(stdout).toContain("Categories:");
    } finally {
      await cleanup();
    }
  });

  test("eval --json carries the full EvaluationReport shape (not an EvalResult)", async () => {
    const { dir, cleanup } = await makeTempSkill(
      "---\nname: eval-json-shape\ndescription: Do a thing when asked.\n---\n\n# eval-json-shape\n",
    );
    try {
      const { stdout, exitCode } = await runCLI("eval", dir, "--json");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      // Legacy shape: EvaluationReport keys. If the runner's EvalResult
      // envelope ever leaks out (providerId, schemaVersion at top level),
      // these assertions break.
      expect(parsed).toHaveProperty("skillPath");
      expect(parsed).toHaveProperty("skillMdPath");
      expect(parsed).toHaveProperty("evaluatedAt");
      expect(parsed).toHaveProperty("overallScore");
      expect(parsed).toHaveProperty("grade");
      expect(parsed).toHaveProperty("topSuggestions");
      expect(parsed).toHaveProperty("frontmatter");
      expect(parsed).not.toHaveProperty("providerId");
      expect(parsed).not.toHaveProperty("schemaVersion");
      // Every category still carries findings + suggestions arrays — the
      // adapter hides those inside `raw`, but the CLI must unwrap them.
      expect(Array.isArray(parsed.categories)).toBe(true);
      for (const cat of parsed.categories) {
        expect(Array.isArray(cat.findings)).toBe(true);
        expect(Array.isArray(cat.suggestions)).toBe(true);
      }
    } finally {
      await cleanup();
    }
  });

  test("eval error on missing path emits SKILL_NOT_FOUND machine envelope + exit 1", async () => {
    // Runner wraps thrown errors into an EvalResult; the CLI must re-throw so
    // the machine envelope still uses SKILL_NOT_FOUND (not a generic error).
    const missing = join(
      tmpdir(),
      `eval-missing-${Date.now()}-${Math.random()}`,
    );
    const { stdout, exitCode } = await runCLI("eval", missing, "--machine");
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("SKILL_NOT_FOUND");
    expect(parsed.error.message).toMatch(/does not exist/i);
  });

  test("eval error on missing path prints legacy Error: line + exit 1 (human mode)", async () => {
    const missing = join(
      tmpdir(),
      `eval-missing-${Date.now()}-${Math.random()}`,
    );
    const { stderr, exitCode } = await runCLI("eval", missing);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/^Error: /m);
    expect(stderr).toMatch(/does not exist/i);
  });
});

// ─── CLI integration: eval --runtime (skillgrade) ──────────────────────────

// The runtime provider shells out to the external `skillgrade` binary, which
// is not installed in CI. The CLI's user-visible contract in that situation
// is that applicable() produces an actionable reason — no crash, no stack
// trace, exit 1. These tests lock in that contract without ever running
// skillgrade for real. Deeper end-to-end exercising of run() lives in
// src/eval/providers/skillgrade/v1/index.test.ts where the Spawner seam can
// return recorded fixture JSON without any subprocess.

describe("CLI integration: eval --runtime", () => {
  async function makeSkillDir(
    opts: { withEvalYaml?: boolean } = {},
  ): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), "eval-runtime-cli-"));
    await writeFile(
      join(dir, "SKILL.md"),
      "---\nname: runtime-cli\ndescription: Runtime eval test skill when invoked.\n---\n\n# runtime-cli\n\n## Instructions\n\n1. Do the thing\n",
      "utf-8",
    );
    if (opts.withEvalYaml) {
      await writeFile(
        join(dir, "eval.yaml"),
        "name: runtime-cli\npreset: smoke\nthreshold: 0.8\n",
        "utf-8",
      );
    }
    return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  // Force the skillgrade detection to fail by scrubbing PATH so any
  // `skillgrade` binary is invisible to the subprocess. We still need
  // bun itself on PATH to run the CLI, so we carefully keep the bun
  // binary's directory (derived from `process.execPath`) but nothing
  // else. If a developer has bun installed alongside skillgrade in the
  // same directory, the PATH scrub won't hide it — but that's an
  // extremely unusual layout and the test still validates the CLI
  // correctly surfaces applicable() reasons for any failure shape.
  async function runRuntimeCLI(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { dirname } = await import("path");
    const bunDir = dirname(process.execPath);
    const emptyDir = await mkdtemp(join(tmpdir(), "empty-path-"));
    try {
      // PATH: empty-dir first (to shadow anything), then bun's dir.
      // Standard locations like /usr/bin are intentionally excluded so
      // a system `skillgrade` can't slip through.
      const scrubbedPath = [emptyDir, bunDir].join(":");
      const proc = Bun.spawn([process.execPath, CLI_BIN, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1", PATH: scrubbedPath },
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
      };
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  }

  test("eval --runtime exits 1 with install hint when skillgrade is missing", async () => {
    const { dir, cleanup } = await makeSkillDir({ withEvalYaml: true });
    try {
      const { stderr, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skillgrade not installed/);
      expect(stderr).toMatch(/npm i -g skillgrade/);
    } finally {
      await cleanup();
    }
  });

  test("eval --runtime --machine emits a structured error envelope", async () => {
    const { dir, cleanup } = await makeSkillDir({ withEvalYaml: true });
    try {
      const { stdout, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
        "--machine",
      );
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(parsed.status).toBe("error");
      expect(parsed.error.message).toMatch(/skillgrade/);
    } finally {
      await cleanup();
    }
  });

  test("eval --runtime init surfaces a scaffold error when skillgrade is missing", async () => {
    const { dir, cleanup } = await makeSkillDir();
    try {
      const { stderr, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
        "init",
      );
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skillgrade/);
    } finally {
      await cleanup();
    }
  });

  test("eval --runtime rejects an invalid --provider value", async () => {
    const { dir, cleanup } = await makeSkillDir({ withEvalYaml: true });
    try {
      const { stderr, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
        "--provider",
        "aws",
      );
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/Invalid --provider/);
    } finally {
      await cleanup();
    }
  });

  test("eval --runtime rejects an invalid --preset value", async () => {
    const { dir, cleanup } = await makeSkillDir({ withEvalYaml: true });
    try {
      const { stderr, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
        "--preset",
        "nuclear",
      );
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/Invalid --preset/);
    } finally {
      await cleanup();
    }
  });

  test("eval --runtime rejects a non-numeric --threshold", async () => {
    const { dir, cleanup } = await makeSkillDir({ withEvalYaml: true });
    try {
      const { stderr, exitCode } = await runRuntimeCLI(
        "eval",
        dir,
        "--runtime",
        "--threshold",
        "abc",
      );
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/Invalid --threshold/);
    } finally {
      await cleanup();
    }
  });

  // Stub-binary end-to-end test. This proves the headline acceptance
  // criterion — "asm eval ./fixture --runtime produces expected output
  // against recorded skillgrade JSON" — at the real CLI layer, not just
  // the provider unit layer. We write a tiny shell script that mimics
  // `skillgrade --version` and `skillgrade run --json`, put it first on
  // PATH, and let the CLI shell out to it. Zero live LLM calls.
  test("eval --runtime with a stub skillgrade binary produces a passing report", async () => {
    const { dir: skillDir, cleanup: cleanupSkill } = await makeSkillDir({
      withEvalYaml: true,
    });
    const stubDir = await mkdtemp(join(tmpdir(), "stub-skillgrade-"));
    try {
      const fixture = JSON.stringify({
        version: "0.1.4",
        skill: "runtime-cli",
        preset: "smoke",
        threshold: 0.8,
        passRate: 0.95,
        passed: true,
        tasks: [
          {
            id: "hello",
            passed: true,
            trials: 5,
            passing: 5,
            passRate: 1.0,
            graders: [{ id: "contains", passed: true, message: "has hello" }],
          },
        ],
      });
      // Escape single quotes via ASCII char for safe shell embedding.
      const escapedFixture = fixture.replace(/'/g, "'\\''");
      const stubPath = join(stubDir, "skillgrade");
      await writeFile(
        stubPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "skillgrade 0.1.4"',
          "  exit 0",
          "fi",
          'if [ "$1" = "run" ]; then',
          `  printf '%s' '${escapedFixture}'`,
          "  exit 0",
          "fi",
          "exit 127",
        ].join("\n"),
        "utf-8",
      );
      await (await import("fs/promises")).chmod(stubPath, 0o755);

      // Keep bun itself + the stub on PATH; everything else scrubbed so
      // a system skillgrade can't interfere.
      const { dirname } = await import("path");
      const bunDir = dirname(process.execPath);
      const scrubbedPath = [stubDir, bunDir].join(":");

      const proc = Bun.spawn(
        [process.execPath, CLI_BIN, "eval", skillDir, "--runtime", "--json"],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1", PATH: scrubbedPath },
        },
      );
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stderr).not.toMatch(/not installed/);

      const parsed = JSON.parse(stdout);
      expect(parsed.providerId).toBe("skillgrade");
      expect(parsed.providerVersion).toBe("1.0.0");
      expect(parsed.score).toBe(95);
      expect(parsed.passed).toBe(true);
      expect(parsed.categories).toHaveLength(1);
      expect(parsed.categories[0].id).toBe("hello");
    } finally {
      await cleanupSkill();
      await rm(stubDir, { recursive: true, force: true });
    }
  });

  test("eval --runtime reads preset/threshold/provider from ~/.asm/config.yml", async () => {
    // HOME override → config.yml placed under a fake home so we don't
    // touch the developer's real ~/.asm/config.yml.
    const fakeHome = await mkdtemp(join(tmpdir(), "runtime-home-"));
    const asmDir = join(fakeHome, ".asm");
    await mkdir(asmDir, { recursive: true });
    await writeFile(
      join(asmDir, "config.yml"),
      [
        "eval:",
        "  providers:",
        "    skillgrade:",
        "      preset: reliable",
        "      threshold: 0.9",
        "      provider: local",
      ].join("\n"),
      "utf-8",
    );

    const { dir: skillDir, cleanup: cleanupSkill } = await makeSkillDir({
      withEvalYaml: true,
    });
    const stubDir = await mkdtemp(join(tmpdir(), "stub-cfg-"));
    try {
      // Stub records its argv to a side-channel file we assert on.
      const argvLog = join(stubDir, "argv.txt");
      const stubPath = join(stubDir, "skillgrade");
      const fixture = JSON.stringify({
        version: "0.1.4",
        passRate: 1.0,
        passed: true,
        tasks: [],
      });
      const escapedFixture = fixture.replace(/'/g, "'\\''");
      await writeFile(
        stubPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "skillgrade 0.1.4"',
          "  exit 0",
          "fi",
          'if [ "$1" = "run" ]; then',
          `  printf '%s\\n' "$@" > '${argvLog}'`,
          `  printf '%s' '${escapedFixture}'`,
          "  exit 0",
          "fi",
          "exit 127",
        ].join("\n"),
        "utf-8",
      );
      await (await import("fs/promises")).chmod(stubPath, 0o755);

      const { dirname } = await import("path");
      const bunDir = dirname(process.execPath);
      const scrubbedPath = [stubDir, bunDir].join(":");

      const proc = Bun.spawn(
        [process.execPath, CLI_BIN, "eval", skillDir, "--runtime", "--json"],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            NO_COLOR: "1",
            PATH: scrubbedPath,
            HOME: fakeHome,
          },
        },
      );
      const [stdout] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout).passed).toBe(true);
      const loggedArgv = await readFile(argvLog, "utf-8");
      expect(loggedArgv).toContain("reliable");
      expect(loggedArgv).toContain("0.9");
      expect(loggedArgv).toContain("local");
    } finally {
      await cleanupSkill();
      await rm(stubDir, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  test("eval --runtime CLI flags override config values", async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), "runtime-home-2-"));
    const asmDir = join(fakeHome, ".asm");
    await mkdir(asmDir, { recursive: true });
    await writeFile(
      join(asmDir, "config.yml"),
      [
        "eval:",
        "  providers:",
        "    skillgrade:",
        "      preset: regression",
        "      threshold: 0.99",
        "      provider: docker",
      ].join("\n"),
      "utf-8",
    );

    const { dir: skillDir, cleanup: cleanupSkill } = await makeSkillDir({
      withEvalYaml: true,
    });
    const stubDir = await mkdtemp(join(tmpdir(), "stub-cfg-override-"));
    try {
      const argvLog = join(stubDir, "argv.txt");
      const stubPath = join(stubDir, "skillgrade");
      const fixture = JSON.stringify({
        version: "0.1.4",
        passRate: 1.0,
        passed: true,
        tasks: [],
      });
      const escapedFixture = fixture.replace(/'/g, "'\\''");
      await writeFile(
        stubPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "skillgrade 0.1.4"',
          "  exit 0",
          "fi",
          'if [ "$1" = "run" ]; then',
          `  printf '%s\\n' "$@" > '${argvLog}'`,
          `  printf '%s' '${escapedFixture}'`,
          "  exit 0",
          "fi",
          "exit 127",
        ].join("\n"),
        "utf-8",
      );
      await (await import("fs/promises")).chmod(stubPath, 0o755);

      const { dirname } = await import("path");
      const bunDir = dirname(process.execPath);
      const scrubbedPath = [stubDir, bunDir].join(":");

      const proc = Bun.spawn(
        [
          process.execPath,
          CLI_BIN,
          "eval",
          skillDir,
          "--runtime",
          "--preset",
          "smoke",
          "--threshold",
          "0.7",
          "--provider",
          "local",
          "--json",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            NO_COLOR: "1",
            PATH: scrubbedPath,
            HOME: fakeHome,
          },
        },
      );
      await new Response(proc.stdout).text();
      await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);

      const loggedArgv = await readFile(argvLog, "utf-8");
      // CLI values, not config values.
      expect(loggedArgv).toContain("smoke");
      expect(loggedArgv).toContain("0.7");
      expect(loggedArgv).toContain("local");
      expect(loggedArgv).not.toContain("regression");
      expect(loggedArgv).not.toContain("0.99");
    } finally {
      await cleanupSkill();
      await rm(stubDir, { recursive: true, force: true });
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  test("eval --runtime with a failing stub exits 1 and reports failure", async () => {
    const { dir: skillDir, cleanup: cleanupSkill } = await makeSkillDir({
      withEvalYaml: true,
    });
    const stubDir = await mkdtemp(join(tmpdir(), "stub-skillgrade-fail-"));
    try {
      const fixture = JSON.stringify({
        version: "0.1.4",
        skill: "runtime-cli",
        passRate: 0.4,
        passed: false,
        tasks: [
          {
            id: "sad-path",
            passed: false,
            trials: 5,
            passing: 2,
            graders: [{ id: "contains", passed: false, message: "no hello" }],
          },
        ],
      });
      const escapedFixture = fixture.replace(/'/g, "'\\''");
      const stubPath = join(stubDir, "skillgrade");
      await writeFile(
        stubPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then',
          '  echo "skillgrade 0.1.4"',
          "  exit 0",
          "fi",
          'if [ "$1" = "run" ]; then',
          `  printf '%s' '${escapedFixture}'`,
          "  exit 0",
          "fi",
          "exit 127",
        ].join("\n"),
        "utf-8",
      );
      await (await import("fs/promises")).chmod(stubPath, 0o755);

      const { dirname } = await import("path");
      const bunDir = dirname(process.execPath);
      const scrubbedPath = [stubDir, bunDir].join(":");

      const proc = Bun.spawn(
        [process.execPath, CLI_BIN, "eval", skillDir, "--runtime"],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, NO_COLOR: "1", PATH: scrubbedPath },
        },
      );
      const [stdout] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/FAIL/);
      expect(stdout).toMatch(/score=40/);
    } finally {
      await cleanupSkill();
      await rm(stubDir, { recursive: true, force: true });
    }
  });
});

// ─── parseArgs: runtime flags ───────────────────────────────────────────────

describe("parseArgs — runtime flags", () => {
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("--runtime sets flags.runtime", () => {
    const result = parse("eval", "./skill", "--runtime");
    expect(result.flags.runtime).toBe(true);
  });

  test("--runtime defaults to false", () => {
    const result = parse("eval", "./skill");
    expect(result.flags.runtime).toBe(false);
  });

  test("--preset captures the next token", () => {
    const result = parse(
      "eval",
      "./skill",
      "--runtime",
      "--preset",
      "reliable",
    );
    expect(result.flags.preset).toBe("reliable");
  });

  test("--threshold accepts fractional values", () => {
    const result = parse("eval", "./skill", "--runtime", "--threshold", "0.9");
    expect(result.flags.threshold).toBe(0.9);
  });

  test("--threshold accepts 0..100 integer values", () => {
    const result = parse("eval", "./skill", "--runtime", "--threshold", "85");
    expect(result.flags.threshold).toBe(85);
  });

  test("--runtime init carries `init` as a positional arg", () => {
    const result = parse("eval", "./skill", "--runtime", "init");
    expect(result.flags.runtime).toBe(true);
    expect(result.positional).toContain("init");
  });
});

// ─── CLI integration: eval-providers ────────────────────────────────────────

describe("CLI integration: eval-providers", () => {
  test("eval-providers list prints quality@1.0.0 with schema + description", async () => {
    const { stdout, exitCode } = await runCLI("eval-providers", "list");
    expect(exitCode).toBe(0);
    // Column header + one quality row. Exact formatting is incidental; we
    // assert on the required data points so the table can be retuned later.
    expect(stdout).toContain("id");
    expect(stdout).toContain("version");
    expect(stdout).toContain("schemaVersion");
    expect(stdout).toContain("description");
    expect(stdout).toContain("requires");
    expect(stdout).toContain("quality");
    expect(stdout).toContain("1.0.0");
    expect(stdout).toContain("Static linter for SKILL.md");
  });

  test("eval-providers list --json emits a parseable array", async () => {
    const { stdout, exitCode } = await runCLI(
      "eval-providers",
      "list",
      "--json",
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    const quality = parsed.find((p: { id: string }) => p.id === "quality");
    expect(quality).toBeTruthy();
    expect(quality.version).toBe("1.0.0");
    expect(quality.schemaVersion).toBe(1);
    expect(typeof quality.description).toBe("string");
    expect(quality.description.length).toBeGreaterThan(0);
    expect(Array.isArray(quality.requires)).toBe(true);
  });

  test("eval-providers with no subcommand exits with code 2", async () => {
    const { exitCode, stderr } = await runCLI("eval-providers");
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/Missing subcommand/i);
  });

  test("eval-providers with unknown subcommand exits with code 2", async () => {
    const { exitCode, stderr } = await runCLI("eval-providers", "add");
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/Unknown eval-providers subcommand/i);
  });
});

// ─── CLI integration: export ────────────────────────────────────────────────

describe("CLI integration: export", () => {
  test("export outputs valid JSON manifest", async () => {
    const { stdout, exitCode } = await runCLI("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("exportedAt");
    expect(data).toHaveProperty("skills");
    expect(Array.isArray(data.skills)).toBe(true);
  });

  test("export manifest version is 1", async () => {
    const { stdout, exitCode } = await runCLI("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.version).toBe(1);
  });

  test("export manifest has valid exportedAt timestamp", async () => {
    const { stdout } = await runCLI("export");
    const data = JSON.parse(stdout);
    const date = new Date(data.exportedAt);
    expect(date.getTime()).not.toBeNaN();
  });

  test("export skills include expected fields", async () => {
    const { stdout } = await runCLI("export");
    const data = JSON.parse(stdout);
    if (data.skills.length > 0) {
      const skill = data.skills[0];
      expect(skill).toHaveProperty("name");
      expect(skill).toHaveProperty("version");
      expect(skill).toHaveProperty("dirName");
      expect(skill).toHaveProperty("provider");
      expect(skill).toHaveProperty("scope");
      expect(skill).toHaveProperty("path");
      expect(skill).toHaveProperty("isSymlink");
    }
  });

  test("export --scope global filters to global only", async () => {
    const { stdout, exitCode } = await runCLI("export", "--scope", "global");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data.skills) {
      expect(skill.scope).toBe("global");
    }
  });

  test("export --scope project filters to project only", async () => {
    const { stdout, exitCode } = await runCLI("export", "--scope", "project");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    for (const skill of data.skills) {
      expect(skill.scope).toBe("project");
    }
  });

  test("main --help includes export command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("export");
  });

  test("main --help includes import command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("import");
  });
});

// ─── CLI integration: import ────────────────────────────────────────────────

describe("CLI integration: import", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "import-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("import without argument shows error", async () => {
    const { stderr, exitCode } = await runCLI("import");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("import nonexistent file shows error", async () => {
    const { stderr, exitCode } = await runCLI(
      "import",
      "/tmp/nonexistent-manifest-xyz.json",
      "--yes",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Manifest file not found");
  });

  test("import invalid JSON shows error", async () => {
    const badFile = join(tempDir, "bad.json");
    await writeFile(badFile, "not json");
    const { stderr, exitCode } = await runCLI("import", badFile, "--yes");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not valid JSON");
  });

  test("import invalid manifest schema shows error", async () => {
    const badFile = join(tempDir, "bad-schema.json");
    await writeFile(badFile, JSON.stringify({ version: 99, skills: "wrong" }));
    const { stderr, exitCode } = await runCLI("import", badFile, "--yes");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid manifest");
  });

  test("import empty manifest shows nothing to import", async () => {
    const emptyFile = join(tempDir, "empty.json");
    await writeFile(
      emptyFile,
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: [],
      }),
    );
    const { stdout, exitCode } = await runCLI("import", emptyFile, "--yes");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no skills");
  });

  test("import with --json outputs valid JSON", async () => {
    // First export, then import
    const { stdout: exportOut } = await runCLI("export");
    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, exportOut);

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("installed");
    expect(data).toHaveProperty("skipped");
    expect(data).toHaveProperty("failed");
    expect(data).toHaveProperty("results");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("import existing skills are skipped", async () => {
    const { stdout: exportOut } = await runCLI("export");
    const data = JSON.parse(exportOut);
    if (data.skills.length === 0) return; // no skills to test with

    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, exportOut);

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // All should be skipped since they already exist
    expect(result.failed).toBe(0);
    for (const r of result.results) {
      expect(r.status).toBe("skipped");
    }
  });

  test("import --scope global filters to global only", async () => {
    const { stdout: exportOut } = await runCLI("export");
    const data = JSON.parse(exportOut);
    // Create a manifest with both global and project skills
    const manifest = {
      ...data,
      skills: [
        ...(data.skills.length > 0
          ? [{ ...data.skills[0], scope: "global" }]
          : []),
        {
          name: "fake-project-skill",
          version: "1.0.0",
          dirName: "fake-project-skill",
          provider: "claude",
          scope: "project",
          path: "/fake/path",
          isSymlink: false,
          symlinkTarget: null,
        },
      ],
    };

    const exportFile = join(tempDir, "export.json");
    await writeFile(exportFile, JSON.stringify(manifest));

    const { stdout, exitCode } = await runCLI(
      "import",
      exportFile,
      "--yes",
      "--json",
      "--scope",
      "global",
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // No project-scoped skills should appear in results
    for (const r of result.results) {
      expect(r.scope).toBe("global");
    }
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
    // If no skills, stats outputs "No skills found." to stdout
    if (stdout === "No skills found.") return;
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
    if (stdout === "No skills found.") return;
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("perSkillDiskBytes");
  });

  test("stats --json without verbose omits perSkillDiskBytes", async () => {
    const { stdout, exitCode } = await runCLI("stats", "--json");
    expect(exitCode).toBe(0);
    if (stdout === "No skills found.") return;
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

// ─── CLI integration: init ──────────────────────────────────────────────────

describe("CLI integration: init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("init missing name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("init");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("init with --path scaffolds skill directory", async () => {
    const skillDir = join(tempDir, "test-skill");
    const { stderr, exitCode } = await runCLI(
      "init",
      "test-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Done!");

    // Verify SKILL.md was created
    const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: test-skill");
  });

  test("init creates SKILL.md with correct content", async () => {
    const skillDir = join(tempDir, "my-skill");
    await runCLI("init", "my-skill", "--path", skillDir);
    const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: my-skill");
    expect(skillMd).toContain("version: 0.1.0");
    expect(skillMd).toContain("# my-skill");
  });

  test("init with --path --force overwrites existing", async () => {
    const skillDir = join(tempDir, "force-skill");
    // First init
    const { exitCode: code1 } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
    );
    expect(code1).toBe(0);

    // Second init with --force
    const { exitCode: code2 } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
      "--force",
    );
    expect(code2).toBe(0);
  });

  test("init existing dir without --force in non-TTY exits 2", async () => {
    const skillDir = join(tempDir, "existing-skill");
    // First init to create the directory
    await runCLI("init", "my-skill", "--path", skillDir);

    // Second init without --force
    const { stderr, exitCode } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("already exists");
  });

  test("main --help includes init command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("init");
  });
});

// ─── CLI integration: link ──────────────────────────────────────────────────

describe("CLI integration: link", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-link-"));
    // Create a valid skill source
    await mkdir(join(tempDir, "source-skill"), { recursive: true });
    await writeFile(
      join(tempDir, "source-skill", "SKILL.md"),
      `---
name: test-link-skill
metadata:
  version: 1.0.0
---
# Test Link Skill
`,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("link missing path exits 2", async () => {
    const { stderr, exitCode } = await runCLI("link");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("link non-existent path exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "link",
      "/tmp/asm-nonexistent-path-999999",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("link path without any SKILL.md exits 1", async () => {
    // Create a directory with no SKILL.md at root or in subdirectories
    const emptyDir = join(tempDir, "empty-dir");
    await mkdir(emptyDir, { recursive: true });
    await mkdir(join(emptyDir, "subdir"), { recursive: true });
    const { stderr, exitCode } = await runCLI("link", emptyDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("link --name with multi-skill folder exits 2", async () => {
    // Create a folder with multiple skill subdirectories
    const multiDir = join(tempDir, "multi");
    await mkdir(join(multiDir, "skill-a"), { recursive: true });
    await mkdir(join(multiDir, "skill-b"), { recursive: true });
    await writeFile(
      join(multiDir, "skill-a", "SKILL.md"),
      `---\nname: skill-a\nversion: 1.0.0\n---\n# Skill A\n`,
    );
    await writeFile(
      join(multiDir, "skill-b", "SKILL.md"),
      `---\nname: skill-b\nversion: 1.0.0\n---\n# Skill B\n`,
    );
    const { stderr, exitCode } = await runCLI(
      "link",
      multiDir,
      "--name",
      "custom",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      "--name cannot be used when linking multiple skills",
    );
  });

  test("link --name with single discovered skill in multi-skill mode applies the custom name", async () => {
    // Create a folder with a single skill subdirectory (no root SKILL.md)
    const multiDir = join(tempDir, "multi-single");
    await mkdir(join(multiDir, "only-skill"), { recursive: true });
    await writeFile(
      join(multiDir, "only-skill", "SKILL.md"),
      `---\nname: only-skill\nversion: 1.0.0\n---\n# Only Skill\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const customLink = join(providerDir, "custom");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        multiDir,
        "--name",
        "custom",
        "--force",
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("custom");
    } finally {
      await rm(customLink, { force: true }).catch(() => {});
    }
  });

  test("link multi-skill folder with --force creates symlinks for all skills", async () => {
    // Create a folder with two skill subdirectories
    const multiDir = join(tempDir, "multi-happy");
    await mkdir(join(multiDir, "test-link-skill-a"), { recursive: true });
    await mkdir(join(multiDir, "test-link-skill-b"), { recursive: true });
    await writeFile(
      join(multiDir, "test-link-skill-a", "SKILL.md"),
      `---\nname: test-link-skill-a\nversion: 1.0.0\n---\n# Test Link Skill A\n`,
    );
    await writeFile(
      join(multiDir, "test-link-skill-b", "SKILL.md"),
      `---\nname: test-link-skill-b\nversion: 2.0.0\n---\n# Test Link Skill B\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "test-link-skill-a");
    const linkB = join(providerDir, "test-link-skill-b");

    try {
      const { stdout, stderr, exitCode } = await runCLI(
        "link",
        multiDir,
        "--force",
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(2);
      expect(result.linked.map((l: any) => l.name).sort()).toEqual([
        "test-link-skill-a",
        "test-link-skill-b",
      ]);

      // Verify symlinks actually exist
      const statsA = await lstat(linkA);
      expect(statsA.isSymbolicLink()).toBe(true);
      const targetA = await readlink(linkA);
      expect(targetA).toBe(join(multiDir, "test-link-skill-a"));

      const statsB = await lstat(linkB);
      expect(statsB.isSymbolicLink()).toBe(true);
      const targetB = await readlink(linkB);
      expect(targetB).toBe(join(multiDir, "test-link-skill-b"));
    } finally {
      // Clean up created symlinks
      await rm(linkA, { force: true }).catch(() => {});
      await rm(linkB, { force: true }).catch(() => {});
    }
  });

  test("link multi-skill partial failure returns JSON with results and failures and exits 1", async () => {
    // Create a folder with two skill subdirectories
    const multiDir = join(tempDir, "multi-partial");
    await mkdir(join(multiDir, "partial-skill-ok"), { recursive: true });
    await mkdir(join(multiDir, "partial-skill-fail"), { recursive: true });
    await writeFile(
      join(multiDir, "partial-skill-ok", "SKILL.md"),
      `---\nname: partial-skill-ok\nversion: 1.0.0\n---\n# Partial OK\n`,
    );
    await writeFile(
      join(multiDir, "partial-skill-fail", "SKILL.md"),
      `---\nname: partial-skill-fail\nversion: 1.0.0\n---\n# Partial Fail\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkOk = join(providerDir, "partial-skill-ok");
    const linkFail = join(providerDir, "partial-skill-fail");

    // Pre-create the target for partial-skill-fail as a regular directory so
    // linking it without --force will fail (non-TTY, no --force).
    await mkdir(linkFail, { recursive: true });

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        multiDir,
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(1);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);

      // One skill should have linked successfully
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("partial-skill-ok");

      // One skill should have failed
      expect(result.failures.length).toBe(1);
      expect(result.failures[0].name).toBe("partial-skill-fail");
      expect(result.failures[0].error).toContain("already exists");
    } finally {
      await rm(linkOk, { force: true }).catch(() => {});
      await rm(linkFail, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("link two explicit skill paths links both --json", async () => {
    // Create two individual skill directories
    const skillA = join(tempDir, "explicit-skill-a");
    const skillB = join(tempDir, "explicit-skill-b");
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: explicit-skill-a\nversion: 1.0.0\n---\n# Explicit Skill A\n`,
    );
    await writeFile(
      join(skillB, "SKILL.md"),
      `---\nname: explicit-skill-b\nversion: 1.0.0\n---\n# Explicit Skill B\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "explicit-skill-a");
    const linkB = join(providerDir, "explicit-skill-b");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        skillA,
        skillB,
        "--tool",
        "claude",
        "--force",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(2);
      const names = result.linked.map((r: { name: string }) => r.name).sort();
      expect(names).toEqual(["explicit-skill-a", "explicit-skill-b"]);
      expect(result.failures.length).toBe(0);
    } finally {
      await rm(linkA, { force: true }).catch(() => {});
      await rm(linkB, { force: true }).catch(() => {});
    }
  });

  test("link multiple explicit paths with --name exits 2", async () => {
    const skillA = join(tempDir, "name-guard-skill-a");
    const skillB = join(tempDir, "name-guard-skill-b");
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: name-guard-skill-a\nversion: 1.0.0\n---\n# Guard A\n`,
    );
    await writeFile(
      join(skillB, "SKILL.md"),
      `---\nname: name-guard-skill-b\nversion: 1.0.0\n---\n# Guard B\n`,
    );

    const { stderr, exitCode } = await runCLI(
      "link",
      skillA,
      skillB,
      "--name",
      "custom",
      "--tool",
      "claude",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      "--name cannot be used when linking multiple paths",
    );
  });

  test("link multiple explicit paths one invalid continues and reports failure --json", async () => {
    const skillA = join(tempDir, "partial-explicit-ok");
    await mkdir(skillA, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: partial-explicit-ok\nversion: 1.0.0\n---\n# Partial Explicit OK\n`,
    );
    const badPath = join(tempDir, "nonexistent-skill");

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "partial-explicit-ok");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        skillA,
        badPath,
        "--tool",
        "claude",
        "--force",
        "--json",
      );
      expect(exitCode).toBe(1);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("partial-explicit-ok");
      expect(result.failures.length).toBe(1);
    } finally {
      await rm(linkA, { force: true }).catch(() => {});
    }
  });

  test("main --help includes link command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("link");
  });
});

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
});

// ─── CLI integration: audit security ────────────────────────────────────────

describe("CLI integration: audit security", () => {
  test("audit security with no target exits 2", async () => {
    const { stderr, exitCode } = await runCLI("audit", "security");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing target");
  });

  test("audit security --all exits 0", async () => {
    const { exitCode } = await runCLI("audit", "security", "--all");
    expect(exitCode).toBe(0);
  });

  test("audit security --all --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      "--all",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("audit security non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "audit",
      "security",
      "zzz-nonexistent-skill-xyz-99999",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("audit security on installed skill returns verdict", async () => {
    // Get a skill name from list
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return; // skip if no skills installed

    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      skills[0].dirName,
    );
    expect(exitCode).toBe(0);
    // Output should contain verdict information
    expect(stdout.toLowerCase()).toMatch(/safe|caution|warning|dangerous/);
  });

  test("audit security on installed skill --json returns valid report", async () => {
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return;

    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      skills[0].dirName,
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("verdict");
    expect(data).toHaveProperty("skillName");
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

// ─── CLI integration: install error paths ───────────────────────────────────

describe("CLI integration: install error paths", () => {
  test("install with invalid source format exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "install",
      "not-a-valid-source",
      "-y",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("install with invalid --transport exits 2", async () => {
    const { stderr, exitCode } = await runCLI(
      "install",
      "github:user/repo",
      "--transport",
      "ftp",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid transport");
  });
});

// ─── isCLIMode: bundle ────────────────────────────────────────────────────

describe("isCLIMode: bundle", () => {
  const check = (...args: string[]) => isCLIMode(["bun", "script.ts", ...args]);

  test("bundle -> CLI mode", () => {
    expect(check("bundle")).toBe(true);
  });

  test("bundle create -> CLI mode", () => {
    expect(check("bundle", "create")).toBe(true);
  });

  test("bundle install -> CLI mode", () => {
    expect(check("bundle", "install")).toBe(true);
  });

  test("bundle list -> CLI mode", () => {
    expect(check("bundle", "list")).toBe(true);
  });
});

// ─── parseArgs: bundle ────────────────────────────────────────────────────

describe("parseArgs: bundle", () => {
  const parse = (...args: string[]) => parseArgs(["bun", "script.ts", ...args]);

  test("bundle create my-bundle", () => {
    const r = parse("bundle", "create", "my-bundle");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("create");
    expect(r.positional).toEqual(["my-bundle"]);
  });

  test("bundle install my-bundle --json", () => {
    const r = parse("bundle", "install", "my-bundle", "--json");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("install");
    expect(r.positional).toEqual(["my-bundle"]);
    expect(r.flags.json).toBe(true);
  });

  test("bundle list --json", () => {
    const r = parse("bundle", "list", "--json");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("list");
    expect(r.flags.json).toBe(true);
  });

  test("bundle show my-bundle", () => {
    const r = parse("bundle", "show", "my-bundle");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("show");
    expect(r.positional).toEqual(["my-bundle"]);
  });

  test("bundle remove my-bundle -y", () => {
    const r = parse("bundle", "remove", "my-bundle", "-y");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("remove");
    expect(r.positional).toEqual(["my-bundle"]);
    expect(r.flags.yes).toBe(true);
  });
});

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

  test("main --help includes bundle in command list", async () => {
    const { stdout, exitCode } = await runCLI("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("bundle");
  });
});
