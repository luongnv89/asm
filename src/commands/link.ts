import { loadConfig, resolveProviderPath } from "../config";
import { formatJSON, ansi } from "../formatter";
import { sanitizeName, resolveProvider } from "../installer";
import { isBareOrScopedName } from "../registry";
import {
  validateLinkSource,
  createLinkSafely,
  discoverLinkableSkills,
  type LinkableSkill,
} from "../linker";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";
import type { ProviderConfig } from "../utils/types";

/** Scope a link is created in — mirrors `asm activate`'s scopes. */
type LinkScope = "global" | "project";

/** One link to create: a resolved source directory and the name it gets. */
interface LinkJob {
  /** Absolute path of the source skill directory. */
  sourcePath: string;
  /** Name of the symlink created inside the target directory. */
  linkName: string;
  /** Source directory name — the skill identity reported to the user. */
  skillName: string;
  /** Label used when reporting failures (the path the user passed in). */
  label: string;
}

/** A destination directory plus the scope it belongs to. */
interface LinkTarget {
  scope: LinkScope;
  dir: string;
}

/** A successfully created link — mirrors `asm activate`'s JSON payload. */
interface LinkedEntry {
  name: string;
  skill: string;
  provider: string;
  scope: LinkScope;
  path: string;
  target: string;
}

/** A link that could not be created. */
interface FailureEntry {
  /** Link name — only present for a link that failed at its target. */
  name?: string;
  source: string;
  scope: LinkScope | null;
  path?: string;
  error: string;
}

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
  -s, --scope <scope>    Target scope: global, project, or both (default: global)
  --name <name>          Override symlink name (single skill only)
  -f, --force            Replace an existing symlink at the target
  --json                 Output as JSON
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Notes:")}
  ${ansi.dim("An existing target is never replaced without --force, and --force replaces symlinks only — real files and directories are kept.")}
  ${ansi.dim('Project scope links into the current directory (e.g. .claude/skills); "local" is accepted as an alias for "project".')}

