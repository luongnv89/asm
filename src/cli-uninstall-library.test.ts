import { describe, test, expect, afterEach } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { getDefaultConfig } from "./config";
import type { AppConfig, LibrarySkillEntry } from "./utils/types";
import { runCliInProcess } from "./cli-test-harness";

// `asm uninstall <library-entry-name> --library` CLI integration tests
// (issue #799). Every test builds its own isolated HOME + ASM_CONFIG_DIR +
// project directory so no test can observe another's library state.

interface JsonLocation {
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  path: string;
  enabled: boolean;
  status: "checked" | "missing" | "unreadable";
  error?: string;
}

interface JsonReference {
  linkPath: string;
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  target: string;
  dangling: boolean;
}

interface UninstallJson {
  command: string;
  library: boolean;
  skill: string | null;
  name: string | null;
  status:
    | "removed"
    | "removed-stale-lock-entry"
    | "blocked"
    | "aborted"
    | "failed"
    | "not-found";
  libraryPath: string | null;
  removedDirectory: boolean;
  removedLockEntry: boolean;
  remaining: { directory: boolean; lockEntry: boolean } | null;
  references: JsonReference[];
  unreadableLocations: JsonLocation[];
  warnings: string[];
  sideEffectNotice: string;
  checkedScope: {
    providerCount: number;
    locationCount: number;
    existingCount: number;
    missingCount: number;
    unreadableCount: number;
    providers: string[];
    locations: JsonLocation[];
  } | null;
  errors: string[];
}

interface Fixture {
  root: string;
  homeDir: string;
  configDir: string;
  projectDir: string;
  librarySkillsDir: string;
  libraryPath: string;
  lockPath: string;
  dirName: string;
  name: string;
  sourceDir: string;
}

