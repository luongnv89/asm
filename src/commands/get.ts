import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import {
  parseFrontmatter,
  resolveSkillDependencies,
} from "../utils/frontmatter";
import { readFile as fsReadFile } from "fs/promises";
import {
  formatJSON,
  ansi,
  formatGetPath,
  formatGetProvenance,
} from "../formatter";
import { borrowGetSkill } from "../get-borrows";
import {
  parseSource,
  isLocalPath,
  isExistingLocalDir,
  assertNoParentSegments,
  validateSkill,
  discoverSkills,
  scanForWarnings,
  classifyWarningRisk,
} from "../installer";
import { isBareOrScopedName, resolveFromRegistry } from "../registry";
import { auditSkillSecurity, formatSecurityReport } from "../security-auditor";
import { looksLikeGithubInput } from "../evaluator";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";
import { resolveIndexedSkillByName } from "../skill-index";
import { estimateTokenCount } from "../utils/token-count";
import { findLibrarySkill, listLibrarySkills } from "../library";
import { join as joinPath } from "path";
import type { GetResult, GetSecurityVerdict, GetTier } from "../utils/types";
import { errorMessage } from "../utils/errors";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";
import { type GetResolution, AmbiguousGetError } from "./inspect";
import { fetchRemoteSkillDir } from "./eval";

function printGetHelp() {
  console.log(`${ansi.bold("Usage:")} asm get <skill> [options]

Resolve a skill and write its SKILL.md body to stdout. Nothing is installed:
no provider directory, no library entry, no residency in any system prompt.
Use it to pull a skill in for a single task and pay nothing afterwards.

<skill> is resolved in this order, and the rung that answered is reported:
  1. installed        a skill already present in one of your agents
  2. library          a library skill, including deactivated ones
  3. index            an indexed catalog skill (resolved by exact name)
  4. registry         the ASM registry, same route as \`asm install <name>\`
An explicit \`github:owner/repo[#ref][:path]\` shorthand, a GitHub URL, or a
local path skips the ladder and is fetched directly.

Index, registry and remote sources are fetched into a temp clone, scanned with
the same pre-install security scan \`asm install\` runs, and deleted. The body
goes to stdout; provenance and the security verdict go to stderr.

With --path, copy the full selected directory (scripts, templates, assets, etc.)
into an ASM-owned borrow and print its absolute path instead. The copy survives
process exit. Later run asm cleanup <borrowed-path>; originals are never removed.
No --keep is needed. Use asm install for permanent provider/library installation.

${ansi.bold("Options:")}
  --path             Borrow the full skill directory, not just its body
  --json             Output {name, description, tier, source, commit,
                     tokenCount, security, content} as a JSON object;
                     --path returns path, sorted files and cleanup argv instead of content
  --machine          Stable machine-readable v1 envelope
  --audit            Also print the full security audit report (stderr),
                     for any resolved skill, not only fetched ones
  -s, --scope <s>    Filter installed lookup: global, project, or both
  --transport <t>    Clone transport for remote sources: auto, https, ssh
  --no-cache         Bypass the registry cache when resolving a name
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm get code-review                      ${ansi.dim("Print the body to stdout")}
  asm get code-review > SKILL.md           ${ansi.dim("Save it without installing")}
  asm get github:owner/repo:skills/review  ${ansi.dim("Fetch a remote skill")}
  asm get owner/review --audit             ${ansi.dim("Show the full security audit")}
  asm get code-review --json               ${ansi.dim("Structured output")}
  asm get --path code-review               ${ansi.dim("Borrow the full directory")}
  asm cleanup /absolute/borrowed-path     ${ansi.dim("Remove only that borrow")}`);
}

/**
 * Validate a cloned directory as a single skill, turning the "this repo is a
 * collection" case into an actionable list of subpaths instead of a bare
 * "SKILL.md not found".
 */

