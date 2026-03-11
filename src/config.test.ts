import { describe, expect, it } from "bun:test";
import { getDefaultConfig, resolveProviderPath, getConfigPath } from "./config";
import { homedir } from "os";
import { resolve } from "path";

const HOME = homedir();

describe("getDefaultConfig", () => {
  it("returns a config with version 1", () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
  });

  it("returns 4 default providers", () => {
    const config = getDefaultConfig();
    expect(config.providers).toHaveLength(4);
  });

  it("includes claude, codex, openclaw, and agents providers", () => {
    const config = getDefaultConfig();
    const names = config.providers.map((p) => p.name);
    expect(names).toEqual(["claude", "codex", "openclaw", "agents"]);
  });

  it("all providers are enabled by default", () => {
    const config = getDefaultConfig();
    expect(config.providers.every((p) => p.enabled)).toBe(true);
  });

  it("has empty customPaths", () => {
    const config = getDefaultConfig();
    expect(config.customPaths).toEqual([]);
  });

  it('defaults to scope "both" and sort "name"', () => {
    const config = getDefaultConfig();
    expect(config.preferences.defaultScope).toBe("both");
    expect(config.preferences.defaultSort).toBe("name");
  });

  it("returns a fresh copy each time (not shared reference)", () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.providers[0].name = "mutated";
    expect(b.providers[0].name).toBe("claude");
  });
});

describe("resolveProviderPath", () => {
  it("resolves ~ paths to home directory", () => {
    const result = resolveProviderPath("~/.claude/skills");
    expect(result).toBe(`${HOME}/.claude/skills`);
  });

  it("preserves absolute paths", () => {
    const result = resolveProviderPath("/usr/local/skills");
    expect(result).toBe("/usr/local/skills");
  });

  it("resolves relative paths from cwd", () => {
    const result = resolveProviderPath(".claude/skills");
    expect(result).toBe(resolve(".claude/skills"));
  });

  it("handles ~/path with deeper nesting", () => {
    const result = resolveProviderPath("~/a/b/c/d");
    expect(result).toBe(`${HOME}/a/b/c/d`);
  });

  it("handles ~ alone as prefix", () => {
    const result = resolveProviderPath("~/");
    expect(result).toBe(HOME);
  });
});

describe("getConfigPath", () => {
  it("returns a path under ~/.config/skill-manager", () => {
    const path = getConfigPath();
    expect(path).toContain(".config/skill-manager/config.json");
  });
});
