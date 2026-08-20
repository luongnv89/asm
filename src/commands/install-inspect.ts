/**
 * `asm install` helpers — help text, single-skill inspection, inspection
 * display, and the single-install / library-install executors.
 * Split from commands/install.ts (issue #455).
 */

import { loadConfig } from "../config";
import { ansi, colorEffort } from "../formatter";
import {
  parseSource,
  sanitizeName,
  validateSkill,
  scanForWarnings,
  classifyWarningRisk,
  executeInstall,
  executeInstallAllProviders,
  buildInstallPlan,
  checkCrossToolLink,
  type CrossToolLinkInfo,
} from "../installer";
import type { InstallResult, ProviderConfig, SkillInfo } from "../utils/types";
import type { ResolutionSource } from "../registry";
import { installLibrarySkill } from "../library";
import { relative as relativePath } from "path";
import { toPortableRelativePath } from "../utils/fs";

import type { ParsedArgs } from "../cli";

export function printInstallHelp() {
  console.log(`${ansi.bold("Usage:")} asm install <source> [options]

Install a skill from a GitHub repository, the curated registry, or a local path.

${ansi.bold("Cross-tool linking (issue #322):")}
  If the skill is already installed in another tool, ASM offers two options:
    1. Reinstall — download fresh from the index (gets latest version)
    2. Link — symlink from the existing install (no download, shares files)
  Skills installed from a local folder always reinstall (link does not apply).

${ansi.bold("Source Format:")}
  code-review                    Install by name from the curated registry
  author/code-review             Install a scoped name (author/name) from registry
  github:owner/repo              Install from default branch
  github:owner/repo#ref          Install from specific branch or tag
  github:owner/repo#ref:path     Install from a subfolder on a specific branch
  https://github.com/owner/repo  Install via HTTPS URL
  https://github.com/owner/repo/tree/branch/path/to/skill
                                 Install from a subfolder URL (auto-detects branch)
  /absolute/path/to/skill        Install from a local folder (absolute path)
  ./relative/path/to/skill       Install from a local folder (relative path)
  ~/path/to/skill                Install from a local folder (home-relative path)

${ansi.bold("Options:")}
  -p, --tool <name>      Target tool (claude, codex, openclaw, agents, all)
                         Use "all" to install to all tools (shared + symlinks)
  -s, --scope <scope>    Installation scope: global or project (default: prompt)
                         global installs to ~/.claude/skills/ (available everywhere)
                         project installs to .claude/skills/ (this project only)
  --name <name>          Override skill directory name
  --path <subdir>        Install skill from a subdirectory of the repo
  --skill <name>         Alias for --path (Vercel skills CLI compatibility)
  --all                  Install all skills found in the repo
  --library              Install into asm's neutral local library
  -m, --method <method>  Install method: default or vercel (default: default)
                         vercel delegates to npx skills add for tracking
  -t, --transport <mode> Transport: https, ssh, or auto (default: auto)
                         auto tries HTTPS first, falls back to SSH on auth error
  --no-cache             Force fresh registry fetch (bypass 1-hour TTL cache)
  -f, --force            Overwrite if skill already exists
  -y, --yes              Skip confirmation prompt
  --json                 Output result as JSON
  --machine              Machine-readable output (includes resolution source)
  --no-color             Disable ANSI colors
  -V, --verbose          Show debug output

${ansi.bold("Registry (bare name):")}
  asm install code-review                  ${ansi.dim("(resolve from registry)")}
  asm install luongnv89/code-review        ${ansi.dim("(scoped name, no ambiguity)")}
  asm install code-review --no-cache       ${ansi.dim("(force fresh registry fetch)")}

${ansi.bold("Local folder:")}
  asm install ./my-skill                   ${ansi.dim("(relative path)")}
  asm install /home/user/skills/my-skill   ${ansi.dim("(absolute path)")}
  asm install ~/skills/my-skill            ${ansi.dim("(home-relative path)")}
  asm install ../other-project/skill       ${ansi.dim("(parent-relative path)")}
  asm install ./skills-dir --all           ${ansi.dim("(all skills in directory)")}
  asm install ./skills-dir --library --all -y ${ansi.dim("(install to local library)")}

${ansi.bold("Single-skill repo:")}
  asm install github:user/my-skill
  asm install github:user/my-skill#v1.0.0 -p claude
  asm install https://github.com/user/my-skill
  asm install github:user/my-skill -p all    ${ansi.dim("(install to all tools)")}
  asm install github:user/private-skill -t ssh  ${ansi.dim("(clone via SSH)")}

${ansi.bold("Multi-skill repo:")}
  asm install github:user/skills --path skills/code-review
  asm install github:user/skills --all -p claude -y
  asm install github:user/skills --all -p all -y  ${ansi.dim("(all skills, all tools)")}
  asm install https://github.com/user/skills --all
  asm install github:user/skills              ${ansi.dim("(interactive picker)")}

${ansi.bold("Subfolder URL:")}
  asm install https://github.com/user/skills/tree/main/skills/agent-config
  asm install github:user/skills#main:skills/agent-config

${ansi.bold("Vercel skills CLI:")}
  asm install github:user/skills --method vercel --skill my-skill
  asm install https://github.com/user/skills -m vercel --skill my-skill -y
  ${ansi.dim("Delegates to npx skills add for Vercel tracking, then registers in asm")}`);
}

