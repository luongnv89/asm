/**
 * Built-in provider registration.
 *
 * `registerBuiltins()` is the single place `src/cli.ts` wires the eval
 * framework. Each built-in provider module exports a singleton, and this
 * function calls `register()` for each one.
 *
 * Providers register unconditionally: environment conditions are checked
 * per-context by each provider's `applicable()` at runtime, not at
 * registration time. This keeps `asm eval-providers list` deterministic
 * across machines.
 */

import { register } from "../registry";
import { qualityProviderV1 } from "./quality/v1";
import { skillCreatorProviderV1 } from "./skill-creator/v1";

/**
 * Register every built-in provider with the shared registry.
 *
 * Safe to call multiple times in tests only if callers reset the
 * registry first (see `__resetForTests` in `../registry.ts`) —
 * `register()` throws on duplicate `(id, version)` by design.
 */
export function registerBuiltins(): void {
  register(qualityProviderV1);
  register(skillCreatorProviderV1);
}
