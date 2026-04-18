/**
 * Provider tests for skillgrade v1.
 *
 * All tests build a provider instance with a fake `Spawner` + fake
 * `fileExists` so no real binary, filesystem, or network is touched.
 * This is the single biggest property of the skillgrade integration:
 * CI must stay offline.
 *
 * Two axes covered:
 *   1. `applicable()` — every failure reason (binary missing, version
 *      out of range, eval.yaml missing, invalid range config).
 *   2. `run()` — success path against recorded fixtures, plus every
 *      failure mode (missing API key, Docker unavailable, timeout,
 *      abort, non-zero exit, bad JSON).
 */

import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  buildRunArgv,
  classifyStderr,
  createSkillgradeProvider,
  DEFAULT_THRESHOLD_FRACTION,
  detectVersion,
  resolveRunOpts,
} from "./index";
import type { Spawner, SpawnResult } from "./spawn";
import type { SkillContext } from "../../../types";

const FIXTURES_DIR = join(__dirname, "fixtures");
const CORPUS_DIR = join(__dirname, "../../../../..", "tests/fixtures/skills");

const CTX_WITH: SkillContext = {
  skillPath: join(CORPUS_DIR, "with-eval-yaml"),
  skillMdPath: join(CORPUS_DIR, "with-eval-yaml", "SKILL.md"),
  skillName: "with-eval-yaml",
};

const CTX_BROKEN: SkillContext = {
  skillPath: join(CORPUS_DIR, "runtime-broken"),
  skillMdPath: join(CORPUS_DIR, "runtime-broken", "SKILL.md"),
  skillName: "runtime-broken",
};

// ─── Spawner builders ───────────────────────────────────────────────────────

/** Reusable spawner that dispatches on the first argv token after the binary. */
function makeSpawner(handlers: {
  version?: () => SpawnResult | Promise<SpawnResult>;
  run?: (argv: string[]) => SpawnResult | Promise<SpawnResult>;
  init?: () => SpawnResult | Promise<SpawnResult>;
}): Spawner {
  return async (argv) => {
    const sub = argv[1];
    if (sub === "--version" && handlers.version) return handlers.version();
    if (sub === "run" && handlers.run) return handlers.run(argv);
    if (sub === "init" && handlers.init) return handlers.init();
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
    };
  };
}

function okVersion(version = "0.1.4"): SpawnResult {
  return {
    exitCode: 0,
    stdout: `skillgrade ${version}\n`,
    stderr: "",
    timedOut: false,
    aborted: false,
  };
}

// ─── Provider shape ─────────────────────────────────────────────────────────

describe("skillgrade provider — identity", () => {
  it("has id=skillgrade, version=1.0.0, schemaVersion=1", () => {
    const p = createSkillgradeProvider();
    expect(p.id).toBe("skillgrade");
    expect(p.version).toBe("1.0.0");
    expect(p.schemaVersion).toBe(1);
    expect(p.externalRequires?.binary).toBe("skillgrade");
    expect(p.externalRequires?.installHint).toContain("npm i -g skillgrade");
  });
});

// ─── detectVersion + helpers ────────────────────────────────────────────────

describe("detectVersion", () => {
  it("parses `skillgrade 0.1.4` from stdout", async () => {
    const v = await detectVersion(
      makeSpawner({ version: () => okVersion("0.1.4") }),
      "skillgrade",
    );
    expect(v).toBe("0.1.4");
  });

  it("falls back to stderr when stdout is empty", async () => {
    const v = await detectVersion(
      makeSpawner({
        version: () => ({
          exitCode: 0,
          stdout: "",
          stderr: "v0.2.0\n",
          timedOut: false,
          aborted: false,
        }),
      }),
      "skillgrade",
    );
    expect(v).toBe("0.2.0");
  });

  it("returns null on non-zero exit", async () => {
    const v = await detectVersion(
      makeSpawner({
        version: () => ({
          exitCode: 1,
          stdout: "",
          stderr: "bad",
          timedOut: false,
          aborted: false,
        }),
      }),
      "skillgrade",
    );
    expect(v).toBeNull();
  });

  it("returns null when the spawner throws", async () => {
    const v = await detectVersion(async () => {
      const e: any = new Error("ENOENT");
      e.code = "ENOENT";
      throw e;
    }, "skillgrade");
    expect(v).toBeNull();
  });
});

