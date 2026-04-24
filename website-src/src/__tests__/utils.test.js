import { describe, expect, it } from "vitest";
import { skillRelPath } from "../lib/utils.js";

describe("skillRelPath (issue #241)", () => {
  it("extracts the in-repo path from a standard installUrl", () => {
    expect(skillRelPath("github:owner/repo:skills/foo")).toBe("skills/foo");
  });

  it("preserves slashes for nested plugin-bundle paths", () => {
    expect(
      skillRelPath(
        "github:sickn33/antigravity-awesome-skills:plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
      ),
    ).toBe(
      "plugins/antigravity-awesome-skills-claude/skills/00-andruia-consultant",
    );
  });

  it("returns empty string when there is no path segment", () => {
    expect(skillRelPath("github:owner/repo")).toBe("");
  });

  it("returns empty string for falsy or non-string input", () => {
    expect(skillRelPath("")).toBe("");
    expect(skillRelPath(null)).toBe("");
    expect(skillRelPath(undefined)).toBe("");
    expect(skillRelPath(123)).toBe("");
  });
});
