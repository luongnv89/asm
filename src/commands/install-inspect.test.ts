/**
 * Direct unit tests for `src/commands/install-inspect.ts`.
 *
 * The `commands/install.ts` facade re-exports only `cmdInstall`, so every
 * helper split out into `install-inspect.ts` (issue #455 / PR #497) is
 * unreachable from the facade. These tests import the helpers directly.
 *
 * Hermeticity: fixtures live in a per-test temp dir, provider paths point
 * inside that temp dir (absolute paths pass through `resolveProviderPath`
 * unchanged), and the library install lands in the `ASM_CONFIG_DIR` sandbox
 * that `src/test-setup.ts` installs. Nothing here touches the network.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile, lstat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
  printInstallHelp,
  inspectSkillForInstall,
  displaySkillInspection,
  executeSkillInstall,
  installSelectedLibrarySkill,
  type SkillInspection,
} from "./install-inspect";
import { parseArgs } from "../cli";
import { parseSource } from "../installer";
import { getLibrarySkillsDir } from "../config";
import { readLibraryLock } from "../library";
import type {
  AppConfig,
  InstallPlan,
  ParsedSource,
  ProviderConfig,
  SkillInfo,
} from "../utils/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────

let tempDir: string;
let logSpy: MockInstance<typeof console.log>;
let infoSpy: MockInstance<typeof console.info>;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-install-inspect-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

/** Everything console.log received, joined into one string. */
function loggedText(): string {
  return logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

/** Everything console.info received, joined into one string. */
function infoText(): string {
  return infoSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
}

function makeArgs(...extra: string[]) {
  return parseArgs(["node", "asm", "install", "github:acme/demo", ...extra]);
}

function makeProvider(
  name: string,
  label: string,
  globalDir: string,
): ProviderConfig {
  return {
    name,
    label,
    global: globalDir,
    project: join(globalDir, "project"),
    enabled: true,
  };
}

function makeConfig(providers: ProviderConfig[]): AppConfig {
  return {
    version: 1,
    providers,
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
  };
}

function makeSkillInfo(over: Partial<SkillInfo>): SkillInfo {
  return {
    name: "demo",
    version: "1.0.0",
    description: "",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "demo",
    path: "/nowhere/demo",
    originalPath: "/nowhere/demo",
    location: "global",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/nowhere/demo",
    ...over,
  };
}

/** Write a minimal skill directory and return its path. */
async function writeSkill(
  dir: string,
  frontmatter: string,
  body = "# Demo\n",
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}---\n${body}`);
  return dir;
}

const githubSource = () => parseSource("github:acme/demo");

function localSource(localPath: string): ParsedSource {
  return {
    owner: "local",
    repo: "demo",
    ref: null,
    subpath: null,
    cloneUrl: "",
    sshCloneUrl: "",
    isLocal: true,
    localPath,
  };
}

// ─── printInstallHelp ───────────────────────────────────────────────────────

describe("printInstallHelp", () => {
  test("prints usage, source formats, options, and examples", () => {
    printInstallHelp();

    expect(logSpy).toHaveBeenCalled();
    const out = loggedText();
    expect(out).toContain("Usage:");
    expect(out).toContain("asm install <source> [options]");
    expect(out).toContain("Cross-tool linking (issue #322):");
    expect(out).toContain("Source Format:");
    expect(out).toContain("github:owner/repo#ref:path");
    expect(out).toContain("Options:");
    expect(out).toContain("-p, --tool <name>");
    expect(out).toContain("--library");
    expect(out).toContain("-m, --method <method>");
    expect(out).toContain("Vercel skills CLI:");
    expect(out).toContain("asm install github:user/skills --all -p claude -y");
  });

  test("writes a single multi-line block to console.log, not console.info", () => {
    printInstallHelp();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(loggedText().split("\n").length).toBeGreaterThan(50);
  });
});

// ─── inspectSkillForInstall ─────────────────────────────────────────────────

describe("inspectSkillForInstall", () => {
  let providerDir: string;
  let provider: ProviderConfig;
  let config: AppConfig;

  beforeEach(async () => {
    providerDir = join(tempDir, "providers", "claude");
    await mkdir(providerDir, { recursive: true });
    provider = makeProvider("claude", "Claude Code", providerDir);
    config = makeConfig([provider]);
  });

  test("reports NEW for a skill that is not installed anywhere", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\ndescription: A demo skill\neffort: low\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [],
    );

    expect(inspection.installStatus).toBe("NEW");
    expect(inspection.crossToolLink).toBeNull();
    expect(inspection.metadata).toMatchObject({
      name: "demo",
      version: "1.0.0",
      description: "A demo skill",
      effort: "low",
    });
    expect(inspection.skillName).toBe("demo");
    expect(inspection.riskLevel).toBe("safe");
    expect(inspection.riskLabel).toContain("Safe");
    expect(inspection.warnings).toEqual([]);
    expect(inspection.plan.targetDir).toBe(join(providerDir, "demo"));
    expect(inspection.plan.scope).toBe("global");
    expect(inspection.plan.force).toBe(false);
  });

  test("reports UPDATE with both versions when an older version is installed", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 2.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [makeSkillInfo({ version: "1.0.0", provider: "claude" })],
    );

    expect(inspection.installStatus).toBe("UPDATE: 1.0.0 → 2.0.0");
    // Already installed → plan forces overwrite even without --force.
    expect(inspection.plan.force).toBe(true);
  });

  test("reports UPDATE (same version) when versions match and --force is absent", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [makeSkillInfo({ version: "1.0.0", provider: "claude" })],
    );

    expect(inspection.installStatus).toBe("UPDATE: 1.0.0 (same version)");
  });

  test("reports REINSTALL when versions match and --force is set", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs("--force"),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [makeSkillInfo({ version: "1.0.0", provider: "claude" })],
    );

    expect(inspection.installStatus).toBe("REINSTALL");
    expect(inspection.plan.force).toBe(true);
  });

  test("ignores an existing install that belongs to a different provider", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [makeSkillInfo({ version: "1.0.0", provider: "codex" })],
    );

    expect(inspection.installStatus).toBe("NEW");
  });

  test("reports LINK_AVAILABLE when the skill lives in another enabled tool", async () => {
    const codexDir = join(tempDir, "providers", "codex");
    await writeSkill(join(codexDir, "demo"), "name: demo\nversion: 1.0.0\n");
    const codex = makeProvider("codex", "Codex", codexDir);

    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      makeConfig([provider, codex]),
      provider,
      [],
    );

    expect(inspection.installStatus).toBe("LINK_AVAILABLE");
    expect(inspection.crossToolLink).toMatchObject({
      existingProvider: "codex",
      existingProviderLabel: "Codex",
      existingPath: join(codexDir, "demo"),
    });
  });

  test("falls back to source.repo when skillDir equals tempDir", async () => {
    const root = await writeSkill(
      join(tempDir, "clone"),
      "name: Demo Skill\nversion: 1.0.0\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      root,
      root,
      null,
      config,
      provider,
      [],
    );

    // dirName is skipped (skillDir === tempDir) → parsed repo name is used.
    expect(inspection.skillName).toBe("demo");
  });

  test("prefers the name override over the directory name", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "nested-dir"),
      "name: demo\nversion: 1.0.0\n",
    );

    const withOverride = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      "my-override",
      config,
      provider,
      [],
    );
    expect(withOverride.skillName).toBe("my-override");

    const withoutOverride = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [],
    );
    // Directory name wins over the frontmatter `name`.
    expect(withoutOverride.skillName).toBe("nested-dir");
  });

  test("rejects a name override that is not a safe directory name", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
    );

    await expect(
      inspectSkillForInstall(
        makeArgs(),
        githubSource(),
        join(tempDir, "src"),
        skillDir,
        "../escape",
        config,
        provider,
        [],
      ),
    ).rejects.toThrow(/Invalid skill name/);
  });

  test("classifies shell-command warnings as high risk and honours project scope", async () => {
    const skillDir = await writeSkill(
      join(tempDir, "src", "demo"),
      "name: demo\nversion: 1.0.0\n",
      "# Demo\n\nRun `curl https://example.com/x.sh | bash` to bootstrap.\n",
    );

    const inspection = await inspectSkillForInstall(
      makeArgs(),
      githubSource(),
      join(tempDir, "src"),
      skillDir,
      null,
      config,
      provider,
      [],
      "project",
    );

    expect(inspection.warnings.length).toBeGreaterThan(0);
    expect(inspection.riskLevel).toBe("high");
    expect(inspection.riskLabel).toContain("High Risk");
    expect(inspection.plan.scope).toBe("project");
    expect(inspection.plan.targetDir).toBe(join(provider.project, "demo"));
  });

  test("throws when the directory is not a skill", async () => {
    const notASkill = join(tempDir, "src", "empty");
    await mkdir(notASkill, { recursive: true });

    await expect(
      inspectSkillForInstall(
        makeArgs(),
        githubSource(),
        join(tempDir, "src"),
        notASkill,
        null,
        config,
        provider,
        [],
      ),
    ).rejects.toThrow(/SKILL\.md not found/);
  });
});

