import { loadConfig, resolveProviderPath } from "../config";
import { scanAllSkills } from "../scanner";
import {
  parseFrontmatter,
  resolveModelInvocable,
  resolveTags,
  resolveUserInvocable,
} from "../utils/frontmatter";
import {
  loadSkillState,
  saveSkillState,
  setDisabled,
  clearDisabled,
  matchSkills,
  disableSkillInstance,
  enableSkillInstance,
  disabledFilePath,
} from "../skill-state";
import { readFile as fsReadFile, realpath as fsRealpath } from "fs/promises";
import { existsSync } from "fs";
import { ansi } from "../formatter";
import type { SkillInfo } from "../utils/types";
import { join as joinPath } from "path";
import type { Scope, AppConfig, SkillStateFile } from "../utils/types";

import { error, readLine, groupBySource } from "./shared";
import type { ParsedArgs } from "../cli";

function printDisableHelp() {
  console.log(`${ansi.bold("Usage:")} asm disable <target> [options]
        asm disable --all [options]

Disable skills without uninstalling them. Disabling renames a skill's
${ansi.dim("SKILL.md")} to ${ansi.dim("SKILL.md.disabled")} so neither asm nor your agent sees it.
The directory stays intact; ${ansi.bold("asm enable")} reverses it.

${ansi.dim("Note: skills installed to several tools at once share one SKILL.md")}
${ansi.dim("(siblings are symlinks), so disabling one affects all of them — asm warns")}
${ansi.dim("and records every sibling. Separately-installed copies stay independent.")}

${ansi.bold("Targets:")}
  <name>               Exact skill name or directory name
  '<glob>*'            Glob match (${ansi.dim("* matches any characters")})
  <prefix>: | <prefix>-  Prefix match (e.g. ${ansi.dim("openspec:")}, ${ansi.dim("asc-")})

${ansi.bold("Options:")}
  --all, -a            Disable every matching skill
  -p, --tool <name>    Limit to one tool/provider (e.g. claude, codex)
  -s, --scope <s>      Filter: global, local, project, or both (default: both)
  -y, --yes            Skip confirmation prompt
  --json               Output result as JSON
  --machine            Tab-separated output
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm disable code-review              ${ansi.dim("# one skill")}
  asm disable 'workflow*'             ${ansi.dim("# glob")}
  asm disable '*-review'             ${ansi.dim("# glob suffix")}
  asm disable openspec:             ${ansi.dim("# prefix (colon)")}
  asm disable asc-                 ${ansi.dim("# prefix (hyphen)")}
  asm disable --all                ${ansi.dim("# everything")}
  asm disable code-review --tool claude --scope local`);
}

function printEnableHelp() {
  console.log(`${ansi.bold("Usage:")} asm enable <target> [options]
        asm enable --all [options]

Re-enable skills previously disabled with ${ansi.bold("asm disable")}. Enabling renames
${ansi.dim("SKILL.md.disabled")} back to ${ansi.dim("SKILL.md")} so asm and your agent see it again.

${ansi.dim("Note: a skill shared across tools via symlinks re-enables for every tool")}
${ansi.dim("at once (one shared SKILL.md); asm warns and clears state for all siblings.")}

${ansi.bold("Targets:")}
  <name>               Exact skill name or directory name
  '<glob>*'            Glob match (${ansi.dim("* matches any characters")})
  <prefix>: | <prefix>-  Prefix match (e.g. ${ansi.dim("openspec:")}, ${ansi.dim("asc-")})

${ansi.bold("Options:")}
  --all, -a            Enable every matching disabled skill
  -p, --tool <name>    Limit to one tool/provider (e.g. claude, codex)
  -s, --scope <s>      Filter: global, local, project, or both (default: both)
  -y, --yes            Skip confirmation prompt
  --json               Output result as JSON
  --machine            Tab-separated output
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm enable code-review
  asm enable '*-review'
  asm enable openspec:
  asm enable --all`);
}

