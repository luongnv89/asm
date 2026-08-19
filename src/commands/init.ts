import { loadConfig } from "../config";
import { ansi } from "../formatter";
import { sanitizeName, resolveProvider } from "../installer";
import { scaffoldSkill, directoryExists } from "../initializer";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printInitHelp() {
  console.log(`${ansi.bold("Usage:")} asm init <name> [options]

Scaffold a new skill directory with a SKILL.md template. Creates a
ready-to-edit skill in the target tool's skill folder.

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents)
  --path <dir>           Scaffold in specified directory instead of provider path
  -f, --force            Overwrite if skill already exists
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm init my-skill                 ${ansi.dim("Scaffold (interactive tool)")}
  asm init my-skill -p claude       ${ansi.dim("Scaffold in Claude Code")}
  asm init my-skill --path ./skills ${ansi.dim("Scaffold in custom directory")}`);
}

export async function cmdInit(args: ParsedArgs) {
  if (args.flags.help) {
    printInitHelp();
    return;
  }

  const name = args.subcommand;
  if (!name) {
    error("Missing required argument: <name>");
    console.error(`Run "asm init --help" for usage.`);
    process.exit(2);
  }

  // Validate name
  const safeName = sanitizeName(name);

  let targetDir: string;

  if (args.flags.path) {
    // --path flag: scaffold in specified directory
    const { resolve: resolvePath } = await import("path");
    targetDir = resolvePath(args.flags.path);
  } else {
    // Resolve provider and scaffold in provider's skill directory
    const config = await loadConfig();
    const { provider } = await resolveProvider(
      config,
      args.flags.provider,
      !!process.stdin.isTTY,
    );
    const { join: joinPath } = await import("path");
    const { resolveProviderPath } = await import("../config");
    const providerDir = resolveProviderPath(
      config.providers.find((p) => p.name === provider.name)!.global,
    );
    targetDir = joinPath(providerDir, safeName);
  }

  // Check conflict
  if (await directoryExists(targetDir)) {
    if (!args.flags.force) {
      if (!process.stdin.isTTY) {
        error(
          `Directory already exists: ${targetDir}. Use --force to overwrite.`,
        );
        process.exit(2);
      }
      process.stderr.write(
        `${ansi.yellow(`Directory already exists: ${targetDir}`)}\n${ansi.bold("Overwrite?")} [y/N] `,
      );
      const answer = await readLine();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.error("Aborted.");
        process.exit(0);
      }
    }
  }

  await scaffoldSkill(safeName, targetDir);
  console.error(
    ansi.green(`Done! Created skill "${safeName}" at ${targetDir}`),
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────