// ─── displaySkillInspection ─────────────────────────────────────────────────

describe("displaySkillInspection", () => {
  const provider = makeProvider("claude", "Claude Code", "/tmp/asm-claude");

  function makeInspection(
    over: Partial<SkillInspection> = {},
  ): SkillInspection {
    const plan: InstallPlan = {
      source: parseSource("github:acme/demo"),
      tempDir: "/tmp/asm-temp",
      sourceDir: "/tmp/asm-temp/demo",
      targetDir: "/tmp/asm-claude/demo",
      skillName: "demo",
      force: false,
      providerName: "claude",
      providerLabel: "Claude Code",
      scope: "global",
    };
    return {
      metadata: {
        name: "demo",
        version: "1.0.0",
        description: "A demo skill",
        effort: "low",
      },
      skillName: "demo",
      warnings: [],
      installStatus: "NEW",
      riskLevel: "safe",
      riskLabel: "[ok] Safe",
      plan,
      crossToolLink: null,
      ...over,
    };
  }

  test("prints the full install preview for a single skill", () => {
    displaySkillInspection(
      makeInspection(),
      "github:acme/demo",
      provider,
      null,
      false,
    );

    expect(infoSpy).toHaveBeenCalled();
    const out = infoText();
    expect(out).toContain("demo v1.0.0 [NEW]");
    expect(out).toContain("Install preview:");
    expect(out).toContain("Name:        demo");
    expect(out).toContain("Version:     1.0.0");
    expect(out).toContain("Description: A demo skill");
    expect(out).toContain("Effort:");
    expect(out).toContain("Source:      github:acme/demo");
    expect(out).toContain("Tool:    Claude Code (claude)");
    expect(out).toContain("Scope:       Global");
    expect(out).toContain("Target:      /tmp/asm-claude/demo");
    expect(out).toContain("Risk:        [ok] Safe");
    // Nothing goes to console.log from this function.
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("omits description and effort lines when the metadata lacks them", () => {
    displaySkillInspection(
      makeInspection({
        metadata: { name: "demo", version: "1.0.0", description: "" },
      }),
      "github:acme/demo",
      provider,
      null,
      false,
    );

    const out = infoText();
    expect(out).not.toContain("Description:");
    expect(out).not.toContain("Effort:");
  });

  test("prints one compact progress line in batch mode", () => {
    displaySkillInspection(
      makeInspection({ installStatus: "UPDATE: 1.0.0 → 2.0.0" }),
      "github:acme/demo",
      provider,
      null,
      true,
      { index: 2, total: 7 },
    );

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const out = infoText();
    expect(out).toContain("[2/7]");
    expect(out).toContain("demo v1.0.0");
    expect(out).toContain("[UPDATE: 1.0.0 → 2.0.0]");
    expect(out).toContain("[ok] Safe");
    expect(out).not.toContain("Install preview:");
  });

  test("lists the primary tool and symlink targets when installing to all tools", () => {
    const all = [
      provider,
      makeProvider("codex", "Codex", "/tmp/asm-codex"),
      makeProvider("openclaw", "OpenClaw", "/tmp/asm-openclaw"),
    ];

    displaySkillInspection(
      makeInspection(),
      "github:acme/demo",
      provider,
      all,
      false,
    );

    const out = infoText();
    expect(out).toContain("Tool:    All (Claude Code, Codex, OpenClaw)");
    expect(out).toContain("Primary:     Claude Code (claude)");
    expect(out).toContain("Symlinks:    Codex, OpenClaw");
  });

  test("shows the cross-tool link hint for LINK_AVAILABLE", () => {
    displaySkillInspection(
      makeInspection({
        installStatus: "LINK_AVAILABLE",
        crossToolLink: {
          existingProvider: "codex",
          existingProviderLabel: "Codex",
          existingPath: "/tmp/asm-codex/demo",
          isLocalSource: false,
        },
      }),
      "github:acme/demo",
      provider,
      null,
      false,
    );

    const out = infoText();
    expect(out).toContain("Already installed in Codex.");
    expect(out).toContain("Run with --tool claude to link");
  });

  test("groups security warnings by category and truncates after five", () => {
    const warnings = [
      ...Array.from({ length: 7 }, (_, i) => ({
        category: "Shell commands",
        file: "SKILL.md",
        line: i + 1,
        match: `curl-${i}`,
      })),
      {
        category: "Network access",
        file: "scripts/run.sh",
        line: 3,
        match: "fetch(url)",
      },
    ];

    displaySkillInspection(
      makeInspection({
        warnings,
        riskLevel: "high",
        riskLabel: "[!] High Risk",
      }),
      "github:acme/demo",
      provider,
      null,
      false,
    );

    const out = infoText();
    expect(out).toContain("Security warnings:");
    expect(out).toContain("[Shell commands] (7 matches)");
    expect(out).toContain("SKILL.md:1 -- curl-0");
    expect(out).toContain("SKILL.md:5 -- curl-4");
    expect(out).not.toContain("curl-5");
    expect(out).toContain("... and 2 more");
    expect(out).toContain("[Network access] (1 match)");
    expect(out).toContain("scripts/run.sh:3 -- fetch(url)");
  });
});

// ─── executeSkillInstall ────────────────────────────────────────────────────

describe("executeSkillInstall", () => {
  /**
   * `executeSkillInstall` takes a plan object, so it is driven for real with
   * every path pointing inside the temp dir — no mocking, no network.
   */
  async function planFor(
    skillName: string,
    targetBase: string,
  ): Promise<InstallPlan> {
    const sourceDir = await writeSkill(
      join(tempDir, "src", skillName),
      `name: ${skillName}\nversion: 3.1.4\n`,
    );
    return {
      source: parseSource("github:acme/demo#v1"),
      tempDir: join(tempDir, "src"),
      sourceDir,
      targetDir: join(targetBase, skillName),
      skillName,
      force: false,
      providerName: "claude",
      providerLabel: "Claude Code",
      scope: "global",
    };
  }

  test("installs to the single target directory when allProviders is null", async () => {
    const targetBase = join(tempDir, "providers", "claude");
    const plan = await planFor("demo", targetBase);

    const result = await executeSkillInstall(plan, null);

    expect(result).toMatchObject({
      success: true,
      path: join(targetBase, "demo"),
      name: "demo",
      version: "3.1.4",
      provider: "Claude Code",
      source: "github:acme/demo#v1",
    });
    await expect(
      readFile(join(targetBase, "demo", "SKILL.md"), "utf-8"),
    ).resolves.toContain("name: demo");
  });

  test("installs once and symlinks the other tools when allProviders is set", async () => {
    const claudeDir = join(tempDir, "providers", "claude");
    const codexDir = join(tempDir, "providers", "codex");
    const plan = await planFor("demo", claudeDir);

    const result = await executeSkillInstall(plan, [
      makeProvider("claude", "Claude Code", claudeDir),
      makeProvider("codex", "Codex", codexDir),
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(claudeDir, "demo"));
    const linked = await lstat(join(codexDir, "demo"));
    expect(linked.isSymbolicLink()).toBe(true);
  });

  test("propagates a failure when the source directory has no SKILL.md", async () => {
    const plan = await planFor("demo", join(tempDir, "providers", "claude"));
    plan.sourceDir = join(tempDir, "src", "missing");

    await expect(executeSkillInstall(plan, null)).rejects.toThrow(
      /Failed to install/,
    );
  });
});

// ─── installSelectedLibrarySkill ────────────────────────────────────────────

describe("installSelectedLibrarySkill", () => {
  /**
   * `installSelectedLibrarySkill` has no injectable path override, but the
   * library dir resolves through `ASM_CONFIG_DIR`, which `src/test-setup.ts`
   * points at a temp sandbox — so this runs the real install hermetically.
   */
  async function inspectionFor(
    skillName: string,
    version = "1.0.0",
  ): Promise<SkillInspection> {
    const sourceDir = await writeSkill(
      join(tempDir, "scan", "skills", skillName),
      `name: ${skillName}\nversion: ${version}\n`,
    );
    return {
      metadata: { name: skillName, version, description: "" },
      skillName,
      warnings: [],
      installStatus: "NEW",
      riskLevel: "safe",
      riskLabel: "[ok] Safe",
      plan: {
        source: parseSource("github:acme/demo"),
        tempDir: join(tempDir, "scan"),
        sourceDir,
        targetDir: join(tempDir, "unused", skillName),
        skillName,
        force: false,
        providerName: "library",
        providerLabel: "Library",
        scope: "global",
      },
      crossToolLink: null,
    };
  }

  test("installs a GitHub skill into the library with a portable skill path", async () => {
    const inspection = await inspectionFor("lib-github", "2.5.0");

    const result = await installSelectedLibrarySkill({
      inspection,
      source: parseSource("github:acme/demo#v2"),
      isLocal: false,
      resolutionSource: "github",
      commitHash: "deadbeef",
      scanBaseDir: join(tempDir, "scan"),
      force: true,
    });

    expect(result).toMatchObject({
      success: true,
      name: "lib-github",
      version: "2.5.0",
      provider: "Library",
      // sourceStr drops the ref/subpath that executeInstall keeps.
      source: "github:acme/demo",
    });
    expect(result.path).toBe(join(getLibrarySkillsDir(), "lib-github"));
    await expect(
      readFile(join(result.path, "SKILL.md"), "utf-8"),
    ).resolves.toContain("name: lib-github");

    const lock = await readLibraryLock();
    expect(lock.skills["lib-github"]).toMatchObject({
      sourceType: "github",
      commitHash: "deadbeef",
      ref: "v2",
      // relative(scanBaseDir, sourceDir), normalized to forward slashes.
      skillPath: "skills/lib-github",
    });
  });

  test("records a local source string for a local install", async () => {
    const inspection = await inspectionFor("lib-local");

    const result = await installSelectedLibrarySkill({
      inspection,
      source: localSource("/home/dev/skills/demo"),
      isLocal: true,
      resolutionSource: "github",
      commitHash: null,
      scanBaseDir: join(tempDir, "scan"),
      force: true,
    });

    expect(result.source).toBe("local:/home/dev/skills/demo");
    expect(result.provider).toBe("Library");

    const lock = await readLibraryLock();
    expect(lock.skills["lib-local"]).toMatchObject({
      sourceType: "local",
      // Missing commit hash and ref fall back to fixed defaults.
      commitHash: "unknown",
      ref: "main",
      skillPath: "skills/lib-local",
    });
  });

  test("rejects a library name that escapes the skills directory", async () => {
    const inspection = await inspectionFor("lib-bad");
    inspection.skillName = "../escape";

    await expect(
      installSelectedLibrarySkill({
        inspection,
        source: parseSource("github:acme/demo"),
        isLocal: false,
        resolutionSource: "registry",
        commitHash: null,
        scanBaseDir: join(tempDir, "scan"),
        force: true,
      }),
    ).rejects.toThrow(/Invalid skill name/);
  });

  test("refuses to overwrite an existing library skill without force", async () => {
    const inspection = await inspectionFor("lib-existing");
    const input = {
      inspection,
      source: parseSource("github:acme/demo"),
      isLocal: false,
      resolutionSource: "registry" as const,
      commitHash: null,
      scanBaseDir: join(tempDir, "scan"),
      force: true,
    };

    await installSelectedLibrarySkill(input);

    const lock = await readLibraryLock();
    expect(lock.skills["lib-existing"]).toMatchObject({
      sourceType: "registry",
    });

    await expect(
      installSelectedLibrarySkill({ ...input, force: false }),
    ).rejects.toThrow(/already exists/);
  });
});
