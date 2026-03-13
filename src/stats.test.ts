import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { dirSize, computeStats, formatHumanSize } from "./stats";
import type { SkillInfo, AuditReport } from "./utils/types";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/tmp/test-skill";
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    dirName: "test-skill",
    path,
    originalPath: path,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: path,
    fileCount: 3,
    ...overrides,
  };
}

function emptyAuditReport(): AuditReport {
  return {
    scannedAt: new Date().toISOString(),
    totalSkills: 0,
    duplicateGroups: [],
    totalDuplicateInstances: 0,
  };
}

describe("dirSize", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stats-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sums file sizes recursively", async () => {
    await writeFile(join(tempDir, "a.txt"), "hello"); // 5 bytes
    await mkdir(join(tempDir, "sub"));
    await writeFile(join(tempDir, "sub", "b.txt"), "world!"); // 6 bytes
    const size = await dirSize(tempDir);
    expect(size).toBe(11);
  });

  it("returns 0 for non-existent directory", async () => {
    const size = await dirSize(join(tempDir, "nope"));
    expect(size).toBe(0);
  });

  it("returns 0 for empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);
    const size = await dirSize(emptyDir);
    expect(size).toBe(0);
  });
});

describe("computeStats", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "stats-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("computes stats for skills", async () => {
    const dir1 = join(tempDir, "skill1");
    const dir2 = join(tempDir, "skill2");
    await mkdir(dir1);
    await mkdir(dir2);
    await writeFile(join(dir1, "SKILL.md"), "content");
    await writeFile(join(dir2, "SKILL.md"), "content2");

    const skills = [
      makeSkill({ path: dir1, provider: "claude", scope: "global" }),
      makeSkill({ path: dir2, provider: "codex", scope: "project" }),
    ];

    const report = await computeStats(skills, emptyAuditReport());
    expect(report.totalSkills).toBe(2);
    expect(report.byProvider["claude"]).toBe(1);
    expect(report.byProvider["codex"]).toBe(1);
    expect(report.byScope.global).toBe(1);
    expect(report.byScope.project).toBe(1);
    expect(report.totalDiskBytes).toBeGreaterThan(0);
    expect(report.duplicateGroups).toBe(0);
  });

  it("handles empty skills array", async () => {
    const report = await computeStats([], emptyAuditReport());
    expect(report.totalSkills).toBe(0);
    expect(report.totalDiskBytes).toBe(0);
    expect(report.byScope.global).toBe(0);
    expect(report.byScope.project).toBe(0);
  });
});

describe("formatHumanSize", () => {
  it("formats bytes", () => {
    expect(formatHumanSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatHumanSize(1024)).toBe("1.0 KB");
    expect(formatHumanSize(1536)).toBe("1.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatHumanSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatHumanSize(14.2 * 1024 * 1024)).toBe("14.2 MB");
  });

  it("formats gigabytes", () => {
    expect(formatHumanSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});
