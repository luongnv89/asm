/**
 * Residency audit — which installed skills are not earning their resident
 * context (issue #423).
 *
 * Every installed skill's frontmatter description sits in the agent's system
 * prompt on every message. This module ranks the installed set by that cost
 * and pairs each demotion candidate with the ASM command that actually works
 * for how that skill is installed. It never modifies anything: `asm audit
 * residency` reports and suggests, and demotion stays a user judgement.
 */

import { resolve, sep } from "path";
import { getDefaultConfig } from "./config";
import { ansi } from "./formatter";
import { median } from "./stats";
import {
  bodyTokens,
  formatTokenCount,
  residentTokens,
} from "./utils/token-count";
import type {
  ResidencyAction,
  ResidencyActionReference,
  ResidencyCandidate,
  ResidencyInstance,
  ResidencyReason,
  ResidencyReport,
  ResidencySignal,
  SkillInfo,
} from "./utils/types";

/**
 * Providers whose skills ASM does not own. `asm disable` explicitly skips
 * them (they have no `SKILL.md` ASM may rename) and `asm deactivate` would
 * throw, so no ASM command can demote them.
 */
const UNMANAGED_PROVIDERS = new Set(["plugin", "codex-plugin"]);

/**
 * A description has to be at least this expensive before "bigger than the
 * median" is worth a user's attention. Without a floor, a set of uniformly
 * tiny descriptions produces candidates that would save a handful of tokens.
 */
export const EXPENSIVE_RESIDENT_FLOOR = 40;

/** Multiple of the median resident cost that counts as an outlier. */
export const EXPENSIVE_RESIDENT_MULTIPLE = 2;

export interface ResidencyAuditOptions {
  /**
   * Resolved path to the ASM library's skills directory. Instances whose real
   * path lives inside it (and that are symlinks) are the only ones for which
   * `asm deactivate` is a valid command.
   */
  librarySkillsDir?: string;
  /** Cap on returned candidates; 0 or negative means no cap. */
  limit?: number;
}

/** How many candidates the human report prints before truncating. */
export const RESIDENCY_DISPLAY_LIMIT = 15;

/** How many install locations a reason names before summarizing the rest. */
const LOCATIONS_SHOWN = 3;

function summarizeLocations(instances: ResidencyInstance[]): string {
  const shown = instances
    .slice(0, LOCATIONS_SHOWN)
    .map((i) => `${i.provider}/${i.scope}`);
  const rest = instances.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
}

