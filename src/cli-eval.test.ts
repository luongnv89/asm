import { describe, test, expect } from "vitest";
import { parseArgs } from "./cli";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { runCLI } from "./cli-test-harness";

// `asm eval` CLI tests — split from cli.test.ts (issue #678).
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
      expect(parsed).toHaveProperty("providers");
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.categories.length).toBe(10);
      expect(Array.isArray(parsed.providers)).toBe(true);
      expect(
        parsed.providers.some((p: { id: string }) => p.id === "quality"),
      ).toBe(true);
      expect(
        parsed.providers.some(
          (p: { id: string }) => p.id === "skill-best-practice",
        ),
      ).toBe(true);
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
      expect(Array.isArray(parsed.data.providers)).toBe(true);
      expect(
        parsed.data.providers.some(
          (p: { id: string }) => p.id === "skill-best-practice",
        ),
      ).toBe(true);
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
      expect(Array.isArray(parsed.providers)).toBe(true);
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

  // ─── #194: batch eval for collection locations ────────────────────────

  test("eval on a collection directory evaluates every child with SKILL.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-batch-"));
    try {
      await mkdir(join(root, "alpha"), { recursive: true });
      await mkdir(join(root, "beta"), { recursive: true });
      await writeFile(
        join(root, "alpha", "SKILL.md"),
        "---\nname: alpha\ndescription: Do alpha when asked.\n---\n\n## When to Use\n- thing\n\n## Instructions\n1. act\n",
        "utf-8",
      );
      await writeFile(
        join(root, "beta", "SKILL.md"),
        "---\nname: beta\ndescription: Do beta when asked.\n---\n\n## When to Use\n- thing\n\n## Instructions\n1. act\n",
        "utf-8",
      );
      // A non-skill folder must be skipped gracefully.
      await mkdir(join(root, "not-a-skill"), { recursive: true });

      const { stdout, exitCode } = await runCLI("eval", root);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Batch summary");
      expect(stdout).toContain("alpha");
      expect(stdout).toContain("beta");
      expect(stdout).not.toContain("not-a-skill"); // skipped silently
      expect(stdout).toMatch(/Skills evaluated:\s+2\/2/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval --json on a collection returns aggregate + results array", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-batch-json-"));
    try {
      await mkdir(join(root, "a"), { recursive: true });
      await mkdir(join(root, "b"), { recursive: true });
      await writeFile(
        join(root, "a", "SKILL.md"),
        "---\nname: a\ndescription: Do a when asked.\n---\n\n## When to Use\n- thing\n",
        "utf-8",
      );
      await writeFile(
        join(root, "b", "SKILL.md"),
        "---\nname: b\ndescription: Do b when asked.\n---\n\n## When to Use\n- thing\n",
        "utf-8",
      );
      const { stdout, exitCode } = await runCLI("eval", root, "--json");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("provenance");
      expect(parsed).toHaveProperty("aggregate");
      expect(parsed).toHaveProperty("results");
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.aggregate.total).toBe(2);
      expect(parsed.aggregate.succeeded).toBe(2);
      expect(parsed.provenance.remote).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval --machine on a collection emits v1 envelope with aggregate", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-batch-machine-"));
    try {
      await mkdir(join(root, "m1"), { recursive: true });
      await writeFile(
        join(root, "m1", "SKILL.md"),
        "---\nname: m1\ndescription: Do m1 when asked.\n---\nbody\n",
        "utf-8",
      );
      await mkdir(join(root, "m2"), { recursive: true });
      await writeFile(
        join(root, "m2", "SKILL.md"),
        "---\nname: m2\ndescription: Do m2 when asked.\n---\nbody\n",
        "utf-8",
      );
      const { stdout, exitCode } = await runCLI("eval", root, "--machine");
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.version).toBe(1);
      expect(parsed.command).toBe("eval");
      expect(parsed.status).toBe("ok");
      expect(parsed.data).toHaveProperty("aggregate");
      expect(parsed.data).toHaveProperty("results");
      expect(parsed.data.aggregate.total).toBe(2);
      expect(parsed.data.results).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval --concurrency rejects invalid values", async () => {
    const { exitCode, stderr } = await runCLI(
      "eval",
      "./whatever",
      "--concurrency",
      "0",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/Invalid --concurrency/);
  });

  // ─── #193: GitHub shorthand routing (without hitting the network) ────

  test("eval with github: shorthand requires git — error is informative", async () => {
    // We can't actually clone in unit tests; route through a bogus repo and
    // assert the error path is followed. This locks in that parseSource is
    // invoked and that --machine still produces a stable error envelope.
    const { stdout, exitCode } = await runCLI(
      "eval",
      "github:bogus_user/repo-that-does-not-exist-for-asm-tests",
      "--machine",
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("SKILL_NOT_FOUND");
  });

  test("eval refuses a `..` hidden in the ref before clone", async () => {
    const { stderr, exitCode } = await runCLI(
      "eval",
      "github:acme/skills#main/../../x",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("escapes the repository");
    expect(stderr).not.toMatch(/Cloning|Fetching|ls-remote|fatal:/);
  });

  test("eval --fix on github: shorthand is rejected with a clear error", async () => {
    const { stderr, exitCode } = await runCLI(
      "eval",
      "github:owner/repo",
      "--fix",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--fix is only supported for local skill paths/);
  });

  test("parseArgs accepts --concurrency and --keep flags", () => {
    const r = parseArgs([
      "node",
      "script.ts",
      "eval",
      "./x",
      "--concurrency",
      "8",
      "--keep",
    ]);
    expect(r.flags.concurrency).toBe(8);
    expect(r.flags.keep).toBe(true);
  });
});

// ─── CLI integration: eval-providers ────────────────────────────────────────

describe("CLI integration: eval-providers", () => {
  test("eval-providers list prints quality and skill-best-practice with schema + description", async () => {
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
    expect(stdout).toContain("skill-best-practice");
    expect(stdout).toContain("1.0.0");
    expect(stdout).toContain("Static linter for SKILL.md");
    expect(stdout).toContain("Deterministic SKILL.md best-practice validation");
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
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    const quality = parsed.find((p: { id: string }) => p.id === "quality");
    expect(quality).toBeTruthy();
    expect(quality.version).toBe("1.0.0");
    expect(quality.schemaVersion).toBe(1);
    expect(typeof quality.description).toBe("string");
    expect(quality.description.length).toBeGreaterThan(0);
    expect(Array.isArray(quality.requires)).toBe(true);
    const skillBestPractice = parsed.find(
      (p: { id: string }) => p.id === "skill-best-practice",
    );
    expect(skillBestPractice).toBeTruthy();
    expect(skillBestPractice.version).toBe("1.2.0");
    expect(skillBestPractice.schemaVersion).toBe(1);
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
