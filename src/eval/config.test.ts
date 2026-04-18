import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  getDefaultEvalConfig,
  loadEvalConfig,
  mergeConfig,
  getEvalConfigPath,
} from "./config";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";

// ─── getDefaultEvalConfig ───────────────────────────────────────────────────

describe("getDefaultEvalConfig", () => {
  it("returns sensible defaults with no providers configured", () => {
    const c = getDefaultEvalConfig();
    expect(c.defaults.threshold).toBe(70);
    expect(c.defaults.timeoutMs).toBe(60_000);
    expect(c.providers).toEqual({});
  });

  it("returns a fresh object each call (not a shared reference)", () => {
    const a = getDefaultEvalConfig();
    const b = getDefaultEvalConfig();
    a.defaults.threshold = 1;
    expect(b.defaults.threshold).toBe(70);
  });
});

// ─── getEvalConfigPath ──────────────────────────────────────────────────────

describe("getEvalConfigPath", () => {
  it("points to ~/.asm/config.yml", () => {
    expect(getEvalConfigPath()).toBe(join(homedir(), ".asm", "config.yml"));
  });
});

// ─── mergeConfig ────────────────────────────────────────────────────────────

describe("mergeConfig", () => {
  it("returns defaults for null / non-object input", () => {
    expect(mergeConfig(null)).toEqual(getDefaultEvalConfig());
    expect(mergeConfig(undefined)).toEqual(getDefaultEvalConfig());
    expect(mergeConfig("oops")).toEqual(getDefaultEvalConfig());
  });

  it("returns defaults when eval section is missing", () => {
    expect(mergeConfig({ other: "thing" })).toEqual(getDefaultEvalConfig());
  });

  it("overrides defaults.threshold and defaults.timeoutMs from YAML", () => {
    const c = mergeConfig({
      eval: { defaults: { threshold: 85, timeoutMs: 30_000 } },
    });
    expect(c.defaults.threshold).toBe(85);
    expect(c.defaults.timeoutMs).toBe(30_000);
  });

  it("ignores non-numeric defaults", () => {
    const c = mergeConfig({
      eval: { defaults: { threshold: "nope", timeoutMs: NaN } },
    });
    expect(c.defaults.threshold).toBe(70);
    expect(c.defaults.timeoutMs).toBe(60_000);
  });

  it("reads per-provider config", () => {
    const c = mergeConfig({
      eval: {
        providers: {
          quality: { version: "^1.0.0" },
          skillgrade: {
            version: "^1.0.0",
            preset: "smoke",
            threshold: 80,
            provider: "local",
          },
        },
      },
    });
    expect(c.providers.quality?.version).toBe("^1.0.0");
    expect(c.providers.skillgrade?.preset).toBe("smoke");
    expect(c.providers.skillgrade?.threshold).toBe(80);
    expect(c.providers.skillgrade?.provider).toBe("local");
  });

  it("preserves unknown per-provider keys for forward compatibility", () => {
    const c = mergeConfig({
      eval: {
        providers: {
          quality: { future_field: "wooo" },
        },
      },
    });
    expect((c.providers.quality as Record<string, unknown>)?.future_field).toBe(
      "wooo",
    );
  });
});

// ─── loadEvalConfig ─────────────────────────────────────────────────────────

describe("loadEvalConfig", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "asm-eval-config-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns defaults when the file is missing", async () => {
    const c = await loadEvalConfig(join(tmp, "does-not-exist.yml"));
    expect(c).toEqual(getDefaultEvalConfig());
  });

  it("returns defaults when the file is empty", async () => {
    const p = join(tmp, "empty.yml");
    await writeFile(p, "", "utf-8");
    const c = await loadEvalConfig(p);
    expect(c).toEqual(getDefaultEvalConfig());
  });

  it("parses a well-formed YAML file", async () => {
    const p = join(tmp, "good.yml");
    await writeFile(
      p,
      [
        "eval:",
        "  defaults:",
        "    threshold: 95",
        "  providers:",
        "    quality:",
        "      version: ^1.0.0",
        "    skillgrade:",
        "      preset: reliable",
      ].join("\n"),
      "utf-8",
    );
    const c = await loadEvalConfig(p);
    expect(c.defaults.threshold).toBe(95);
    expect(c.providers.quality?.version).toBe("^1.0.0");
    expect(c.providers.skillgrade?.preset).toBe("reliable");
  });

  it("throws on malformed YAML", async () => {
    const p = join(tmp, "bad.yml");
    await writeFile(p, "eval:\n  defaults:\n    threshold: [1, 2", "utf-8");
    let caught: Error | null = null;
    try {
      await loadEvalConfig(p);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
  });
});
