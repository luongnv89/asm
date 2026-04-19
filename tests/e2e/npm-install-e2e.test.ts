import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  setDefaultTimeout,
} from "bun:test";
import { join, resolve } from "path";
import { mkdtemp, rm, readFile, access } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { tmpdir } from "os";

// npm pack + install can take a while, and the runtime eval smoke
// test spawns skillgrade (also slow on the first run).
setDefaultTimeout(120_000);

const ROOT = resolve(import.meta.dir, "..", "..");

let installDir: string;
let asmBin: string;
let setupError: string | null = null;

// ─── Setup: npm pack + npm install -g --prefix ─────────────────────────────

beforeAll(async () => {
  try {
    installDir = await mkdtemp(join(tmpdir(), "asm-npm-install-e2e-"));

    // Find the tarball: either from ASM_TARBALL env var or by running npm pack
    let tarball: string;
    const envTarball = process.env.ASM_TARBALL;

    if (envTarball) {
      // In CI, the tarball is downloaded as an artifact
      const globbed = readdirSync(ROOT).filter((f) =>
        f.match(/^agent-skill-manager-.*\.tgz$/),
      );
      if (globbed.length > 0) {
        tarball = join(ROOT, globbed[0]);
      } else {
        tarball = resolve(ROOT, envTarball);
      }
    } else {
      // Local: run npm pack to create it
      const packProc = Bun.spawn(["npm", "pack"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      });
      const packOut = (await new Response(packProc.stdout).text()).trim();
      await packProc.exited;
      tarball = join(ROOT, packOut.split("\n").pop()!);
    }

    // Install globally into the temp prefix
    const installProc = Bun.spawn(
      ["npm", "install", "--global", "--prefix", installDir, tarball],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      },
    );
    const installStderr = await new Response(installProc.stderr).text();
    const installExit = await installProc.exited;

    if (installExit !== 0) {
      setupError = `npm install failed (exit ${installExit}): ${installStderr}`;
      return;
    }

    // Resolve binary path
    asmBin = join(installDir, "bin", "asm");

    // Verify the binary exists
    try {
      await access(asmBin);
    } catch {
      // On some npm versions, the bin might be at a different path
      const altBin = join(installDir, "bin", "agent-skill-manager");
      try {
        await access(altBin);
        asmBin = altBin;
      } catch {
        setupError = `Binary not found at ${asmBin} or ${altBin}`;
      }
    }
  } catch (err) {
    setupError = `Setup failed: ${err}`;
  }
});

afterAll(async () => {
  if (installDir) {
    await rm(installDir, { recursive: true, force: true });
  }
  // Clean up any tarball we created
  const tarballs = readdirSync(ROOT).filter((f) =>
    f.match(/^agent-skill-manager-.*\.tgz$/),
  );
  for (const t of tarballs) {
    await rm(join(ROOT, t), { force: true });
  }
});

