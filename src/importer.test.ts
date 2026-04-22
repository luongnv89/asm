import { describe, expect, it } from "vitest";
import { validateManifest } from "./importer";
import type { ExportManifest, ExportedSkill } from "./utils/types";

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

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    const result = validateManifest(makeManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    const result = validateManifest("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a JSON object");
  });

  it("rejects null input", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a JSON object");
  });

  it("rejects array input", () => {
    const result = validateManifest([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a JSON object");
  });

  it("rejects unsupported version", () => {
    const result = validateManifest({ ...makeManifest(), version: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unsupported manifest version");
  });

  it("rejects missing exportedAt", () => {
    const manifest = makeManifest();
    const data = { ...manifest, exportedAt: undefined };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exportedAt"))).toBe(true);
  });

  it("rejects missing skills array", () => {
    const data = { version: 1, exportedAt: "2025-01-01T00:00:00Z" };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("skills"))).toBe(true);
  });

  it("rejects skill with missing name", () => {
    const manifest = makeManifest({
      skills: [makeExportedSkill({ name: "" })],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects skill with missing provider", () => {
    const manifest = makeManifest({
      skills: [makeExportedSkill({ provider: "" })],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("provider"))).toBe(true);
  });

  it("rejects skill with invalid scope", () => {
    const manifest = makeManifest({
      skills: [makeExportedSkill({ scope: "invalid" as any })],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("scope"))).toBe(true);
  });

  it("accepts manifest with empty skills array", () => {
    const result = validateManifest(makeManifest({ skills: [] }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts manifest with multiple valid skills", () => {
    const manifest = makeManifest({
      skills: [
        makeExportedSkill({ name: "skill-a", dirName: "skill-a" }),
        makeExportedSkill({
          name: "skill-b",
          dirName: "skill-b",
          provider: "codex",
          scope: "project",
        }),
      ],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("collects multiple errors at once", () => {
    const data = {
      version: 99,
      skills: [{ name: "", provider: "" }],
    };
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("accepts symlink metadata in skills", () => {
    const manifest = makeManifest({
      skills: [
        makeExportedSkill({
          isSymlink: true,
          symlinkTarget: "/Users/dev/my-skill",
        }),
      ],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  it("rejects skill with missing dirName", () => {
    const manifest = makeManifest({
      skills: [makeExportedSkill({ dirName: "" })],
    });
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("dirName"))).toBe(true);
  });

  it("rejects skill with undefined dirName", () => {
    const data = makeManifest({
      skills: [{ ...makeExportedSkill(), dirName: undefined } as any],
    });
    const result = validateManifest(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("dirName"))).toBe(true);
  });
});