async function validateSkillForGet(
  rootDir: string,
  hintBase: string,
): Promise<{ name: string; description: string }> {
  try {
    const { name, description } = await validateSkill(rootDir);
    return { name, description };
  } catch (err) {
    const nested = (await discoverSkills(rootDir)).filter((s) => s.relPath);
    if (nested.length > 0) {
      const shown = nested.slice(0, 5);
      throw new Error(
        `"${hintBase}" holds ${nested.length} skills, not one. Pick a skill:\n` +
          shown.map((s) => `    asm get ${hintBase}:${s.relPath}`).join("\n"),
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Clone a remote source into a temp dir, read its body, and run the same
 * pre-install security scan `asm install` runs. The verdict is *reported*, not
 * enforced — neither body output nor a borrowed copy installs the skill. The
 * caller sees the risk before using the text or files; no skill code is run.
 */

async function fetchGetFromRemote(
  args: ParsedArgs,
  sourceInput: string,
  tier: GetTier,
): Promise<GetResolution> {
  // Refuse an escaping subpath before announcing a fetch, so the failure costs
  // no network round-trip and stdout/stderr stay clean.
  assertNoParentSegments(parseSource(sourceInput), sourceInput);

  process.stderr.write(ansi.dim(`Fetching ${sourceInput}…\n`));
  const remote = await fetchRemoteSkillDir(
    sourceInput,
    args.flags.transport,
    false,
  );
  try {
    const parsed = parseSource(sourceInput);
    // Keep any explicit ref in the hint — dropping it would suggest commands
    // that silently resolve against the default branch instead.
    const hintBase = `github:${parsed.owner}/${parsed.repo}${
      parsed.ref ? `#${parsed.ref}` : ""
    }`;
    const { name, description } = await validateSkillForGet(
      remote.rootDir,
      hintBase,
    );
    const content = await fsReadFile(
      joinPath(remote.rootDir, "SKILL.md"),
      "utf-8",
    );
    const dependencies = resolveSkillDependencies(parseFrontmatter(content));

    const warnings = await scanForWarnings(remote.rootDir);
    const security: GetSecurityVerdict = {
      risk: classifyWarningRisk(warnings),
      warnings: warnings.length,
      categories: Array.from(new Set(warnings.map((w) => w.category))).sort(),
    };

    return {
      result: {
        name,
        description,
        dependencies,
        tier,
        source: remote.sourceRef,
        commit: remote.commitSha,
        tokenCount: estimateTokenCount(content),
        security,
        content,
      },
      cleanup: remote.cleanup,
      dir: remote.rootDir,
      owner: parsed.owner,
      repo: parsed.repo,
    };
  } catch (err) {
    await remote.cleanup();
    throw err;
  }
}

/** Build a `GetResult` from a SKILL.md that already sits on this machine. */

function localGetResult(
  content: string,
  tier: GetTier,
  source: string,
  overrides: {
    name?: string;
    description?: string;
    commit?: string | null;
    tokenCount?: number;
  } = {},
): GetResult {
  const fm = parseFrontmatter(content);
  return {
    name: overrides.name || fm.name || source.split(/[/\\]/).pop() || source,
    description:
      overrides.description ??
      (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
    dependencies: resolveSkillDependencies(fm),
    tier,
    source,
    commit: overrides.commit ?? null,
    tokenCount: overrides.tokenCount ?? estimateTokenCount(content),
    security: null,
    content,
  };
}

/**
 * The resolution ladder: explicit sources short-circuit, bare names walk
 * installed → library → index → registry. Cheapest and most local wins, and
 * whichever rung answered is reported as the `tier` so provenance is visible.
 */

export async function resolveGetTarget(
  args: ParsedArgs,
  target: string,
): Promise<GetResolution> {
  // Explicit GitHub shorthand / URL — straight to the remote rung.
  if (looksLikeGithubInput(target)) {
    return fetchGetFromRemote(args, target, "remote");
  }

  // Explicit local path (or a path-shaped input that exists on disk).
  if (isLocalPath(target) || (await isExistingLocalDir(target))) {
    const localPath = parseSource(
      isLocalPath(target) ? target : `./${target}`,
    ).localPath!;
    let content: string;
    try {
      content = await fsReadFile(joinPath(localPath, "SKILL.md"), "utf-8");
    } catch {
      throw new Error(`No SKILL.md found in "${localPath}".`);
    }
    return {
      result: localGetResult(content, "local", localPath),
      cleanup: null,
      dir: localPath,
    };
  }

  // Rung 1 — installed skills. The scanner already retained the body, so a
  // hit here costs no IO at all.
  const config = await loadConfig();
  const installed = await scanAllSkills(config, args.flags.scope);
  const match =
    installed.find((s) => s.dirName === target) ??
    installed.find((s) => s.name === target);
  if (match) {
    const content =
      match._skillMdContent !== undefined
        ? match._skillMdContent
        : await fsReadFile(joinPath(match.path, "SKILL.md"), "utf-8");
    return {
      result: localGetResult(content, "installed", match.path, {
        name: match.name,
        description: match.description,
        tokenCount: match.tokenCount,
      }),
      cleanup: null,
      dir: match.path,
    };
  }

  // Rung 2 — the local library. Deactivated library skills are invisible to
  // the scanner, and they are exactly the population `asm audit residency`
  // points at the reference tier.
  const libMatch = findLibrarySkill(await listLibrarySkills(), target);
  if (libMatch && !libMatch.missing) {
    const content = await fsReadFile(
      joinPath(libMatch.libraryPath, "SKILL.md"),
      "utf-8",
    );
    return {
      result: localGetResult(content, "library", libMatch.libraryPath, {
        name: libMatch.name,
        commit: libMatch.commitHash || null,
      }),
      cleanup: null,
      dir: libMatch.libraryPath,
    };
  }

  // Rung 3 — the indexed catalog. `IndexedSkill` carries no body, so a hit
  // here necessarily degrades into a temp clone.
  const indexed = await resolveIndexedSkillByName(target);
  if (indexed.status === "ambiguous") {
    throw new AmbiguousGetError(
      `"${target}" matches ${indexed.matches.length} indexed skills.`,
      indexed.matches.map(
        (m) => `${m.repo.owner}/${m.repo.repo} — asm get ${m.skill.installUrl}`,
      ),
    );
  }
  if (indexed.status === "found") {
    return fetchGetFromRemote(args, indexed.match.skill.installUrl, "index");
  }

  // Rung 4 — the ASM registry, the same route `asm install <name>` takes.
  if (isBareOrScopedName(target)) {
    const { resolved, multipleMatches, suggestions } =
      await resolveFromRegistry(target, { noCache: args.flags.noCache });
    if (resolved) {
      const m = resolved.manifest;
      const repoPath = m.repository.replace("https://github.com/", "");
      const ref = m.skill_path
        ? `github:${repoPath}#${m.commit}:${m.skill_path}`
        : `github:${repoPath}#${m.commit}`;
      return fetchGetFromRemote(args, ref, "registry");
    }
    if (multipleMatches.length > 0) {
      throw new AmbiguousGetError(
        `"${target}" is published by ${multipleMatches.length} authors.`,
        multipleMatches
          .slice(0, 5)
          .map((m) => `${m.author}/${m.name} — asm get ${m.author}/${m.name}`),
      );
    }
    if (suggestions.length > 0) {
      throw new Error(
        `Skill "${target}" not found. Did you mean: ${suggestions.join(", ")}?`,
      );
    }
  }

  throw new Error(
    `Skill "${target}" not found installed, in the library, in the index, or in the registry.`,
  );
}

export async function cmdGet(args: ParsedArgs) {
  if (args.flags.help) {
    printGetHelp();
    return;
  }

  const startTime = performance.now();
  const target = args.subcommand;
  if (!target) {
    error("Missing required argument: <skill>");
    console.error(`Run "asm get --help" for usage.`);
    process.exit(2);
  }

  // stdout carries the body (or the JSON object) and nothing else. Redirecting
  // console output up front means no dependency can leak a line into a piped
  // body.
  const restoreConsole = redirectConsoleToStderr();
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const resolution = await resolveGetTarget(args, target);
    cleanup = resolution.cleanup;
    const result = resolution.result;

    // `--audit` applies to whatever was resolved: a temp clone is still on disk
    // at this point, and installed/library/local tiers have a real directory
    // too, so the flag never silently does nothing.
    if (args.flags.audit) {
      const report = await auditSkillSecurity(
        resolution.dir,
        result.name,
        resolution.owner,
        resolution.repo,
      );
      process.stderr.write(formatSecurityReport(report) + "\n");
    }

    const output = args.flags.getPath
      ? await borrowGetSkill(target, resolution.dir, result)
      : result;
    if (args.flags.machine) {
      process.stdout.write(
        formatMachineOutput("get", output, startTime) + "\n",
      );
    } else if (args.flags.json) {
      process.stdout.write(formatJSON(output) + "\n");
    } else if ("path" in output) {
      process.stderr.write(formatGetProvenance(output));
      process.stdout.write(formatGetPath(output));
    } else {
      process.stderr.write(formatGetProvenance(result));
      process.stdout.write(result.content);
      if (!result.content.endsWith("\n")) process.stdout.write("\n");
    }
  } catch (err) {
    const message = errorMessage(err) || String(err);
    const candidates =
      err instanceof AmbiguousGetError ? err.candidates : undefined;
    if (args.flags.machine) {
      process.stdout.write(
        formatMachineError(
          "get",
          candidates ? ErrorCodes.INVALID_ARGUMENT : ErrorCodes.SKILL_NOT_FOUND,
          message,
          startTime,
          candidates ? { candidates } : undefined,
        ) + "\n",
      );
    } else {
      error(message);
      if (candidates) {
        for (const c of candidates) {
          process.stderr.write(`    ${ansi.cyan("•")} ${c}\n`);
        }
      } else {
        process.stderr.write(
          ansi.dim(
            `Try ${ansi.bold("asm list")} or ${ansi.bold(`asm search "${target}"`)}.\n`,
          ),
        );
      }
    }
    // `process.exitCode` rather than `process.exit()`: under `--machine` the
    // error envelope has just been written to stdout, and an immediate exit can
    // truncate a pipe before it flushes. The `finally` below still cleans up.
    process.exitCode = 1;
  } finally {
    if (cleanup) await cleanup();
    restoreConsole();
  }
}
