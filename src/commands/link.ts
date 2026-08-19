import { loadConfig } from "../config";
import { formatJSON, ansi } from "../formatter";
import { sanitizeName, resolveProvider } from "../installer";
import { isBareOrScopedName } from "../registry";
import {
  validateLinkSource,
  createLink,
  discoverLinkableSkills,
} from "../linker";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printLinkHelp() {
  console.log(`${ansi.bold("Usage:")} asm link <path> [<path2> ...] [options]

Symlink a local skill directory into an agent's skill folder. Useful
for local development — changes to the source are reflected immediately.

If <path> contains a SKILL.md at its root, it is linked as a single skill.
If <path> has no root SKILL.md but contains subdirectories with SKILL.md
files, all discovered skills are linked in a single invocation.

Multiple paths can be provided to link several skills at once.

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents)
  --name <name>          Override symlink name (single skill only)
  -f, --force            Overwrite if target already exists
  --json                 Output as JSON
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Examples:")}
  asm link ./my-skill                          ${ansi.dim("Link (interactive tool)")}
  asm link ./my-skill -p claude                ${ansi.dim("Link to Claude Code")}
  asm link ./my-skill --name alias             ${ansi.dim("Link with custom name")}
  asm link ./my-skills-folder                  ${ansi.dim("Link all skills in folder")}
  asm link ./skill1 ./skill2 ./skill3 -p claude ${ansi.dim("Link multiple skills at once")}`);
}

/**
 * Prompt the user to confirm overwrite if the target already exists.
 * Returns the effective force flag (true if user confirmed or force was already set).
 * Throws if the user declines or stdin is not a TTY.
 */
/**
 * Checks whether the target already exists and, if so, asks the user to
 * confirm the overwrite (in TTY mode) or throws (in non-TTY mode).
 *
 * Returns `shouldForce`: `true` when the caller must pass `force=true`
 * to `createLink` (i.e. target exists and user confirmed, or `force`
 * was already set), `false` when the target does not exist and no
 * force is needed.
 */

async function confirmOverwriteIfNeeded(
  targetPath: string,
  force: boolean,
): Promise<boolean> {
  if (force) return true;

  const { access: fsAccess } = await import("fs/promises");
  let exists = false;
  try {
    await fsAccess(targetPath);
    exists = true;
  } catch {
    // doesn't exist
  }

  if (!exists) return false;

  if (!process.stdin.isTTY) {
    throw new Error(
      `Target already exists: ${targetPath}. Use --force to overwrite.`,
    );
  }

  process.stderr.write(
    `${ansi.yellow(`Target already exists: ${targetPath}`)}\n${ansi.bold("Overwrite?")} [y/N] `,
  );
  const answer = await readLine();
  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    console.error("Aborted.");
    process.exit(0);
  }
  return true;
}

/** Link a single skill source to the provider directory. */

async function linkSingleSkill(
  absSourcePath: string,
  providerDir: string,
  linkName: string,
  force: boolean,
): Promise<{ name: string; symlinkPath: string; targetPath: string }> {
  const { join: joinPath } = await import("path");
  const targetPath = joinPath(providerDir, linkName);

  const shouldForce = await confirmOverwriteIfNeeded(targetPath, force);
  await createLink(absSourcePath, providerDir, linkName, shouldForce);

  return { name: linkName, symlinkPath: targetPath, targetPath: absSourcePath };
}

