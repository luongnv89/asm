/**
 * Built-in provider registration.
 *
 * `registerBuiltins()` is the single place `src/cli.ts` wires the eval
 * framework. Each built-in provider module exports a factory, and this
 * function calls `register()` for each one.
 *
 * PR 1 shipped this as an empty function. PR 2 (#156) added the `quality`
 * provider — an adapter over `src/evaluator.ts`. PR 4 (#158) adds
 * `skillgrade` — runtime eval via the external `skillgrade` CLI.
 *
 * Providers register unconditionally: environment conditions (binary
 * present, API key exported, etc.) are checked per-context by each
 * provider's `applicable()` at runtime, not at registration time. This
 * keeps `asm eval-providers list` deterministic across machines.
 */

import { register } from "../registry";
import { qualityProviderV1 } from "./quality/v1";
import { skillgradeProviderV1 } from "./skillgrade/v1";

/**
 * Register every built-in provider with the shared registry.
 *
 * Safe to call multiple times in tests only if callers reset the
 * registry first (see `__resetForTests` in `../registry.ts`) —
 * `register()` throws on duplicate `(id, version)` by design.
 */
export function registerBuiltins(): void {
  register(qualityProviderV1);
  register(skillgradeProviderV1);
}
