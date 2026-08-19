import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import {
  buildFullRemovalPlan,
  executeRemoval,
  getExistingTargets,
  buildRelocationInfo,
} from "../uninstaller";
import { ansi, shortenPath } from "../formatter";
import type { RelocationInfo } from "../utils/types";
import { removeLockEntry, setLockEntryProvider } from "../utils/lock";
import { resolve } from "path";
import type { Scope } from "../utils/types";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printUninstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm uninstall <skill-name> [options]

Remove a skill and its associated rule files. Shows a removal plan
before proceeding and asks for confirmation.

${ansi.bold("Options:")}
  -y, --yes          Skip confirmation prompt
  -s, --scope <s>    Filter: global, project, or both (default: both)
  -p, --tool <name>  Filter by tool/provider (e.g., claude, codex)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm uninstall code-review              ${ansi.dim("Remove with confirmation")}
  asm uninstall code-review -y           ${ansi.dim("Remove without confirmation")}
  asm uninstall code-review -s project   ${ansi.dim("Remove project copy only")}
  asm uninstall code-review -p claude    ${ansi.dim("Remove from Claude only")}`);
}

export async function cmdUninstall(args: ParsedArgs) {
  if (args.flags.help) {
    printUninstallHelp();
    return;
  }

  const skillName = args.subcommand;
  if (!skillName) {
    error("Missing required argument: <skill-name>");
    console.error(`Run "asm uninstall --help" for usage.`);
    process.exit(2);
  }

  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  // Apply provider filter if --tool flag is provided
  const options: { providerFilter?: string; scopeFilter?: Scope } = {};
  if (args.flags.provider) {
    options.providerFilter = args.flags.provider;
  }
  if (args.flags.scope && args.flags.scope !== "both") {
    options.scopeFilter = args.flags.scope;
  }

  const plan = buildFullRemovalPlan(skillName, allSkills, config, options);

  const existing = await getExistingTargets(plan);
  if (existing.length === 0) {
    error(`Skill "${skillName}" not found or nothing to remove.`);
    process.exit(1);
  }

  // Detect real-folder relocation
  const matchingSkills = allSkills.filter((s) => s.dirName === skillName);
  const targetProvider = options.providerFilter;
  let relocationInfo: RelocationInfo | null = null;
  if (targetProvider) {
    relocationInfo = buildRelocationInfo(plan, matchingSkills, targetProvider);
  }

  // Show removal plan with details
  console.error(ansi.bold("Removal plan:"));
  console.error(`  ${ansi.dim("Scope:")} ${options.scopeFilter || "both"}`);
  if (targetProvider) {
    console.error(`  ${ansi.dim("Tool:")} ${targetProvider}`);
    if (relocationInfo?.needed) {
      console.error(
        `  ${ansi.yellow("⚠ Real folder relocation:")} ${relocationInfo.fromPath} → ${relocationInfo.toPath} (${relocationInfo.toProvider})`,
      );
    }
  }
  console.error("");
  for (const target of existing) {
    console.error(`  ${ansi.red("•")} ${shortenPath(target)}`);
  }

  if (!args.flags.yes) {
    // Interactive confirmation
    if (!process.stdin.isTTY) {
      error(
        "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
      );
      process.exit(2);
    }
    process.stderr.write(`\n${ansi.bold("Proceed with removal?")} [y/N] `);
    const answer = await readLine();
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  // When relocation is needed, pass the full RelocationInfo so executeRemoval
  // physically renames the real folder rather than deleting it and symlinking
  // to the original (which would have been the about-to-be-deleted path).
  let log: string[];
  try {
    log = await executeRemoval(
      plan,
      undefined,
      relocationInfo?.needed ? relocationInfo : undefined,
    );
  } catch (err: any) {
    // executeRemoval throws when a relocation rename/EXDEV-fallback fails.
    // Surface any partial log entries (including the failure message it
    // pushed before throwing) so the user sees what happened, then exit
    // non-zero — don't print "Done." for a half-finished uninstall.
    const partialLog: string[] = Array.isArray(err?.log) ? err.log : [];
    for (const entry of partialLog) {
      console.error(entry);
    }
    error(err?.message || "Uninstall failed.");
    process.exit(1);
  }
  for (const entry of log) {
    console.error(entry);
  }

  // Lock-entry cleanup. The lock schema stores one entry per skill name,
  // keyed on a single provider field. On a full uninstall (no `-t`) we
  // drop the entry. On a partial uninstall (`-t <provider>`) with other
  // providers' instances still present, we MUST keep source-tracking
  // metadata (`source`, `commitHash`, `ref`) alive for the survivors:
  //
  //   • Real-folder relocation (a real folder was moved to a kept
  //     provider's slot) — repoint the lock entry's `provider` field at
  //     the new home so `asm list`/`asm update` use the right path.
  //   • Two-real-folders or repoint-only — at least one surviving
  //     provider has a real folder, so source-tracking metadata stays
  //     useful even if the entry's `provider` field is now stale
  //     relative to which install survived.
  //
  // Known limitation: in the two-real-folders case the lock points at
  // ONE provider only; that provider may not be the one that survived.
  // Per-provider lock entries are the long-term fix (tracked separately).
  const removedDirSet = new Set(plan.directories.map((d) => resolve(d.path)));
  const survivingInstances = matchingSkills.filter(
    (s) => !removedDirSet.has(resolve(s.originalPath)),
  );
  try {
    if (targetProvider && survivingInstances.length > 0) {
      if (relocationInfo?.needed && !relocationInfo.repointOnly) {
        await setLockEntryProvider(skillName, relocationInfo.toProvider);
      }
      // else: keep the lock entry as-is — two-real-folders or
      // repoint-only, both leave the original provider's real folder
      // intact, so source-tracking metadata stays accurate.
    } else {
      await removeLockEntry(skillName);
    }
  } catch {
    // Lock cleanup failure is non-fatal
  }

  console.error(ansi.green("\nDone."));
}
