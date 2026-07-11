import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  readdir,
  readlink,
  readFile,
  lstat,
  utimes,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  importSkills,
  skillDirsIdentical,
  buildImportConflict,
  renderConflictDiff,
} from "./importer";
import { createDirSymlink } from "./utils/fs";
import type {
  ExportManifest,
  ExportedSkill,
  AppConfig,
  ProviderConfig,
  SkillInfo,
  ImportConflict,
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

  it("recreates symlink when importing a symlinked skill", async () => {
    // Create the real skill directory that the symlink will point to
    const realSkillDir = join(sourceSkillsDir, "real-skill");
    await mkdir(realSkillDir, { recursive: true });
    await writeFile(join(realSkillDir, "skill.md"), "# Symlinked Skill");

    const deps = makeDeps({
      installedSkills: [
        makeSkillInfo({
          name: "linked-skill",
          dirName: "linked-skill",
          realPath: realSkillDir,
          isSymlink: true,
          symlinkTarget: realSkillDir,
        }),
      ],
    });

    const manifest = makeManifest({
      skills: [
        makeExportedSkill({
          name: "linked-skill",
          dirName: "linked-skill",
          isSymlink: true,
          symlinkTarget: realSkillDir,
        }),
      ],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.installed).toBe(1);
    expect(summary.results[0].status).toBe("installed");

    // Verify it was created as a symlink pointing to the correct target
    const targetPath = join(globalSkillsDir, "linked-skill");
    const stat = await lstat(targetPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const linkTarget = await readlink(targetPath);
    expect(linkTarget).toBe(realSkillDir);
  });

  it("falls back to copy when symlink target is unreachable", async () => {
    const srcDir = join(sourceSkillsDir, "linked-skill");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "skill.md"), "# Fallback");

    const deps = makeDeps({
      installedSkills: [
        makeSkillInfo({
          name: "linked-skill",
          dirName: "linked-skill",
          realPath: srcDir,
          isSymlink: true,
          symlinkTarget: "/nonexistent/path/that/does/not/exist",
        }),
      ],
    });

    const manifest = makeManifest({
      skills: [
        makeExportedSkill({
          name: "linked-skill",
          dirName: "linked-skill",
          isSymlink: true,
          symlinkTarget: "/nonexistent/path/that/does/not/exist",
        }),
      ],
    });

    const summary = await importSkills(
      manifest,
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.installed).toBe(1);
    expect(summary.results[0].status).toBe("installed");

    // Verify it was created as a regular directory (not a symlink)
    const targetPath = join(globalSkillsDir, "linked-skill");
    const stat = await lstat(targetPath);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.isDirectory()).toBe(true);
    const files = await readdir(targetPath);
    expect(files).toContain("skill.md");
  });
});

// ─── Conflict detection & safe overwrite ────────────────────────

describe("importSkills conflicts", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "importer-conflict-"));
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

  async function makeSkillDir(dir: string, content: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), content);
  }

  const HOUR = 60 * 60 * 1000;

  it("does not delete the skill when the manifest source is the target itself (self-import regression)", async () => {
    // `asm export` then `asm import --force` on the same machine resolves the
    // copy source to the install being overwritten. The old remove-then-copy
    // deleted the only copy and then failed with ENOENT.
    const targetDir = join(globalSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Precious content");

    const deps = makeDeps({
      installedSkills: [
        makeSkillInfo({
          realPath: targetDir,
          path: targetDir,
          originalPath: targetDir,
        }),
      ],
    });

    const summary = await importSkills(
      makeManifest(),
      { force: true, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.failed).toBe(0);
    expect(summary.results[0].status).toBe("skipped");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Precious content",
    );
  });

  it("skips without a conflict when existing content is identical", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Same");
    await makeSkillDir(srcDir, "# Same");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.conflicts).toBe(0);
    expect(summary.results[0].status).toBe("skipped");
    expect(summary.results[0].reason).toContain("Already installed");
    expect(summary.results[0].conflict).toBeUndefined();
  });

  it("reports a conflict with the newer side when contents differ (local newer)", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local edit");
    await makeSkillDir(srcDir, "# Imported edit");
    const now = new Date();
    const earlier = new Date(now.getTime() - HOUR);
    await utimes(join(targetDir, "SKILL.md"), now, now);
    await utimes(join(srcDir, "SKILL.md"), earlier, earlier);

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.conflicts).toBe(1);
    const result = summary.results[0];
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("Conflict");
    expect(result.reason).toContain("local version is newer");
    expect(result.conflict?.newer).toBe("local");
    // Local content untouched
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Local edit",
    );
  });

  it("reports the imported side as newer when the source was modified later", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local");
    await makeSkillDir(srcDir, "# Imported");
    const now = new Date();
    const earlier = new Date(now.getTime() - HOUR);
    await utimes(join(targetDir, "SKILL.md"), earlier, earlier);
    await utimes(join(srcDir, "SKILL.md"), now, now);

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      { force: false, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.results[0].reason).toContain("imported version is newer");
    expect(summary.results[0].conflict?.newer).toBe("imported");
  });

  it("resolves a conflict with use-imported via the onConflict callback", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local");
    await makeSkillDir(srcDir, "# Imported");

    const seen: ImportConflict[] = [];
    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      {
        force: false,
        dryRun: false,
        scopeFilter: "both",
        onConflict: async (c) => {
          seen.push(c);
          return "use-imported";
        },
      },
      deps,
    );

    expect(seen).toHaveLength(1);
    expect(summary.installed).toBe(1);
    expect(summary.conflicts).toBe(1);
    expect(summary.results[0].status).toBe("installed");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Imported",
    );
  });

  it("keeps the local version when the callback answers keep-local", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local");
    await makeSkillDir(srcDir, "# Imported");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      {
        force: false,
        dryRun: false,
        scopeFilter: "both",
        onConflict: async () => "keep-local",
      },
      deps,
    );

    expect(summary.results[0].status).toBe("skipped");
    expect(summary.results[0].reason).toContain("kept local");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Local",
    );
  });

  it("skips the skill when the callback answers skip", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local");
    await makeSkillDir(srcDir, "# Imported");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      {
        force: false,
        dryRun: false,
        scopeFilter: "both",
        onConflict: async () => "skip",
      },
      deps,
    );

    expect(summary.results[0].status).toBe("skipped");
    expect(summary.results[0].reason).toContain("Conflict: skipped");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Local",
    );
  });

  it("force still overwrites a differing skill (existing escape hatch)", async () => {
    const targetDir = join(globalSkillsDir, "test-skill");
    const srcDir = join(sourceSkillsDir, "test-skill");
    await makeSkillDir(targetDir, "# Local");
    await makeSkillDir(srcDir, "# Imported");

    const deps = makeDeps({
      installedSkills: [makeSkillInfo({ realPath: srcDir })],
    });

    const summary = await importSkills(
      makeManifest(),
      { force: true, dryRun: false, scopeFilter: "both" },
      deps,
    );

    expect(summary.installed).toBe(1);
    await expect(readFile(join(targetDir, "SKILL.md"), "utf-8")).resolves.toBe(
      "# Imported",
    );
  });
});

