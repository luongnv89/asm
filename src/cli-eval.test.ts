import { describe, test, expect, vi } from "vitest";
import { parseArgs } from "./cli";

// Remote-target tests (#771) point `cloneToTemp` at a local fixture instead of
// cloning; every other test keeps the real installer.
const remoteClone = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock("./installer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./installer")>();
  return {
    ...actual,
    cloneToTemp: (...args: Parameters<typeof actual.cloneToTemp>) =>
      remoteClone.dir
        ? Promise.resolve(remoteClone.dir)
        : actual.cloneToTemp(...args),
  };
});
import { join } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  realpath,
  symlink,
} from "fs/promises";
import { tmpdir } from "os";
import { runCLI } from "./cli-test-harness";

// `asm eval` CLI tests — split from cli.test.ts (issue #678).

// Pass-through runner mock: a skill whose path contains "asm-eval-error"
// gets a provider whose run() throws, so the real runner's error wrap
// (provider-threw) and cmdEval's errored-skill path are exercised
// deterministically (#773). Every other skill runs unchanged.
vi.mock("./eval/runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval/runner")>();
  type Args = Parameters<typeof actual.runProvider>;
  return {
    ...actual,
    runProvider: (provider: Args[0], ctx: Args[1], opts?: Args[2]) => {
      if (!ctx.skillPath.includes("asm-eval-error")) {
        return actual.runProvider(provider, ctx, opts);
      }
      const failing = Object.assign(Object.create(provider), {
        run: async () => {
          throw new Error("simulated provider failure");
        },
      }) as Args[0];
      return actual.runProvider(failing, ctx, opts);
    },
  };
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

  test("remote eval scores the license category against the clone root (#771)", async () => {
    const clone = await mkdtemp(join(tmpdir(), "eval-remote-license-"));
    const skill = (name: string, license?: string) =>
      `---\nname: ${name}\ndescription: Do ${name} when asked.\n${
        license ? `license: ${license}\n` : ""
      }---\n\n## When to Use\n- thing\n`;
    try {
      await mkdir(join(clone, ".git"), { recursive: true });
      await writeFile(join(clone, "LICENSE"), "MIT License\n", "utf-8");
      for (const [name, license] of [
        ["inherited", "MIT"],
        ["private", "UNLICENSED"],
        ["undeclared", undefined],
      ] as const) {
        await mkdir(join(clone, "skills", name), { recursive: true });
        await writeFile(
          join(clone, "skills", name, "SKILL.md"),
          skill(name, license),
          "utf-8",
        );
      }
      remoteClone.dir = clone;
      const { stdout, exitCode } = await runCLI(
        "eval",
        "github:acme/licensed:skills",
        "--json",
        "--keep",
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.provenance.remote).toBe(true);
      const scores = Object.fromEntries(
        parsed.results.map(
          (r: {
            skillPath: string;
            report: { categories: { id: string; score: number }[] };
          }) => [
            r.skillPath.split(/[\\/]/).at(-1),
            r.report.categories.find((c) => c.id === "license")!.score,
          ],
        ),
      );
      expect(scores.inherited).toBeGreaterThanOrEqual(8);
      expect(scores.private).toBeGreaterThanOrEqual(8);
      expect(scores.undeclared).toBe(0);
    } finally {
      remoteClone.dir = null;
      await rm(clone, { recursive: true, force: true });
    }
  });

  describe("symlinks that leave the skill folder (#825)", () => {
    const MARKER = "OUTSIDE-MARKER-825";
    const skillMd = (name: string) =>
      `---\nname: ${name}\ndescription: "Use when testing. Prints hi."\nlicense: MIT\n---\n\n# ${name}\n\nRun \`python3 scripts/linked.py\`.\n`;

    async function fixture() {
      const base = await mkdtemp(join(tmpdir(), "eval-cli-links-"));
      const outside = join(base, "outside");
      const skill = join(base, "s1");
      await mkdir(join(outside, "dir"), { recursive: true });
      await mkdir(join(skill, "scripts"), { recursive: true });
      await writeFile(
        join(outside, "secret.py"),
        `def broken(:\n    pass  # ${MARKER}\n`,
      );
      await writeFile(join(outside, "dir", "bad2.py"), `x = (  # ${MARKER}\n`);
      await writeFile(join(skill, "SKILL.md"), skillMd("s1"));
      await symlink(
        join(outside, "secret.py"),
        join(skill, "scripts", "linked.py"),
      );
      await symlink(join(outside, "dir"), join(skill, "scripts", "linkdir"));
      return { base, outside, skill };
    }

    test.skipIf(process.platform === "win32")(
      "eval --json and text report the links and never their content",
      async () => {
        const { base, skill } = await fixture();
        try {
          const json = await runCLI("eval", skill, "--json");
          expect(json.exitCode).toBe(0);
          expect(json.stdout).not.toContain(MARKER);
          const report = JSON.parse(json.stdout);
          expect(
            report.externalSymlinks.map((l: { path: string }) => l.path).sort(),
          ).toEqual(["scripts/linkdir", "scripts/linked.py"]);
          const lint = report.categories.find(
            (c: { id: string }) => c.id === "script-lint",
          );
          expect(lint.findings).toEqual(["No bundled scripts found to lint."]);

          const text = await runCLI("eval", skill);
          expect(text.exitCode).toBe(0);
          expect(text.stdout).not.toContain(MARKER);
          expect(text.stdout).toContain("Symlinks not read (2):");
          expect(text.stdout).toMatch(
            /scripts\/linked\.py -> .*secret\.py \(file, NOT read\)/,
          );
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      },
    );

    test.skipIf(process.platform === "win32")(
      "a collection child linked to a skill folder is evaluated as its own folder",
      async () => {
        const { base, outside, skill } = await fixture();
        const coll = join(base, "coll");
        try {
          await mkdir(join(coll, "ok"), { recursive: true });
          await writeFile(join(coll, "ok", "SKILL.md"), skillMd("ok"));
          // `asm activate` / `asm link` layout: the child links to a skill
          // folder elsewhere, which itself links out to `outside`.
          await symlink(skill, join(coll, "s1"));
          await mkdir(join(outside, "nomd"));
          await symlink(join(outside, "nomd"), join(coll, "nomd"));
          await symlink("/", join(coll, "root"));
          const target = await realpath(skill);

          const direct = JSON.parse(
            (await runCLI("eval", skill, "--json")).stdout,
          );
          const json = await runCLI("eval", coll, "--json");
          expect(json.exitCode).toBe(0);
          expect(json.stdout).not.toContain(MARKER);
          const parsed = JSON.parse(json.stdout);
          expect(parsed.aggregate).toMatchObject({ total: 2, failed: 0 });
          const s1 = parsed.results.find(
            (r: { label: string }) => r.label === "s1",
          );
          expect(s1.error).toBeNull();
          expect(s1.link).toEqual({ path: "s1", target });
          // Same score and findings as `asm eval <child>`.
          expect(s1.report.overallScore).toBe(direct.overallScore);
          expect(s1.report.categories).toEqual(direct.categories);
          expect(
            s1.report.externalSymlinks.map((l: { path: string }) => l.path),
          ).toEqual(expect.arrayContaining(["scripts/linked.py"]));
          const ok = parsed.results.find(
            (r: { label: string }) => r.label === "ok",
          );
          expect(ok).not.toHaveProperty("link");

          const text = await runCLI("eval", coll);
          expect(text.stdout).not.toContain(MARKER);
          expect(text.stdout).toContain(
            `info: s1 -> ${target} (linked skill folder, evaluated at its real path)`,
          );
          expect(text.stdout).not.toMatch(/error:/);

          const machine = JSON.parse(
            (await runCLI("eval", coll, "--machine")).stdout,
          );
          const m1 = machine.data.results.find(
            (r: { label: string }) => r.label === "s1",
          );
          expect(m1.link).toEqual({ path: "s1", target });

          // A gate scores the linked child like any other.
          const gated = await runCLI("eval", coll, "--min-score", "10");
          expect(gated.exitCode).toBe(0);
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      },
    );

    test.skipIf(process.platform === "win32")(
      "a SKILL.md that links outside has its own --machine error code",
      async () => {
        const { base, outside } = await fixture();
        const linked = join(base, "s2");
        try {
          await mkdir(linked);
          await writeFile(join(outside, "SKILL.md"), `# ${MARKER}\n`);
          await symlink(join(outside, "SKILL.md"), join(linked, "SKILL.md"));
          for (const extra of [[], ["--fix"]]) {
            const { stdout, exitCode } = await runCLI(
              "eval",
              linked,
              "--machine",
              ...extra,
            );
            expect(exitCode).toBe(1);
            expect(stdout).not.toContain(MARKER);
            const parsed = JSON.parse(stdout);
            expect(parsed.error.code).toBe("SKILL_MD_OUTSIDE_LINK");
            expect(parsed.error.message).toMatch(
              /^Symlink not read: SKILL\.md -> .*\(file, NOT read\)/,
            );
          }
        } finally {
          await rm(base, { recursive: true, force: true });
        }
      },
    );

    test.skipIf(process.platform === "win32")(
      "a remote subpath that links out of the clone is not listed or read",
      async () => {
        const { base, outside } = await fixture();
        const clone = join(base, "clone");
        try {
          await mkdir(join(clone, ".git"), { recursive: true });
          await mkdir(join(outside, "child"));
          await writeFile(
            join(outside, "child", "SKILL.md"),
            skillMd("child").replace("Prints hi.", MARKER),
          );
          await symlink(outside, join(clone, "skills"));
          remoteClone.dir = clone;
          const { stdout, stderr, exitCode } = await runCLI(
            "eval",
            "github:acme/linked:skills",
            "--json",
            "--keep",
          );
          expect(exitCode).toBe(1);
          expect(stdout + stderr).not.toContain(MARKER);
          expect(stderr).toMatch(
            /Symlink not read: skills -> .*outside \(directory, NOT read\)/,
          );
        } finally {
          remoteClone.dir = null;
          await rm(base, { recursive: true, force: true });
        }
      },
    );
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

  // ─── #773: --min-score / --min-category quality gates ────────────────

  const WEAK_SKILL =
    "---\nname: weak\ndescription: Do weak things when asked.\n---\n\nbody\n";

  async function makeGateCollection(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "eval-gate-"));
    for (const name of ["g1", "g2"]) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(
        join(root, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Do ${name} when asked.\n---\n\n## When to Use\n- thing\n\n## Instructions\n1. act\n`,
        "utf-8",
      );
    }
    return root;
  }

  /** Remove the lines the gate adds so gated text can be compared to ungated. */
  function stripGateLines(text: string): string {
    return text
      .replace(/\n\nThreshold: {8}[^\n]*/g, "")
      .replace(/\n {2}(Thresholds|Passed|Failed): [^\n]*/g, "");
  }

  test("eval without gate flags: text, JSON and exit code are unchanged", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    try {
      const plain = await runCLI("eval", dir);
      expect(plain.exitCode).toBe(0);
      expect(plain.stdout).not.toMatch(/Threshold|PASS|FAIL/);

      // Adding an always-passing gate only appends the verdict line: strip it
      // and the bytes must match the ungated run exactly.
      const gated = await runCLI("eval", dir, "--min-score", "0");
      expect(gated.exitCode).toBe(0);
      expect(gated.stdout).not.toBe(plain.stdout);
      expect(stripGateLines(gated.stdout)).toBe(plain.stdout);

      const json = JSON.parse((await runCLI("eval", dir, "--json")).stdout);
      expect(json).not.toHaveProperty("threshold");
      expect(json).not.toHaveProperty("thresholds");
      const machine = JSON.parse(
        (await runCLI("eval", dir, "--machine")).stdout,
      );
      expect(Object.keys(machine.data)).toEqual([
        "skill_path",
        "skill_md_path",
        "overall_score",
        "grade",
        "categories",
        "top_suggestions",
        "providers",
        "fix",
      ]);
    } finally {
      await cleanup();
    }
  });

  test("eval batch without gate flags: summary, JSON keys and exit code are unchanged", async () => {
    const root = await makeGateCollection();
    try {
      const plain = await runCLI("eval", root);
      expect(plain.exitCode).toBe(0);
      const gated = await runCLI(
        "eval",
        root,
        "--min-score",
        "0",
        "--min-category",
        "0",
      );
      expect(gated.exitCode).toBe(0);
      expect(stripGateLines(gated.stdout)).toBe(plain.stdout);

      const json = JSON.parse((await runCLI("eval", root, "--json")).stdout);
      expect(Object.keys(json)).toEqual(["provenance", "aggregate", "results"]);
      expect(Object.keys(json.aggregate)).toEqual([
        "total",
        "succeeded",
        "failed",
        "meanScore",
        "top",
        "bottom",
      ]);
      expect(Object.keys(json.results[0])).toEqual([
        "label",
        "skillPath",
        "error",
        "report",
      ]);
      const machine = JSON.parse(
        (await runCLI("eval", root, "--machine")).stdout,
      );
      expect(Object.keys(machine.data)).toEqual([
        "provenance",
        "aggregate",
        "results",
      ]);
      expect(machine.data.aggregate).not.toHaveProperty("threshold_passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval --min-score exits 1 with FAIL when the overall score is below N", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    try {
      const { stdout, exitCode } = await runCLI(
        "eval",
        dir,
        "--min-score",
        "100",
      );
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Threshold: {8}FAIL {2}overall \d+\/100 < 100/);
    } finally {
      await cleanup();
    }
  });

  test("eval --min-category exits 1 and names the failing categories", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    try {
      const { stdout, exitCode } = await runCLI(
        "eval",
        dir,
        "--min-category",
        "10",
      );
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(
        /FAIL {2}categories < 10: .*Testability \(\d+\/10\)/,
      );
      expect(stdout).not.toMatch(/overall \d+\/100 </);
    } finally {
      await cleanup();
    }
  });

  test("eval gate exits 0 with PASS when every threshold is met", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    try {
      const { stdout, exitCode } = await runCLI(
        "eval",
        dir,
        "--min-score",
        "0",
        "--min-category",
        "0",
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain(
        "Threshold:        PASS  (min-score 0, min-category 0)",
      );
    } finally {
      await cleanup();
    }
  });

  test("eval gate on a collection prints PASS/FAIL per skill and passed/failed counts", async () => {
    const root = await makeGateCollection();
    await mkdir(join(root, "weak"), { recursive: true });
    await writeFile(join(root, "weak", "SKILL.md"), WEAK_SKILL, "utf-8");
    try {
      const { stdout, exitCode } = await runCLI(
        "eval",
        root,
        "--min-score",
        "100",
      );
      expect(exitCode).toBe(1);
      expect(stdout.match(/Threshold: {8}FAIL/g)).toHaveLength(3);
      expect(stdout).toContain("  Thresholds:            min-score 100");
      expect(stdout).toContain("  Passed:                0/3");
      expect(stdout).toContain("  Failed:                3/3  (g1, g2, weak)");

      const pass = await runCLI("eval", root, "--min-category", "0");
      expect(pass.exitCode).toBe(0);
      expect(pass.stdout.match(/Threshold: {8}PASS/g)).toHaveLength(3);
      expect(pass.stdout).toContain("  Passed:                3/3");
      expect(pass.stdout).toContain("  Failed:                0/3");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval gate --json adds thresholds, per-skill verdicts and counts", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    const root = await makeGateCollection();
    try {
      const single = await runCLI(
        "eval",
        dir,
        "--json",
        "--min-score",
        "100",
        "--min-category",
        "10",
      );
      expect(single.exitCode).toBe(1);
      const s = JSON.parse(single.stdout);
      expect(s).toHaveProperty("overallScore"); // existing shape kept
      expect(s.thresholds).toEqual({ minScore: 100, minCategory: 10 });
      expect(s.threshold.passed).toBe(false);
      expect(s.threshold.overallBelowMin).toBe(true);
      expect(s.threshold.failingCategories.length).toBeGreaterThan(0);

      const batch = await runCLI("eval", root, "--json", "--min-score", "0");
      expect(batch.exitCode).toBe(0);
      const b = JSON.parse(batch.stdout);
      expect(b.aggregate.total).toBe(2); // existing fields kept
      expect(b.aggregate.thresholdPassed).toBe(2);
      expect(b.aggregate.thresholdFailed).toBe(0);
      expect(b.thresholds).toEqual({ minScore: 0, minCategory: null });
      expect(b.results[0].report).toHaveProperty("overallScore");
      expect(b.results[0].threshold).toEqual({
        passed: true,
        errored: false,
        overallBelowMin: false,
        failingCategories: [],
      });
    } finally {
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("eval gate --machine adds fields without breaking the v1 envelope", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    const root = await makeGateCollection();
    try {
      const single = await runCLI(
        "eval",
        dir,
        "--machine",
        "--min-category",
        "10",
      );
      expect(single.exitCode).toBe(1);
      const s = JSON.parse(single.stdout);
      expect(s.version).toBe(1);
      expect(s.status).toBe("ok");
      expect(s.data).toHaveProperty("overall_score");
      expect(s.data.thresholds).toEqual({ min_score: null, min_category: 10 });
      expect(s.data.threshold.passed).toBe(false);
      expect(s.data.threshold.overall_below_min).toBe(false);
      expect(s.data.threshold.failing_categories[0]).toHaveProperty("id");

      const batch = await runCLI(
        "eval",
        root,
        "--machine",
        "--min-score",
        "100",
      );
      expect(batch.exitCode).toBe(1);
      const b = JSON.parse(batch.stdout);
      expect(b.version).toBe(1);
      expect(b.data.aggregate.total).toBe(2);
      expect(b.data.aggregate.mean_score).toEqual(expect.any(Number));
      expect(b.data.aggregate.threshold_passed).toBe(0);
      expect(b.data.aggregate.threshold_failed).toBe(2);
      expect(b.data.thresholds).toEqual({ min_score: 100, min_category: null });
      expect(b.data.results[1].report).toHaveProperty("overall_score");
      expect(b.data.results[1].threshold.passed).toBe(false);
    } finally {
      await cleanup();
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["--min-score", "abc", 100],
    ["--min-score", "101", 100],
    ["--min-score", "-1", 100],
    ["--min-category", "11", 10],
    ["--min-category", "", 10],
  ])("eval %s %j is rejected with exit 2", async (flag, val, max) => {
    const { stderr, exitCode } = await runCLI("eval", "./whatever", flag, val);
    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      `Error: Invalid ${flag}: "${val}". Must be a number between 0 and ${max}.`,
    );
  });

  test("eval --min-score without a value is rejected with exit 2", async () => {
    const { stderr, exitCode } = await runCLI(
      "eval",
      "./whatever",
      "--min-score",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --min-score: "".');
  });

  test("eval gate flags cannot be combined with --fix", async () => {
    const { dir, cleanup } = await makeTempSkill(WEAK_SKILL);
    try {
      const human = await runCLI("eval", dir, "--fix", "--min-score", "50");
      expect(human.exitCode).toBe(2);
      expect(human.stderr).toMatch(/cannot be combined with --fix/);
      const machine = await runCLI(
        "eval",
        dir,
        "--fix",
        "--machine",
        "--min-category",
        "5",
      );
      expect(machine.exitCode).toBe(2);
      expect(JSON.parse(machine.stdout).error.code).toBe("INVALID_ARGUMENT");
      // Nothing was written.
      expect(await readFile(join(dir, "SKILL.md"), "utf-8")).toBe(WEAK_SKILL);
    } finally {
      await cleanup();
    }
  });

  test("eval --help documents the gate flags and Gate 2", async () => {
    const { stdout, exitCode } = await runCLI("eval", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--min-score N");
    expect(stdout).toContain("--min-category N");
    expect(stdout).toContain("--min-score 86 --min-category 8");
    expect(stdout).toContain("Exit codes:");
  });

  // ─── #773 fix round 1: errored skills, mixed collections, repeats ────

  async function addSkill(root: string, name: string, body: string) {
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, "SKILL.md"), body, "utf-8");
  }

  test("gated collection where every skill errors exits 1 (never a false pass)", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-allerr-"));
    try {
      await addSkill(root, "asm-eval-error-a", WEAK_SKILL);
      await addSkill(root, "asm-eval-error-b", WEAK_SKILL);

      // Ungated: today's behaviour is kept (errors reported, exit 0).
      const plain = await runCLI("eval", root);
      expect(plain.exitCode).toBe(0);
      expect(plain.stdout).not.toContain("Threshold:");

      const text = await runCLI(
        "eval",
        root,
        "--min-score",
        "86",
        "--min-category",
        "8",
      );
      expect(text.exitCode).toBe(1);
      expect(text.stdout).toContain("simulated provider failure");
      expect(
        text.stdout.match(
          /Threshold: {8}ERROR {2}evaluation failed; counted as a failure/g,
        ),
      ).toHaveLength(2);
      expect(text.stdout).toContain("  Passed:                0/2");
      expect(text.stdout).toContain(
        "  Failed:                2/2  (asm-eval-error-a [ERROR], asm-eval-error-b [ERROR])",
      );

      const machine = await runCLI(
        "eval",
        root,
        "--machine",
        "--min-score",
        "86",
      );
      expect(machine.exitCode).toBe(1);
      const m = JSON.parse(machine.stdout);
      expect(m.version).toBe(1);
      expect(m.data.aggregate.failed).toBe(2); // existing field kept
      expect(m.data.aggregate.threshold_passed).toBe(0);
      expect(m.data.aggregate.threshold_failed).toBe(2);
      expect(m.data.aggregate.threshold_errored).toBe(2);
      expect(m.data.results[0].threshold).toEqual({
        passed: false,
        errored: true,
        overall_below_min: false,
        failing_categories: [],
      });

      const json = await runCLI("eval", root, "--json", "--min-category", "8");
      expect(json.exitCode).toBe(1);
      const j = JSON.parse(json.stdout);
      expect(j.aggregate.thresholdPassed).toBe(0);
      expect(j.aggregate.thresholdFailed).toBe(2);
      expect(j.aggregate.thresholdErrored).toBe(2);
      expect(j.results[1].threshold.errored).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("gated collection with one good and one errored skill exits 1", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-mixerr-"));
    try {
      await addSkill(root, "asm-eval-error-x", WEAK_SKILL);
      await addSkill(root, "good", WEAK_SKILL);
      const { stdout, exitCode } = await runCLI(
        "eval",
        root,
        "--min-score",
        "0",
      );
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Threshold:        PASS  (min-score 0)");
      expect(stdout).toContain("Threshold:        ERROR");
      expect(stdout).toContain("  Passed:                1/2");
      expect(stdout).toContain(
        "  Failed:                1/2  (asm-eval-error-x [ERROR])",
      );

      const m = JSON.parse(
        (await runCLI("eval", root, "--machine", "--min-score", "0")).stdout,
      );
      expect(m.data.aggregate.threshold_passed).toBe(1);
      expect(m.data.aggregate.threshold_failed).toBe(1);
      expect(m.data.aggregate.threshold_errored).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("gated single errored skill exits 1, matching the batch path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "eval-singleerr-"));
    const dir = join(parent, "asm-eval-error-single");
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), WEAK_SKILL, "utf-8");
      const text = await runCLI("eval", dir, "--min-score", "0");
      expect(text.exitCode).toBe(1);
      expect(text.stderr).toContain("Error: simulated provider failure");
      const machine = await runCLI(
        "eval",
        dir,
        "--machine",
        "--min-category",
        "0",
      );
      expect(machine.exitCode).toBe(1);
      expect(JSON.parse(machine.stdout).status).toBe("error");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("gated mixed pass/fail collection exits 1 with Passed 1/2", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-mixed-"));
    try {
      await addSkill(
        root,
        "strong",
        "---\nname: strong\ndescription: Do strong things when asked.\n---\n\n## When to Use\n- thing\n\n## Instructions\n1. act\n",
      );
      await addSkill(root, "weak", WEAK_SKILL);
      const scores = JSON.parse(
        (await runCLI("eval", root, "--json")).stdout,
      ).results.map(
        (r: { report: { overallScore: number } }) => r.report.overallScore,
      );
      const [strong, weak] = scores as number[];
      expect(strong).toBeGreaterThan(weak);

      const { stdout, exitCode } = await runCLI(
        "eval",
        root,
        "--min-score",
        String(strong),
      );
      expect(exitCode).toBe(1);
      expect(stdout).toContain(`Threshold:        PASS  (min-score ${strong})`);
      expect(stdout).toContain(
        `Threshold:        FAIL  overall ${weak}/100 < ${strong}`,
      );
      expect(stdout).toContain("  Passed:                1/2");
      expect(stdout).toContain("  Failed:                1/2  (weak)");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each(["--min-score", "--min-category"])(
    "a repeated %s is rejected with exit 2",
    async (flag) => {
      const { stderr, exitCode } = await runCLI(
        "eval",
        "./whatever",
        flag,
        "5",
        flag,
        "1",
      );
      expect(exitCode).toBe(2);
      expect(stderr).toContain(
        `Error: ${flag} was given more than once. Pass it a single time.`,
      );
    },
  );

  test("parseArgs accepts --min-score and --min-category", () => {
    const r = parseArgs([
      "node",
      "script.ts",
      "eval",
      "./x",
      "--min-score",
      "86",
      "--min-category",
      "7.5",
    ]);
    expect(r.flags.minScore).toBe(86);
    expect(r.flags.minCategory).toBe(7.5);
    const d = parseArgs(["node", "script.ts", "eval", "./x"]);
    expect(d.flags.minScore).toBeNull();
    expect(d.flags.minCategory).toBeNull();
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