function isInside(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  if (p === c) return false;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Signals #423 lists, with the two that have no data source in ASM today
 * marked unavailable rather than silently dropped.
 */
export function residencySignals(): ResidencySignal[] {
  return [
    {
      id: "expensive-description",
      label: "Expensive residency",
      available: true,
    },
    {
      id: "redundant-activation",
      label: "Redundant activation",
      available: true,
    },
    {
      id: "trigger-collision",
      label: "Trigger collision",
      available: false,
      reason: "needs trigger-overlap detection (issue #18)",
    },
    {
      id: "unused",
      label: "Unused",
      available: false,
      reason: "needs skill usage statistics (issue #354)",
    },
  ];
}

/**
 * Pick a command that will actually succeed for this skill.
 *
 * `deactivateLibrarySkill` throws on non-symlinks and on symlinks pointing
 * outside the library, so `asm deactivate` is only safe for a single instance
 * that is a live library symlink. `asm disable` works for every ASM-managed
 * instance and is reversible with `asm enable`, so it is the fallback. It
 * demotes the whole group at once — `asm install` symlinks siblings to one
 * canonical `SKILL.md`, so renaming it disables every place the skill is
 * resident.
 */
export function chooseDemotionAction(
  dirName: string,
  instances: ResidencyInstance[],
): ResidencyAction {
  // Second demotion destination: the reference tier (issue #422). Demoting a
  // library skill does not mean losing it — `asm get` still delivers the body
  // on demand, at zero residency, without reinstalling anything.
  //
  // Offered on the `deactivate` path only. `asm deactivate` removes the
  // provider symlink and leaves the library copy intact, so `asm get` still
  // resolves it on the library rung. `asm disable` is different: it renames
  // `SKILL.md` to `SKILL.md.disabled` on the *canonical* directory — which,
  // for a library-linked skill, is the library copy itself — so after
  // disabling there is no local `SKILL.md` left for `asm get` to read on any
  // rung. Advice that breaks the moment the user follows the primary command
  // is worse than no advice, so the disable path gets the one command alone.
  const reference: ResidencyActionReference = {
    command: `asm get ${dirName}`,
    hint: "read it on demand, zero residency",
  };

  if (instances.length === 1 && instances[0].libraryLinked) {
    const only = instances[0];
    // `asm deactivate --provider X` must be a name resolveProvider accepts
    // (config.providers). customPaths scan as provider "custom", which is not
    // a valid --provider flag — fall back to disable.
    if (isResolvableProviderName(only.provider)) {
      return {
        kind: "deactivate",
        command: `asm deactivate ${dirName} --provider ${only.provider} --scope ${only.scope}`,
        hint: "keep it in the library, activate when needed",
        reference,
      };
    }
  }
  return {
    kind: "disable",
    command: `asm disable ${dirName}`,
    hint:
      instances.length > 1
        ? "reversible with asm enable; disables every ASM-managed copy of this skill name"
        : "reversible with asm enable",
  };
}

/** Names `resolveProvider` would accept from the default provider table. */
function isResolvableProviderName(name: string): boolean {
  return getDefaultConfig().providers.some((p) => p.name === name);
}

/**
 * Rank installed skills that are not earning their residency.
 *
 * Skills are grouped by directory name, because that is what both demotion
 * commands take and because a skill installed into three tools pays its
 * resident cost three times.
 */
export function computeResidencyAudit(
  skills: SkillInfo[],
  options: ResidencyAuditOptions = {},
): ResidencyReport {
  const librarySkillsDir = options.librarySkillsDir ?? "";
  const limit = options.limit ?? 0;

  const residentCosts = skills.map((s) => residentTokens(s));
  const totalResidentTokens = residentCosts.reduce((a, b) => a + b, 0);
  const medianResidentTokens = median(residentCosts);

  const managed = skills.filter((s) => !UNMANAGED_PROVIDERS.has(s.provider));
  const unmanagedSkills = skills.length - managed.length;

  // Group instances by directory name — the identifier both demotion commands
  // accept, and the unit that pays residency once per install location.
  const groups = new Map<string, SkillInfo[]>();
  for (const skill of managed) {
    const key = skill.dirName || skill.name;
    const list = groups.get(key);
    if (list) list.push(skill);
    else groups.set(key, [skill]);
  }

  const expensiveThreshold = Math.max(
    EXPENSIVE_RESIDENT_FLOOR,
    medianResidentTokens * EXPENSIVE_RESIDENT_MULTIPLE,
  );

  const candidates: ResidencyCandidate[] = [];

  for (const [dirName, group] of groups) {
    const first = group[0];
    const resident = residentTokens(first);
    // Symlinked siblings share one SKILL.md, but two independently-installed
    // skills can share a directory name and differ, so sum the group rather
    // than multiplying the representative's cost.
    const groupResident = group.reduce((sum, s) => sum + residentTokens(s), 0);
    const groupBody = group.reduce((sum, s) => sum + bodyTokens(s), 0);
    const instances: ResidencyInstance[] = group.map((s) => ({
      provider: s.provider,
      providerLabel: s.providerLabel || s.provider,
      scope: s.scope,
      path: s.path,
      libraryLinked:
        s.isSymlink &&
        librarySkillsDir.length > 0 &&
        isInside(librarySkillsDir, s.realPath || s.path),
    }));

    const reasons: ResidencyReason[] = [];

    if (resident >= expensiveThreshold && resident > 0) {
      const multiple =
        medianResidentTokens > 0
          ? `${(resident / medianResidentTokens).toFixed(1)}x the median description`
          : "well above the rest of the installed set";
      reasons.push({
        id: "expensive-description",
        detail: `${formatTokenCount(resident)} resident · ${multiple}`,
      });
    }

    if (instances.length > 1) {
      reasons.push({
        id: "redundant-activation",
        detail:
          `resident in ${instances.length} places (${summarizeLocations(instances)}) · ` +
          `each pays ${formatTokenCount(resident)}`,
      });
    }

    if (reasons.length === 0) continue;

    candidates.push({
      name: first.name,
      dirName,
      residentTokens: resident,
      totalResidentTokens: groupResident,
      bodyTokens: groupBody,
      score: groupResident,
      instances,
      reasons,
      action: chooseDemotionAction(dirName, instances),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    scannedAt: new Date().toISOString(),
    totalSkills: skills.length,
    totalResidentTokens,
    medianResidentTokens,
    unmanagedSkills,
    candidates: limit > 0 ? candidates.slice(0, limit) : candidates,
    signals: residencySignals(),
  };
}

/** Render the residency audit as CLI text. */
export function formatResidencyReport(
  report: ResidencyReport,
  displayLimit: number = RESIDENCY_DISPLAY_LIMIT,
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(ansi.blueBold("  Residency Audit"));
  lines.push(ansi.dim("  " + "-".repeat(40)));
  lines.push("");

  if (report.totalSkills === 0) {
    lines.push("  No installed skills.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  ${ansi.bold("Resident total:")}  ${ansi.cyan(formatTokenCount(report.totalResidentTokens))} ` +
      ansi.dim(`across ${report.totalSkills} skill(s), every message`),
  );
  lines.push(
    `  ${ansi.bold("Median skill:")}    ${ansi.cyan(formatTokenCount(report.medianResidentTokens))}`,
  );
  lines.push("");

  if (report.candidates.length === 0) {
    lines.push(`  ${ansi.green("No demotion candidates.")}`);
    lines.push("");
  } else {
    const shown =
      displayLimit > 0
        ? report.candidates.slice(0, displayLimit)
        : report.candidates;
    lines.push(
      ansi.bold(`  Demotion candidates (${report.candidates.length})`),
    );
    lines.push(ansi.dim("  Highest resident cost first."));
    lines.push("");
    for (const candidate of shown) {
      lines.push(
        `    ${ansi.cyan(candidate.name)}  ` +
          ansi.dim(`${formatTokenCount(candidate.totalResidentTokens)} total`),
      );
      // One line per reason: joining them overflows 80 columns and wraps back
      // to column 0, breaking the hanging indent that ties them to the name.
      for (const reason of candidate.reasons) {
        lines.push(ansi.dim(`      ${reason.detail}`));
      }
      lines.push(
        `      ${ansi.yellow("→")} ${ansi.bold(candidate.action.command)}` +
          ansi.dim(`  (${candidate.action.hint})`),
      );
      if (candidate.action.reference) {
        lines.push(
          `      ${ansi.yellow("→")} ${ansi.bold(candidate.action.reference.command)}` +
            ansi.dim(`  (${candidate.action.reference.hint})`),
        );
      }
      lines.push("");
    }
    const hidden = report.candidates.length - shown.length;
    if (hidden > 0) {
      lines.push(
        ansi.dim(`  … ${hidden} more not shown — use --json for the full list`),
      );
      lines.push("");
    }
  }

  if (report.unmanagedSkills > 0) {
    lines.push(
      ansi.dim(
        `  ${report.unmanagedSkills} plugin-provided skill(s) are counted but ` +
          `not ASM-managed — no ASM command demotes them.`,
      ),
    );
    lines.push("");
  }

  const unavailable = report.signals.filter((s) => !s.available);
  if (unavailable.length > 0) {
    lines.push(ansi.dim("  Signals not yet available:"));
    for (const signal of unavailable) {
      lines.push(ansi.dim(`    ${signal.label} — ${signal.reason}`));
    }
    lines.push("");
  }

  lines.push(
    ansi.dim("  Nothing was changed. Run a suggested command to demote."),
  );
  lines.push("");

  return lines.join("\n");
}
