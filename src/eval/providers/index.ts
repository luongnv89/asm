/**
 * Built-in provider registration.
 *
 * `registerBuiltins()` is the single place PR 3+ wires `src/cli.ts` to
 * the eval framework. Each built-in provider module exports a factory,
 * and this function calls `register()` for each one.
 *
 * PR 1 ships this as an empty function on purpose — no providers are
 * registered yet. PR 2 adds the `quality` provider import + register
 * call here; PR 4 adds `skillgrade`. Keeping the list here (rather
 * than each provider self-registering at import time) makes ordering
 * deterministic and makes it possible to run with a restricted
 * provider set in tests.
 *
 * This file MUST NOT be imported from `src/cli.ts` in PR 1 — the
 * acceptance criteria for #155 explicitly require zero user-visible
 * behavior change. Later PRs own that wiring.
 */

import { register } from "../registry";

/**
 * Register every built-in provider with the shared registry.
 *
 * Safe to call multiple times in tests only if callers reset the
 * registry first (see `__resetForTests` in `../registry.ts`) —
 * `register()` throws on duplicate `(id, version)` by design.
 */
export function registerBuiltins(): void {
  // PR 2: register(qualityProviderV1);
  // PR 4: register(skillgradeProviderV1);
  // `register` is imported but intentionally unused in PR 1 — it is the
  // hook every subsequent PR in the Skillgrade integration series will
  // call from inside this function.
  void register;
}
