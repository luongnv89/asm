import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createDirSymlink } from "./utils/fs";
import { parseArgs, isCLIMode } from "./cli";
import { join, dirname } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readdir,
  readFile,
  lstat,
  realpath,
  chmod,
} from "fs/promises";
import { tmpdir } from "os";
import { spawnCollect } from "./utils/test-spawn";
import { runCliInProcess, CLI_BIN } from "./cli-test-harness";

// `asm get`/`asm deps` CLI tests — split from cli.test.ts (issue #678).
describe("asm get (issue #422)", () => {
  let home: string;
  let skillDir: string;
  const BODY = `---
name: get-fixture
description: A fixture skill used by the asm get tests.
dependencies:
  - code-review
  - test-coverage
---

# Get fixture

One line of body text.
`;

  // Every spawn runs against a throwaway HOME so the command can never read —
  // or write — the developer's real skill directories.
  async function runGet(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const res = await runCliInProcess(["npx", "tsx", CLI_BIN, "get", ...args], {
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });
    return {
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "asm-get-home-"));
    skillDir = join(
      await mkdtemp(join(tmpdir(), "asm-get-src-")),
      "get-fixture",
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), BODY, "utf-8");
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(dirname(skillDir), { recursive: true, force: true });
  });

  test("writes the SKILL.md body to stdout and nothing else", async () => {
    const { stdout, exitCode } = await runGet(skillDir);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(BODY);
  });

  test("reports provenance on stderr, never on stdout", async () => {
    const { stdout, stderr } = await runGet(skillDir);
    expect(stderr).toContain("get-fixture");
    expect(stderr).toContain(skillDir);
    expect(stderr).toContain("residency");
    expect(stdout).not.toContain("residency");
    expect(stdout).not.toContain("source:");
  });

  test("resolves an installed skill by name and reports the installed tier", async () => {
    const installed = join(home, ".claude", "skills", "get-fixture");
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, "SKILL.md"), BODY, "utf-8");

    const { stdout, stderr, exitCode } = await runGet("get-fixture");
    expect(exitCode).toBe(0);
    expect(stdout).toBe(BODY);
    expect(stderr).toContain("(installed)");
  });

  test("resolves a deactivated library skill the scanner cannot see", async () => {
    // Tier 2 lives outside every provider directory, so `scanAllSkills` finds
    // nothing — this rung is the only way `asm get` reaches it, and it is the
    // population `asm audit residency` points at the reference tier.
    const libraryDir = join(home, ".config", "agent-skill-manager", "library");
    const libSkill = join(libraryDir, "skills", "lib-only");
    await mkdir(libSkill, { recursive: true });
    await writeFile(join(libSkill, "SKILL.md"), BODY, "utf-8");
    await writeFile(
      join(libraryDir, "library-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          "lib-only": {
            name: "lib-only",
            version: "1.0.0",
            source: "github:acme/skills",
            commitHash: "0123456789abcdef0123456789abcdef01234567",
            ref: null,
            skillPath: "lib-only",
            libraryPath: libSkill,
            installedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      "utf-8",
    );

    const { stdout, stderr, exitCode } = await runGet("lib-only", "--json");
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Fetching");
    const payload = JSON.parse(stdout);
    expect(payload.tier).toBe("library");
    expect(payload.source).toBe(libSkill);
    expect(payload.commit).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(payload.content).toBe(BODY);
  });

  test("refuses to guess when two indexed repos publish the same name", async () => {
    const indexDir = join(
      home,
      ".config",
      "agent-skill-manager",
      "skill-index",
    );
    await mkdir(indexDir, { recursive: true });
    const entry = (owner: string, repo: string) => ({
      repoUrl: `https://github.com/${owner}/${repo}`,
      owner,
      repo,
      updatedAt: "2026-01-01T00:00:00.000Z",
      skillCount: 1,
      skills: [
        {
          name: "collide-422",
          description: "A name published by two repos.",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "",
          allowedTools: [],
          installUrl: `github:${owner}/${repo}:skills/collide-422`,
          relPath: "skills/collide-422",
          tokenCount: 10,
        },
      ],
      bundles: [],
    });
    await writeFile(
      join(indexDir, "acme_skills.json"),
      JSON.stringify(entry("acme", "skills")),
      "utf-8",
    );
    await writeFile(
      join(indexDir, "other_pack.json"),
      JSON.stringify(entry("other", "pack")),
      "utf-8",
    );

    const { stderr, exitCode } = await runGet("collide-422");
    expect(exitCode).toBe(1);
    // Never a clone: an ambiguous name is reported, not resolved.
    expect(stderr).not.toContain("Fetching");
    expect(stderr).toContain("matches 2 indexed skills");
    expect(stderr).toContain("github:acme/skills:skills/collide-422");
    expect(stderr).toContain("github:other/pack:skills/collide-422");

    const machine = await runGet("collide-422", "--machine");
    expect(machine.exitCode).toBe(1);
    const envelope = JSON.parse(machine.stdout);
    expect(envelope.status).toBe("error");
    expect(envelope.error.code).toBe("INVALID_ARGUMENT");
    expect(envelope.error.details.candidates).toHaveLength(2);
  });

  test("--json emits one object with source, token count and body", async () => {
    const { stdout, exitCode } = await runGet(skillDir, "--json");
    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.name).toBe("get-fixture");
    expect(payload.description).toBe(
      "A fixture skill used by the asm get tests.",
    );
    expect(payload.dependencies).toEqual(["code-review", "test-coverage"]);
    expect(payload.tier).toBe("local");
    expect(payload.source).toBe(skillDir);
    expect(typeof payload.tokenCount).toBe("number");
    expect(payload.tokenCount).toBeGreaterThan(0);
    expect(payload.content).toBe(BODY);
    // Assembled field by field — the scanner's private cache must never leak.
    expect(payload).not.toHaveProperty("_skillMdContent");
  });

  test("--machine wraps the same data in the v1 envelope", async () => {
    const { stdout, exitCode } = await runGet(skillDir, "--machine");
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("get");
    expect(envelope.status).toBe("ok");
    expect(envelope.data.content).toBe(BODY);
  });

  test("refuses a subpath that climbs out of the clone", async () => {
    const { stderr, exitCode } = await runGet(
      "github:acme/skills:../../../etc",
    );
    expect(exitCode).toBe(1);
    // Rejected before any network access — the clone never starts.
    expect(stderr).not.toContain("Fetching");
    expect(stderr).toContain("escapes the repository");
  });

  test("refuses a `..` hidden in the ref, which resolveSubpath would split out", async () => {
    // `parseSource` reports subpath: null here — the `..` lives in the ref, and
    // `resolveSubpath` would later split "main/../../etc" into ref "main" plus
    // subpath "../../etc", which is then joined onto the temp clone.
    const { stderr, exitCode } = await runGet(
      "github:acme/skills#main/../../etc",
    );
    expect(exitCode).toBe(1);
    // Rejected before any network access — neither ls-remote nor clone runs.
    expect(stderr).not.toContain("Fetching");
    expect(stderr).toContain("escapes the repository");
  });

  test("--audit prints the audit report on stderr for a local tier", async () => {
    // The flag used to be a silent no-op for skills that were never fetched;
    // it now runs against whatever directory the ladder resolved.
    const { stdout, stderr, exitCode } = await runGet(skillDir, "--audit");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Security Audit");
    // The body still owns stdout, byte for byte.
    expect(stdout).toBe(BODY);
  });

  test("a missing argument exits 2", async () => {
    const { exitCode, stderr } = await runGet();
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("an unresolvable name exits 1 with a search hint", async () => {
    // Deliberately not a valid bare/scoped registry name, so the ladder ends
    // locally and the test never touches the network.
    const { exitCode, stderr } = await runGet("NotARealSkill_422");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
    expect(stderr).toContain("asm search");
  });

  test("--help exits 0 and documents the zero-residency guarantee", async () => {
    const { stdout, exitCode } = await runGet("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm get <skill>");
    expect(stdout).toContain("Nothing is installed");
  });

  test("installs nothing: no provider directory and no library are created", async () => {
    const exists = async (p: string) => {
      try {
        await lstat(p);
        return true;
      } catch {
        return false;
      }
    };

    await runGet(skillDir);
    await runGet(skillDir, "--json");
    // Walk the whole ladder — installed, library, index — and fall off the end.
    // The name is deliberately not a valid bare/scoped registry name, so the
    // registry rung is never reached and no network call happens.
    await runGet("NotARealSkill_422");

    // Provider directories for the most common agents.
    for (const dir of [
      join(home, ".claude", "skills"),
      join(home, ".codex", "skills"),
      join(home, ".cursor", "rules"),
    ]) {
      expect(await exists(dir)).toBe(false);
    }
    // The `asm` library — tier 2 — must be untouched as well.
    expect(
      await exists(join(home, ".config", "agent-skill-manager", "library")),
    ).toBe(false);
    // The registry metadata cache is deliberately NOT asserted on: it is
    // resolution metadata, not an installed skill, and the local path used
    // here never reaches the registry rung anyway.
  });
});