describe("resolveRunOpts", () => {
  it("applies defaults when nothing is set", () => {
    expect(resolveRunOpts({})).toEqual({
      thresholdFraction: DEFAULT_THRESHOLD_FRACTION,
      preset: "smoke",
      provider: "docker",
    });
  });

  it("accepts fraction threshold verbatim", () => {
    expect(resolveRunOpts({ threshold: 0.5 }).thresholdFraction).toBe(0.5);
  });

  it("converts >1 threshold as 0..100 integer to fraction", () => {
    expect(resolveRunOpts({ threshold: 80 }).thresholdFraction).toBe(0.8);
  });

  it("rejects unknown presets & providers (fallback to default)", () => {
    const r = resolveRunOpts({
      preset: "bogus" as any,
      provider: "alien" as any,
    });
    expect(r.preset).toBe("smoke");
    expect(r.provider).toBe("docker");
  });
});

describe("buildRunArgv", () => {
  it("produces the canonical --ci --json argv", () => {
    const argv = buildRunArgv("skillgrade", {
      thresholdFraction: 0.9,
      preset: "reliable",
      provider: "local",
    });
    expect(argv).toEqual([
      "skillgrade",
      "run",
      "--ci",
      "--threshold",
      "0.9",
      "--preset",
      "reliable",
      "--provider",
      "local",
      "--json",
    ]);
  });
});

describe("classifyStderr", () => {
  it("detects missing API key", () => {
    expect(classifyStderr("ANTHROPIC_API_KEY is not set").code).toBe(
      "missing-api-key",
    );
    expect(classifyStderr("401 Unauthorized").code).toBe("missing-api-key");
  });

  it("detects docker unavailable", () => {
    expect(classifyStderr("cannot connect to the docker daemon").code).toBe(
      "docker-unavailable",
    );
    expect(classifyStderr("docker is not running").code).toBe(
      "docker-unavailable",
    );
  });

  it("defaults to skillgrade-nonzero-exit for unknown stderr", () => {
    expect(classifyStderr("something else went wrong").code).toBe(
      "skillgrade-nonzero-exit",
    );
  });
});

// ─── applicable() ───────────────────────────────────────────────────────────

describe("applicable() — binary", () => {
  it("returns ok:false when skillgrade is not on PATH", async () => {
    const p = createSkillgradeProvider({
      spawn: async () => {
        const e: any = new Error("ENOENT");
        e.code = "ENOENT";
        throw e;
      },
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("npm i -g skillgrade");
  });

  it("returns ok:false when `skillgrade --version` exits non-zero", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        version: () => ({
          exitCode: 127,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not installed or unreachable/i);
  });
});

describe("applicable() — version range", () => {
  it("returns ok:false when version is below range", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion("0.1.2") }),
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("0.1.2");
    expect(r.reason).toContain("0.1.3");
  });

  it("returns ok:false when version is above range", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion("0.3.0") }),
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside required range/i);
  });

  it("returns ok:true for versions inside the declared range", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion("0.2.1") }),
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(true);
  });

  it("returns ok:false with a clear error when externalRequires is invalid", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion("0.1.4") }),
      fileExists: async () => true,
      externalRequires: "totally-bogus-range",
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("invalid externalRequires");
  });
});

describe("applicable() — eval.yaml", () => {
  it("returns ok:false when eval.yaml is missing in the skill dir", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion() }),
      fileExists: async () => false,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no eval.yaml");
    expect(r.reason).toContain("asm eval --runtime init");
  });

  it("returns ok:true when all three stages pass", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({ version: () => okVersion() }),
      fileExists: async () => true,
    });
    const r = await p.applicable(CTX_WITH, {});
    expect(r.ok).toBe(true);
  });
});

// ─── run() ──────────────────────────────────────────────────────────────────

async function loadFixture(name: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, `${name}.skillgrade.json`), "utf-8");
}