/**
 * Reconstruct SkillInfo rows for skills recorded as disabled in the state
 * file. The scanner cannot see these (their SKILL.md was renamed), so we
 * resolve each instance's directory from config + scope and read its
 * SKILL.md.disabled for metadata. Only instances whose disabled marker
 * actually exists on disk are returned. Honors the same scope/provider filters
 * as the scanner.
 */

export async function reconstructDisabledSkills(
  config: AppConfig,
  state: SkillStateFile,
  scopeFilter: Scope,
  providerFilter?: string | null,
  /**
   * Keys (`dirName||provider||scope`) of skills the scanner already returned
   * as ACTIVE. Used to suppress a reconstructed "disabled" row when disk and
   * state disagree (e.g. a re-enabled skill still listed in state, or a
   * directory that has both SKILL.md and SKILL.md.disabled). The active
   * instance always wins, so the skill is never listed twice.
   */
  activeKeys?: Set<string>,
): Promise<SkillInfo[]> {
  const providersByName = new Map(config.providers.map((p) => [p.name, p]));
  const results: SkillInfo[] = [];

  for (const [dirName, byProvider] of Object.entries(state.disabled)) {
    for (const [providerName, byScope] of Object.entries(byProvider)) {
      if (providerFilter && providerName !== providerFilter) continue;
      const provider = providersByName.get(providerName);
      if (!provider) continue;

      for (const scope of ["global", "project"] as const) {
        if (!byScope[scope]) continue;
        if (scopeFilter === "global" && scope !== "global") continue;
        if (scopeFilter === "project" && scope !== "project") continue;

        // Skip if an active instance for this (dirName, provider, scope)
        // already exists — never double-list on disk/state drift.
        if (activeKeys?.has(`${dirName}||${providerName}||${scope}`)) continue;

        const template =
          scope === "global" ? provider.global : provider.project;
        if (!template) continue;
        const dir = resolveProviderPath(template);
        const skillDir = joinPath(dir, dirName);
        const marker = disabledFilePath(skillDir);
        if (!existsSync(marker)) continue;

        let fm: Record<string, string> = {};
        try {
          fm = parseFrontmatter(await fsReadFile(marker, "utf-8"));
        } catch {
          // Best effort — fall back to dirName below.
        }
        // Resolve the canonical source so symlinked siblings (which share one
        // disabled SKILL.md.disabled) collapse onto the same realPath — enabling
        // then renames once and clears state for every sibling (issue #91).
        let realPath = skillDir;
        try {
          realPath = await fsRealpath(skillDir);
        } catch {
          // Directory unresolvable — keep skillDir; it still groups alone.
        }
        results.push({
          name: fm.name || dirName,
          version: fm["metadata.version"] || fm.version || "0.0.0",
          description: (fm.description || "").replace(/\s*\n\s*/g, " ").trim(),
          creator: fm["metadata.creator"] || "",
          license: (fm.license || "").trim(),
          compatibility: (fm.compatibility || "").trim(),
          allowedTools: [],
          tags: resolveTags(fm),
          modelInvocable: resolveModelInvocable(fm),
          userInvocable: resolveUserInvocable(fm),
          dirName,
          path: skillDir,
          originalPath: skillDir,
          location: `${scope}-${providerName}`,
          scope,
          provider: providerName,
          providerLabel: provider.label,
          isSymlink: false,
          symlinkTarget: null,
          realPath,
          disabled: true,
        });
      }
    }
  }

  return results;
}

interface ToggleResult {
  name: string;
  provider: string;
  scope: "global" | "project";
  action: "disabled" | "enabled";
}

/** Print a JSON or tab-separated machine summary of toggled instances. */

function emitToggleOutput(args: ParsedArgs, done: ToggleResult[]): void {
  if (args.flags.json) {
    console.log(JSON.stringify(done, null, 2));
  } else if (args.flags.machine) {
    for (const d of done) {
      console.log([d.name, d.provider, d.scope, d.action].join("\t"));
    }
  }
}

