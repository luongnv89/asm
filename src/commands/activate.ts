import { loadConfig, resolveProviderPath } from "../config";
import { ansi } from "../formatter";
import { resolveProvider } from "../installer";
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
  -s, --scope <scope>    Activation scope: global or project
  --name <name>          Link name to create (default: library directory name)
  -f, --force            Replace an existing target
  --json                 Output as JSON object
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm activate brainstorming -p codex -s project
  asm activate brainstorming -p claude -s global --json`);
}

function printDeactivateHelp() {
  console.log(`${ansi.bold("Usage:")} asm deactivate <skill> -p <tool> -s <global|project> [options]

Remove a centrally activated library skill from a provider skill folder.

${ansi.bold("Options:")}
  -p, --tool <name>      Provider to deactivate from (e.g., claude, codex)
  -s, --scope <scope>    Activation scope: global or project
  --json                 Output as JSON object
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm deactivate brainstorming -p codex -s project
  asm deactivate brainstorming -p claude -s global --json`);
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

  if (args.flags.scope === "both") {
    error("Activation requires --scope global or --scope project.");
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
  const targetTemplate =
    args.flags.scope === "global" ? provider.global : provider.project;
  const targetDir = resolveProviderPath(targetTemplate);
  const activationName = args.flags.name || skill.dirName;
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
    scope: args.flags.scope,
    path: result.symlinkPath,
    target: result.targetPath,
  };

  if (args.flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `${ansi.green("✓")} activated ${activationName} (${provider.name}/${args.flags.scope}) -> ${result.targetPath}`,
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

  if (args.flags.scope === "both") {
    error("Deactivation requires --scope global or --scope project.");
    process.exit(2);
  }

  const config = await loadConfig();
  let provider: ProviderConfig;
  try {
    provider = (
      await resolveProvider(config, args.flags.provider, process.stdin.isTTY)
    ).provider;
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    error(message);
    process.exit(2);
  }

  try {
    const targetTemplate =
      args.flags.scope === "global" ? provider.global : provider.project;
    const targetDir = resolveProviderPath(targetTemplate);
    const result = await deactivateLibrarySkill({
      targetDir,
      activationName: skillName,
      provider: provider.name,
      scope: args.flags.scope,
    });

    if (args.flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(
      `${ansi.green("✓")} deactivated ${result.name} (${result.provider}/${result.scope}) -> ${result.target}`,
    );
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.flags.json) {
      console.log(JSON.stringify({ error: message }, null, 2));
      process.exit(1);
    }
    error(message);
    process.exit(1);
  }
}