interface FixtureOptions {
  dirName?: string;
  name?: string;
  /** Omit the managed library directory (stale-lock fixture). */
  createLibraryDir?: boolean;
  /** Omit the `library-lock.json` entry (untracked-directory fixture). */
  writeLockEntry?: boolean;
  sourceType?: "github" | "registry" | "local";
  /** Create the local source directory for `local:` entries. */
  createSourceDir?: boolean;
}

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function frontmatter(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} test skill\nversion: 1.0.0\n---\n# ${name}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  // Canonicalise: on macOS `os.tmpdir()` is `/var/...` while `process.cwd()`
  // after `chdir()` reports `/private/var/...`. Matching spellings keeps the
  // scan-location assertions exact.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "asm-cli-uninstall-library-")),
  );
  tempRoots.push(root);

  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const projectDir = join(root, "project");
  const dirName = options.dirName ?? "brainstorming";
  const name = options.name ?? dirName;
  const librarySkillsDir = join(configDir, "library", "skills");
  const libraryPath = join(librarySkillsDir, dirName);
  const lockPath = join(configDir, "library", "library-lock.json");
  const sourceDir = join(root, "local-source");

  await mkdir(homeDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });

  if (options.createSourceDir) {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), frontmatter(name));
  }

  if (options.createLibraryDir !== false) {
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), frontmatter(name));
  }

  if (options.writeLockEntry !== false) {
    const sourceType = options.sourceType ?? "github";
    const entry: LibrarySkillEntry = {
      name,
      version: "1.0.0",
      source:
        sourceType === "local" ? `local:${sourceDir}` : "github:example/skills",
      sourceType,
      commitHash: "0123456789abcdef",
      ref: sourceType === "local" ? null : "main",
      skillPath: `skills/${dirName}`,
      libraryPath,
      installedAt: "2026-01-01T00:00:00.000Z",
    };
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({ version: 1, skills: { [dirName]: entry } }, null, 2)}\n`,
    );
  }

  return {
    root,
    homeDir,
    configDir,
    projectDir,
    librarySkillsDir,
    libraryPath,
    lockPath,
    dirName,
    name,
    sourceDir,
  };
}

function cliEnv(fixture: Fixture): NodeJS.ProcessEnv {
  return {
    HOME: fixture.homeDir,
    USERPROFILE: fixture.homeDir,
    ASM_CONFIG_DIR: fixture.configDir,
    NO_COLOR: "1",
  };
}

async function runAsm(fixture: Fixture, argv: string[]) {
  return runCliInProcess(argv, {
    env: cliEnv(fixture),
    cwd: fixture.projectDir,
  });
}

async function runUninstall(fixture: Fixture, args: string[]) {
  return runAsm(fixture, ["uninstall", ...args]);
}

function parsePayload(stdout: string): UninstallJson {
  const trimmed = stdout.trim();
  expect(trimmed.startsWith("{")).toBe(true);
  expect(trimmed.endsWith("}")).toBe(true);
  return JSON.parse(trimmed) as UninstallJson;
}

async function readLockSkills(
  fixture: Fixture,
): Promise<Record<string, LibrarySkillEntry>> {
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf-8")) as {
    version: number;
    skills: Record<string, LibrarySkillEntry>;
  };
  return lock.skills;
}

async function writeConfig(fixture: Fixture, config: AppConfig): Promise<void> {
  await writeFile(
    join(fixture.configDir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function linkActivation(
  linkPath: string,
  libraryPath: string,
): Promise<void> {
  await mkdir(dirname(linkPath), { recursive: true });
  await symlink(libraryPath, linkPath);
}

const NOTICE_MARKER = "Other projects are NOT checked.";

// ─── 1. JSON success ───────────────────────────────────────────────────────

describe("CLI integration: uninstall --library (issue #799)", () => {
  test("--json success is pure JSON with warnings and checked scope", async () => {
    const fixture = await makeFixture();

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.command).toBe("uninstall");
    expect(payload.library).toBe(true);
    expect(payload.skill).toBe("brainstorming");
    expect(payload.name).toBe("brainstorming");
    expect(payload.status).toBe("removed");
    expect(payload.removedDirectory).toBe(true);
    expect(payload.removedLockEntry).toBe(true);
    expect(payload.remaining).toEqual({ directory: false, lockEntry: false });
    expect(payload.libraryPath).toBe(fixture.libraryPath);
    expect(payload.errors).toEqual([]);

    // The side-effect warning is part of the machine contract, not a log line.
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings.join("\n")).toContain(NOTICE_MARKER);
    expect(payload.sideEffectNotice).toContain(NOTICE_MARKER);

    // The scope actually scanned must be reported, not just asserted in prose.
    expect(payload.checkedScope).not.toBeNull();
    const scope = payload.checkedScope!;
    expect(scope.locationCount).toBeGreaterThan(0);
    expect(scope.providerCount).toBeGreaterThan(0);
    expect(scope.providers.length).toBeGreaterThan(0);
    expect(scope.providers).toContain("claude");
    expect(scope.locations.length).toBeGreaterThan(0);

    // The notice goes to stderr so stdout stays parseable.
    expect(stderr).toContain(NOTICE_MARKER);

    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
  });

  // ─── 2. -y never skips the notice or the reference check ─────────────────

  test("-y still prints the side-effect notice and still refuses on a reference", async () => {
    const fixture = await makeFixture();
    await linkActivation(
      join(fixture.homeDir, ".claude", "skills", "brainstorming"),
      fixture.libraryPath,
    );

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--yes",
      "--json",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(NOTICE_MARKER);
    expect(stderr).toContain("Side effects:");

    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references.length).toBeGreaterThan(0);
    expect(payload.removedDirectory).toBe(false);
    expect(payload.removedLockEntry).toBe(false);

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  // ─── 3. Human mode ───────────────────────────────────────────────────────

  test("human mode reports success on stdout and diagnostics on stderr", async () => {
    const fixture = await makeFixture();

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed library skill");
    expect(stdout).toContain("brainstorming");

    expect(stderr).toContain(NOTICE_MARKER);
    expect(stderr).toContain("Checked scope:");
    expect(stderr).toContain("No activation references found");

    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
  });

  // ─── 4. Blocking activation references ───────────────────────────────────

  test("blocks on a global activation link", async () => {
    const fixture = await makeFixture();
    const linkPath = join(
      fixture.homeDir,
      ".claude",
      "skills",
      "brainstorming",
    );
    await linkActivation(linkPath, fixture.libraryPath);

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0]).toMatchObject({
      linkPath,
      provider: "claude",
      scope: "global",
    });

    // Blocked output includes a ready-to-run deactivation command.
    expect(stderr).toContain(
      "asm deactivate brainstorming -p claude -s global",
    );
    expect(stderr).toContain("# remove this activation link");

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  test("blocks on a link into the entry directory (not just the entry itself)", async () => {
    const fixture = await makeFixture();
    const linkPath = join(
      fixture.homeDir,
      ".claude",
      "skills",
      "inner-file-link",
    );
    await linkActivation(linkPath, join(fixture.libraryPath, "SKILL.md"));

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0].linkPath).toBe(linkPath);
    expect(payload.references[0].target).toBe(
      join(fixture.libraryPath, "SKILL.md"),
    );

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  test("blocks on a current-project activation link", async () => {
    const fixture = await makeFixture();
    const linkPath = join(
      fixture.projectDir,
      ".claude",
      "skills",
      "brainstorming",
    );
    await linkActivation(linkPath, fixture.libraryPath);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0]).toMatchObject({
      linkPath,
      provider: "claude",
      scope: "project",
    });

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  test("blocks on a renamed activation link (matched by target, not name)", async () => {
    const fixture = await makeFixture();
    const linkPath = join(
      fixture.homeDir,
      ".agents",
      "skills",
      "renamed-activation-link",
    );
    await linkActivation(linkPath, fixture.libraryPath);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0]).toMatchObject({
      linkPath,
      provider: "agents",
      scope: "global",
    });
    expect(
      payload.references[0].linkPath.endsWith("renamed-activation-link"),
    ).toBe(true);
    expect(payload.references[0].target).toBe(fixture.libraryPath);
    expect(payload.references[0].linkPath.endsWith(fixture.dirName)).toBe(
      false,
    );

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  test("blocks on a disabled provider's activation location", async () => {
    const fixture = await makeFixture();
    const config = getDefaultConfig();
    config.providers = config.providers.map((provider) =>
      provider.name === "gemini" ? { ...provider, enabled: false } : provider,
    );
    await writeConfig(fixture, config);

    const linkPath = join(
      fixture.homeDir,
      ".gemini",
      "skills",
      "gemini-activation",
    );
    await linkActivation(linkPath, fixture.libraryPath);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0]).toMatchObject({
      linkPath,
      provider: "gemini",
      scope: "global",
    });

    const geminiLocation = payload.checkedScope!.locations.find(
      (location) =>
        location.provider === "gemini" && location.scope === "global",
    );
    expect(geminiLocation).toBeDefined();
    expect(geminiLocation!.enabled).toBe(false);
    expect(geminiLocation!.status).toBe("checked");

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  // ─── 5. Independent same-name provider copy ──────────────────────────────

  test("a real same-name provider directory does not block and survives removal", async () => {
    const fixture = await makeFixture();
    const providerCopy = join(
      fixture.homeDir,
      ".claude",
      "skills",
      "brainstorming",
    );
    await mkdir(providerCopy, { recursive: true });
    await writeFile(
      join(providerCopy, "SKILL.md"),
      frontmatter("provider-owned-copy"),
    );

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("removed");
    expect(payload.removedDirectory).toBe(true);
    expect(payload.references).toEqual([]);

    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
    expect(await exists(providerCopy)).toBe(true);
    expect(await readFile(join(providerCopy, "SKILL.md"), "utf-8")).toContain(
      "provider-owned-copy",
    );
  });

  // ─── 6. Stale lock entry ─────────────────────────────────────────────────

  test("removes a stale lock entry when the library directory is gone", async () => {
    const fixture = await makeFixture({ createLibraryDir: false });

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("removed-stale-lock-entry");
    expect(payload.removedDirectory).toBe(false);
    expect(payload.removedLockEntry).toBe(true);
    expect(payload.remaining).toEqual({ directory: false, lockEntry: false });
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
  });

  // ─── 7. Directory without a lock entry ───────────────────────────────────

  test("refuses to delete a library directory with no lock entry", async () => {
    const fixture = await makeFixture({ writeLockEntry: false });

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("not-found");
    expect(payload.errors.join("\n")).toContain("not found");
    expect(stderr).toContain("not found");

    // A directory the lock does not know about is never guessed at or deleted.
    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await exists(fixture.lockPath)).toBe(false);
  });

  // ─── 8. Incompatible flags ───────────────────────────────────────────────

  const flagConflictCases: Array<[string, string[], RegExp]> = [
    ["-p provider filter", ["-p", "claude"], /cannot be combined with --tool/],
    [
      "--scope global",
      ["--scope", "global"],
      /cannot be combined with --scope/,
    ],
    ["-s project", ["-s", "project"], /cannot be combined with --scope/],
    // The shared parser defaults scope to "both", so an explicit `both` must
    // still be detected as an explicit --scope (scopeExplicit plumbing).
    ["--scope both", ["--scope", "both"], /cannot be combined with --scope/],
    ["--all", ["--all"], /cannot be combined with --all/],
    ["--force", ["--force"], /cannot be combined with --force/],
    ["--machine", ["--machine"], /--machine is not supported with --library/],
  ];

  test.each(flagConflictCases)(
    "rejects %s with exit 2",
    async (_label, flags, message) => {
      const fixture = await makeFixture();

      const { stderr, exitCode } = await runUninstall(fixture, [
        "brainstorming",
        "--library",
        ...flags,
      ]);

      expect(exitCode).toBe(2);
      expect(stderr).toMatch(message);
      expect(await exists(fixture.libraryPath)).toBe(true);
      expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
    },
  );

  // ─── 9. Missing / extra positional arguments ─────────────────────────────

  test("missing library-entry-name exits 2", async () => {
    const fixture = await makeFixture();

    const { stderr, exitCode } = await runUninstall(fixture, ["--library"]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
    expect(stderr).toContain("--library");
    expect(await exists(fixture.libraryPath)).toBe(true);
  });

  test("two positional names with --library exits 2", async () => {
    const fixture = await makeFixture();

    const { stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "another-skill",
      "--library",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("Only one library entry can be removed");
    expect(stderr).toContain("another-skill");
    expect(await exists(fixture.libraryPath)).toBe(true);
  });

  // ─── 10. Non-interactive confirmation ────────────────────────────────────

  test("without -y and without a TTY exits 2 and removes nothing", async () => {
    const fixture = await makeFixture();

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
    ]);

    expect(exitCode).toBe(2);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("failed");
    expect(payload.errors.join("\n")).toContain("non-interactive");
    expect(stderr).toContain("non-interactive");

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  // ─── 11. No fall-through to provider uninstall ───────────────────────────

  test("does not fall through: an ordinary provider install stays untouched", async () => {
    const fixture = await makeFixture();
    // `asm install <dir>` keys the destination on the source basename, so the
    // source directory must share the library entry name.
    const installSource = join(fixture.root, "brainstorming");
    await mkdir(installSource, { recursive: true });
    await writeFile(
      join(installSource, "SKILL.md"),
      frontmatter("brainstorming"),
    );

    const install = await runAsm(fixture, [
      "install",
      installSource,
      "--yes",
      "--force",
      "--tool",
      "claude",
    ]);
    expect(install.exitCode).toBe(0);

    const providerPath = join(
      fixture.homeDir,
      ".claude",
      "skills",
      "brainstorming",
    );
    expect(await exists(providerPath)).toBe(true);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("removed");
    expect(payload.references).toEqual([]);

    // The library original is gone; the independently installed provider copy
    // is untouched (no provider-scanner fall-through, no provider deletion).
    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
    expect(await exists(providerPath)).toBe(true);
    expect(await readFile(join(providerPath, "SKILL.md"), "utf-8")).toContain(
      "# brainstorming",
    );
  });

  // ─── 12. local: source is never touched ──────────────────────────────────

  test("keeps the local: source directory outside the library", async () => {
    const fixture = await makeFixture({
      sourceType: "local",
      createSourceDir: true,
    });
    const sourceSkill = join(fixture.sourceDir, "SKILL.md");
    expect(await exists(sourceSkill)).toBe(true);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("removed");

    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty("brainstorming");
    // The recorded local source is the user's own directory: keep it.
    expect(await exists(fixture.sourceDir)).toBe(true);
    expect(await readFile(sourceSkill, "utf-8")).toContain("# brainstorming");
  });

  // ─── 13. Unreadable scope location ───────────────────────────────────────

  test("an unreadable scope location blocks removal (nothing removed)", async () => {
    const isRoot =
      typeof process.geteuid === "function" && process.geteuid() === 0;
    const fixture = await makeFixture();
    const unreadableDir = join(fixture.projectDir, ".agents", "skills");
    await mkdir(unreadableDir, { recursive: true });

    if (!isRoot) await chmod(unreadableDir, 0o000);
    try {
      if (isRoot) return; // chmod cannot deny root; the assertion is moot.

      const { stdout, exitCode } = await runUninstall(fixture, [
        "brainstorming",
        "--library",
        "--json",
        "--yes",
      ]);

      expect(exitCode).toBe(1);
      const payload = parsePayload(stdout);
      expect(payload.status).toBe("blocked");
      expect(payload.unreadableLocations.length).toBeGreaterThan(0);
      expect(payload.unreadableLocations[0]).toMatchObject({
        provider: "agents",
        scope: "project",
        path: unreadableDir,
        status: "unreadable",
      });
      expect(payload.checkedScope!.unreadableCount).toBeGreaterThan(0);

      expect(await exists(fixture.libraryPath)).toBe(true);
      expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
    } finally {
      if (!isRoot) await chmod(unreadableDir, 0o755);
    }
  });

  // ─── 14. Fuzzy / partial entry names are not resolved ────────────────────

  test("a fuzzy partial name is not resolved and removes nothing", async () => {
    const fixture = await makeFixture();

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brain",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("not-found");
    expect(payload.errors.join("\n")).toContain('"brain" not found');
    expect(stderr).toContain("not found");

    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  // ─── 15. Exact frontmatter-name fallback (directory key differs) ─────────

  test("resolves a unique exact frontmatter name when the directory key differs", async () => {
    const fixture = await makeFixture({
      dirName: "brainstorming-dir",
      name: "brainstorming",
    });

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(0);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("removed");
    // The payload reports the authoritative lock key, not the typed name.
    expect(payload.skill).toBe("brainstorming-dir");
    expect(payload.name).toBe("brainstorming");
    expect(await exists(fixture.libraryPath)).toBe(false);
    expect(await readLockSkills(fixture)).not.toHaveProperty(
      "brainstorming-dir",
    );
  });

  // ─── 16. A dangling in-scope link also blocks ────────────────────────────

  test("blocks on a dangling activation link that points at the entry", async () => {
    // Stale lock entry: the library directory is already gone, but a link in
    // the checked scope still points at it.
    const fixture = await makeFixture({ createLibraryDir: false });
    const linkPath = join(
      fixture.homeDir,
      ".claude",
      "skills",
      "brainstorming",
    );
    await linkActivation(linkPath, fixture.libraryPath);

    const { stdout, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("blocked");
    expect(payload.references).toHaveLength(1);
    expect(payload.references[0]).toMatchObject({
      linkPath,
      provider: "claude",
      scope: "global",
      dangling: true,
    });
    // The stale lock entry survives because the dangling link still blocks it.
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });

  // ─── 17. Failure paths still honour the --json contract ──────────────────

  test("an unreadable lock file yields structured JSON, not a fatal error", async () => {
    const fixture = await makeFixture({ writeLockEntry: false });
    // A directory where the lock file belongs makes every lock read fail.
    await mkdir(fixture.lockPath, { recursive: true });

    const { stdout, stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "--json",
      "--yes",
    ]);

    expect(exitCode).toBe(1);
    const payload = parsePayload(stdout);
    expect(payload.status).toBe("failed");
    expect(payload.errors.join("\n")).toContain(
      "Could not read the library lock",
    );
    expect(stderr).toContain("Could not read the library lock");
    expect(stderr).not.toContain("Fatal error");
    expect(await exists(fixture.libraryPath)).toBe(true);
  });

  test("a lock-write failure reports the remaining state and exits 1", async () => {
    const isRoot =
      typeof process.geteuid === "function" && process.geteuid() === 0;
    if (isRoot) return; // chmod cannot deny root; the assertion is moot.

    const fixture = await makeFixture();
    const libraryDir = dirname(fixture.lockPath);
    // Readable + executable but not writable: the directory is removable (its
    // parent skills/ is writable) while the atomic lock write must fail.
    await chmod(libraryDir, 0o500);
    try {
      const { stdout, stderr, exitCode } = await runUninstall(fixture, [
        "brainstorming",
        "--library",
        "--json",
        "--yes",
      ]);

      expect(exitCode).toBe(1);
      const payload = parsePayload(stdout);
      expect(payload.status).toBe("failed");
      expect(payload.removedDirectory).toBe(true);
      expect(payload.removedLockEntry).toBe(false);
      expect(payload.remaining).toEqual({
        directory: false,
        lockEntry: true,
      });
      expect(stderr).toContain("Remaining state");
      // Directory first, lock second: the directory really is gone.
      expect(await exists(fixture.libraryPath)).toBe(false);
    } finally {
      await chmod(libraryDir, 0o755);
    }
  });

  // ─── 18. A trailing -p with no value is still rejected ───────────────────

  test("rejects --tool even when it is last and takes no value", async () => {
    const fixture = await makeFixture();

    const { stderr, exitCode } = await runUninstall(fixture, [
      "brainstorming",
      "--library",
      "-p",
    ]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain("cannot be combined with --tool");
    expect(await exists(fixture.libraryPath)).toBe(true);
    expect(await readLockSkills(fixture)).toHaveProperty("brainstorming");
  });
});