// ─── Install: inspect a single skill (returns metadata for review) ──────────

export interface SkillInspection {
  metadata: {
    name: string;
    version: string;
    description: string;
    effort?: string;
  };
  skillName: string;
  warnings: Awaited<ReturnType<typeof scanForWarnings>>;
  installStatus: string;
  riskLevel: "high" | "medium" | "safe";
  riskLabel: string;
  plan: ReturnType<typeof buildInstallPlan>;
  /** When set, the skill exists in another tool — user can Link instead of reinstall. */
  crossToolLink?: CrossToolLinkInfo | null;
}

export async function inspectSkillForInstall(
  args: ParsedArgs,
  source: ReturnType<typeof parseSource>,
  tempDir: string,
  skillDir: string,
  skillNameOverride: string | null,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: ProviderConfig,
  existingSkills: SkillInfo[],
  scope: "global" | "project" = "global",
): Promise<SkillInspection> {
  const metadata = await validateSkill(skillDir);
  const warnings = await scanForWarnings(skillDir);

  const dirName = skillDir === tempDir ? null : skillDir.split(/[/\\]/).pop();
  const rawName = skillNameOverride || dirName || source.repo;
  const skillName = sanitizeName(rawName);

  // Check NEW vs UPDATE status
  const existingMatch = existingSkills.find(
    (s) =>
      s.name.toLowerCase() === metadata.name.toLowerCase() &&
      s.provider === provider.name,
  );
  let installStatus: string;
  let crossToolLink: CrossToolLinkInfo | null = null;
  const alreadyExists = !!existingMatch;
  if (existingMatch) {
    if (existingMatch.version === metadata.version) {
      installStatus = args.flags.force
        ? "REINSTALL"
        : `UPDATE: ${existingMatch.version} (same version)`;
    } else {
      installStatus = `UPDATE: ${existingMatch.version} → ${metadata.version}`;
    }
  } else {
    // Skill not installed in target provider — check if it exists in another tool
    crossToolLink = await checkCrossToolLink(skillName, provider.name, config);
    if (crossToolLink) {
      installStatus = "LINK_AVAILABLE";
    } else {
      installStatus = "NEW";
    }
  }

  // If skill already exists, force overwrite (user will confirm at the end)
  const plan = buildInstallPlan(
    source,
    tempDir,
    skillDir,
    skillName,
    provider,
    args.flags.force || alreadyExists,
    scope,
  );

  const riskLevel = classifyWarningRisk(warnings);
  const riskLabel =
    riskLevel === "high"
      ? ansi.red("[!] High Risk")
      : riskLevel === "medium"
        ? ansi.yellow("[~] Medium Risk")
        : ansi.green("[ok] Safe");

  return {
    metadata,
    skillName,
    warnings,
    installStatus,
    riskLevel,
    riskLabel,
    plan,
    crossToolLink: crossToolLink ?? null,
  };
}

// ─── Install: display inspection details ────────────────────────────────────

