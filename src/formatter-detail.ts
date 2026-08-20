/**
 * Skill detail and multi-instance inspect renderers.
 * Split from formatter.ts (issue #455).
 */

import type { SkillInfo } from "./utils/types";
import { countFiles } from "./scanner";
import { formatTokenCount } from "./utils/token-count";
import { formatInvocability } from "./utils/frontmatter";
import {
  ansi,
  useColor,
  providerBadge,
  colorProvider,
  colorEffort,
  formatAllowedTools,
  toolRiskWarning,
  shortenPath,
  wordWrap,
} from "./formatter-core";

// ─── Detail formatter ───────────────────────────────────────────────────────

export async function formatSkillDetail(skill: SkillInfo): Promise<string> {
  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${useColor() ? ansi.bold(key + ":") : key + ":"} ${value}`;

  lines.push(label("Name", skill.name));
  lines.push(label("Version", skill.version));
  lines.push(label("Creator", skill.creator || "\u2014"));
  lines.push(label("License", skill.license || "\u2014"));
  if (skill.compatibility) {
    lines.push(label("Compatibility", skill.compatibility));
  }
  if (skill.effort) {
    lines.push(label("Effort", colorEffort(skill.effort)));
  }
  lines.push(
    label(
      "Invocable",
      formatInvocability(skill.modelInvocable, skill.userInvocable),
    ),
  );
  lines.push(label("Tool", skill.providerLabel));
  lines.push(label("Scope", skill.scope));
  lines.push(label("Location", skill.location));
  lines.push(label("Path", shortenPath(skill.path)));
  lines.push(label("Type", skill.isSymlink ? "symlink" : "directory"));
  if (skill.isSymlink && skill.symlinkTarget) {
    lines.push(label("Symlink Target", skill.symlinkTarget));
  }
  const fileCount = skill.fileCount ?? (await countFiles(skill.path));
  lines.push(label("File Count", String(fileCount)));
  if (typeof skill.tokenCount === "number") {
    lines.push(label("Est. Tokens", formatTokenCount(skill.tokenCount)));
  }
  if (skill.description) {
    lines.push("");
    lines.push(label("Description", skill.description));
  }

  if (skill.allowedTools && skill.allowedTools.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("Allowed Tools:") : "Allowed Tools:");
    lines.push(`  ${formatAllowedTools(skill.allowedTools)}`);
    const warning = toolRiskWarning(skill.allowedTools);
    if (warning) {
      lines.push(`  ${useColor() ? ansi.yellow("\u26A0") : "!"} ${warning}`);
    }
  }

  // Eval summary section — fulfills issue #187 acceptance criteria.
  // Show empty state explicitly when not available so it never reads as
  // "broken or missing".
  lines.push("");
  lines.push(useColor() ? ansi.bold("Eval Score:") : "Eval Score:");
  const evalSummaries = getEvalSummaries(skill);
  if (evalSummaries.length > 0) {
    const multipleProviders = evalSummaries.length > 1;
    for (const ev of evalSummaries) {
      const overallColored = colorEvalScore(ev.overallScore);
      const providerLabel = ev.providerId
        ? `${ev.providerId}@${ev.providerVersion ?? "?"}`
        : "quality";
      if (multipleProviders) {
        lines.push(
          `  ${providerLabel}: ${overallColored} / 100  (${ev.grade})`,
        );
      } else {
        lines.push(`  Overall: ${overallColored} / 100  (${ev.grade})`);
      }
      const evVer = ev.evaluatedVersion
        ? ` — version ${ev.evaluatedVersion}`
        : "";
      lines.push(
        `  ${useColor() ? ansi.dim("Evaluated:") : "Evaluated:"} ${ev.evaluatedAt}${evVer}`,
      );
      if (ev.categories.length > 0) {
        if (multipleProviders) {
          lines.push(
            useColor()
              ? ansi.dim(`  Categories (${providerLabel}):`)
              : `  Categories (${providerLabel}):`,
          );
        } else {
          lines.push(useColor() ? ansi.dim("  Categories:") : "  Categories:");
        }
        for (const c of ev.categories) {
          lines.push(`    ${c.name.padEnd(28)} ${c.score}/${c.max}`);
        }
      }
    }
  } else {
    lines.push(
      useColor()
        ? ansi.dim(
            "  Not available — run `asm eval " +
              skill.path +
              "` to generate one.",
          )
        : "  Not available — run `asm eval " +
            skill.path +
            "` to generate one.",
    );
  }

  if (skill.warnings && skill.warnings.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("Warnings:") : "Warnings:");
    for (const w of skill.warnings) {
      lines.push(
        `  ${useColor() ? ansi.yellow("!") : "!"} [${w.category}] ${w.message}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Color an `asm eval` overall score (0..100) by quality tier.
 *   90+ green, 80+ cyan, 65+ yellow, else red.
 */
export function colorEvalScore(score: number): string {
  const txt = String(score);
  if (!useColor()) return txt;
  if (score >= 90) return ansi.green(txt);
  if (score >= 80) return ansi.cyan(txt);
  if (score >= 65) return ansi.yellow(txt);
  return ansi.red(txt);
}

function getEvalSummaries(
  skill: SkillInfo,
): NonNullable<SkillInfo["evalSummary"]>[] {
  if (skill.evalSummaries && Object.keys(skill.evalSummaries).length > 0) {
    const summaries = Object.values(skill.evalSummaries) as NonNullable<
      SkillInfo["evalSummary"]
    >[];
    return summaries.sort((a, b) => {
      const aId = a.providerId ?? "quality";
      const bId = b.providerId ?? "quality";
      if (aId === "quality" && bId !== "quality") return -1;
      if (bId === "quality" && aId !== "quality") return 1;
      return aId.localeCompare(bId);
    });
  }
  return skill.evalSummary ? [skill.evalSummary] : [];
}

// ─── Multi-instance detail formatter ────────────────────────────────────────

export async function formatSkillInspect(skills: SkillInfo[]): Promise<string> {
  if (skills.length === 0) return "No skills found.";
  if (skills.length === 1) return formatSkillDetail(skills[0]);

  const lines: string[] = [];
  const label = (key: string, value: string) =>
    `${useColor() ? ansi.bold(key + ":") : key + ":"} ${value}`;
  const ref = skills[0];

  // ── Header ──
  const title = ref.name;
  lines.push("");
  lines.push(useColor() ? ansi.blueBold(`  ${title}`) : `  ${title}`);
  lines.push(
    useColor()
      ? ansi.dim("  " + "-".repeat(title.length + 2))
      : "  " + "-".repeat(title.length + 2),
  );
  lines.push("");

  // ── Shared info ──
  lines.push(label("  Version", ref.version));
  lines.push(label("  Creator", ref.creator || "\u2014"));
  lines.push(label("  License", ref.license || "\u2014"));
  if (ref.compatibility) {
    lines.push(label("  Compatibility", ref.compatibility));
  }
  if (ref.effort) {
    lines.push(label("  Effort", colorEffort(ref.effort)));
  }
  lines.push(
    label(
      "  Invocable",
      formatInvocability(ref.modelInvocable, ref.userInvocable),
    ),
  );

  const fileCount = ref.fileCount ?? (await countFiles(ref.path));
  lines.push(label("  File Count", String(fileCount)));
  if (typeof ref.tokenCount === "number") {
    lines.push(label("  Est. Tokens", formatTokenCount(ref.tokenCount)));
  }

  // Provider badges
  const badges = skills
    .map((s) => providerBadge(s.provider, s.providerLabel))
    .join(" ");
  lines.push(label("  Installed in", badges));

  // Eval summary block
  lines.push("");
  lines.push(useColor() ? ansi.bold("  Eval Score:") : "  Eval Score:");
  const refEvalSummaries = getEvalSummaries(ref);
  if (refEvalSummaries.length > 0) {
    const multipleProviders = refEvalSummaries.length > 1;
    for (const ev of refEvalSummaries) {
      const overallColored = colorEvalScore(ev.overallScore);
      const providerLabel = ev.providerId
        ? `${ev.providerId}@${ev.providerVersion ?? "?"}`
        : "quality";
      if (multipleProviders) {
        lines.push(
          `    ${providerLabel}: ${overallColored} / 100  (${ev.grade})`,
        );
      } else {
        lines.push(`    Overall: ${overallColored} / 100  (${ev.grade})`);
      }
      const evVer = ev.evaluatedVersion
        ? ` — version ${ev.evaluatedVersion}`
        : "";
      lines.push(
        `    ${useColor() ? ansi.dim("Evaluated:") : "Evaluated:"} ${ev.evaluatedAt}${evVer}`,
      );
      if (ev.categories.length > 0) {
        for (const c of ev.categories) {
          lines.push(`      ${c.name.padEnd(28)} ${c.score}/${c.max}`);
        }
      }
    }
  } else {
    lines.push(
      useColor()
        ? ansi.dim(
            `    Not available — run \`asm eval ${ref.path}\` to generate one.`,
          )
        : `    Not available — run \`asm eval ${ref.path}\` to generate one.`,
    );
  }

  // ── Description ──
  if (ref.description) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("  Description:") : "  Description:");
    const wrapped = wordWrap(ref.description, 72);
    for (const wl of wrapped) {
      lines.push("    " + wl);
    }
  }

  // ── Allowed Tools ──
  if (ref.allowedTools && ref.allowedTools.length > 0) {
    lines.push("");
    lines.push(useColor() ? ansi.bold("  Allowed Tools:") : "  Allowed Tools:");
    lines.push(`    ${formatAllowedTools(ref.allowedTools)}`);
    const warning = toolRiskWarning(ref.allowedTools);
    if (warning) {
      lines.push(`    ${useColor() ? ansi.yellow("\u26A0") : "!"} ${warning}`);
    }
  }

  // ── Installations ──
  lines.push("");
  const instHeader = `  Installations (${skills.length})`;
  lines.push(useColor() ? ansi.bold(instHeader) : instHeader);

  for (let i = 0; i < skills.length; i++) {
    const s = skills[i];
    const provider = colorProvider(s.provider, s.providerLabel);
    const type = s.isSymlink ? "symlink" : "directory";
    const scope = ansi.dim(s.scope);

    lines.push(`    ${provider} (${scope}, ${type})`);
    lines.push(`      ${ansi.dim("Path:")} ${shortenPath(s.path)}`);
    if (s.isSymlink && s.symlinkTarget) {
      lines.push(`      ${ansi.dim("Target:")} ${s.symlinkTarget}`);
    }
  }

  // ── Warnings (aggregate) ──
  const allWarnings = skills.flatMap((s) => {
    if (!s.warnings || s.warnings.length === 0) return [];
    return s.warnings.map((w) => ({ ...w, provider: s.providerLabel }));
  });

  if (allWarnings.length > 0) {
    lines.push("");
    const warnHeader = `  Warnings (${allWarnings.length})`;
    lines.push(useColor() ? ansi.bold(warnHeader) : warnHeader);
    for (const w of allWarnings) {
      const icon = useColor() ? ansi.yellow("!") : "!";
      lines.push(`    ${icon} [${w.category}] ${w.message}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
