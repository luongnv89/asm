import { join } from "path";
import { loadConfig, resolveProviderPath } from "../config";
import { ansi } from "../formatter";
import { resolveProvider } from "../installer";
import { resolveInstallScope } from "../installer-link";
import type { ProviderConfig } from "../utils/types";
import {
  activateLibrarySkill,
  deactivateLibrarySkill,
  findLibrarySkill,
  listLibrarySkills,
} from "../library";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printActivateHelp() {
  console.log(`${ansi.bold("Usage:")} asm activate <skill> -p <tool> -s <scope> [options]

Link a centrally installed library skill into a provider skill folder.

${ansi.bold("Options:")}
  -p, --tool <name>      Provider to activate into (e.g., claude, codex)
  -s, --scope <scope>    Activation scope: global, project, or both (default: global; prompted when interactive)
  --name <name>          Link name to create (default: library directory name)
  -f, --force            Replace an existing target
  --json                 Output as JSON object
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm activate brainstorming -p codex -s project
  asm activate brainstorming -p claude -s both --json`);
}

function printDeactivateHelp() {
  console.log(`${ansi.bold("Usage:")} asm deactivate <skill> -p <tool> -s <global|project|both> [options]

Remove a centrally activated library skill from a provider skill folder.

${ansi.bold("Options:")}
  -p, --tool <name>      Provider to deactivate from (e.g., claude, codex)
  -s, --scope <scope>    Deactivation scope: global, project, or both (default: global; prompted when interactive)
  --json                 Output as JSON object
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm deactivate brainstorming -p codex -s project
  asm deactivate brainstorming -p claude -s both --json`);
}

// ─── Multi-scope activation ─────────────────────────────────────────────────

/** Both provider scopes, in the order they are attempted. */
const BOTH_SCOPES = ["global", "project"] as const;

interface ScopeActivation {
  name: string;
  skill: string;
  provider: string;
  scope: "global" | "project";
  path: string;
  target: string;
}

interface ScopeFailure {
  name: string;
  provider: string;
  scope: "global" | "project";
  path?: string;
  error: string;
}

/**
 * Activate one library skill in both provider scopes.
 *
 * Each scope is attempted independently: a conflict in one scope leaves the
 * other link in place, matching the install scope contract. Any failure
 * exits 1.
 */