export async function cmdLink(args: ParsedArgs) {
  if (args.flags.help) {
    printLinkHelp();
    return;
  }

  // Collect all source paths: subcommand + remaining positional args
  const sourcePaths: string[] = [];
  if (args.subcommand) sourcePaths.push(args.subcommand);
  sourcePaths.push(...args.positional);

  if (sourcePaths.length === 0) {
    error("Missing required argument: <path>");
    console.error(`Run "asm link --help" for usage.`);
    process.exit(2);
  }

  // When multiple explicit paths are provided, run each as a separate link operation
  if (sourcePaths.length > 1) {
    // --name is not supported with multiple explicit paths
    if (args.flags.name) {
      error(
        `--name cannot be used when linking multiple paths. ` +
          `Link each skill individually to use --name.`,
      );
      process.exit(2);
    }

    // Resolve provider once for all paths
    const config = await loadConfig();
    const { provider } = await resolveProvider(
      config,
      args.flags.provider,
      !!process.stdin.isTTY,
    );

    const { resolveProviderPath } = await import("../config");
    const providerDir = resolveProviderPath(
      config.providers.find((p) => p.name === provider.name)!.global,
    );

    const { resolve: resolvePath, basename } = await import("path");

    const allResults: Array<{
      name: string;
      symlinkPath: string;
      targetPath: string;
    }> = [];
    const allFailures: Array<{ name: string; error: string }> = [];

    for (const sourcePath of sourcePaths) {
      const absSourcePath = resolvePath(sourcePath);

      // Determine single-skill vs multi-skill mode. Only "no SKILL.md / not a
      // dir / does not exist" should fall through to multi-skill discovery —
      // record other validation errors (e.g. malformed frontmatter) as failures
      // so the user gets an actionable message.
      let isSingleSkill = false;
      let validateErr: string | null = null;
      try {
        await validateLinkSource(absSourcePath);
        isSingleSkill = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isMultiSkillCandidate =
          msg.startsWith("Path does not exist") ||
          msg.startsWith("Path is not a directory") ||
          msg.startsWith("No SKILL.md found");
        if (!isMultiSkillCandidate) {
          validateErr = msg;
        }
      }

      if (validateErr) {
        allFailures.push({ name: sourcePath, error: validateErr });
        if (!args.flags.json) {
          console.error(
            ansi.red(`  Failed to process "${sourcePath}": ${validateErr}`),
          );
        }
        continue;
      }

      if (isSingleSkill) {
        const linkName = basename(absSourcePath);
        try {
          const result = await linkSingleSkill(
            absSourcePath,
            providerDir,
            linkName,
            !!args.flags.force,
          );
          allResults.push(result);
          if (!args.flags.json) {
            console.error(
              ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          allFailures.push({ name: linkName, error: msg });
          if (!args.flags.json) {
            console.error(ansi.red(`  Failed to link "${linkName}": ${msg}`));
          }
        }
      } else {
        // Discover skills in the directory
        let discovered: Awaited<ReturnType<typeof discoverLinkableSkills>>;
        try {
          discovered = await discoverLinkableSkills(absSourcePath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          let display = msg;
          if (
            msg.startsWith("Path does not exist") &&
            isBareOrScopedName(sourcePath)
          ) {
            display = `${msg} — "${sourcePath}" looks like a registry name; try "asm install ${sourcePath}" first.`;
          }
          allFailures.push({ name: sourcePath, error: display });
          if (!args.flags.json) {
            console.error(
              ansi.red(`  Failed to process "${sourcePath}": ${display}`),
            );
          }
          continue;
        }

        if (discovered.length === 0) {
          const msg = `No SKILL.md found in ${absSourcePath} or its immediate subdirectories.`;
          allFailures.push({ name: sourcePath, error: msg });
          if (!args.flags.json) {
            console.error(ansi.red(`  ${msg}`));
          }
          continue;
        }

        for (const skill of discovered) {
          try {
            const result = await linkSingleSkill(
              skill.absPath,
              providerDir,
              skill.dirName,
              !!args.flags.force,
            );
            allResults.push(result);
            if (!args.flags.json) {
              console.error(
                ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            allFailures.push({ name: skill.name, error: msg });
            if (!args.flags.json) {
              console.error(
                ansi.red(`  Failed to link "${skill.name}": ${msg}`),
              );
            }
          }
        }
      }
    }

    if (args.flags.json) {
      console.log(
        formatJSON({
          success: allFailures.length === 0,
          linked: allResults,
          failures: allFailures,
        }),
      );
    } else {
      if (allFailures.length > 0) {
        console.error(
          ansi.yellow(
            `\n${allResults.length} linked, ${allFailures.length} failed.`,
          ),
        );
      } else {
        console.error(
          ansi.green(
            `\nDone! Linked ${allResults.length} skill(s) successfully.`,
          ),
        );
      }
    }

    if (allFailures.length > 0) {
      process.exit(1);
    }
    return;
  }

  // ── Single path provided (original behavior) ──

  const sourcePath = sourcePaths[0];
  const { resolve: resolvePath, basename } = await import("path");
  const absSourcePath = resolvePath(sourcePath);

  // Determine single-skill vs multi-skill mode before resolving the provider
  let isSingleSkill = false;
  try {
    await validateLinkSource(absSourcePath);
    isSingleSkill = true;
  } catch (err: unknown) {
    // Errors classified as "not a single-skill dir, try multi-skill discovery":
    //   - "Path does not exist" / "Path is not a directory" / "No SKILL.md found"
    // Surface anything else (e.g. "Invalid SKILL.md ...: missing name") so the
    // user gets an actionable message instead of falling through to a misleading
    // multi-skill discovery error.
    const msg = err instanceof Error ? err.message : String(err);
    const isMultiSkillCandidate =
      msg.startsWith("Path does not exist") ||
      msg.startsWith("Path is not a directory") ||
      msg.startsWith("No SKILL.md found");
    if (!isMultiSkillCandidate) {
      error(msg);
      process.exit(1);
    }
  }

  // Multi-skill: discover and validate early (before provider resolution)
  let discovered: Awaited<ReturnType<typeof discoverLinkableSkills>> = [];
  if (!isSingleSkill) {
    try {
      discovered = await discoverLinkableSkills(absSourcePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Path-not-found is the common case when users pass a bare skill name
      // (e.g. `asm link code-review`). Suggest the install path explicitly.
      if (msg.startsWith("Path does not exist")) {
        error(`No such skill or path: ${sourcePath}`);
        if (isBareOrScopedName(sourcePath)) {
          console.error(
            `  "${sourcePath}" looks like a registry name, not a local path.`,
          );
          console.error(
            `  Install it first:  ${ansi.bold(`asm install ${sourcePath}`)}`,
          );
          console.error(
            `  Or pass a local path: ${ansi.bold(`asm link ./path/to/${sourcePath}`)}`,
          );
        } else {
          console.error(
            `  Pass a local directory containing SKILL.md, or run "asm install <name>" first.`,
          );
        }
      } else {
        error(msg);
      }
      process.exit(1);
    }

    if (discovered.length === 0) {
      error(
        `No SKILL.md found in ${absSourcePath} or its immediate subdirectories.`,
      );
      process.exit(1);
    }

    // --name is not allowed when multiple skills are discovered
    if (args.flags.name && discovered.length > 1) {
      error(
        `--name cannot be used when linking multiple skills (found ${discovered.length} skills). ` +
          `Link each skill individually to use --name.`,
      );
      process.exit(2);
    }
  }

  // Resolve provider (shared for single and multi)
  const config = await loadConfig();
  const { provider } = await resolveProvider(
    config,
    args.flags.provider,
    !!process.stdin.isTTY,
  );

  const { resolveProviderPath } = await import("../config");
  const providerDir = resolveProviderPath(
    config.providers.find((p) => p.name === provider.name)!.global,
  );

  if (isSingleSkill) {
    // ── Single-skill mode (existing behavior) ──
    const linkName = args.flags.name
      ? sanitizeName(args.flags.name)
      : basename(absSourcePath);

    let result: Awaited<ReturnType<typeof linkSingleSkill>>;
    try {
      result = await linkSingleSkill(
        absSourcePath,
        providerDir,
        linkName,
        !!args.flags.force,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.flags.json) {
        console.log(formatJSON({ success: false, error: msg }));
      } else {
        error(msg);
      }
      process.exit(2);
    }

    if (args.flags.json) {
      console.log(formatJSON({ success: true, ...result }));
    } else {
      console.error(
        ansi.green(`Done! Linked "${result.name}" -> ${result.targetPath}`),
      );
      console.error(`  Symlink: ${result.symlinkPath}`);
      console.error(
        ansi.dim(
          `  If you move or delete the source, run "asm uninstall ${result.name}" to clean up.`,
        ),
      );
    }
    return;
  }

  // ── Multi-skill mode ──

  // Display discovered skills
  console.error(
    `Found ${ansi.bold(String(discovered.length))} skill(s) in ${absSourcePath}:`,
  );
  for (const skill of discovered) {
    console.error(
      `  ${ansi.bold(skill.name)} ${ansi.dim(`v${skill.version}`)} ${ansi.dim(`(${skill.dirName}/)`)}`,
    );
  }

  // Confirmation prompt in interactive mode
  if (process.stdin.isTTY && !args.flags.force) {
    process.stderr.write(
      `\n${ansi.bold(`Link ${discovered.length} skill(s)?`)} [Y/n] `,
    );
    const answer = await readLine();
    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      console.error("Aborted.");
      process.exit(0);
    }
  }

  // Link each skill
  const results: Array<{
    name: string;
    symlinkPath: string;
    targetPath: string;
  }> = [];
  const failures: Array<{ name: string; error: string }> = [];

  for (const skill of discovered) {
    const linkName =
      args.flags.name && discovered.length === 1
        ? sanitizeName(args.flags.name)
        : skill.dirName;

    try {
      const result = await linkSingleSkill(
        skill.absPath,
        providerDir,
        linkName,
        !!args.flags.force,
      );
      results.push(result);
      if (!args.flags.json) {
        console.error(
          ansi.green(`  Linked "${result.name}" -> ${result.targetPath}`),
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ name: skill.name, error: msg });
      if (!args.flags.json) {
        console.error(ansi.red(`  Failed to link "${skill.name}": ${msg}`));
      }
    }
  }

  if (args.flags.json) {
    console.log(
      formatJSON({
        success: failures.length === 0,
        linked: results,
        failures,
      }),
    );
  } else {
    if (failures.length > 0) {
      console.error(
        ansi.yellow(`\n${results.length} linked, ${failures.length} failed.`),
      );
    } else {
      console.error(
        ansi.green(`\nDone! Linked ${results.length} skill(s) successfully.`),
      );
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}
