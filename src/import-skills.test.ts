import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { importSkills } from "./importer";
import type {
  ExportManifest,
  ExportedSkill,
  AppConfig,
  ProviderConfig,
  SkillInfo,
} from "./utils/types";

// ─── Shared test temp dir ────────────────────────────────────────────────────

let tempDir: string;
let globalSkillsDir: string;
let projectSkillsDir: string;
let sourceSkillsDir: string;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExportedSkill(
  overrides: Partial<ExportedSkill> = {},
): ExportedSkill {
  return {
    name: "test-skill",
    version: "1.0.0",
    dirName: "test-skill",
    provider: "claude",
    scope: "global",
    path: "/home/user/.claude/skills/test-skill",
    isSymlink: false,
    symlinkTarget: null,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<ExportManifest> = {}): ExportManifest {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    skills: [makeExportedSkill()],
    ...overrides,
  };
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "claude",
    label: "Claude",
    global: globalSkillsDir,
    project: projectSkillsDir,
    enabled: true,
    ...overrides,
  };
}

function makeSkillInfo(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path: "/tmp/source/test-skill",
    originalPath: "/tmp/source/test-skill",
    location: "/tmp/source",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/tmp/source/test-skill",
    ...overrides,
  };
}

function makeDeps(overrides?: {
  config?: Partial<AppConfig>;
  installedSkills?: SkillInfo[];
}) {
  return {
    config: {
      version: 1,
      providers: [makeProvider()],
      customPaths: [],
      preferences: { defaultScope: "global" } as any,
      ...overrides?.config,
    } as AppConfig,
    installedSkills: overrides?.installedSkills ?? [],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("importSkills", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "importer-test-"));
    globalSkillsDir = join(tempDir, "global-skills");
    projectSkillsDir = join(tempDir, "project-skills");
    sourceSkillsDir = join(tempDir, "source-skills");
    await mkdir(globalSkillsDir, { recursive: true });
    await mkdir(projectSkillsDir, { recursive: true });
    await mkdir(sourceSkillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("installs a skill when source is available", async () => {
    const srcDir = join(sourceSkillsDir, "test-skill");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "skill.md"), "# Test");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const manifest = makeManifest();
    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.installed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0].status).toBe("installed");
    const targetFiles = await readdir(join(globalSkillsDir, "test-skill"));
    expect(targetFiles).toContain("skill.md");
  });

  it("skips a skill when already installed and force is false", async () => {
    await mkdir(join(globalSkillsDir, "test-skill"), { recursive: true });

    const deps = makeDeps();
    const manifest = makeManifest();
    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.skipped).toBe(1);
    expect(summary.results[0].status).toBe("skipped");
    expect(summary.results[0].reason).toContain("Already installed");
  });

  it("overwrites when force is true and skill already exists", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "old.txt"), "old content");

    const srcDir = join(sourceSkillsDir, "test-skill");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "new.txt"), "new content");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const manifest = makeManifest();
    const summary = await importSkills(
      manifest,
      { force: true, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.installed).toBe(1);
    expect(summary.results[0].status).toBe("installed");
    const files = await readdir(join(globalSkillsDir, "test-skill"));
    expect(files).toContain("new.txt");
    expect(files).not.toContain("old.txt");
  });

  it("reports dry-run status instead of installed", async () => {
    const deps = makeDeps();
    const manifest = makeManifest();
    const summary = await importSkills(
      manifest,
      { force: false, dryRun: true, scopeFilter: "both" },
      deps,
    );

    expect(summary.results[0].status).toBe("dry-run");
    expect(summary.results[0].reason).toContain("Would install");
  });

  it("dry-run distinguishes existing vs new skills", async () => {
    await mkdir(join(globalSkillsDir, "existing-skill"), { recursive: true });

    const deps = makeDeps();
    const manifest = makeManifest({
      skills: [
        makeExportedSkill({
          name: "existing-skill",
          dirName: "existing-skill",
        }),
        makeExportedSkill({ name: "new-skill", dirName: "new-skill" }),
      ],
    });

    const summary = await importSkills(
      manifest,
      { force: true, dryRun: true, scopeFilter: "both" },
      deps,
    );

    const existing = summary.results.find(
      (r) => r.skillName === "existing-skill",
    );
    const newSkill = summary.results.find((r) => r.skillName === "new-skill");
    expect(existing?.status).toBe("dry-run");
    expect(existing?.reason).toContain("Would overwrite");
    expect(newSkill?.status).toBe("dry-run");
    expect(newSkill?.reason).toContain("Would install");
  });

  it("filters by scope when scopeFilter is set", async () => {
    const deps = makeDeps();
    const manifest = makeManifest({
      skills: [
        makeExportedSkill({
          name: "global-skill",
          dirName: "global-skill",
          scope: "global",
        }),
        makeExportedSkill({
          name: "project-skill",
          dirName: "project-skill",
          scope: "project",
        }),
      ],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: true, scopeFilter: "global" },
      deps,
    );

    expect(summary.total).toBe(1);
    expect(summary.results[0].skillName).toBe("global-skill");
  });

  it("fails when provider is not found or disabled", async () => {
    const deps = makeDeps();
    const manifest = makeManifest({
      skills: [makeExportedSkill({ provider: "nonexistent-provider" })],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.failed).toBe(1);
    expect(summary.results[0].status).toBe("failed");
    expect(summary.results[0].reason).toContain("not found or not enabled");
  });

  it("fails when no installed source is found", async () => {
    const deps = makeDeps({ installedSkills: [] });
    const manifest = makeManifest();
    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.failed).toBe(1);
    expect(summary.results[0].status).toBe("failed");
    expect(summary.results[0].reason).toContain("No installed source found");
  });

  it("neutralizes path traversal in dirName", async () => {
    const deps = makeDeps();
    const manifest = makeManifest({
      skills: [makeExportedSkill({ dirName: "../../.bashrc" })],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    // Path traversal is neutralized by basename(); the skill fails because
    // no installed source matches the sanitized dirName ".bashrc"
    expect(summary.results[0].status).toBe("failed");
  });

  it("rejects dirName that resolves to '..' ", async () => {
    const deps = makeDeps();
    const manifest = makeManifest({
      skills: [makeExportedSkill({ dirName: ".." })],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.results[0].status).toBe("failed");
    expect(summary.results[0].reason).toContain("not found or not enabled");
  });

  it("returns correct summary counts", async () => {
    const srcDir = join(sourceSkillsDir, "installable");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "skill.md"), "# Test");

    await mkdir(join(globalSkillsDir, "existing"), { recursive: true });

    const deps = makeDeps({
      installedSkills: [
        makeSkillInfo({
          name: "installable",
          dirName: "installable",
          realPath: srcDir,
        }),
      ],
    });

    const manifest = makeManifest({
      skills: [
        makeExportedSkill({ name: "existing", dirName: "existing" }),
        makeExportedSkill({ name: "installable", dirName: "installable" }),
        makeExportedSkill({
          name: "missing-provider",
          dirName: "missing-provider",
          provider: "unknown",
        }),
      ],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.total).toBe(3);
    expect(summary.skipped).toBe(1);
    expect(summary.installed).toBe(1);
    expect(summary.failed).toBe(1);
  });
});
