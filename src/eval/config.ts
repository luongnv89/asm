/**
 * Config reader for the `asm eval` framework.
 *
 * Reads the `eval` section from `~/.asm/config.yml` and returns a typed
 * `EvalConfig` populated with defaults. This is a separate file from the
 * main app config (`~/.config/agent-skill-manager/config.json`) because
 * it tracks the Skillgrade integration plan's YAML-first layout — they
 * may unify later, but this PR is about scaffolding only.
 *
 * The file is optional. A missing file, empty file, or missing `eval`
 * section all return the same defaults. Malformed YAML is surfaced via
 * a thrown error so users see the problem instead of silently running
 * with defaults they didn't intend.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { parse as parseYaml } from "yaml";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Per-provider knobs read from the YAML file.
 *
 * All fields are optional — providers fall back to their own internal
 * defaults when a knob is missing. The shape stays deliberately loose
 * so later providers can add fields without a schema migration.
 */
export interface ProviderEvalConfig {
  /** Preferred version range for this provider (e.g. `"^1.0.0"`). */
  version?: string;
  /** External binary requirement override (e.g. `"^0.1.0"` for skillgrade). */
  externalRequires?: string;
  /** Skillgrade-style preset. */
  preset?: "smoke" | "reliable" | "regression";
  /** Pass/fail threshold in 0..100. */
  threshold?: number;
  /** Execution provider for runtime evaluators. */
  provider?: "docker" | "local";
  /** Free-form overrides — providers pick out what they understand. */
  [key: string]: unknown;
}

/**
 * Top-level shape of the `eval` section.
 *
 * `providers` is a mapping keyed by provider id (matches
 * `EvalProvider.id`). `defaults` applies to every provider unless
 * overridden.
 */
export interface EvalConfig {
  /** Defaults applied to every provider (threshold, timeout, etc.). */
  defaults: {
    threshold: number;
    timeoutMs: number;
  };
  /** Per-provider configuration keyed by provider id. */
  providers: Record<string, ProviderEvalConfig>;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/**
 * Baseline defaults. Kept in a single place so tests can reference them
 * and so PR 3/4 additions are obvious.
 */
export function getDefaultEvalConfig(): EvalConfig {
  return {
    defaults: {
      threshold: 70,
      timeoutMs: 60_000,
    },
    providers: {},
  };
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/**
 * Absolute path to the YAML config file. Exposed so tests can stub it
 * and so `asm config` output can reference it.
 */
export function getEvalConfigPath(): string {
  return join(homedir(), ".asm", "config.yml");
}

// ─── Loader ─────────────────────────────────────────────────────────────────

/**
 * Load and normalize `EvalConfig` from disk.
 *
 * Behavior:
 *   - File missing / empty → defaults.
 *   - No `eval` section    → defaults.
 *   - Malformed YAML       → throws (with YAML parser's message).
 *   - Unknown fields       → preserved under their provider bucket so
 *                            later PRs can read them without migration.
 */
export async function loadEvalConfig(
  path: string = getEvalConfigPath(),
): Promise<EvalConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return getDefaultEvalConfig();
    throw err;
  }
  if (raw.trim().length === 0) return getDefaultEvalConfig();

  const parsed = parseYaml(raw) as unknown;
  return mergeConfig(parsed);
}

/**
 * Merge a parsed YAML document with defaults. Exported for tests and
 * for any future "load from string" entry point.
 */
export function mergeConfig(parsed: unknown): EvalConfig {
  const defaults = getDefaultEvalConfig();
  if (!parsed || typeof parsed !== "object") return defaults;
  const root = parsed as Record<string, unknown>;
  const evalSection = root.eval;
  if (!evalSection || typeof evalSection !== "object") return defaults;
  const section = evalSection as Record<string, unknown>;

  const out: EvalConfig = {
    defaults: {
      threshold: defaults.defaults.threshold,
      timeoutMs: defaults.defaults.timeoutMs,
    },
    providers: {},
  };

  const sectionDefaults = section.defaults;
  if (sectionDefaults && typeof sectionDefaults === "object") {
    const d = sectionDefaults as Record<string, unknown>;
    if (typeof d.threshold === "number" && Number.isFinite(d.threshold)) {
      out.defaults.threshold = d.threshold;
    }
    if (typeof d.timeoutMs === "number" && Number.isFinite(d.timeoutMs)) {
      out.defaults.timeoutMs = d.timeoutMs;
    }
  }

  const providers = section.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    for (const [id, value] of Object.entries(
      providers as Record<string, unknown>,
    )) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out.providers[id] = { ...(value as ProviderEvalConfig) };
      }
    }
  }

  return out;
}
