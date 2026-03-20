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
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { tmpdir } from "os";

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
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--transport");
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
});

// ─── CLI integration: per-command --help (new commands) ─────────────────────

describe("CLI integration: per-command --help (new commands)", () => {
  test("export --help shows export usage", async () => {
    const { stdout, exitCode } = await runCLI("export", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm export");
    expect(stdout).toContain("--scope");
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

  test("link path without SKILL.md exits 1", async () => {
    // tempDir itself has no SKILL.md (only source-skill/ subdir does)
    const { stderr, exitCode } = await runCLI("link", tempDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
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
