import {
  loadConfig,
  getConfigPath,
  getDefaultConfig,
  saveConfig,
} from "../config";
import { formatJSON, ansi } from "../formatter";
import { parseEditorCommand } from "../utils/editor";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printConfigHelp() {
  console.log(`${ansi.bold("Usage:")} asm config <subcommand>

Manage configuration. Config is stored at ~/.config/agent-skill-manager/.

${ansi.bold("Subcommands:")}
  show     Print current config as JSON
  path     Print config file path
  reset    Reset config to defaults (with confirmation)
  edit     Open config in $EDITOR

${ansi.bold("Options:")}
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm config show                   ${ansi.dim("View current config")}
  asm config edit                   ${ansi.dim("Edit in $EDITOR")}
  asm config reset -y               ${ansi.dim("Reset without confirmation")}`);
}

export async function cmdConfig(args: ParsedArgs) {
  if (args.flags.help) {
    printConfigHelp();
    return;
  }

  const sub = args.subcommand;

  if (!sub) {
    error("Missing subcommand. Use: show, path, reset, or edit.");
    console.error(`Run "asm config --help" for usage.`);
    process.exit(2);
  }

  switch (sub) {
    case "show": {
      const config = await loadConfig();
      console.log(formatJSON(config));
      break;
    }
    case "path": {
      console.log(getConfigPath());
      break;
    }
    case "reset": {
      if (!args.flags.yes) {
        if (!process.stdin.isTTY) {
          error(
            "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
          );
          process.exit(2);
        }
        process.stderr.write(
          `${ansi.bold("Reset config to defaults?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }
      const defaults = getDefaultConfig();
      await saveConfig(defaults);
      console.error(ansi.green("Config reset to defaults."));
      break;
    }
    case "edit": {
      const editorCmd = process.env.VISUAL || process.env.EDITOR || "vi";
      const [editorBin, editorArgs] = parseEditorCommand(editorCmd);
      const configPath = getConfigPath();
      // Ensure config file exists
      await loadConfig();
      const { spawn: spawnProcess } = await import("child_process");
      await new Promise<void>((resolve, reject) => {
        const proc = spawnProcess(editorBin, [...editorArgs, configPath], {
          stdio: "inherit",
        });
        proc.on("close", () => resolve());
        proc.on("error", reject);
      });
      break;
    }
    default: {
      error(
        `Unknown config subcommand: "${sub}". Use: show, path, reset, or edit.`,
      );
      process.exit(2);
    }
  }
}