describe("asm get --path and cleanup (issue #654)", () => {
  let tempDir: string;
  let sourceDir: string;
  let home: string;
  let configDir: string;
  const body =
    "---\nname: borrow-fixture\ndescription: Full skill fixture\n---\n# Borrow fixture\n";
  const binary = Buffer.from([0, 255, 128, 1]);

  // Cross-process borrow-lock tests (the concurrency case below) still need
  // real spawned children — one process cannot hold two OS-level borrowers.
  function runSpawned(...args: string[]) {
    return spawnCollect(["npx", "tsx", CLI_BIN, ...args], {
      cwd: tempDir,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ASM_CONFIG_DIR: configDir,
        NO_COLOR: "1",
      },
    });
  }

  async function run(...args: string[]) {
    return runCliInProcess(["npx", "tsx", CLI_BIN, ...args], {
      cwd: tempDir,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        ASM_CONFIG_DIR: configDir,
        NO_COLOR: "1",
      },
    });
  }

  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "asm-borrow-cli-")));
    home = join(tempDir, "home");
    configDir = join(home, ".config", "agent-skill-manager");
    sourceDir = join(tempDir, "source with spaces", "borrow-fixture");
    await mkdir(join(sourceDir, "scripts"), { recursive: true });
    await mkdir(join(sourceDir, "assets"));
    await mkdir(join(sourceDir, "templates"));
    await writeFile(join(sourceDir, "SKILL.md"), body);
    await writeFile(
      join(sourceDir, "scripts", "run.sh"),
      "#!/bin/sh\nprintf fixture\n",
    );
    await chmod(join(sourceDir, "scripts", "run.sh"), 0o755);
    await writeFile(join(sourceDir, "assets", "data.bin"), binary);
    await writeFile(join(sourceDir, "templates", "sample.txt"), "template");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reads all files after get exits, then a second command removes only the borrow", async () => {
    const got = await run("get", "--path", sourceDir);
    expect(got.exitCode, got.stderr).toBe(0);
    const path = got.stdout.trim();
    expect(got.stdout).toBe(path + "\n");
    expect(await realpath(path)).toBe(path);
    expect(path).not.toBe(sourceDir);
    expect(got.stderr).toContain("asm cleanup");
    expect(got.stderr).toContain("(local)");
    expect(await readFile(join(path, "SKILL.md"), "utf-8")).toBe(body);
    expect(await readFile(join(path, "assets", "data.bin"))).toEqual(binary);
    expect(await readFile(join(path, "templates", "sample.txt"), "utf-8")).toBe(
      "template",
    );
    if (process.platform !== "win32")
      expect((await lstat(join(path, "scripts", "run.sh"))).mode & 0o777).toBe(
        0o755,
      );
    const sentinel = join(configDir, "unrelated.txt");
    await writeFile(sentinel, "keep");
    const cleaned = await run("cleanup", path);
    expect(cleaned.exitCode, cleaned.stderr).toBe(0);
    expect(cleaned.stdout).toContain("Removed borrowed skill");
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(sourceDir, "SKILL.md"), "utf-8")).toBe(body);
    expect(await readFile(sentinel, "utf-8")).toBe("keep");
    for (const dir of [
      join(home, ".claude", "skills"),
      join(configDir, "library"),
    ]) {
      await expect(lstat(dir)).rejects.toMatchObject({ code: "ENOENT" });
    }
    const repeated = await run("cleanup", path, "--json");
    expect(repeated.exitCode).toBe(0);
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      path,
      status: "not-found",
      errors: [],
    });
  });

  test.each([
    ["before", "--json"],
    ["after", "--json"],
    ["before", "--machine"],
    ["after", "--machine"],
  ])("supports --path %s the target with %s", async (position, mode) => {
    const got = await run(
      "get",
      ...(position === "before"
        ? ["--path", sourceDir]
        : [sourceDir, "--path"]),
      mode,
    );
    expect(got.exitCode, got.stderr).toBe(0);
    const payload = JSON.parse(got.stdout);
    if (mode === "--machine")
      expect(payload).toMatchObject({
        command: "get",
        status: "ok",
        version: 1,
      });
    const result = mode === "--machine" ? payload.data : payload;
    expect(result).toMatchObject({
      name: "borrow-fixture",
      tier: "local",
      source: sourceDir,
      security: null,
      files: [
        "SKILL.md",
        "assets/data.bin",
        "scripts/run.sh",
        "templates/sample.txt",
      ],
      cleanup: { command: "asm", args: ["cleanup", result.path] },
    });
    expect(result).not.toHaveProperty("content");
    expect(await readFile(join(result.path, "SKILL.md"), "utf-8")).toBe(body);
    const cleaned = await run(...result.cleanup.args, mode);
    expect(cleaned.exitCode, cleaned.stderr).toBe(0);
    const cleanup = JSON.parse(cleaned.stdout);
    expect(mode === "--machine" ? cleanup.data : cleanup).toMatchObject({
      path: result.path,
      status: "removed",
      errors: [],
    });
  });

  test("copies installed provider symlinks and leaves the provider and source intact", async () => {
    const installed = join(home, ".claude", "skills", "borrow-fixture");
    await mkdir(dirname(installed), { recursive: true });
    await createDirSymlink(sourceDir, installed);
    const got = await run("get", "borrow-fixture", "--path", "--json");
    expect(got.exitCode, got.stderr).toBe(0);
    const result = JSON.parse(got.stdout);
    expect(result.tier).toBe("installed");
    expect(result.files).toContain("assets/data.bin");
    expect((await run("cleanup", result.path)).exitCode).toBe(0);
    expect((await lstat(installed)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(installed, "SKILL.md"), "utf-8")).toBe(body);
  });

  test("borrows a deactivated library installation without removing the permanent install", async () => {
    const installed = await run("install", sourceDir, "--library", "--yes");
    expect(installed.exitCode, installed.stderr).toBe(0);
    const got = await run("get", "borrow-fixture", "--path", "--json");
    expect(got.exitCode, got.stderr).toBe(0);
    const result = JSON.parse(got.stdout);
    expect(result.tier).toBe("library");
    expect(result.path).not.toBe(result.source);
    expect((await run("cleanup", result.path)).exitCode).toBe(0);
    const originalCleanup = await run("cleanup", result.source, "--json");
    expect(JSON.parse(originalCleanup.stdout).status).toBe("not-found");
    expect(await readFile(join(result.source, "SKILL.md"), "utf-8")).toBe(body);
    expect(await readFile(join(sourceDir, "SKILL.md"), "utf-8")).toBe(body);
  });

  test("isolates concurrent subprocess borrows and serializes cross-process cleanup", async () => {
    const gets = await Promise.all([
      runSpawned("get", sourceDir, "--path"),
      runSpawned("get", sourceDir, "--path"),
    ]);
    expect(gets.map((r) => r.exitCode)).toEqual([0, 0]);
    const [one, two] = gets.map((r) => r.stdout.trim());
    expect(one).not.toBe(two);
    const cleanups = await Promise.all([
      runSpawned("cleanup", one, "--json"),
      runSpawned("cleanup", one, "--json"),
    ]);
    expect(cleanups.map((r) => r.exitCode)).toEqual([0, 0]);
    expect(cleanups.map((r) => JSON.parse(r.stdout).status).sort()).toEqual([
      "not-found",
      "removed",
    ]);
    expect(await readFile(join(two, "SKILL.md"), "utf-8")).toBe(body);
    expect((await run("cleanup", two)).exitCode).toBe(0);
    expect(await readFile(join(sourceDir, "SKILL.md"), "utf-8")).toBe(body);
  });

  test("reports ownership refusal through a machine error without deleting content", async () => {
    const got = await run("get", sourceDir, "--path");
    const path = got.stdout.trim();
    const marker = (await readdir(path)).find((name) =>
      name.startsWith(".asm-owner-"),
    )!;
    await rm(join(path, marker));
    const cleaned = await run("cleanup", path, "--machine");
    expect(cleaned.exitCode).toBe(1);
    expect(JSON.parse(cleaned.stdout)).toMatchObject({
      command: "cleanup",
      status: "error",
      error: { details: { path, status: "refused" } },
    });
    const preserved = (await readdir(dirname(path))).find((name) =>
      name.includes(".quarantine-"),
    )!;
    expect(
      await readFile(join(dirname(path), preserved, "SKILL.md"), "utf-8"),
    ).toBe(body);
    expect(await readFile(join(sourceDir, "SKILL.md"), "utf-8")).toBe(body);
  });

  test("keeps shell metacharacters in config paths as data, not cleanup command syntax", async () => {
    configDir = join(home, "config with $dollars `backticks` and 'quotes'");
    const got = await run("get", sourceDir, "--path");
    expect(got.exitCode, got.stderr).toBe(0);
    const path = got.stdout.trim();
    expect(path.startsWith(configDir)).toBe(true);
    expect(got.stdout).toBe(path + "\n");
    expect(got.stderr).toContain(
      "run asm cleanup with the exact path printed to stdout.",
    );
    expect(got.stderr).not.toContain(path);
    expect(await readFile(join(path, "SKILL.md"), "utf-8")).toBe(body);
    expect((await run("cleanup", path)).exitCode).toBe(0);
  });

  test("documents borrows and cleanup in command and main help", async () => {
    const get = await run("get", "--help");
    expect(get.stdout).toContain("--path");
    expect(get.stdout).toContain("survives");
    const cleanup = await run("cleanup", "--help");
    expect(cleanup.exitCode).toBe(0);
    expect(cleanup.stdout).toContain("asm cleanup <borrowed-path>");
    expect((await run("--help")).stdout).toContain("cleanup <path>");
  });

  test("validates missing/extra cleanup arguments and a missing get --path target", async () => {
    expect((await run("get", "--path")).exitCode).toBe(2);
    expect((await run("cleanup")).exitCode).toBe(2);
    const extra = await run("cleanup", sourceDir, tempDir, "--machine");
    expect(extra.exitCode).toBe(2);
    expect(JSON.parse(extra.stdout)).toMatchObject({
      status: "error",
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  test("rejects cleanup --dry-run without deleting the borrow", async () => {
    const got = await run("get", sourceDir, "--path", "--json");
    expect(got.exitCode, got.stderr).toBe(0);
    const result = JSON.parse(got.stdout);
    const refused = await run("cleanup", result.path, "--dry-run");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("does not support --dry-run");
    expect(await readFile(join(result.path, "SKILL.md"), "utf-8")).toBe(body);
    const machine = await run("cleanup", result.path, "--dry-run", "--machine");
    expect(machine.exitCode).toBe(2);
    expect(JSON.parse(machine.stdout)).toMatchObject({
      status: "error",
      error: { code: "INVALID_ARGUMENT" },
    });
    expect((await run("cleanup", result.path)).exitCode).toBe(0);
    await expect(lstat(result.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ─── Caller-owned dependency leases (issue #621) ───────────────────────────

describe("asm deps (issue #621)", () => {
  let tempDir: string;
  let sourceDir: string;
  let configDir: string;

  async function runDeps(...args: string[]) {
    return runCliInProcess(["npx", "tsx", CLI_BIN, "deps", ...args], {
      env: {
        ...process.env,
        HOME: join(tempDir, "home"),
        USERPROFILE: join(tempDir, "home"),
        ASM_CONFIG_DIR: configDir,
        NO_COLOR: "1",
      },
    });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-deps-cli-"));
    sourceDir = join(tempDir, "parent");
    configDir = join(tempDir, "config");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: parent\ndescription: Parent fixture\ndependencies:\n  - code-review\n  - github:owner/repo:skills/helper\n---\n# Parent\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("parses session lifecycle flags and enters CLI mode", () => {
    const args = parseArgs([
      "node",
      "cli",
      "deps",
      "cleanup",
      "--session",
      "run-621",
      "--stale-before",
      "2026-09-01T00:00:00Z",
    ]);
    expect(args.flags.session).toBe("run-621");
    expect(args.flags.staleBefore).toBe("2026-09-01T00:00:00Z");
    expect(isCLIMode(["node", "cli", "deps"])).toBe(true);
  });

  test("discovers optional dependencies without installing them", async () => {
    const result = await runDeps("discover", sourceDir, "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: "parent",
      source: sourceDir,
      dependencies: ["code-review", "github:owner/repo:skills/helper"],
    });
    await expect(readdir(configDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("acquires a pre-existing path and preserves it on idempotent release", async () => {
    const acquired = await runDeps(
      "acquire",
      sourceDir,
      "--session",
      "run-621",
      "--json",
    );
    expect(acquired.exitCode).toBe(0);
    const canonicalSourceDir = await realpath(sourceDir);
    expect(JSON.parse(acquired.stdout)).toMatchObject({
      sessionId: "run-621",
      path: canonicalSourceDir,
      skillMdPath: join(canonicalSourceDir, "SKILL.md"),
      owned: false,
      reused: false,
    });

    const released = await runDeps("release", "--session", "run-621", "--json");
    expect(released.exitCode).toBe(0);
    expect(JSON.parse(released.stdout).preserved).toEqual([canonicalSourceDir]);
    await expect(
      readFile(join(sourceDir, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Parent");

    const repeated = await runDeps("release", "--session", "run-621", "--json");
    expect(JSON.parse(repeated.stdout).alreadyReleased).toBe(true);
  });

  test("requires caller identity and an explicit stale cutoff", async () => {
    const acquire = await runDeps("acquire", sourceDir, "--json");
    expect(acquire.exitCode).toBe(2);
    expect(acquire.stderr).toContain("--session");

    const cleanup = await runDeps("cleanup", "--json");
    expect(cleanup.exitCode).toBe(2);
    expect(cleanup.stderr).toContain("--stale-before");

    const invalidCutoff = await runDeps(
      "cleanup",
      "--stale-before",
      "not-a-date",
      "--json",
    );
    expect(invalidCutoff.exitCode).toBe(2);
    expect(invalidCutoff.stderr).toContain("ISO-8601");
  });

  test("--help documents the caller-owned lifecycle boundary", async () => {
    const result = await runDeps("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("asm deps <subcommand>");
    expect(result.stdout).toContain("does not launch or supervise");
  });
});
