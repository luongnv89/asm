import { loadConfig, getLibrarySkillsDir } from "../config";
import { scanAllSkills } from "../scanner";
import { realpath as fsRealpath } from "fs/promises";
import { buildRemovalPlan, executeRemoval } from "../uninstaller";
import { formatJSON, ansi, shortenPath } from "../formatter";
import {
  parseSource,
  assertNoParentSegments,
  assertPathInsideRoot,
  checkGitAvailable,
  cloneToTemp,
  validateSkill,
  cleanupTemp,
  resolveSubpath,
} from "../installer";
import { computeResidencyAudit, formatResidencyReport } from "../residency";
import {
  detectDuplicates,
  sortInstancesForKeep,
  skillContentFingerprint,
  ensureSkillMdContent,
  formatAuditReport,
  formatAuditReportJSON,
} from "../auditor";
import {
  auditSkillSecurity,
  formatSecurityReport,
  formatSecurityReportJSON,
} from "../security-auditor";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
} from "../utils/machine";

import { formatAuditMachineData, error } from "./shared";
import type { ParsedArgs } from "../cli";

function printAuditHelp() {
  console.log(`${ansi.bold("Usage:")} asm audit [subcommand] [options]

Detect duplicate skills or run security audits on installed/remote skills.

${ansi.bold("Subcommands:")}
  duplicates             Find duplicate skills (default)
  security <name|source> Run security audit on an installed skill or GitHub source
  residency              Rank installed skills that do not earn their resident context

${ansi.bold("Options:")}
  --json             Output as JSON
  --machine          Output in stable machine-readable v1 envelope format
  -y, --yes          Auto-remove duplicates, keeping one instance per group
  -f, --force        With -y: remove even diverged (content-differing) copies
  -s, --scope <s>    Filter: global, project, or both (default: both)
  --no-color         Disable ANSI colors
  -V, --verbose      Show debug output

${ansi.bold("Examples:")}
  asm audit                                    ${ansi.dim("Find duplicates")}
  asm audit -y                                 ${ansi.dim("Auto-remove duplicates")}
  asm audit --json                             ${ansi.dim("Output as JSON")}
  asm audit residency                          ${ansi.dim("Rank demotion candidates")}
  asm audit residency --json                   ${ansi.dim("Residency report as JSON")}
  asm audit security code-review               ${ansi.dim("Audit an installed skill")}
  asm audit security github:user/repo          ${ansi.dim("Audit a remote skill before installing")}
  asm audit security --all                     ${ansi.dim("Audit all installed skills")}
  asm audit security code-review --json        ${ansi.dim("Output audit as JSON")}
  asm audit security code-review --machine     ${ansi.dim("Machine-readable v1 envelope output")}
  asm audit security https://github.com/user/skills/tree/main/skills/agent-config
                                               ${ansi.dim("Audit a skill from a subfolder URL")}`);
}

