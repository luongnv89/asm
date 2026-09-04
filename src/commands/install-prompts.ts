/**
 * Shared interactive install preamble (issue #612).
 *
 * `asm install` and `asm bundle install` offer the same two decisions before
 * writing anything: which skills to install and which scope to install them
 * into. Both helpers below are TTY-gated (`isTTY && !yes`) so `--yes` and
 * non-interactive runs keep the historical defaults (all skills, global
 * scope). All user-facing output goes to stderr via the injected `log`
 * (default `console.error`); machine/JSON output on stdout stays clean.
 */

import { ansi } from "../formatter";
import { checkboxPicker } from "../utils/checkbox-picker";
import { resolveInstallScope } from "../installer-link";
import type { BundleSkillRef, ProviderConfig } from "../utils/types";

export type InstallScope = "global" | "project";

export interface ScopePromptOptions {
  scopeFlag: string | null;
  provider: ProviderConfig;
  isTTY: boolean;
  yes: boolean;
  log?: (message: string) => void;
}

/**
 * Resolve the install scope, logging the decision like the `asm install`
 * flow does. Single-skill and bundle installs share this so the scope offer
 * cannot drift between the two commands.
 */
export async function promptInstallScope(
  opts: ScopePromptOptions,
): Promise<InstallScope> {
  const {
    scopeFlag,
    provider,
    isTTY,
    yes,
    log = (message: string) => console.error(message),
  } = opts;

  if (scopeFlag === "global" || scopeFlag === "project") {
    // Explicit --scope flag provided
    log(
      `  ${ansi.dim(`scope: ${scopeFlag}`)}${scopeFlag === "global" ? ` (${provider.global})` : ` (${provider.project})`}`,
    );
    return scopeFlag;
  }

  if (!isTTY || yes) {
    // Non-interactive mode: default to global
    log(`  ${ansi.dim(`scope: global (default)`)} (${provider.global})`);
    return "global";
  }

  // Interactive: prompt user to choose
  log(""); // blank line before picker
  const scope = await resolveInstallScope({
    scopeFlag,
    provider,
    isTTY,
    yes,
  });
  log(
    `  Selected: ${ansi.bold(scope)} ${ansi.dim(`(${scope === "global" ? provider.global : provider.project})`)}`,
  );
  return scope;
}

export interface SkillPromptOptions {
  isTTY: boolean;
  yes: boolean;
  log?: (message: string) => void;
}

/**
 * Let the user pick which bundle entries to install. Non-interactive runs,
 * `--yes`, and single-skill bundles install everything without prompting.
 * Multi-skill TTY runs show a checkbox picker (all checked by default).
 *
 * Throws when the picker is dismissed with nothing selected; callers turn
 * that into `error()` + `process.exit(1)` (bundle style) or let their
 * `try/catch` report it (install style).
 */
export async function selectBundleSkills(
  skills: BundleSkillRef[],
  opts: SkillPromptOptions,
): Promise<BundleSkillRef[]> {
  const {
    isTTY,
    yes,
    log = (message: string) => console.error(message),
  } = opts;

  if (skills.length <= 1 || !isTTY || yes) {
    return skills;
  }

  log(ansi.bold(`Select skills to install from this bundle:\n`));
  const items = skills.map((s) => ({
    label: s.name,
    hint: s.description
      ? s.description.slice(0, 60) + (s.description.length > 60 ? "..." : "")
      : s.version
        ? `v${s.version}`
        : s.installUrl,
    checked: true,
  }));
  const indices = await checkboxPicker({ items });

  if (indices.length === 0) {
    throw new Error("No skills selected. Aborting.");
  }
  return indices.map((i) => skills[i]);
}