export function displaySkillInspection(
  inspection: SkillInspection,
  sourceStr: string,
  provider: ProviderConfig,
  allProviders: ProviderConfig[] | null,
  isBatch: boolean,
  batchContext?: { index: number; total: number },
) {
  const { metadata, warnings, installStatus, riskLabel, plan, crossToolLink } =
    inspection;

  if (isBatch && batchContext) {
    const progress = ansi.dim(`[${batchContext.index}/${batchContext.total}]`);
    const statusColor =
      installStatus === "NEW"
        ? ansi.green(`[${installStatus}]`)
        : ansi.yellow(`[${installStatus}]`);
    console.info(
      `${progress} ${ansi.bold(metadata.name)} v${metadata.version} ${statusColor} ${riskLabel}`,
    );
  } else {
    const statusColor =
      installStatus === "NEW"
        ? ansi.green(`[${installStatus}]`)
        : ansi.yellow(`[${installStatus}]`);
    console.info(
      `  ${ansi.bold(metadata.name)} v${metadata.version} ${statusColor}`,
    );

    // Show cross-tool link hint
    if (installStatus === "LINK_AVAILABLE" && crossToolLink) {
      console.info(
        `    ${ansi.dim(`Already installed in ${crossToolLink.existingProviderLabel}. `)}${ansi.cyan(`Run with --tool ${provider.name} to link, or reinstall for a fresh copy.`)}`,
      );
    }

    console.info(`\n  ${ansi.bold("Install preview:")}`);
    console.info(`    ${ansi.bold("Name:")}        ${metadata.name}`);
    console.info(`    ${ansi.bold("Version:")}     ${metadata.version}`);
    if (metadata.description) {
      console.info(
        `    ${ansi.bold("Description:")} ${ansi.dim(metadata.description)}`,
      );
    }
    if (metadata.effort) {
      console.info(
        `    ${ansi.bold("Effort:")}      ${colorEffort(metadata.effort)}`,
      );
    }
    console.info(`    ${ansi.bold("Source:")}      ${sourceStr}`);
    if (allProviders) {
      console.info(
        `    ${ansi.bold("Tool:")}    All (${allProviders.map((p) => p.label).join(", ")})`,
      );
      console.info(
        `    ${ansi.bold("Primary:")}     ${provider.label} (${provider.name})`,
      );
      console.info(
        `    ${ansi.bold("Symlinks:")}    ${allProviders
          .filter((p) => p.name !== provider.name)
          .map((p) => p.label)
          .join(", ")}`,
      );
    } else {
      console.info(
        `    ${ansi.bold("Tool:")}    ${provider.label} (${provider.name})`,
      );
    }
    console.info(
      `    ${ansi.bold("Scope:")}       ${plan.scope === "project" ? "Project" : "Global"}`,
    );
    console.info(`    ${ansi.bold("Target:")}      ${plan.targetDir}`);
    console.info(`    ${ansi.bold("Status:")}      ${statusColor}`);
    console.info(`    ${ansi.bold("Risk:")}        ${riskLabel}`);

    if (warnings.length > 0) {
      console.info(`\n  ${ansi.bold("Security warnings:")}`);
      const grouped = new Map<string, typeof warnings>();
      for (const w of warnings) {
        const list = grouped.get(w.category) || [];
        list.push(w);
        grouped.set(w.category, list);
      }
      for (const [category, items] of grouped) {
        const isHighRiskCategory = [
          "Shell commands",
          "Code execution",
          "Credentials",
        ].includes(category);
        const categoryLabel = isHighRiskCategory
          ? ansi.red(`[${category}]`)
          : ansi.yellow(`[${category}]`);
        console.info(
          `\n    ${categoryLabel} ${ansi.dim(`(${items.length} match${items.length > 1 ? "es" : ""})`)}`,
        );
        for (const item of items.slice(0, 5)) {
          console.info(
            `      ${ansi.dim(`${item.file}:${item.line}`)} -- ${item.match}`,
          );
        }
        if (items.length > 5) {
          console.info(ansi.dim(`      ... and ${items.length - 5} more`));
        }
      }
    }
  }
}

// ─── Install: execute a single skill install ────────────────────────────────

export async function executeSkillInstall(
  plan: ReturnType<typeof buildInstallPlan>,
  allProviders: ProviderConfig[] | null,
): Promise<InstallResult> {
  if (allProviders) {
    return await executeInstallAllProviders(plan, allProviders);
  }
  return await executeInstall(plan);
}

export async function installSelectedLibrarySkill(input: {
  inspection: SkillInspection;
  source: ReturnType<typeof parseSource>;
  isLocal: boolean;
  resolutionSource: ResolutionSource;
  commitHash: string | null;
  scanBaseDir: string;
  force: boolean;
}): Promise<InstallResult> {
  const {
    inspection,
    source,
    isLocal,
    resolutionSource,
    commitHash,
    scanBaseDir,
    force,
  } = input;
  const sourceStr = isLocal
    ? `local:${source.localPath}`
    : `github:${source.owner}/${source.repo}`;
  const sourceType = isLocal
    ? ("local" as const)
    : resolutionSource === "registry"
      ? ("registry" as const)
      : ("github" as const);
  const skillPath = toPortableRelativePath(
    relativePath(scanBaseDir, inspection.plan.sourceDir),
  );
  const installed = await installLibrarySkill({
    sourceDir: inspection.plan.sourceDir,
    libraryName: inspection.skillName,
    source: sourceStr,
    sourceType,
    commitHash: commitHash || "unknown",
    ref: source.ref || "main",
    skillPath,
    force,
  });

  return {
    success: true,
    path: installed.libraryPath,
    name: installed.name,
    version: installed.version,
    provider: "Library",
    source: sourceStr,
  };
}