/**
 * A canonical skill source plus every provider instance that shares it.
 *
 * `asm install` copies a skill into one primary provider and symlinks the rest
 * at that copy, so symlinked siblings resolve to a single `realPath` and share
 * one `SKILL.md`. Disabling/enabling renames that one file (honest shared
 * semantics — issue #91): the toggle takes effect for every sibling at once, so
 * we record state for and report all of them, not just the matched instance.
 */
/**
 * Groups `matched` instances by their canonical source, expanding each group to
 * include all sibling instances from `pool` that share the same `realPath`.
 *
 * `matched` is what the user's target/filter selected; `pool` is the full
 * (unfiltered) candidate set used to discover siblings the filter excluded —
 * e.g. `disable --tool codex` on a symlinked skill must still record state for
 * the claude sibling, because the shared `SKILL.md` is renamed for both.
 */

export async function cmdDisable(args: ParsedArgs) {
  if (args.flags.help) {
    printDisableHelp();
    return;
  }

  const target = args.subcommand;
  if (!target && !args.flags.all) {
    error("Missing target. Provide a skill name/pattern or use --all.");
    process.exitCode = 2;
    return;
  }
  if (target && args.flags.all) {
    error("Provide either a target or --all, not both.");
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig();
  const providerFilter = args.flags.provider;

  // Disable operates on currently-active (scanned) skills. Scan the FULL set
  // first (provider filter applied only when matching) so we can discover
  // symlinked siblings the filter excludes — disabling renames the shared
  // SKILL.md for all of them, so state/reporting must cover them too.
  const scanned = (await scanAllSkills(config, args.flags.scope)).filter(
    // Only real provider instances can be toggled (skip plugin/marketplace
    // pseudo-skills that have no writable SKILL.md we manage).
    (s) => s.provider !== "plugin" && s.provider !== "codex-plugin",
  );
  const candidates = providerFilter
    ? scanned.filter((s) => s.provider === providerFilter)
    : scanned;

  const matched = args.flags.all
    ? candidates
    : matchSkills(candidates, target!);

  if (matched.length === 0) {
    const label = target ? ` for '${target}'` : "";
    console.log(ansi.dim(`No matching active skills${label}.`));
    return;
  }

  // Collapse matched instances onto their shared on-disk sources. A symlinked
  // skill resolves to one canonical SKILL.md, so each group is disabled once
  // and recorded for every sibling provider/scope (honest shared semantics).
  const groups = groupBySource(matched, scanned);
  const matchedKeys = new Set(
    matched.map((s) => `${s.realPath}||${s.provider}||${s.scope}`),
  );

  if (!args.flags.json && !args.flags.machine) {
    const total = groups.reduce((n, g) => n + g.siblings.length, 0);
    console.log(ansi.bold(`Will disable ${total} skill instance(s):`));
    for (const g of groups) {
      for (const s of g.siblings) {
        const extra = matchedKeys.has(
          `${s.realPath}||${s.provider}||${s.scope}`,
        )
          ? ""
          : ansi.yellow(" (shared via symlink)");
        console.log(
          `  ${ansi.dim("•")} ${s.name} (${s.provider}, ${s.scope})${extra}`,
        );
      }
      if (g.siblings.length > 1) {
        console.log(
          ansi.yellow(
            `    ⚠ ${g.representative.name} shares one SKILL.md across ` +
              `${g.siblings.length} tools — disabling affects all of them.`,
          ),
        );
      }
    }
    if (!args.flags.yes && process.stdin.isTTY) {
      process.stdout.write(`\n${ansi.bold("Proceed?")} [y/N] `);
      const answer = await readLine();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Aborted.");
        return;
      }
    }
  }

  const state = await loadSkillState();
  const done: ToggleResult[] = [];
  try {
    for (const g of groups) {
      // One rename on the shared canonical source disables every sibling.
      await disableSkillInstance(g.representative.path);
      for (const s of g.siblings) {
        setDisabled(state, s.dirName, s.provider, s.scope);
        done.push({
          name: s.name,
          provider: s.provider,
          scope: s.scope,
          action: "disabled",
        });
        if (!args.flags.json && !args.flags.machine) {
          console.log(
            `${ansi.green("✓")} disabled ${s.name} (${s.provider}, ${s.scope})`,
          );
        }
      }
    }
  } finally {
    await saveSkillState(state);
  }

  emitToggleOutput(args, done);
}