export async function cmdAudit(args: ParsedArgs) {
  if (args.flags.help) {
    printAuditHelp();
    return;
  }

  const startTime = performance.now();
  const sub = args.subcommand ?? "duplicates";

  if (sub === "security") {
    await cmdAuditSecurity(args, startTime);
    return;
  }

  if (sub === "residency") {
    await cmdAuditResidency(args, startTime);
    return;
  }

  if (sub !== "duplicates") {
    error(
      `Unknown audit subcommand: "${sub}". Use: duplicates, security, residency`,
    );
    process.exit(2);
  }

  const config = await loadConfig();
  // Always scan all providers regardless of --scope
  const allSkills = await scanAllSkills(config, "both");
  // Fingerprinting (#562) needs SKILL.md content; the scanner usually caches
  // it, but reconstructed rows (e.g. disabled skills) may lack it.
  await Promise.all(allSkills.map(ensureSkillMdContent));
  const report = detectDuplicates(allSkills);

  if (args.flags.machine) {
    const data = {
      duplicate_groups: report.duplicateGroups.map((g) => ({
        name: g.key,
        reason: g.reason,
        ...(g.contentClass ? { contentClass: g.contentClass } : {}),
        count: g.instances.length,
        instances: g.instances.map((i) => ({
          path: i.path,
          scope: i.scope,
          provider: i.provider,
        })),
      })),
      total_duplicates: report.duplicateGroups.length,
      totalDuplicateInstances: report.totalDuplicateInstances,
    };
    console.log(formatMachineOutput("audit duplicates", data, startTime));
    return;
  }

  if (args.flags.json) {
    console.log(formatAuditReportJSON(report));
    return;
  }

  console.log(formatAuditReport(report));

  if (args.flags.yes && report.duplicateGroups.length > 0) {
    // Auto-remove all but the first (recommended keep) instance per group.
    // Safety guard (#563): an instance is only removed when its content
    // fingerprint matches the kept copy; diverged or unverifiable copies
    // are skipped unless --force is given.
    console.error(ansi.bold("\nAuto-removing duplicates..."));
    let removed = 0;
    let skipped = 0;
    for (const group of report.duplicateGroups) {
      const sorted = sortInstancesForKeep(group.instances);
      const kept = sorted[0];
      const keptFingerprint = skillContentFingerprint(kept);
      for (let i = 1; i < sorted.length; i++) {
        const skill = sorted[i];
        const fingerprint = skillContentFingerprint(skill);
        const identical =
          keptFingerprint !== null &&
          fingerprint !== null &&
          keptFingerprint === fingerprint;
        if (!identical && !args.flags.force) {
          skipped++;
          const why =
            keptFingerprint === null || fingerprint === null
              ? "contents could not be verified"
              : "contents differ from the kept copy";
          console.error(
            ansi.yellow(
              `  Skipping ${shortenPath(skill.path)} — ${why}. ` +
                `Kept ${shortenPath(kept.path)}. ` +
                `Re-run with --force to remove it anyway.`,
            ),
          );
          continue;
        }
        const plan = buildRemovalPlan(skill, config);
        const log = await executeRemoval(plan, kept.path);
        for (const entry of log) {
          console.error(entry);
        }
        removed++;
      }
    }
    if (skipped > 0) {
      console.error(
        ansi.yellow(
          `\n${skipped} duplicate cop${skipped === 1 ? "y" : "ies"} skipped (content differs or could not be verified).`,
        ),
      );
    }
    console.error(
      ansi.green(
        `\nDone. Removed ${removed} duplicate cop${removed === 1 ? "y" : "ies"}.`,
      ),
    );
  }
}

/**
 * `asm audit residency` — rank installed skills that are not earning their
 * resident context and pair each with a command that actually works for how
 * it is installed (issue #423).
 *
 * Read-only by construction: this path never removes, deactivates, or
 * disables anything, and it deliberately ignores `--yes` — residency is a
 * user judgement, so demotion only ever happens when the user runs one of the
 * suggested commands themselves.
 */

export async function cmdAuditResidency(args: ParsedArgs, startTime: number) {
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  // Resolve the library's real path so symlinked HOMEs still match; a missing
  // library just means no instance qualifies for `asm deactivate`.
  let librarySkillsDir = getLibrarySkillsDir();
  try {
    librarySkillsDir = await fsRealpath(librarySkillsDir);
  } catch {
    // library not created yet — containment check simply never matches
  }

  const report = computeResidencyAudit(allSkills, { librarySkillsDir });

  if (args.flags.machine) {
    console.log(formatMachineOutput("audit residency", report, startTime));
    return;
  }

  if (args.flags.json) {
    console.log(formatJSON(report));
    return;
  }

  console.log(formatResidencyReport(report));
}

export async function cmdAuditSecurity(args: ParsedArgs, startTime: number) {
  const target = args.positional[0];

  if (args.flags.all) {
    await cmdAuditSecurityAll(args, startTime);
  } else if (!target) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.INVALID_ARGUMENT,
          "Missing target. Provide a skill name, GitHub source, or use --all.",
          startTime,
        ),
      );
      process.exit(2);
    }
    error(
      "Missing target. Provide a skill name, GitHub source, or use --all.\nUsage: asm audit security <name|github:owner/repo> [--all]",
    );
    process.exit(2);
  } else if (
    target.startsWith("github:") ||
    target.startsWith("https://github.com/")
  ) {
    await cmdAuditSecuritySource(args, target, startTime);
  } else {
    await cmdAuditSecurityInstalled(args, target, startTime);
  }
}

