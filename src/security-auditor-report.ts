import { ansi } from "./formatter";
import type {
  CodeScanMatch,
  SecurityAuditReport,
  SecurityVerdict,
} from "./utils/types";
// Split from security-auditor.ts (issue #677).

// ─── Report Formatting ──────────────────────────────────────────────────────

// Alias for brevity in formatting functions
const color = ansi;

const BOX_WIDTH = 56;

const CATEGORY_TO_PERM: Record<string, string> = {
  "Shell execution": "shell",
  "Dynamic code execution": "code-execution",
  "Network requests": "network",
  "External URLs": "network",
  "File system access": "filesystem",
  "Environment variable access": "environment",
  "Embedded credentials": "credentials",
  "Obfuscation patterns": "obfuscation",
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function verdictBadge(verdict: SecurityVerdict): string {
  switch (verdict) {
    case "safe":
      return color.bgGreen(" SAFE ");
    case "caution":
      return color.bgCyan(" CAUTION ");
    case "warning":
      return color.bgYellow(" WARNING ");
    case "dangerous":
      return color.bgRed(" DANGEROUS ");
  }
}

function verdictColor(verdict: SecurityVerdict): (s: string) => string {
  switch (verdict) {
    case "safe":
      return color.green;
    case "caution":
      return color.cyan;
    case "warning":
      return color.yellow;
    case "dangerous":
      return color.red;
  }
}

function severityIcon(severity: "critical" | "warning" | "info"): string {
  switch (severity) {
    case "critical":
      return color.red("!!");
    case "warning":
      return color.yellow(" !");
    case "info":
      return color.dim(" i");
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI CSI
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

function deduplicateMatches(matches: CodeScanMatch[]): CodeScanMatch[] {
  const seen = new Map<string, CodeScanMatch>();
  for (const m of matches) {
    const key = `${m.file}:${m.line}`;
    const existing = seen.get(key);
    if (
      !existing ||
      SEVERITY_ORDER[m.severity] < SEVERITY_ORDER[existing.severity]
    ) {
      seen.set(key, m);
    }
  }
  return Array.from(seen.values());
}

interface FileGroup {
  file: string;
  entries: Array<{
    line: number;
    match: string;
    severity: CodeScanMatch["severity"];
  }>;
}

function groupMatchesByFile(matches: CodeScanMatch[]): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const m of matches) {
    let group = map.get(m.file);
    if (!group) {
      group = { file: m.file, entries: [] };
      map.set(m.file, group);
    }
    group.entries.push({
      line: m.line,
      match: m.match,
      severity: m.severity,
    });
  }
  return Array.from(map.values());
}

export function formatSecurityReport(report: SecurityAuditReport): string {
  const lines: string[] = [];

  // ── Zone A: Header Box ──
  const badgeText = verdictBadge(report.verdict);
  const badgePlain = stripAnsi(badgeText);
  const namePart = `  ${color.bold(report.skillName)}`;
  const namePlain = `  ${report.skillName}`;
  const innerWidth = BOX_WIDTH - 4; // minus │ + space on each side
  const gap = Math.max(1, innerWidth - namePlain.length - badgePlain.length);

  lines.push("");
  lines.push(
    color.dim("  +-- ") +
      color.bold("Security Audit") +
      color.dim(" " + "-".repeat(BOX_WIDTH - 19) + "+"),
  );
  lines.push(
    color.dim("  |") + namePart + " ".repeat(gap) + badgeText + color.dim("|"),
  );
  lines.push(
    color.dim("  |") +
      color.dim(
        `  ${formatNumber(report.totalFiles)} files | ${formatNumber(report.totalLines)} lines`,
      ) +
      " ".repeat(
        Math.max(
          1,
          innerWidth -
            `  ${formatNumber(report.totalFiles)} files | ${formatNumber(report.totalLines)} lines`
              .length,
        ),
      ) +
      color.dim("|"),
  );
  lines.push(color.dim("  +" + "-".repeat(BOX_WIDTH - 2) + "+"));

  // ── Source line (compact) ──
  if (report.source) {
    const src = report.source;
    if (src.fetchError) {
      lines.push(
        `  ${color.yellow("!")} Could not fetch profile: ${src.fetchError}`,
      );
    } else {
      const parts: string[] = [];
      parts.push(
        `${src.owner} ${src.isOrganization ? color.cyan("(org)") : color.dim("(user)")}`,
      );
      if (src.publicRepos !== null) {
        const repoCount = src.publicRepos;
        const repoLabel =
          repoCount < 3
            ? color.yellow(`${repoCount} repos`)
            : repoCount < 10
              ? color.cyan(`${repoCount} repos`)
              : color.green(`${repoCount} repos`);
        parts.push(repoLabel);
      }
      if (src.accountAge) {
        parts.push(src.accountAge);
      }
      lines.push(`  ${color.dim("Author:")} ${parts.join(color.dim(" | "))}`);
    }
  }

  lines.push("");

  // ── Zone B: Threat Summary ──
  if (report.codeScans.length === 0) {
    lines.push(
      `  ${color.green("*")} ${color.green("No suspicious patterns detected.")}`,
    );
  } else {
    // Verdict reason line
    const vColor = verdictColor(report.verdict);
    const verdictIcon =
      report.verdict === "dangerous" || report.verdict === "warning"
        ? severityIcon("critical")
        : report.verdict === "caution"
          ? severityIcon("warning")
          : severityIcon("info");
    lines.push(`  ${verdictIcon} ${vColor(report.verdictReason)}`);

    // Aggregate counts
    let totalCrit = 0;
    let totalWarn = 0;
    let totalInfo = 0;
    for (const cat of report.codeScans) {
      for (const m of cat.matches) {
        if (m.severity === "critical") totalCrit++;
        else if (m.severity === "warning") totalWarn++;
        else totalInfo++;
      }
    }

    const countParts: string[] = [];
    if (totalCrit > 0) countParts.push(color.red(`${totalCrit} critical`));
    if (totalWarn > 0) countParts.push(color.yellow(`${totalWarn} warning`));
    if (totalInfo > 0) countParts.push(color.dim(`${totalInfo} info`));

    const permTypes = report.permissions.map((p) => p.type);
    const permLabel =
      permTypes.length > 0 ? color.dim(`Perms: ${permTypes.join(", ")}`) : "";

    lines.push(`     ${countParts.join(color.dim(" | "))}    ${permLabel}`);
  }

  lines.push("");

  // ── Zone C: Findings ──
  if (report.codeScans.length > 0) {
    lines.push(`  ${color.bold("Findings")}`);
    lines.push(color.dim("  " + "=".repeat(BOX_WIDTH - 2)));

    for (const category of report.codeScans) {
      const dedupedMatches = deduplicateMatches(category.matches);
      const critCount = dedupedMatches.filter(
        (m) => m.severity === "critical",
      ).length;
      const warnCount = dedupedMatches.filter(
        (m) => m.severity === "warning",
      ).length;
      const infoCount = dedupedMatches.filter(
        (m) => m.severity === "info",
      ).length;

      // Determine category severity icon
      const catIcon =
        critCount > 0
          ? severityIcon("critical")
          : warnCount > 0
            ? severityIcon("warning")
            : severityIcon("info");

      // Counts string
      const counts: string[] = [];
      if (critCount > 0) counts.push(color.red(`${critCount} critical`));
      if (warnCount > 0) counts.push(color.yellow(`${warnCount} warning`));
      if (infoCount > 0) counts.push(color.dim(`${infoCount} info`));

      // Permission label
      const permType = CATEGORY_TO_PERM[category.category];
      const permSuffix = permType ? color.dim(`PERM: ${permType}`) : "";

      const headerLeft = `  ${catIcon} ${color.bold(category.category)} (${counts.join(", ")})`;
      if (permSuffix) {
        const headerLeftPlain = visibleLength(headerLeft);
        const permPlain = visibleLength(permSuffix);
        const headerGap = Math.max(2, BOX_WIDTH - headerLeftPlain - permPlain);
        lines.push(headerLeft + " ".repeat(headerGap) + permSuffix);
      } else {
        lines.push(headerLeft);
      }

      // Group matches by file and render compactly
      const fileGroups = groupMatchesByFile(dedupedMatches);

      // Compute max file name length for alignment (capped)
      const maxFileLen = Math.min(
        24,
        Math.max(...fileGroups.map((g) => g.file.length)),
      );

      let shownEntries = 0;
      const maxEntries = 3;

      for (const group of fileGroups) {
        if (shownEntries >= maxEntries) break;

        const fileName = truncate(group.file, 24);
        const paddedFile = color.dim(fileName.padEnd(maxFileLen));

        if (group.entries.length === 1) {
          // Single line from this file — show with match text
          const e = group.entries[0];
          const matchText = truncate(e.match, 50);
          lines.push(
            `     ${paddedFile}  :${e.line} ${color.dim("--")} ${e.severity === "critical" ? matchText : color.dim(matchText)}`,
          );
          shownEntries++;
        } else if (group.entries.length <= 3) {
          // Few lines — show line numbers inline with first match
          const lineNums = group.entries.map((e) => `:${e.line}`).join(", ");
          const firstMatch = truncate(group.entries[0].match, 40);
          lines.push(
            `     ${paddedFile}  ${lineNums} ${color.dim("--")} ${color.dim(firstMatch)}`,
          );
          shownEntries++;
        } else {
          // Many lines — compact with count
          const shown = group.entries.slice(0, 3);
          const lineNums = shown.map((e) => `:${e.line}`).join(", ");
          const remaining = group.entries.length - 3;
          lines.push(
            `     ${paddedFile}  ${lineNums} ${color.dim(`(+${remaining} more)`)}`,
          );
          shownEntries++;
        }
      }

      // Remaining files not shown
      const remainingFiles =
        fileGroups.length - Math.min(fileGroups.length, maxEntries);
      if (remainingFiles > 0) {
        const remainingMatches =
          dedupedMatches.length -
          fileGroups
            .slice(0, maxEntries)
            .reduce((sum, g) => sum + g.entries.length, 0);
        if (remainingMatches > 0) {
          lines.push(
            `     ${color.dim(`... ${remainingMatches} more in ${remainingFiles} file${remainingFiles > 1 ? "s" : ""}`)}`,
          );
        }
      }

      lines.push("");
    }
  }

  // ── Zone D: Footer ──
  lines.push(color.dim("  " + "=".repeat(BOX_WIDTH - 2)));
  const date = new Date(report.scannedAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const sourceUrl =
    report.source && !report.source.fetchError
      ? `github.com/${report.source.owner}`
      : "";
  if (sourceUrl) {
    const footerGap = Math.max(
      2,
      BOX_WIDTH - 2 - dateStr.length - sourceUrl.length,
    );
    lines.push(color.dim(`  ${dateStr}${" ".repeat(footerGap)}${sourceUrl}`));
  } else {
    lines.push(color.dim(`  ${dateStr}`));
  }
  lines.push("");

  return lines.join("\n");
}

export function formatSecurityReportJSON(report: SecurityAuditReport): string {
  return JSON.stringify(report, null, 2);
}