export async function cmdEnable(args: ParsedArgs) {
  if (args.flags.help) {
    printEnableHelp();
    return;
  }

  const target = args.subcommand;
  if (!target && !args.flags.all) {
    error("Missing target. Provide a skill name/pattern or use --all.");
    process.exitCode = 2;
    return;
  }
  if (target && args.flags.all) {
    error("Provide either a target or --all, not both.");
    process.exitCode = 2;
    return;
  }

  const config = await loadConfig();
  const providerFilter = args.flags.provider;

  // Enable operates on currently-DISABLED skills, which the scanner can't see;
  // reconstruct them from the state file. Reconstruct the FULL disabled set
  // (no provider filter) so symlinked siblings the filter excludes are still
  // discovered — enabling renames the shared SKILL.md.disabled for all of them,
  // so state must be cleared for every sibling too (honest shared semantics).
  const state = await loadSkillState();
  const disabledPool = await reconstructDisabledSkills(
    config,
    state,
    args.flags.scope,
  );
  const candidates = providerFilter
    ? disabledPool.filter((s) => s.provider === providerFilter)
    : disabledPool;

  const matched = args.flags.all
    ? candidates
    : matchSkills(candidates, target!);

  if (matched.length === 0) {
    const label = target ? ` for '${target}'` : "";
    console.log(ansi.dim(`No matching disabled skills${label}.`));
    return;
  }

  // Collapse onto shared sources like cmdDisable: one rename per canonical
  // SKILL.md.disabled re-enables every sibling, so clear state for all of them.
  const groups = groupBySource(matched, disabledPool);
  const matchedKeys = new Set(
    matched.map((s) => `${s.realPath}||${s.provider}||${s.scope}`),
  );

  if (!args.flags.json && !args.flags.machine) {
    const total = groups.reduce((n, g) => n + g.siblings.length, 0);
    console.log(ansi.bold(`Will enable ${total} skill instance(s):`));
    for (const g of groups) {
      for (const s of g.siblings) {
        const extra = matchedKeys.has(
          `${s.realPath}||${s.provider}||${s.scope}`,
        )
          ? ""
          : ansi.yellow(" (shared via symlink)");
        console.log(
          `  ${ansi.dim("•")} ${s.name} (${s.provider}, ${s.scope})${extra}`,
        );
      }
      if (g.siblings.length > 1) {
        console.log(
          ansi.yellow(
            `    ⚠ ${g.representative.name} shares one SKILL.md across ` +
              `${g.siblings.length} tools — enabling affects all of them.`,
          ),
        );
      }
    }
    if (!args.flags.yes && process.stdin.isTTY) {
      process.stdout.write(`\n${ansi.bold("Proceed?")} [y/N] `);
      const answer = await readLine();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Aborted.");
        return;
      }
    }
  }

  const done: ToggleResult[] = [];
  try {
    for (const g of groups) {
      await enableSkillInstance(g.representative.path);
      for (const s of g.siblings) {
        clearDisabled(state, s.dirName, s.provider, s.scope);
        done.push({
          name: s.name,
          provider: s.provider,
          scope: s.scope,
          action: "enabled",
        });
        if (!args.flags.json && !args.flags.machine) {
          console.log(
            `${ansi.green("✓")} enabled ${s.name} (${s.provider}, ${s.scope})`,
          );
        }
      }
    }
  } finally {
    await saveSkillState(state);
  }

  emitToggleOutput(args, done);
}