async function activateBothScopes(input: {
  provider: ProviderConfig;
  libraryPath: string;
  skillName: string;
  activationName: string;
  force: boolean;
  json: boolean;
}): Promise<void> {
  const linked: ScopeActivation[] = [];
  const failures: ScopeFailure[] = [];

  for (const scope of BOTH_SCOPES) {
    let linkPath: string | undefined;
    try {
      const template =
        scope === "global" ? input.provider.global : input.provider.project;
      if (!template) {
        throw new Error(
          `Provider "${input.provider.name}" has no ${scope} path configured.`,
        );
      }
      const targetDir = resolveProviderPath(template);
      linkPath = join(targetDir, input.activationName);
      const result = await activateLibrarySkill({
        libraryPath: input.libraryPath,
        targetDir,
        activationName: input.activationName,
        force: input.force,
      });
      linked.push({
        name: input.activationName,
        skill: input.skillName,
        provider: input.provider.name,
        scope,
        path: result.symlinkPath,
        target: result.targetPath,
      });
    } catch (err: unknown) {
      failures.push({
        name: input.activationName,
        provider: input.provider.name,
        scope,
        path: linkPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (input.json) {
    console.log(
      JSON.stringify(
        { success: failures.length === 0, linked, failures },
        null,
        2,
      ),
    );
  } else {
    for (const entry of linked) {
      console.log(
        `${ansi.green("✓")} activated ${entry.name} (${entry.provider}/${entry.scope}) -> ${entry.target}`,
      );
    }
    for (const failure of failures) {
      console.error(
        ansi.red(
          `  Failed to activate "${failure.name}" (${input.provider.name}/${failure.scope}): ${failure.error}`,
        ),
      );
    }
  }

  if (failures.length > 0) process.exit(1);
}

/**
 * Deactivate one library skill in both provider scopes, independently.
 */
async function deactivateBothScopes(input: {
  provider: ProviderConfig;
  activationName: string;
  json: boolean;
}): Promise<void> {
  const removed: Array<{
    name: string;
    provider: string;
    scope: "global" | "project";
    path: string;
    target: string;
  }> = [];
  const failures: ScopeFailure[] = [];

  for (const scope of BOTH_SCOPES) {
    let linkPath: string | undefined;
    try {
      const template =
        scope === "global" ? input.provider.global : input.provider.project;
      if (!template) {
        throw new Error(
          `Provider "${input.provider.name}" has no ${scope} path configured.`,
        );
      }
      const targetDir = resolveProviderPath(template);
      linkPath = join(targetDir, input.activationName);
      removed.push(
        await deactivateLibrarySkill({
          targetDir,
          activationName: input.activationName,
          provider: input.provider.name,
          scope,
        }),
      );
    } catch (err: unknown) {
      failures.push({
        name: input.activationName,
        provider: input.provider.name,
        scope,
        path: linkPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (input.json) {
    console.log(
      JSON.stringify(
        { success: failures.length === 0, linked: removed, failures },
        null,
        2,
      ),
    );
  } else {
    for (const entry of removed) {
      console.log(
        `${ansi.green("✓")} deactivated ${entry.name} (${entry.provider}/${entry.scope}) -> ${entry.target}`,
      );
    }
    for (const failure of failures) {
      console.error(
        ansi.red(
          `  Failed to deactivate "${failure.name}" (${input.provider.name}/${failure.scope}): ${failure.error}`,
        ),
      );
    }
  }

  if (failures.length > 0) process.exit(1);
}

// ─── Command Handlers ───────────────────────────────────────────────────────

export async function cmdActivate(args: ParsedArgs) {
  if (args.flags.help) {
    printActivateHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing skill name. Use: asm activate <skill>");
    console.error(`Run "asm activate --help" for usage.`);
    process.exit(2);
  }

  const rows = await listLibrarySkills();
  const skill = findLibrarySkill(rows, skillName);
  if (!skill) {
    error(`Library skill "${skillName}" not found. Run "asm library list".`);
    process.exit(1);
  }
  if (skill.missing) {
    error(
      `Library skill "${skillName}" is missing on disk: ${skill.libraryPath}`,
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const { provider } = await resolveProvider(
    config,
    args.flags.provider,
    process.stdin.isTTY,
  );
  const activationName = args.flags.name || skill.dirName;

  // Explicit `both` links into both provider scopes. An omitted scope keeps
  // the existing behaviour (non-TTY/--yes -> global, TTY -> picker), so the
  // shared resolver is only used for the single-scope paths.
  if (args.flags.scopeExplicit && args.flags.scope === "both") {
    await activateBothScopes({
      provider,
      libraryPath: skill.libraryPath,
      skillName: skill.dirName,
      activationName,
      force: args.flags.force,
      json: args.flags.json,
    });
    return;
  }

  let scope: "global" | "project";
  try {
    scope = await resolveInstallScope({
      scopeFlag: args.flags.scope,
      provider,
      isTTY: !!process.stdin.isTTY,
      yes: args.flags.yes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(1);
  }
  const targetTemplate =
    scope === "global" ? provider.global : provider.project;
  const targetDir = resolveProviderPath(targetTemplate);
  const result = await activateLibrarySkill({
    libraryPath: skill.libraryPath,
    targetDir,
    activationName,
    force: args.flags.force,
  });

  const payload = {
    name: activationName,
    skill: skill.dirName,
    provider: provider.name,
    scope,
    path: result.symlinkPath,
    target: result.targetPath,
  };

  if (args.flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `${ansi.green("✓")} activated ${activationName} (${provider.name}/${scope}) -> ${result.targetPath}`,
  );
}

export async function cmdDeactivate(args: ParsedArgs) {
  if (args.flags.help) {
    printDeactivateHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing skill name. Use: asm deactivate <skill>");
    console.error(`Run "asm deactivate --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  let provider: ProviderConfig;
  try {
    provider = (
      await resolveProvider(config, args.flags.provider, process.stdin.isTTY)
    ).provider;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(2);
  }

  // Explicit `both` removes from both scopes and reports each result; it is
  // handled before the single-scope try/catch so its exit sentinel is not
  // mistaken for a deactivation error.
  if (args.flags.scopeExplicit && args.flags.scope === "both") {
    await deactivateBothScopes({
      provider,
      activationName: skillName,
      json: args.flags.json,
    });
    return;
  }

  try {
    const scope = await resolveInstallScope({
      scopeFlag: args.flags.scope,
      provider,
      isTTY: !!process.stdin.isTTY,
      yes: args.flags.yes,
    });
    const targetTemplate =
      scope === "global" ? provider.global : provider.project;
    const targetDir = resolveProviderPath(targetTemplate);
    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: skillName,
      provider: provider.name,
      scope,
    });

    if (args.flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(
      `${ansi.green("✓")} deactivated ${result.name} (${result.provider}/${result.scope}) -> ${result.target}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.flags.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
      process.exit(1);
    }
    error(message);
    process.exit(1);
  }
}
