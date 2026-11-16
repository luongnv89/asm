import { fileURLToPath } from "url";
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { join, resolve, dirname } from "path";
import { mkdtemp, rm, readFile, access } from "fs/promises";
import { existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { spawnCollect, spawnCollectTimed } from "../../src/utils/test-spawn";

vi.setConfig({ testTimeout: 120_000 });

// Setup budget (#816). `testTimeout` above never covered `beforeAll`: the hook
// ran under vitest's 30 s `hookTimeout`, and `npm install --global <tarball>`
// resolves the package's dependencies from the live registry. A healthy run
// installs in a few seconds, but npm's own retry schedule (fetch-retries=2,
// fetch-retry-mintimeout=10 s, fetch-retry-maxtimeout=60 s) means one or two
// slow registry responses alone push it past 30 s. Each step gets its own
// deadline, and the hook timeout sits above their sum so a step deadline always
// fires first and names itself instead of a bare "Hook timed out".
const PACK_BUDGET_MS = 60_000;
const INSTALL_BUDGET_MS = 180_000;
const SETUP_HOOK_TIMEOUT_MS = PACK_BUDGET_MS + INSTALL_BUDGET_MS + 30_000;

/** Run one setup command under its deadline; throw a message naming the step. */
async function runSetupStep(
  step: string,
  argv: readonly string[],
  opts: Parameters<typeof spawnCollect>[1],
  budgetMs: number,
): Promise<{ stdout: string; stderr: string }> {
  const res = await spawnCollectTimed(argv, { ...opts, timeoutMs: budgetMs });
  const secs = (res.elapsedMs / 1000).toFixed(1);
  const tail = res.stderr.trim().split("\n").slice(-20).join("\n");
  if (res.timedOut) {
    throw new Error(
      `Setup timed out after ${secs}s (budget ${budgetMs / 1000}s) while ${step}` +
        (tail ? `\nnpm stderr (last lines):\n${tail}` : ""),
    );
  }
  if (res.exitCode !== 0) {
    throw new Error(
      `Setup failed after ${secs}s while ${step} (exit ${res.exitCode})` +
        (tail ? `:\n${tail}` : ""),
    );
  }
  console.info(`[npm-install-e2e] ${step}: ${secs}s`);
  return res;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
      const packRes = await runSetupStep(
        "packing the tarball (npm pack)",
        ["npm", "pack"],
        { cwd: ROOT },
        PACK_BUDGET_MS,
      );
      const packOut = packRes.stdout.trim();
      tarball = join(ROOT, packOut.split("\n").pop()!);
    }

    // Install globally into the temp prefix. --no-audit drops the advisory
    // request npm otherwise sends to the registry and awaits after resolving;
    // it has no bearing on whether the package installs or runs.
    await runSetupStep(
      "installing the tarball and its dependencies from the registry (npm install --global)",
      [
        "npm",
        "install",
        "--global",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installDir,
        tarball,
      ],
      { env: { ...process.env } },
      INSTALL_BUDGET_MS,
    );

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
    setupError = err instanceof Error ? err.message : `Setup failed: ${err}`;
  }
}, SETUP_HOOK_TIMEOUT_MS);

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

  const res = await spawnCollect([asmBin, ...args], {
    env: {
      ...process.env,
      NO_COLOR: "1",
      PATH: `${join(installDir, "bin")}:${process.env.PATH}`,
    },
  });
  return {
    stdout: res.stdout.trim(),
    stderr: res.stderr.trim(),
    exitCode: res.exitCode,
  };
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

// ─── Regression: no protocol errors ─────────────────────────────────────────

describe("npm install: no Node.js protocol errors", () => {
  test("no ERR_UNSUPPORTED_ESM_URL_SCHEME (issue #35)", async () => {
    const { stderr } = await runAsm("--version");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_ESM_URL_SCHEME");
  });
});