describe("skillDirsIdentical", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dirs-identical-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns true for identical trees including nested directories", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(join(a, "nested"), { recursive: true });
    await mkdir(join(b, "nested"), { recursive: true });
    await writeFile(join(a, "SKILL.md"), "# Same");
    await writeFile(join(b, "SKILL.md"), "# Same");
    await writeFile(join(a, "nested", "ref.md"), "ref");
    await writeFile(join(b, "nested", "ref.md"), "ref");

    await expect(skillDirsIdentical(a, b)).resolves.toBe(true);
  });

  it("terminates when identical trees contain self-referential symlinks", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "SKILL.md"), "# Same");
    await writeFile(join(b, "SKILL.md"), "# Same");
    await createDirSymlink(".", join(a, "self"));
    await createDirSymlink(".", join(b, "self"));

    await expect(skillDirsIdentical(a, b)).resolves.toBe(true);
  });

  it("compares each non-cyclic symlink path when targets are shared", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(join(a, "target"), { recursive: true });
    await mkdir(join(b, "target"), { recursive: true });
    await writeFile(join(a, "target", "ref.md"), "ref");
    await writeFile(join(b, "target", "ref.md"), "ref");
    await createDirSymlink("target", join(a, "first"));
    await createDirSymlink("target", join(a, "second"));
    await createDirSymlink("target", join(b, "first"));

    await expect(skillDirsIdentical(a, b)).resolves.toBe(false);
  });

  it("returns false when file contents differ", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "SKILL.md"), "# One");
    await writeFile(join(b, "SKILL.md"), "# Two");

    await expect(skillDirsIdentical(a, b)).resolves.toBe(false);
  });

  it("returns false when one tree has an extra file", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "SKILL.md"), "# Same");
    await writeFile(join(b, "SKILL.md"), "# Same");
    await writeFile(join(b, "extra.txt"), "surplus");

    await expect(skillDirsIdentical(a, b)).resolves.toBe(false);
  });

  it("ignores .git directories", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await mkdir(join(a, ".git"), { recursive: true });
    await mkdir(b, { recursive: true });
    await writeFile(join(a, "SKILL.md"), "# Same");
    await writeFile(join(b, "SKILL.md"), "# Same");
    await writeFile(join(a, ".git", "HEAD"), "ref: refs/heads/main");

    await expect(skillDirsIdentical(a, b)).resolves.toBe(true);
  });
});

describe("buildImportConflict / renderConflictDiff", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "conflict-diff-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports same-age trees as 'same' within the mtime epsilon", async () => {
    const local = join(tempDir, "local");
    const imported = join(tempDir, "imported");
    await mkdir(local, { recursive: true });
    await mkdir(imported, { recursive: true });
    await writeFile(join(local, "SKILL.md"), "# A");
    await writeFile(join(imported, "SKILL.md"), "# B");
    const when = new Date();
    await utimes(join(local, "SKILL.md"), when, when);
    await utimes(join(imported, "SKILL.md"), when, when);

    const conflict = await buildImportConflict(
      makeExportedSkill(),
      imported,
      local,
    );
    expect(conflict.newer).toBe("same");
  });

  it("renders per-file unified diffs and added/removed notes", async () => {
    const local = join(tempDir, "local");
    const imported = join(tempDir, "imported");
    await mkdir(local, { recursive: true });
    await mkdir(imported, { recursive: true });
    await writeFile(join(local, "SKILL.md"), "shared\nlocal line\n");
    await writeFile(join(imported, "SKILL.md"), "shared\nimported line\n");
    await writeFile(join(local, "only-local.md"), "x");
    await writeFile(join(imported, "only-imported.md"), "y");

    const conflict: ImportConflict = {
      skillName: "test-skill",
      provider: "claude",
      scope: "global",
      targetDir: local,
      sourcePath: imported,
      localModified: new Date().toISOString(),
      importedModified: new Date().toISOString(),
      newer: "same",
    };

    const diff = await renderConflictDiff(conflict);
    expect(diff).toContain("-local line");
    expect(diff).toContain("+imported line");
    expect(diff).toContain("only in local: only-local.md");
    expect(diff).toContain("only in imported: only-imported.md");
  });
});
