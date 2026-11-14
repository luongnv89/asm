import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runCLI } from "./cli-test-harness";
import { getIndexDir } from "./config";
import type { RepoIndex } from "./utils/types";

// `asm index ingest` must never reach the network in unit tests: the clone is
// stubbed to a local fixture dir, and eval providers are stubbed out (#837).
const ingestMocks = vi.hoisted(() => ({
  cloneToTemp: vi.fn<() => Promise<string>>(() =>
    Promise.reject(new Error("network clone disabled in unit tests")),
  ),
}));

vi.mock("./installer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./installer")>();
  return {
    ...actual,
    checkGitAvailable: () => Promise.resolve(),
    cloneToTemp: ingestMocks.cloneToTemp,
    cleanupTemp: () => Promise.resolve(),
  };
});

vi.mock("./eval/builtins", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval/builtins")>();
  return { ...actual, getEvalProviders: () => [] };
});

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

// ─── asm index ingest --exclude (#837) ──────────────────────────────────────

describe("CLI integration: index ingest --exclude", () => {
  const SOURCE = "github:exclude-cli/fixture";
  let fixtureDir: string;

  async function writeSkill(name: string): Promise<void> {
    const dir = join(fixtureDir, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Fixture skill ${name} for ingest exclude tests\nversion: 1.0.0\nlicense: MIT\n---\n\n# ${name}\n\nFixture body.\n`,
      "utf-8",
    );
  }

  async function indexedNames(): Promise<string[]> {
    const raw = await readFile(
      join(getIndexDir(), "exclude-cli_fixture.json"),
      "utf-8",
    );
    return (JSON.parse(raw) as RepoIndex).skills.map((s) => s.name).sort();
  }

  beforeEach(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), "asm-cli-ingest-exclude-"));
    for (const name of ["alpha", "beta", "gamma"]) await writeSkill(name);
    ingestMocks.cloneToTemp.mockResolvedValue(fixtureDir);
  });

  afterEach(async () => {
    ingestMocks.cloneToTemp.mockReset();
    await rm(fixtureDir, { recursive: true, force: true });
    await rm(join(getIndexDir(), "exclude-cli_fixture.json"), { force: true });
  });

  test("without --exclude: indexes every skill, JSON shape unchanged", async () => {
    const { stdout, stderr, exitCode } = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Object.keys(data)).toEqual([
      "success",
      "owner",
      "repo",
      "skillCount",
      "updatedAt",
    ]);
    expect(data.skillCount).toBe(3);
    expect(stderr).not.toContain("Excluded");
    expect(await indexedNames()).toEqual(["alpha", "beta", "gamma"]);
  });

  test("one --exclude leaves that skill out and reports it", async () => {
    const { stdout, exitCode } = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
      "beta",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.skillCount).toBe(2);
    expect(data.excluded).toEqual(["beta"]);
    expect(data.unmatchedExcludes).toEqual([]);
    expect(await indexedNames()).toEqual(["alpha", "gamma"]);
  });

  test("--exclude repeats", async () => {
    const { stdout, exitCode } = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
      "alpha",
      "--exclude",
      "gamma",
      "--json",
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).excluded).toEqual(["alpha", "gamma"]);
    expect(await indexedNames()).toEqual(["beta"]);
  });

  test("--exclude accepts a comma-separated list", async () => {
    const { stderr, exitCode } = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
      "alpha, gamma",
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Skills found: 1");
    expect(stderr).toContain("Excluded: alpha, gamma");
    expect(stderr).not.toContain("matched no skill");
    expect(await indexedNames()).toEqual(["beta"]);
  });

  test("an unmatched --exclude name is reported, not an error", async () => {
    const text = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
      "betta,gamma",
    );
    expect(text.exitCode).toBe(0);
    expect(text.stderr).toContain("Excluded: gamma");
    expect(text.stderr).toContain("--exclude matched no skill: betta");

    const json = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
      "betta",
      "--json",
    );
    expect(json.exitCode).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.skillCount).toBe(3);
    expect(data.excluded).toEqual([]);
    expect(data.unmatchedExcludes).toEqual(["betta"]);
    expect(await indexedNames()).toEqual(["alpha", "beta", "gamma"]);
  });

  test("--exclude without a value exits 2", async () => {
    const { stderr, exitCode } = await runCLI(
      "index",
      "ingest",
      SOURCE,
      "--exclude",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing value for "--exclude"');
  });

  test("index --help lists --exclude", async () => {
    const { stdout } = await runCLI("index", "--help");
    expect(stdout).toContain("--exclude <name>");
  });
});