// Helper: run asm via the npm-installed binary
async function runAsm(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (setupError) throw new Error(setupError);

  const proc = Bun.spawn([asmBin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NO_COLOR: "1",
      PATH: `${join(installDir, "bin")}:${process.env.PATH}`,
    },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ─── Installation structure ─────────────────────────────────────────────────

describe("npm install: package structure", () => {
  test("setup succeeded", () => {
    if (setupError) throw new Error(setupError);
    expect(existsSync(asmBin)).toBe(true);
  });

  test("asm binary exists", () => {
    if (setupError) throw new Error(setupError);
    expect(existsSync(asmBin)).toBe(true);
  });

  test("dist/agent-skill-manager.js exists in installed package", () => {
    if (setupError) throw new Error(setupError);
    const distFile = join(
      installDir,
      "lib",
      "node_modules",
      "agent-skill-manager",
      "dist",
      "agent-skill-manager.js",
    );
    expect(existsSync(distFile)).toBe(true);
  });

  test("data/skill-index/ exists in installed package", () => {
    if (setupError) throw new Error(setupError);
    const dataDir = join(
      installDir,
      "lib",
      "node_modules",
      "agent-skill-manager",
      "data",
      "skill-index",
    );
    expect(existsSync(dataDir)).toBe(true);
    const jsons = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
    expect(jsons.length).toBeGreaterThanOrEqual(1);
  });

  // Regression: issue #172 — reinstall must restore bundled skillgrade so
  // `asm eval --runtime` works without a separate install step. The package
  // declares `bundledDependencies: ["skillgrade"]`, so the tarball ships the
  // full skillgrade tree under node_modules/ and npm preserves it on install.
  //
  // Note: this only asserts post-install reachability. A regular
  // `dependencies` entry would also satisfy this — the discriminating test
  // for `bundledDependencies` is the offline-install assertion below.
  test("skillgrade/ bin is reachable after install (issue #172)", () => {
    if (setupError) throw new Error(setupError);
    const skillgradeBin = join(
      installDir,
      "lib",
      "node_modules",
      "agent-skill-manager",
      "node_modules",
      "skillgrade",
      "bin",
      "skillgrade.js",
    );
    expect(existsSync(skillgradeBin)).toBe(true);
  });

  // Discriminating test for `bundledDependencies` (issue #172): the packed
  // tarball itself must contain skillgrade's files, so the package can be
  // installed offline / into an air-gapped CI runner / onto a failing
  // registry mirror. Without `bundledDependencies`, npm pack would omit
  // node_modules/ and this check would fail.
  test("tarball embeds skillgrade via bundledDependencies (issue #172)", async () => {
    if (setupError) throw new Error(setupError);

    // Re-pack to a throwaway directory so we can inspect the tarball
    // contents without coupling to the shared install tarball's lifecycle.
    const inspectDir = await mkdtemp(join(tmpdir(), "asm-npm-e2e-pack-"));
    try {
      const packProc = Bun.spawn(
        ["npm", "pack", "--pack-destination", inspectDir, ROOT],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const packExit = await packProc.exited;
      expect(packExit).toBe(0);

      const [packed] = readdirSync(inspectDir).filter((f) =>
        f.match(/^agent-skill-manager-.*\.tgz$/),
      );
      expect(packed).toBeTruthy();

      const listProc = Bun.spawn(["tar", "-tzf", join(inspectDir, packed)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const listing = await new Response(listProc.stdout).text();

      // Both the entry point and package metadata must ship inside the
      // tarball — simply having one could be a partial-match false positive.
      expect(listing).toContain(
        "package/node_modules/skillgrade/bin/skillgrade.js",
      );
      expect(listing).toContain("package/node_modules/skillgrade/package.json");
    } finally {
      await rm(inspectDir, { recursive: true, force: true });
    }
  });
});

// ─── Command tests via installed binary ─────────────────────────────────────

describe("npm install: asm --version", () => {
  test("prints version and exits 0", async () => {
    const { stdout, exitCode } = await runAsm("--version");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^asm v\d+\.\d+\.\d+/);
  });
});

describe("npm install: asm --help", () => {
  test("prints help and exits 0", async () => {
    const { stdout, exitCode } = await runAsm("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("list");
    expect(stdout).toContain("search");
  });
});

describe("npm install: asm list", () => {
  test("list --json returns valid JSON array", async () => {
    const { stdout, exitCode } = await runAsm("list", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("npm install: asm config", () => {
  test("config show returns valid JSON", async () => {
    const { stdout, exitCode } = await runAsm("config", "show");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("version");
  });

  test("config path returns a path", async () => {
    const { stdout, exitCode } = await runAsm("config", "path");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("config.json");
  });
});

describe("npm install: asm export", () => {
  test("export returns valid JSON", async () => {
    const { stdout, exitCode } = await runAsm("export");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("skills");
  });
});

describe("npm install: asm audit", () => {
  test("audit exits 0", async () => {
    const { exitCode } = await runAsm("audit");
    expect(exitCode).toBe(0);
  });
});

describe("npm install: asm stats", () => {
  test("stats exits 0", async () => {
    const { exitCode } = await runAsm("stats");
    expect(exitCode).toBe(0);
  });
});

describe("npm install: asm index", () => {
  test("index list exits 0", async () => {
    const { exitCode } = await runAsm("index", "list");
    expect(exitCode).toBe(0);
  });
});

describe("npm install: asm init", () => {
  let tempWorkspace: string;

  beforeAll(async () => {
    tempWorkspace = await mkdtemp(join(tmpdir(), "asm-npm-e2e-ws-"));
  });

  afterAll(async () => {
    if (tempWorkspace) {
      await rm(tempWorkspace, { recursive: true, force: true });
    }
  });

  test("init scaffolds skill and creates SKILL.md", async () => {
    if (setupError) throw new Error(setupError);
    const skillDir = join(tempWorkspace, "test-skill");
    const { exitCode } = await runAsm("init", "test-skill", "--path", skillDir);
    expect(exitCode).toBe(0);
    const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(content).toContain("name: test-skill");
  });
});

// ─── Runtime eval flow (bundled skillgrade, issue #172) ─────────────────────
//
// Regression smoke test for issue #172 acceptance criterion 4: verifies that
// a clean global install produces a working `asm eval --runtime` flow — no
// separate skillgrade install required. `asm eval <skill> --runtime init`
// is the cheapest exercise of the bundled binary: it scaffolds eval.yaml
// without making LLM calls, so it's deterministic and CI-safe.

describe("npm install: asm eval --runtime (bundled skillgrade)", () => {
  let evalWorkspace: string;

  beforeAll(async () => {
    evalWorkspace = await mkdtemp(join(tmpdir(), "asm-npm-e2e-eval-"));
  });

  afterAll(async () => {
    if (evalWorkspace) {
      await rm(evalWorkspace, { recursive: true, force: true });
    }
  });

  test("eval --runtime init scaffolds eval.yaml via bundled skillgrade", async () => {
    if (setupError) throw new Error(setupError);

    // Minimal SKILL.md fixture — skillgrade init reads this and drafts
    // eval.yaml without invoking any LLM.
    const skillDir = join(evalWorkspace, "bundled-skillgrade-skill");
    const { exitCode: mkExit } = await runAsm(
      "init",
      "bundled-skillgrade-skill",
      "--path",
      skillDir,
    );
    expect(mkExit).toBe(0);

    const { exitCode, stdout, stderr } = await runAsm(
      "eval",
      skillDir,
      "--runtime",
      "init",
    );

    // Assertion #1: the bundled skillgrade binary was reachable — the
    // "skillgrade not installed" error path means bundling regressed.
    const combined = `${stdout}\n${stderr}`;
    expect(combined).not.toContain("skillgrade not installed");

    // Assertion #2: scaffold succeeded.
    expect(exitCode).toBe(0);
    const evalYaml = join(skillDir, "eval.yaml");
    expect(existsSync(evalYaml)).toBe(true);
  });
});

// ─── Regression: no protocol errors ─────────────────────────────────────────

describe("npm install: no Node.js protocol errors", () => {
  test("no ERR_UNSUPPORTED_ESM_URL_SCHEME (issue #35)", async () => {
    const { stderr } = await runAsm("--version");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_ESM_URL_SCHEME");
  });
});
