import { describe, expect, it } from "vitest";
import { buildManifest } from "./exporter";
import type { SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/home/user/.claude/skills/test-skill";
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
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
    effort: undefined,
    ...overrides,
  };
}

describe("buildManifest", () => {
  it("produces valid manifest schema", () => {
    const skills = [makeSkill()];
    const manifest = buildManifest(skills);
    expect(manifest.version).toBe(1);
    expect(manifest.exportedAt).toBeTruthy();
    expect(new Date(manifest.exportedAt).getTime()).not.toBeNaN();
    expect(manifest.skills).toHaveLength(1);
  });

  it("maps skill fields correctly", () => {
    const skill = makeSkill({
      name: "my-skill",
      version: "2.0.0",
      dirName: "my-skill",
      provider: "codex",
      scope: "project",
      path: "/project/.codex/skills/my-skill",
      isSymlink: false,
      symlinkTarget: null,
    });
    const manifest = buildManifest([skill]);
    const exported = manifest.skills[0];
    expect(exported.name).toBe("my-skill");
    expect(exported.version).toBe("2.0.0");
    expect(exported.dirName).toBe("my-skill");
    expect(exported.provider).toBe("codex");
    expect(exported.scope).toBe("project");
    expect(exported.path).toBe("/project/.codex/skills/my-skill");
    expect(exported.isSymlink).toBe(false);
    expect(exported.symlinkTarget).toBeNull();
  });

  it("handles empty skills array", () => {
    const manifest = buildManifest([]);
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toHaveLength(0);
  });

  it("includes symlink metadata", () => {
    const skill = makeSkill({
      isSymlink: true,
      symlinkTarget: "/Users/dev/my-skill",
    });
    const manifest = buildManifest([skill]);
    expect(manifest.skills[0].isSymlink).toBe(true);
    expect(manifest.skills[0].symlinkTarget).toBe("/Users/dev/my-skill");
  });

  it("does not include description or fileCount in exported skills", () => {
    const skill = makeSkill({
      description: "should not appear",
      fileCount: 42,
    });
    const manifest = buildManifest([skill]);
    const exported = manifest.skills[0] as any;
    expect(exported.description).toBeUndefined();
    expect(exported.fileCount).toBeUndefined();
  });
});
