import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";
import {
  getDefaultConfig,
  resolveProviderPath,
  getConfigPath,
  loadConfig,
  saveConfig,
  saveSelectedTools,
  setConfigDirForTesting,
} from "./config";
import { setVerbose } from "./logger";
import { homedir } from "os";
import { resolve, join, dirname } from "path";
import { writeFile, readFile, rm, mkdir } from "fs/promises";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

// Redirect all config I/O to a per-worker temp directory so that concurrent
// test workers (e.g. cli.test.ts subprocesses that call loadConfig/saveConfig)
// cannot clobber selectedTools by writing fresh defaults to the same path.
setConfigDirForTesting(mkdtempSync(join(tmpdir(), "asm-config-test-")));

const HOME = homedir();

describe("getDefaultConfig", () => {
  it("returns a config with version 1", () => {
    const config = getDefaultConfig();
    expect(config.version).toBe(1);
  });

  it("returns 17 default providers", () => {
    const config = getDefaultConfig();
    expect(config.providers).toHaveLength(17);
  });

  it("includes all 17 default providers in priority order", () => {
    const config = getDefaultConfig();
    const names = config.providers.map((p) => p.name);
    expect(names).toEqual([
      "claude",
      "agents",
      "codex",
      "opencode",
      "openclaw",
      "cursor",
      "copilot",
      "windsurf",
      "antigravity",
      "gemini",
      "cline",
      "roocode",
      "continue",
      "aider",
      "zed",
      "augment",
      "amp",
    ]);
  });

  it("all 17 providers are enabled by default", () => {
    const config = getDefaultConfig();
    expect(config.providers).toHaveLength(17);
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
  it("returns a path under ~/.config/agent-skill-manager", () => {
    const path = getConfigPath();
    expect(path).toContain(".config/agent-skill-manager/config.json");
  });
});

describe("config backup on corruption", () => {
  const configPath = getConfigPath();
  const backupPath = configPath + ".bak";
  let originalContent: string | null = null;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    stderrSpy = spyOn(console, "error").mockImplementation(() => {});
    // Save original config if it exists
    try {
      originalContent = await readFile(configPath, "utf-8");
    } catch {
      originalContent = null;
    }
    // Remove backup if it exists
    try {
      await rm(backupPath);
    } catch {}
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    // Restore original config
    if (originalContent !== null) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, originalContent, "utf-8");
    } else {
      try {
        await rm(configPath);
      } catch {}
    }
    // Clean up backup
    try {
      await rm(backupPath);
    } catch {}
  });

  it("creates .bak and warns on corrupted config", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "this is not valid json!!!", "utf-8");

    const config = await loadConfig();

    // Should return defaults
    expect(config.version).toBe(1);
    expect(config.providers).toHaveLength(17);

    // Should have created backup
    const backup = await readFile(backupPath, "utf-8");
    expect(backup).toBe("this is not valid json!!!");

    // Should have warned to stderr
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("corrupted");
    expect(output).toContain(".bak");
  });

  it("silently creates defaults for missing config", async () => {
    try {
      await rm(configPath);
    } catch {}

    const config = await loadConfig();

    // Should return defaults
    expect(config.version).toBe(1);

    // Should NOT have created backup
    let backupExists = false;
    try {
      await readFile(backupPath);
      backupExists = true;
    } catch {}
    expect(backupExists).toBe(false);

    // Should NOT have warned
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).not.toContain("corrupted");
  });

  it("treats empty file as parse error and backs up", async () => {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, "", "utf-8");

    const config = await loadConfig();

    // Should return defaults
    expect(config.version).toBe(1);

    // Should have created backup of empty file
    const backup = await readFile(backupPath, "utf-8");
    expect(backup).toBe("");

    // Should have warned
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("corrupted");
  });
});

describe("config verbose output", () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setVerbose(false);
    stderrSpy.mockRestore();
  });

  it("emits debug lines when verbose is enabled", async () => {
    setVerbose(true);
    await loadConfig();
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).toContain("[verbose]");
    expect(output).toContain("config:");
  });

  it("logs 'loaded from' when config file exists", async () => {
    setVerbose(true);
    await loadConfig();
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    // Either loaded from file or using defaults — both are valid
    const hasLoaded =
      output.includes("loaded from") || output.includes("using defaults");
    expect(hasLoaded).toBe(true);
  });

  it("emits no debug lines when verbose is disabled", async () => {
    setVerbose(false);
    await loadConfig();
    const output = stderrSpy.mock.calls
      .map((c: unknown[]) => c[0] as string)
      .join("\n");
    expect(output).not.toContain("[verbose]");
  });
});

describe("selectedTools preference", () => {
  const configPath = getConfigPath();
  let originalContent: string | null = null;

  beforeAll(async () => {
    // Ensure the config file exists before any test runs. Without this,
    // concurrent test files (e.g. cli.test.ts subprocesses) can race to
    // handle the ENOENT path in loadConfig and overwrite the file with
    // defaults, clobbering the selectedTools that saveSelectedTools just wrote.
    await mkdir(dirname(configPath), { recursive: true });
    try {
      await readFile(configPath, "utf-8");
    } catch {
      await writeFile(
        configPath,
        JSON.stringify(getDefaultConfig(), null, 2) + "\n",
        "utf-8",
      );
    }
  });

  beforeEach(async () => {
    try {
      originalContent = await readFile(configPath, "utf-8");
    } catch {
      originalContent = null;
    }
  });

  afterEach(async () => {
    if (originalContent !== null) {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, originalContent, "utf-8");
    } else {
      try {
        await rm(configPath);
      } catch {}
    }
  });

  it("default config has no selectedTools", () => {
    const config = getDefaultConfig();
    expect(config.preferences.selectedTools).toBeUndefined();
  });

  it("saveSelectedTools persists tool names to config", async () => {
    await saveSelectedTools(["claude", "codex"]);
    const config = await loadConfig();
    expect(config.preferences.selectedTools).toEqual(["claude", "codex"]);
  });

  it("saveSelectedTools overwrites previous selection", async () => {
    await saveSelectedTools(["claude", "codex"]);
    await saveSelectedTools(["agents"]);
    const config = await loadConfig();
    expect(config.preferences.selectedTools).toEqual(["agents"]);
  });

  it("loadConfig preserves selectedTools from saved config", async () => {
    const config = await loadConfig();
    config.preferences.selectedTools = ["opencode", "cursor"];
    await saveConfig(config);

    const reloaded = await loadConfig();
    expect(reloaded.preferences.selectedTools).toEqual(["opencode", "cursor"]);
  });

  it("mergeWithDefaults preserves selectedTools from saved config", async () => {
    // Write a partial config with selectedTools
    await mkdir(dirname(configPath), { recursive: true });
    const partial = {
      version: 1,
      providers: [],
      preferences: {
        defaultScope: "both",
        defaultSort: "name",
        selectedTools: ["claude", "agents"],
      },
    };
    await writeFile(configPath, JSON.stringify(partial), "utf-8");

    const config = await loadConfig();
    expect(config.preferences.selectedTools).toEqual(["claude", "agents"]);
  });
});