export async function cmdAuditSecurityAll(args: ParsedArgs, startTime: number) {
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);

  if (allSkills.length === 0) {
    if (args.flags.machine) {
      console.log(formatMachineOutput("audit security", [], startTime));
    } else if (args.flags.json) {
      console.log("[]");
    } else {
      console.log("No skills found to audit.");
    }
    return;
  }

  // Deduplicate by realPath to avoid scanning the same skill multiple times
  const seen = new Set<string>();
  const uniqueSkills = allSkills.filter((s) => {
    if (seen.has(s.realPath)) return false;
    seen.add(s.realPath);
    return true;
  });

  console.error(
    `Auditing ${uniqueSkills.length} skill${uniqueSkills.length > 1 ? "s" : ""}...\n`,
  );

  const reports = [];
  for (const skill of uniqueSkills) {
    console.error(`  Scanning ${ansi.bold(skill.name)}...`);
    const report = await auditSkillSecurity(skill.realPath, skill.name);
    reports.push(report);
  }

  if (args.flags.machine) {
    console.log(
      formatMachineOutput(
        "audit security",
        formatAuditMachineData(reports),
        startTime,
      ),
    );
  } else if (args.flags.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) {
      console.log(formatSecurityReport(report));
    }

    const verdictCounts = { safe: 0, caution: 0, warning: 0, dangerous: 0 };
    for (const r of reports) {
      verdictCounts[r.verdict]++;
    }
    console.log(ansi.bold("\n  Summary:"));
    if (verdictCounts.dangerous > 0)
      console.log(`    ${ansi.red(`${verdictCounts.dangerous} dangerous`)}`);
    if (verdictCounts.warning > 0)
      console.log(`    ${ansi.yellow(`${verdictCounts.warning} warning`)}`);
    if (verdictCounts.caution > 0)
      console.log(`    ${verdictCounts.caution} caution`);
    if (verdictCounts.safe > 0)
      console.log(`    ${ansi.green(`${verdictCounts.safe} safe`)}`);
    console.log("");
  }
}

export async function cmdAuditSecuritySource(
  args: ParsedArgs,
  target: string,
  startTime: number,
) {
  let tempDir: string | null = null;
  try {
    let source = parseSource(target);

    if (source.isLocal) {
      throw new Error(
        "Local paths are not supported for remote security audits. Use: asm audit security <installed-skill-name>",
      );
    }

    assertNoParentSegments(source, target);

    await checkGitAvailable();

    // Resolve ref/subpath for subfolder URLs
    source = await resolveSubpath(source);
    console.error(`Cloning ${target} for audit...`);

    tempDir = await cloneToTemp(source, args.flags.transport);

    // Use subpath if available (from URL like /tree/main/skills/agent-config)
    const { join: joinPath } = await import("path");
    const auditDir = source.subpath
      ? joinPath(tempDir, source.subpath)
      : tempDir;
    try {
      assertPathInsideRoot(tempDir, auditDir, target);
    } catch (guardErr) {
      await cleanupTemp(tempDir);
      tempDir = null;
      throw guardErr;
    }

    const { name } = await validateSkill(auditDir);
    const report = await auditSkillSecurity(
      auditDir,
      name,
      source.owner,
      source.repo,
    );

    if (args.flags.machine) {
      console.log(
        formatMachineOutput(
          "audit security",
          formatAuditMachineData([report]),
          startTime,
        ),
      );
    } else if (args.flags.json) {
      console.log(formatSecurityReportJSON(report));
    } else {
      console.log(formatSecurityReport(report));
    }
  } catch (err: any) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.AUDIT_FAILED,
          err.message,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(err.message);
    process.exit(1);
  } finally {
    if (tempDir) {
      await cleanupTemp(tempDir);
    }
  }
}

export async function cmdAuditSecurityInstalled(
  args: ParsedArgs,
  target: string,
  startTime: number,
) {
  const config = await loadConfig();
  const allSkills = await scanAllSkills(config, args.flags.scope);
  const matches = allSkills.filter((s) => s.dirName === target);

  if (matches.length === 0) {
    if (args.flags.machine) {
      console.log(
        formatMachineError(
          "audit security",
          ErrorCodes.SKILL_NOT_FOUND,
          `Skill "${target}" not found.`,
          startTime,
        ),
      );
      process.exit(1);
    }
    error(
      `Skill "${target}" not found. Use "asm list" to see installed skills.`,
    );
    process.exit(1);
  }

  const skill = matches[0];

  console.error(`Auditing installed skill: ${ansi.bold(skill.name)}...\n`);

  const report = await auditSkillSecurity(skill.realPath, skill.name);

  if (args.flags.machine) {
    console.log(
      formatMachineOutput(
        "audit security",
        formatAuditMachineData([report]),
        startTime,
      ),
    );
  } else if (args.flags.json) {
    console.log(formatSecurityReportJSON(report));
  } else {
    console.log(formatSecurityReport(report));
  }
}
