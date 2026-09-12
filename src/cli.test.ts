import { describe, test, expect } from "vitest";
import { fileURLToPath } from "url";
import { parseArgs, isCLIMode } from "./cli";
import { join, dirname } from "path";
import { runInlineTs } from "./utils/test-spawn";
import { runCLI } from "./cli-test-harness";

// ─── parseArgs unit tests ───────────────────────────────────────────────────

describe("parseArgs", () => {
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

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

  test("parses repeatable and comma-separated tag filters", () => {
    const result = parse("list", "--tag", "cli,testing", "--tag", "frontend");
    expect(result.flags.tagFilters).toEqual(["cli,testing", "frontend"]);
  });

  test("parses tag editing command arguments", () => {
    const result = parse("tag", "add", "code-review", "cli,testing");
    expect(result.command).toBe("tag");
    expect(result.subcommand).toBe("add");
    expect(result.positional).toEqual(["code-review", "cli,testing"]);
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

  test("parses deactivate with skill name", () => {
    const result = parse("deactivate", "brainstorming");
    expect(result.command).toBe("deactivate");
    expect(result.subcommand).toBe("brainstorming");
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

describe("parseArgs: --tokens (issue #421)", () => {
  test("defaults to false", () => {
    expect(parseArgs(["node", "cli", "stats"]).flags.tokens).toBe(false);
  });

  test("--tokens sets the attention-budget flag", () => {
    const args = parseArgs(["node", "cli", "stats", "--tokens"]);
    expect(args.command).toBe("stats");
    expect(args.flags.tokens).toBe(true);
  });

  test("--tokens combines with --json and --machine", () => {
    expect(
      parseArgs(["node", "cli", "stats", "--tokens", "--json"]).flags,
    ).toMatchObject({ tokens: true, json: true });
    expect(
      parseArgs(["node", "cli", "stats", "--tokens", "--machine"]).flags,
    ).toMatchObject({ tokens: true, machine: true });
  });
});

describe("parseArgs: audit residency (issue #423)", () => {
  test("residency parses as an audit subcommand, not a top-level verb", () => {
    const args = parseArgs(["node", "cli", "audit", "residency"]);
    expect(args.command).toBe("audit");
    expect(args.subcommand).toBe("residency");
  });
});

describe("parseArgs: audit overlap (issue #566)", () => {
  test("overlap parses as an audit subcommand, not a top-level verb", () => {
    const args = parseArgs(["node", "cli", "audit", "overlap"]);
    expect(args.command).toBe("audit");
    expect(args.subcommand).toBe("overlap");
  });
});

describe("isCLIMode", () => {
  const check = (...args: string[]) =>
    isCLIMode(["node", "script.ts", ...args]);

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

  test("deactivate → CLI mode", () => {
    expect(check("deactivate")).toBe(true);
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

// ─── runCLI integration tests ──────────────────────────────────────────────

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
    expect(stdout).toContain("deactivate");
    expect(stdout).toContain("library");
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

  test("deactivate --help shows deactivate usage", async () => {
    const { stdout, exitCode } = await runCLI("deactivate", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm deactivate");
    expect(stdout).toContain("<global|project>");
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
    const { stdout } = await runCLI(
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

// ─── parseArgs: install command ─────────────────────────────────────────────

describe("parseArgs: install", () => {
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

  test("parses install with source", () => {
    const result = parse("install", "github:user/repo");
    expect(result.command).toBe("install");
    expect(result.subcommand).toBe("github:user/repo");
  });

  test("parses install --library", () => {
    const result = parse("install", "github:user/repo", "--library");
    expect(result.command).toBe("install");
    expect(result.subcommand).toBe("github:user/repo");
    expect(result.flags.library).toBe(true);
  });

  test("parses import --diff", () => {
    const result = parse("import", "skills.json", "--diff");
    expect(result.command).toBe("import");
    expect(result.subcommand).toBe("skills.json");
    expect(result.flags.diff).toBe(true);
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
  const check = (...args: string[]) =>
    isCLIMode(["node", "script.ts", ...args]);

  test("install → CLI mode", () => {
    expect(check("install")).toBe(true);
  });
});

// ─── readLine unit tests (subprocess — stdin piping needs a real child) ─────

describe("readLine", () => {
  test("resolves with input followed by newline", async () => {
    // Test readLine directly using a helper subprocess
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(result);
    `;
    const { stdout, exitCode } = await runInlineTs(script, {
      stdin: "hello\n",
      env: { ...process.env },
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("hello");
  });

  test("resolves on EOF without trailing newline", async () => {
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(result);
    `;
    const { stdout, exitCode } = await runInlineTs(script, {
      stdin: "yes",
      env: { ...process.env },
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("yes");
  });

  test("empty EOF resolves with empty string", async () => {
    const script = `
      import { readLine } from "./src/cli";
      const result = await readLine();
      process.stdout.write(JSON.stringify(result));
    `;
    const { stdout, exitCode } = await runInlineTs(script, {
      stdin: "",
      env: { ...process.env },
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe('""');
  });
});

// ─── CLI integration: verbose flag ──────────────────────────────────────

describe("CLI integration: verbose flag", () => {
  test("list -V produces verbose output on stderr", async () => {
    const { stderr, exitCode } = await runCLI("list", "-V");
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
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

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

  test("parses independent invocability flags (#417)", () => {
    const none = parse("list");
    expect(none.flags.modelInvocable).toBe(false);
    expect(none.flags.userInvocable).toBe(false);
    const both = parse("list", "--model-invocable", "--user-invocable");
    expect(both.flags.modelInvocable).toBe(true);
    expect(both.flags.userInvocable).toBe(true);
    const search = parse("search", "q", "--user-invocable");
    expect(search.flags.userInvocable).toBe(true);
    expect(search.flags.modelInvocable).toBe(false);
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

// ─── parseArgs: large-list flags (issue #192) ───────────────────────────────

describe("parseArgs: large-list flags (#192)", () => {
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

  test("parses --compact flag", () => {
    const result = parse("list", "--compact");
    expect(result.flags.compact).toBe(true);
  });

  test("defaults compact to false", () => {
    const result = parse("list");
    expect(result.flags.compact).toBe(false);
  });

  test("parses --summary flag", () => {
    const result = parse("list", "--summary");
    expect(result.flags.summary).toBe(true);
  });

  test("defaults summary to false", () => {
    const result = parse("list");
    expect(result.flags.summary).toBe(false);
  });

  test("parses --group-by tool", () => {
    const result = parse("list", "--group-by", "tool");
    expect(result.flags.groupBy).toBe("tool");
  });

  test("parses --group-by scope", () => {
    const result = parse("list", "--group-by", "scope");
    expect(result.flags.groupBy).toBe("scope");
  });

  test("parses --group-by effort", () => {
    const result = parse("list", "--group-by", "effort");
    expect(result.flags.groupBy).toBe("effort");
  });

  test("defaults groupBy to null", () => {
    const result = parse("list");
    expect(result.flags.groupBy).toBeNull();
  });

  test("parses --limit as non-negative integer", () => {
    const result = parse("list", "--limit", "25");
    expect(result.flags.limit).toBe(25);
  });

  test("defaults limit to 0", () => {
    const result = parse("list");
    expect(result.flags.limit).toBe(0);
  });

  test("parses --limit 0 as 'no limit'", () => {
    const result = parse("list", "--limit", "0");
    expect(result.flags.limit).toBe(0);
  });
});

// ─── isCLIMode: newer commands ──────────────────────────────────────────────

describe("isCLIMode: newer commands", () => {
  const check = (...args: string[]) =>
    isCLIMode(["node", "script.ts", ...args]);

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
    expect(stdout).toContain("--diff");
    expect(stdout).toContain("cannot be combined with --force");
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

// ─── isCLIMode: bundle ────────────────────────────────────────────────────

describe("isCLIMode: bundle", () => {
  const check = (...args: string[]) =>
    isCLIMode(["node", "script.ts", ...args]);

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
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

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

// ─── parseArgs: bundle modify / export ──────────────────────────────────────

describe("parseArgs: bundle modify and export", () => {
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

  test("bundle modify my-bundle parses subcommand and positional", () => {
    const r = parse("bundle", "modify", "my-bundle");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("modify");
    expect(r.positional).toEqual(["my-bundle"]);
  });

  test("bundle modify my-bundle --add url parses add flag", () => {
    const r = parse(
      "bundle",
      "modify",
      "my-bundle",
      "--add",
      "github:user/repo",
    );
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("modify");
    expect(r.positional).toEqual(["my-bundle"]);
    expect(r.flags.add).toBe("github:user/repo");
  });

  test("bundle modify my-bundle --remove skill-name parses remove flag", () => {
    const r = parse("bundle", "modify", "my-bundle", "--remove", "skill-name");
    expect(r.subcommand).toBe("modify");
    expect(r.flags.remove).toBe("skill-name");
  });

  test("bundle modify my-bundle --description 'new desc' parses description flag", () => {
    const r = parse(
      "bundle",
      "modify",
      "my-bundle",
      "--description",
      "new desc",
    );
    expect(r.subcommand).toBe("modify");
    expect(r.flags.description).toBe("new desc");
  });

  test("bundle modify my-bundle --author 'new author' parses author flag", () => {
    const r = parse("bundle", "modify", "my-bundle", "--author", "new author");
    expect(r.subcommand).toBe("modify");
    expect(r.flags.author).toBe("new author");
  });

  test("bundle modify my-bundle --tags 'a,b,c' parses tags flag", () => {
    const r = parse("bundle", "modify", "my-bundle", "--tags", "a,b,c");
    expect(r.subcommand).toBe("modify");
    expect(r.flags.tags).toBe("a,b,c");
  });

  test("bundle export my-bundle parses subcommand and positional", () => {
    const r = parse("bundle", "export", "my-bundle");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("export");
    expect(r.positional).toEqual(["my-bundle"]);
  });

  test("bundle export my-bundle ./out.json parses two positionals", () => {
    const r = parse("bundle", "export", "my-bundle", "./out.json");
    expect(r.command).toBe("bundle");
    expect(r.subcommand).toBe("export");
    expect(r.positional).toEqual(["my-bundle", "./out.json"]);
  });

  test("bundle export my-bundle --force parses force flag", () => {
    const r = parse("bundle", "export", "my-bundle", "--force");
    expect(r.subcommand).toBe("export");
    expect(r.flags.force).toBe(true);
  });
});

// ─── asm get: zero-residency reference tier (issue #422) ────────────────────

describe("parseArgs: --audit (issue #422)", () => {
  const parse = (...args: string[]) =>
    parseArgs(["node", "script.ts", ...args]);

  test("defaults to false", () => {
    expect(parse("get", "code-review").flags.audit).toBe(false);
  });

  test("--audit sets the escalation flag", () => {
    const args = parse("get", "code-review", "--audit");
    expect(args.command).toBe("get");
    expect(args.subcommand).toBe("code-review");
    expect(args.flags.audit).toBe(true);
  });

  test("--audit combines with --json and --machine", () => {
    expect(parse("get", "x", "--audit", "--json").flags).toMatchObject({
      audit: true,
      json: true,
    });
    expect(parse("get", "x", "--audit", "--machine").flags).toMatchObject({
      audit: true,
      machine: true,
    });
  });
});

describe("isCLIMode: get (issue #422)", () => {
  test("get is a known command, not an unrecognised first arg", () => {
    expect(isCLIMode(["node", "script.ts", "get"])).toBe(true);
    expect(isCLIMode(["node", "script.ts", "get", "code-review"])).toBe(true);
  });
});

// ─── Durable full-directory get borrows (issue #654) ───────────────────────

describe("parseArgs: get --path and cleanup", () => {
  test.each([
    ["get", "--path", "helper"],
    ["get", "helper", "--path"],
    ["get", "--path", "helper", "--json"],
    ["get", "helper", "--path", "--machine"],
  ])("distinguishes the boolean get flag: %j", (...argv) => {
    expect(parseArgs(["node", "asm", ...argv])).toMatchObject({
      command: "get",
      subcommand: "helper",
      positional: [],
      flags: { getPath: true, path: null },
    });
  });

  test.each(["install", "init"])(
    "preserves %s --path as a string",
    (command) => {
      expect(
        parseArgs(["node", "asm", command, "helper", "--path", "/target"]),
      ).toMatchObject({ flags: { getPath: false, path: "/target" } });
    },
  );

  test("recognizes cleanup and its exact path positional", () => {
    expect(isCLIMode(["node", "asm", "cleanup", "/borrow"])).toBe(true);
    expect(parseArgs(["node", "asm", "cleanup", "/borrow"])).toMatchObject({
      command: "cleanup",
      subcommand: "/borrow",
    });
  });
});