${ansi.bold("Examples:")}
  asm link ./my-skill                          ${ansi.dim("Link (interactive tool)")}
  asm link ./my-skill -p claude                ${ansi.dim("Link to Claude Code")}
  asm link ./my-skill -p claude -s project     ${ansi.dim("Link into this project only")}
  asm link ./my-skill -p claude -s both        ${ansi.dim("Link globally and in this project")}
  asm link ./my-skill --name alias             ${ansi.dim("Link with custom name")}
  asm link ./my-skills-folder                  ${ansi.dim("Link all skills in folder")}
  asm link ./skill1 ./skill2 ./skill3 -p claude ${ansi.dim("Link multiple skills at once")}`);
}

/**
 * Resolve the requested scope.
 *
 * The shared CLI parser normalises "local" to "project" and only marks a
 * scope as user-supplied through `scopeExplicit`; without the flag
 * `flags.scope` holds the parser default ("both"). An omitted scope keeps
 * the historical global behaviour — it must not silently create two links.
 */
function resolveLinkScope(args: ParsedArgs): "global" | "project" | "both" {
  if (!args.flags.scopeExplicit) return "global";
  const scope = args.flags.scope;
  if (scope === "project") return "project";
  if (scope === "both") return "both";
  return "global";
}

/**
 * Resolve the destination directories for a scope. Project scope resolves
 * against the current working directory — no Git-root discovery — so the
 * link lands in the project the command was run from.
 */
function resolveLinkTargets(
  provider: ProviderConfig,
  scope: "global" | "project" | "both",
): LinkTarget[] {
  // Build lazily: a user config without a `project` path must still support
  // the global scope it supported before scope handling existed.
  const globalTarget = (): LinkTarget => ({
    scope: "global",
    dir: resolveProviderPath(provider.global),
  });
  const projectTarget = (): LinkTarget => ({
    scope: "project",
    dir: resolveProviderPath(provider.project),
  });
  if (scope === "both") return [globalTarget(), projectTarget()];
  return scope === "project" ? [projectTarget()] : [globalTarget()];
}

/**
 * Turn one user-supplied path into the links it should produce.
 *
 * A directory with a root SKILL.md is a single skill; a directory without
 * one may hold skill subdirectories, discovered one level deep. Failures are
 * returned rather than thrown so the caller can decide between aborting
 * (single path) and continuing (multiple paths).
 */
async function resolveSourceJobs(
  sourcePath: string,
  nameFlag: string | undefined,
): Promise<{
  jobs: LinkJob[];
  discovered?: LinkableSkill[];
  failure?: { error: string; missing: boolean };
}> {
  const { resolve: resolvePath, basename } = await import("path");
  const absSourcePath = resolvePath(sourcePath);

  let isSingleSkill = false;
  try {
    await validateLinkSource(absSourcePath);
    isSingleSkill = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only "no skill here" errors fall through to directory discovery;
    // anything else (e.g. malformed frontmatter) is actionable as-is.
    const isMultiSkillCandidate =
      msg.startsWith("Path does not exist") ||
      msg.startsWith("Path is not a directory") ||
      msg.startsWith("No SKILL.md found");
    if (!isMultiSkillCandidate) {
      return { jobs: [], failure: { error: msg, missing: false } };
    }
  }

  if (isSingleSkill) {
    const linkName = nameFlag ?? basename(absSourcePath);
    if (!linkName) {
      return {
        jobs: [],
        failure: {
          error: `Invalid skill name: cannot derive a link name from ${absSourcePath}`,
          missing: false,
        },
      };
    }
    return {
      jobs: [
        {
          sourcePath: absSourcePath,
          linkName,
          skillName: basename(absSourcePath),
          label: sourcePath,
        },
      ],
    };
  }

  let discovered: LinkableSkill[];
  try {
    discovered = await discoverLinkableSkills(absSourcePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jobs: [],
      failure: {
        error: msg,
        missing: msg.startsWith("Path does not exist"),
      },
    };
  }

  if (discovered.length === 0) {
    return {
      jobs: [],
      failure: {
        error: `No SKILL.md found in ${absSourcePath} or its immediate subdirectories.`,
        missing: false,
      },
    };
  }

  return {
    jobs: discovered.map((skill) => ({
      sourcePath: skill.absPath,
      linkName: nameFlag && discovered.length === 1 ? nameFlag : skill.dirName,
      skillName: skill.dirName,
      label: skill.name,
    })),
    discovered,
  };
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

  const multipleSources = sourcePaths.length > 1;

  // --name is not supported with multiple explicit paths
  if (multipleSources && args.flags.name) {
    error(
      `--name cannot be used when linking multiple paths. ` +
        `Link each skill individually to use --name.`,
    );
    process.exit(2);
  }

  // Validate --name once, before touching any source: an unsafe name is a
  // usage error (exit 2), not a per-link failure, and must never surface as
  // an uncaught exception.
  let nameFlag: string | undefined;
  if (args.flags.name) {
    try {
      nameFlag = sanitizeName(args.flags.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.flags.json) {
        console.log(formatJSON({ success: false, error: msg }));
      }
      error(msg);
      process.exit(2);
    }
  }

  // ── Resolve the sources into link jobs ──
  const jobs: LinkJob[] = [];
  const sourceFailures: { source: string; error: string; missing: boolean }[] =
    [];
  let discoveredSkills: LinkableSkill[] = [];
  let discoveredRoot = "";

  for (const sourcePath of sourcePaths) {
    const result = await resolveSourceJobs(sourcePath, nameFlag);

    if (result.failure) {
      sourceFailures.push({ source: sourcePath, ...result.failure });
      continue;
    }

    // --name is not allowed when multiple skills are discovered
    if (args.flags.name && (result.discovered?.length ?? 0) > 1) {
      error(
        `--name cannot be used when linking multiple skills (found ${result.discovered!.length} skills). ` +
          `Link each skill individually to use --name.`,
      );
      process.exit(2);
    }

    if (result.discovered && result.discovered.length > 0) {
      discoveredSkills = result.discovered;
      discoveredRoot = sourcePath;
    }

    jobs.push(...result.jobs);
  }

  // A single unusable path aborts the command with a polished error.
  if (!multipleSources && sourceFailures.length > 0) {
    const failure = sourceFailures[0];
    const display = failure.missing
      ? `No such skill or path: ${failure.source}`
      : failure.error;
    if (args.flags.json) {
      // A single failed link keeps the compact {success:false,error} payload,
      // including failures detected before any target is resolved.
      console.log(formatJSON({ success: false, error: display }));
    }
    if (failure.missing) {
      error(display);
      if (isBareOrScopedName(failure.source)) {
        console.error(
          `  "${failure.source}" looks like a registry name, not a local path.`,
        );
        console.error(
          `  Install it first:  ${ansi.bold(`asm install ${failure.source}`)}`,
        );
        console.error(
          `  Or pass a local path:  ${ansi.bold(`asm link ./path/to/${failure.source}`)}`,
        );
      } else {
        console.error(
          `  Pass a local directory containing SKILL.md, or run "asm install <name>" first.`,
        );
      }
    } else {
      error(failure.error);
    }
    process.exit(1);
  }

  // Display discovered skills (single-source discovery mode)
  if (!multipleSources && discoveredSkills.length > 0) {
    console.error(
      `Found ${ansi.bold(String(discoveredSkills.length))} skill(s) in ${discoveredRoot}:`,
    );
    for (const skill of discoveredSkills) {
      console.error(
        `  ${ansi.bold(skill.name)} ${ansi.dim(`v${skill.version}`)} ${ansi.dim(`(${skill.dirName}/)`)}`,
      );
    }

    // Confirmation prompt in interactive mode
    if (process.stdin.isTTY && !args.flags.force && !args.flags.json) {
      process.stderr.write(
        `\n${ansi.bold(`Link ${discoveredSkills.length} skill(s)?`)} [Y/n] `,
      );
      const answer = await readLine();
      if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
        console.error("Aborted.");
        process.exit(0);
      }
    }
  }

  // ── Resolve provider and destination directories ──
  const config = await loadConfig();
  const { provider } = await resolveProvider(
    config,
    args.flags.provider,
    !!process.stdin.isTTY,
  );

  const scope = resolveLinkScope(args);
  const targets = resolveLinkTargets(provider, scope);

  // ── Create the links ──
  const linked: LinkedEntry[] = [];
  const failures: FailureEntry[] = [];

  for (const job of jobs) {
    for (const target of targets) {
      const { join: joinPath } = await import("path");
      const linkPath = joinPath(target.dir, job.linkName);
      try {
        await createLinkSafely(
          job.sourcePath,
          target.dir,
          job.linkName,
          !!args.flags.force,
        );
        linked.push({
          name: job.linkName,
          skill: job.skillName,
          provider: provider.name,
          scope: target.scope,
          path: linkPath,
          target: job.sourcePath,
        });
      } catch (err: unknown) {
        failures.push({
          name: job.linkName,
          source: job.label,
          scope: target.scope,
          path: linkPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Sources that never became jobs (multiple-path mode) are failures too.
  for (const failure of sourceFailures) {
    const display =
      failure.missing && isBareOrScopedName(failure.source)
        ? `${failure.error} — "${failure.source}" looks like a registry name; try "asm install ${failure.source}" first.`
        : failure.error;
    failures.push({
      source: failure.source,
      scope: null,
      error: display,
    });
  }

  // A single link keeps the compact activate-style payload; anything else
  // (several sources, several skills, or both scopes) reports every result.
  const bulk = multipleSources || jobs.length > 1 || scope === "both";

  if (args.flags.json) {
    if (bulk) {
      console.log(
        formatJSON({
          success: failures.length === 0,
          linked,
          failures,
        }),
      );
    } else if (failures.length === 0 && linked.length === 1) {
      console.log(formatJSON(linked[0]));
    } else {
      console.log(
        formatJSON({
          success: false,
          error: failures[0]?.error ?? "Failed to link skill.",
        }),
      );
    }
  } else {
    if (bulk) {
      for (const entry of linked) {
        console.error(
          ansi.green(
            `  Linked "${entry.name}" (${entry.provider}/${entry.scope}) -> ${entry.target}`,
          ),
        );
      }
      for (const failure of failures) {
        const scopeLabel = failure.scope
          ? ` (${provider.name}/${failure.scope})`
          : "";
        const label = failure.name ?? failure.source;
        console.error(
          ansi.red(
            `  Failed to link "${label}"${scopeLabel}: ${failure.error}`,
          ),
        );
      }
      if (failures.length > 0) {
        console.error(
          ansi.yellow(`\n${linked.length} linked, ${failures.length} failed.`),
        );
      } else {
        console.error(
          ansi.green(`\nDone! Linked ${linked.length} skill(s) successfully.`),
        );
      }
    } else if (linked.length === 1 && failures.length === 0) {
      const entry = linked[0];
      console.error(
        ansi.green(
          `Done! Linked "${entry.name}" (${entry.provider}/${entry.scope}) -> ${entry.target}`,
        ),
      );
      console.error(`  Symlink: ${entry.path}`);
      console.error(
        ansi.dim(
          `  If you move or delete the source, run "asm uninstall ${entry.name}" to clean up.`,
        ),
      );
    } else {
      error(failures[0]?.error ?? "Failed to link skill.");
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}
