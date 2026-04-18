/**
 * Built-in provider registration.
 *
 * `registerBuiltins()` is the single place PR 3+ wires `src/cli.ts` to
 * the eval framework. Each built-in provider module exports a factory,
 * and this function calls `register()` for each one.
 *
 * PR 1 shipped this as an empty function. PR 2 (#156) adds the `quality`
 * provider — an adapter over `src/evaluator.ts`. PR 4 will add
 * `skillgrade`. Keeping the list here (rather than each provider
 * self-registering at import time) makes ordering deterministic and
 * makes it possible to run with a restricted provider set in tests.
 *
 * This file MUST NOT be imported from `src/cli.ts` yet — PR 3 owns that
 * wiring. Importing it here in PR 2 would register a provider at module
 * load time and silently change `asm eval` behavior.
 */

import { register } from "../registry";
import { qualityProviderV1 } from "./quality/v1";

/**
 * Register every built-in provider with the shared registry.
 *
 * Safe to call multiple times in tests only if callers reset the
 * registry first (see `__resetForTests` in `../registry.ts`) —
 * `register()` throws on duplicate `(id, version)` by design.
 */
export function registerBuiltins(): void {
  register(qualityProviderV1);
  // PR 4: register(skillgradeProviderV1);
}
