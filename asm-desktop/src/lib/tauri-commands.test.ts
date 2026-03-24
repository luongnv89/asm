import { describe, it, expect, vi } from "vitest";
import {
  parseSkillsFromJson,
  installSkill,
  uninstallSkill,
  searchSkills,
  listInstalledSkills,
  getSkillIndex,
} from "./tauri-commands";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockedInvoke = invoke as ReturnType<typeof vi.fn>;

describe("parseSkillsFromJson", () => {
  it("parses a JSON array of skills", () => {
    const json = JSON.stringify([
      { name: "skill1", description: "A test skill" },
      { name: "skill2", description: "Another test skill" },
    ]);
    const result = parseSkillsFromJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("skill1");
  });

  it("parses skills from object with skills array", () => {
    const json = JSON.stringify({
      skills: [
        { name: "skill1", description: "A test skill" },
        { name: "skill2" },
      ],
    });
    const result = parseSkillsFromJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("skill1");
  });

  it("returns empty array for invalid JSON", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = parseSkillsFromJson("not valid json");
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("returns empty array for unexpected format", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = parseSkillsFromJson(JSON.stringify({ foo: "bar" }));
    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("installSkill", () => {
  it("successfully installs a skill", async () => {
    mockedInvoke.mockResolvedValue({
      success: true,
      stdout: "Skill installed",
      stderr: "",
      code: 0,
    });
    const result = await installSkill("test-skill");
    expect(result.success).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("install_skill", {
      name: "test-skill",
    });
  });

  it("handles installation failure", async () => {
    mockedInvoke.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Skill not found",
      code: 1,
    });
    const result = await installSkill("nonexistent-skill");
    expect(result.success).toBe(false);
    expect(result.stderr).toBe("Skill not found");
  });

  it("handles invocation error", async () => {
    mockedInvoke.mockRejectedValue(new Error("IPC error"));
    await expect(installSkill("test-skill")).rejects.toThrow("IPC error");
  });
});

describe("uninstallSkill", () => {
  it("successfully uninstalls a skill", async () => {
    mockedInvoke.mockResolvedValue({
      success: true,
      stdout: "Skill uninstalled",
      stderr: "",
      code: 0,
    });
    const result = await uninstallSkill("test-skill");
    expect(result.success).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("uninstall_skill", {
      name: "test-skill",
    });
  });

  it("handles uninstallation failure", async () => {
    mockedInvoke.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Not installed",
      code: 1,
    });
    const result = await uninstallSkill("test-skill");
    expect(result.success).toBe(false);
  });
});

describe("searchSkills", () => {
  it("returns search results", async () => {
    mockedInvoke.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "search-result", description: "Found" }]),
      stderr: "",
      code: 0,
    });
    const result = await searchSkills("test query");
    expect(result.success).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("search_skills", {
      query: "test query",
    });
  });
});

describe("listInstalledSkills", () => {
  it("returns list of installed skills", async () => {
    mockedInvoke.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "installed-skill" }]),
      stderr: "",
      code: 0,
    });
    const result = await listInstalledSkills();
    expect(result.success).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("list_installed_skills");
  });
});

describe("getSkillIndex", () => {
  it("returns skill index", async () => {
    mockedInvoke.mockResolvedValue({
      success: true,
      stdout: JSON.stringify({ skills: [{ name: "indexed-skill" }] }),
      stderr: "",
      code: 0,
    });
    const result = await getSkillIndex();
    expect(result.success).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith("get_skill_index");
  });

  it("handles index fetch failure", async () => {
    mockedInvoke.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Network error",
      code: 1,
    });
    const result = await getSkillIndex();
    expect(result).toBeDefined();
  });
});
