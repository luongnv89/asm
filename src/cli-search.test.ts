import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runCLI, runCliInProcess } from "./cli-test-harness";

// `asm search` CLI tests — split from cli.test.ts (issue #678).
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

// ─── CLI integration: search --fuzzy / --root (issue #735) ──────────────────

describe("CLI integration: search --fuzzy / --root (issue #735)", () => {
  let base: string;
  let home: string;
  let cwd: string;
  let projects: string;
  let deployProject: string;

  async function writeSkill(dir: string, name: string, description: string) {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    );
  }

  // cwd is a temp dir: the asm repo root itself holds .claude/skills.
  const search = (...args: string[]) =>
    runCliInProcess(["search", ...args], { cwd, env: { HOME: home } });

  const jsonRows = async (...args: string[]) => {
    const { stdout, exitCode } = await search(...args, "--json");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as Array<Record<string, unknown>>;
  };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fuzzy-search-"));
    home = join(base, "home");
    cwd = join(base, "cwd");
    projects = join(base, "projects");
    deployProject = join(projects, "client", "web", "app");
    await writeSkill(
      join(home, ".claude", "skills", "code-review"),
      "code-review",
      "Review pull requests and diffs for bugs and security issues",
    );
    await writeSkill(
      join(home, ".claude", "skills", "review"),
      "review",
      "Generic review checklist",
    );
    await writeSkill(
      join(home, ".agents", "skills", "pdf-tools"),
      "pdf-tools",
      "Extract text and tables from PDF documents",
    );
    await writeSkill(
      join(deployProject, ".claude", "skills", "deploy-helper"),
      "deploy-helper",
      "Ship releases to staging and production servers",
    );
    await writeSkill(
      join(cwd, ".claude", "skills", "deploy-local"),
      "deploy-local",
      "Deploy from the current project",
    );
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("--root finds a skill installed in another project", async () => {
    const rows = await jsonRows("deploy", "--root", projects);
    expect(rows.map((r) => r.name)).toEqual(["deploy-helper"]);
    expect(rows[0]).toMatchObject({
      scope: "project",
      provider: "claude",
      projectRoot: deployProject,
      path: join(deployProject, ".claude", "skills", "deploy-helper"),
      status: "installed",
    });
    expect(rows[0].score).toEqual(expect.any(Number));
  });

  test("--fuzzy without --root searches only global dirs", async () => {
    const rows = await jsonRows("deploy", "--fuzzy");
    expect(rows).toEqual([]);
  });

  test("--root expands ~ and resolves relative paths", async () => {
    await writeSkill(
      join(home, "work", "proj", ".claude", "skills", "tilde-skill"),
      "tilde-skill",
      "Found through a home-relative root",
    );
    await writeSkill(
      join(cwd, "sub", "proj", ".claude", "skills", "relative-skill"),
      "relative-skill",
      "Found through a cwd-relative root",
    );
    const tilde = await jsonRows("tilde-skill", "--root", "~/work");
    expect(tilde.map((r) => r.name)).toEqual(["tilde-skill"]);
    const relative = await jsonRows("relative-skill", "--root", "sub");
    expect(relative.map((r) => r.name)).toEqual(["relative-skill"]);
  });

  test("a misspelled or partial name still finds the skill", async () => {
    const typo = await jsonRows("revew", "--fuzzy");
    expect(typo.map((r) => r.name)).toContain("code-review");
    const partial = await jsonRows("code", "--fuzzy");
    expect(partial.map((r) => r.name)).toContain("code-review");
  });

  test("a description-only query matches on what the skill does", async () => {
    const rows = await jsonRows("extract tables from documents", "--fuzzy");
    expect(rows.map((r) => r.name)).toEqual(["pdf-tools"]);
  });

  test("results are ordered best match first", async () => {
    const rows = await jsonRows("review", "--fuzzy");
    expect(rows.map((r) => r.name)).toEqual(["review", "code-review"]);
    const scores = rows.map((r) => r.score as number);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  test("human output shows tool and install location", async () => {
    const { stdout, exitCode } = await search("deploy", "--root", projects);
    expect(exitCode).toBe(0);
    // Columns: Name, Score, Tool, Location, Path (two-space separated).
    const cells = (out: string, name: string) =>
      (out.split("\n").find((l) => l.startsWith(name)) ?? "").split(/\s{2,}/);
    expect(stdout.split("\n")[0].split(/\s{2,}/)).toEqual([
      "Name",
      "Score",
      "Tool",
      "Location",
      "Path",
    ]);
    const [, , tool, location, path] = cells(stdout, "deploy-helper");
    expect(tool).toBe("Claude Code");
    expect(location).toBe(deployProject);
    expect(path).toBe(
      join(deployProject, ".claude", "skills", "deploy-helper"),
    );

    const global = await search("pdf", "--fuzzy");
    const [, , globalTool, globalLocation] = cells(global.stdout, "pdf-tools");
    expect(globalTool).toBe("Agents");
    expect(globalLocation).toBe("global");
  });

  test("human output explains an empty result", async () => {
    const { stderr, exitCode } = await search("zzz-nothing-here", "--fuzzy");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("No installed skills matching");
    expect(stderr).toContain("--root");
  });

  test("--machine rows carry score, project_root, and path", async () => {
    const { stdout, exitCode } = await search(
      "deploy",
      "--root",
      projects,
      "--machine",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.status).toBe("ok");
    expect(envelope.data[0]).toMatchObject({
      name: "deploy-helper",
      source: "installed",
      match_count: 1,
      scope: "project",
      provider: "claude",
      project_root: deployProject,
      path: join(deployProject, ".claude", "skills", "deploy-helper"),
    });
    expect(envelope.data[0].score).toEqual(expect.any(Number));
  });

  test("-p/--tool still filters fuzzy results", async () => {
    const rows = await jsonRows("code", "--fuzzy", "-p", "agents");
    expect(rows.map((r) => r.name)).not.toContain("code-review");
  });

  test("--root that is not a directory exits 2", async () => {
    const missing = join(base, "does-not-exist");
    const { stderr, exitCode } = await search("x", "--root", missing);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("not an existing directory");

    const machine = await search("x", "--root", missing, "--machine");
    expect(machine.exitCode).toBe(2);
    expect(JSON.parse(machine.stdout)).toMatchObject({
      status: "error",
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  test("--root with no value exits 2", async () => {
    const { stderr, exitCode } = await search("x", "--root");
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing value for "--root"');
  });

  test("--fuzzy with --available exits 2", async () => {
    const { stderr, exitCode } = await search("x", "--fuzzy", "--available");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--available");
  });
});