describe("run() — happy path", () => {
  it("maps with-eval-yaml recorded JSON to a passing EvalResult", async () => {
    const stdout = await loadFixture("with-eval-yaml");
    let argvSeen: string[] = [];
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: (argv) => {
          argvSeen = argv;
          return {
            exitCode: 0,
            stdout,
            stderr: "",
            timedOut: false,
            aborted: false,
          };
        },
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.passed).toBe(true);
    expect(r.score).toBe(92);
    expect(r.providerId).toBe("skillgrade");
    expect(r.providerVersion).toBe("1.0.0");
    expect(r.categories.map((c) => c.id)).toEqual([
      "summarize-empty-range",
      "summarize-typical-range",
    ]);
    // Verify argv carried defaults through.
    expect(argvSeen).toContain("--ci");
    expect(argvSeen).toContain("--json");
    expect(argvSeen).toContain("--preset");
    expect(argvSeen).toContain("smoke");
  });

  it("maps runtime-broken recorded JSON to a failing EvalResult", async () => {
    const stdout = await loadFixture("runtime-broken");
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: 0,
          stdout,
          stderr: "",
          timedOut: false,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_BROKEN, {});
    expect(r.passed).toBe(false);
    expect(r.score).toBe(40);
    expect(r.findings.some((f) => f.severity === "warning")).toBe(true);
  });

  it("threads --threshold / --preset / --provider from EvalOpts", async () => {
    const stdout = await loadFixture("with-eval-yaml");
    let argvSeen: string[] = [];
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: (argv) => {
          argvSeen = argv;
          return {
            exitCode: 0,
            stdout,
            stderr: "",
            timedOut: false,
            aborted: false,
          };
        },
      }),
      fileExists: async () => true,
    });
    await p.run(CTX_WITH, {
      threshold: 0.95,
      preset: "reliable",
      provider: "local",
    });
    expect(argvSeen).toEqual([
      "skillgrade",
      "run",
      "--ci",
      "--threshold",
      "0.95",
      "--preset",
      "reliable",
      "--provider",
      "local",
      "--json",
    ]);
  });
});

describe("run() — failure modes", () => {
  it("returns a missing-api-key finding when skillgrade complains about keys", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: 2,
          stdout: "",
          stderr: "ANTHROPIC_API_KEY is not set",
          timedOut: false,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.passed).toBe(false);
    expect(r.findings[0]!.code).toBe("missing-api-key");
    expect(r.findings[0]!.severity).toBe("error");
  });

  it("returns a docker-unavailable finding when Docker isn't running", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: 1,
          stdout: "",
          stderr: "docker: cannot connect to the docker daemon",
          timedOut: false,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.findings[0]!.code).toBe("docker-unavailable");
  });

  it("returns a timeout finding when the spawner reports timedOut", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: true,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, { timeoutMs: 5 });
    expect(r.findings[0]!.code).toBe("timeout");
  });

  it("returns an aborted finding when the spawner reports aborted", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: true,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.findings[0]!.code).toBe("aborted");
  });

  it("returns a bad-JSON finding when stdout is not JSON", async () => {
    const p = createSkillgradeProvider({
      spawn: makeSpawner({
        run: () => ({
          exitCode: 0,
          stdout: "not-json-at-all",
          stderr: "",
          timedOut: false,
          aborted: false,
        }),
      }),
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.findings[0]!.code).toBe("skillgrade-bad-json");
  });

  it("returns a binary-missing finding when the spawner throws ENOENT at run time", async () => {
    const p = createSkillgradeProvider({
      spawn: async () => {
        const e: any = new Error("spawn skillgrade ENOENT");
        e.code = "ENOENT";
        throw e;
      },
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.findings[0]!.code).toBe("binary-missing");
  });

  it("returns a spawn-failed finding for generic spawn errors", async () => {
    const p = createSkillgradeProvider({
      spawn: async () => {
        throw new Error("EACCES");
      },
      fileExists: async () => true,
    });
    const r = await p.run(CTX_WITH, {});
    expect(r.findings[0]!.code).toBe("spawn-failed");
  });
});

describe("run() — cwd is the skill directory", () => {
  it("invokes the spawner with cwd = ctx.skillPath", async () => {
    const stdout = await loadFixture("with-eval-yaml");
    let cwdSeen: string | undefined;
    const p = createSkillgradeProvider({
      spawn: async (_argv, opts) => {
        cwdSeen = opts?.cwd;
        return {
          exitCode: 0,
          stdout,
          stderr: "",
          timedOut: false,
          aborted: false,
        };
      },
      fileExists: async () => true,
    });
    await p.run(CTX_WITH, {});
    expect(cwdSeen).toBe(CTX_WITH.skillPath);
  });
});
