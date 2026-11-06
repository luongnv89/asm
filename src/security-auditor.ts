import { debug } from "./logger";
import { readFilesRecursive } from "./utils/fs";
import type {
  ExternalSymlink,
  SourceAnalysis,
  CodeScanCategory,
  PermissionRequest,
  SecurityAuditReport,
  SecurityVerdict,
} from "./utils/types";
import {
  analyzeSource,
  scanCode,
  analyzePermissions,
} from "./security-auditor-scan";

// ─── Verdict Calculation ─────────────────────────────────────────────────────

export function calculateVerdict(
  scanResults: CodeScanCategory[],
  permissions: PermissionRequest[],
  source: SourceAnalysis | null,
): { verdict: SecurityVerdict; reason: string } {
  let criticalCount = 0;
  let warningCount = 0;

  for (const cat of scanResults) {
    for (const match of cat.matches) {
      if (match.severity === "critical") criticalCount++;
      if (match.severity === "warning") warningCount++;
    }
  }

  const hasShell = permissions.some((p) => p.type === "shell");
  const hasCodeExec = permissions.some((p) => p.type === "code-execution");
  const hasNetwork = permissions.some((p) => p.type === "network");

  // Dangerous: shell + network (potential data exfiltration)
  if (hasShell && hasNetwork) {
    return {
      verdict: "dangerous",
      reason:
        "Skill has both shell execution and network access -- potential data exfiltration risk.",
    };
  }

  // Dangerous: code execution + network
  if (hasCodeExec && hasNetwork) {
    return {
      verdict: "dangerous",
      reason:
        "Skill has dynamic code execution and network access -- potential remote code execution risk.",
    };
  }

  // Dangerous: many critical findings
  if (criticalCount >= 10) {
    return {
      verdict: "dangerous",
      reason: `${criticalCount} critical findings detected. High concentration of risky patterns.`,
    };
  }

  // Warning: shell or code execution
  if (hasShell || hasCodeExec) {
    return {
      verdict: "warning",
      reason: hasShell
        ? "Skill executes shell commands. Review commands carefully before installing."
        : "Skill uses dynamic code execution. Review usage carefully.",
    };
  }

  // Warning: critical findings exist
  if (criticalCount > 0) {
    return {
      verdict: "warning",
      reason: `${criticalCount} critical finding${criticalCount > 1 ? "s" : ""} detected. Manual review recommended.`,
    };
  }

  // Caution: warnings exist
  if (warningCount > 0) {
    return {
      verdict: "caution",
      reason: `${warningCount} warning${warningCount > 1 ? "s" : ""} found. Generally acceptable but worth reviewing.`,
    };
  }

  // New/unknown source may lower confidence
  if (source && source.publicRepos !== null && source.publicRepos < 3) {
    return {
      verdict: "caution",
      reason:
        "No code issues found, but the author has very few public repositories.",
    };
  }

  return {
    verdict: "safe",
    reason: "No suspicious patterns detected.",
  };
}

// ─── Main Audit Function ────────────────────────────────────────────────────

// Documentation files that should be excluded from security scanning.
// These files contain examples and instructions that reference commands
// (curl, exec, bash, etc.) but are not executable source code.
const DOC_EXTENSIONS = new Set([".md", ".txt", ".rst", ".adoc", ".markdown"]);

// Names of common documentation files to always exclude.
const DOC_FILENAMES = new Set([
  "SKILL.md",
  "README.md",
  "readme.md",
  "CHANGELOG.md",
  "changelog.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "CONTRIBUTING.md",
  "contributing.md",
  "CODE_OF_CONDUCT.md",
  "security.md",
  "SECURITY.md",
  "SUPPORT.md",
  "support.md",
  "TODO.md",
  "todo.md",
  "ROADMAP.md",
  "roadmap.md",
]);

function isDocFile(relPath: string): boolean {
  const basename = relPath.split("/").pop()!;
  if (DOC_FILENAMES.has(basename)) return true;
  const ext = basename.includes(".")
    ? `.${basename.split(".").pop()!.toLowerCase()}`
    : "";
  return DOC_EXTENSIONS.has(ext);
}

/**
 * Raise a verdict to at least `warning` when the audited folder has symlinks
 * that leave it, dangle, or loop (#779): an audit must never call `safe`
 * content that is not part of the folder or that it could not read.
 */
export function applyExternalSymlinks(
  verdict: SecurityVerdict,
  reason: string,
  links: ExternalSymlink[],
): { verdict: SecurityVerdict; reason: string } {
  if (links.length === 0) return { verdict, reason };
  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const outside = links.filter(
    (l) => l.kind === "file" || l.kind === "directory" || l.kind === "special",
  );
  const broken = links.filter(
    (l) => l.kind === "dangling" || l.kind === "loop",
  );
  const parts: string[] = [];
  if (outside.length > 0) {
    parts.push(
      `${count(outside.length, "symlink points", "symlinks point")} outside the skill folder (${outside.map((l) => l.path).join(", ")}); content outside the folder was NOT read and must be reviewed by hand`,
    );
  }
  if (broken.length > 0) {
    parts.push(
      `${count(broken.length, "symlink dangles or loops and was", "symlinks dangle or loop and were")} not followed (${broken.map((l) => l.path).join(", ")})`,
    );
  }
  const symlinkReason = `${parts.join("; ")}.`;
  if (verdict === "warning" || verdict === "dangerous") {
    return { verdict, reason: `${reason} ${symlinkReason}` };
  }
  return {
    verdict: "warning",
    reason: verdict === "safe" ? symlinkReason : `${symlinkReason} ${reason}`,
  };
}

export interface AuditSkillSecurityOptions {
  /**
   * Local-folder mode (#779): never read outside `skillPath`. Symlinks that
   * leave it, dangle, or loop are reported as critical findings (verdict at
   * least `warning`) and their targets are never opened, read or walked.
   */
  trackSymlinks?: boolean;
  /** Symlinks already found by the caller (e.g. a collection child link). */
  externalSymlinks?: ExternalSymlink[];
  /**
   * Set false to read nothing at all — used when `skillPath` itself is a
   * link outside the audited folder, so only the link findings are reported.
   */
  readFiles?: boolean;
}

export async function auditSkillSecurity(
  skillPath: string,
  skillName: string,
  sourceOwner?: string,
  sourceRepo?: string,
  options: AuditSkillSecurityOptions = {},
): Promise<SecurityAuditReport> {
  debug(`security-audit: scanning ${skillPath}`);

  const links: ExternalSymlink[] = [...(options.externalSymlinks ?? [])];

  // Read all files, excluding documentation
  const allFiles =
    options.readFiles === false
      ? []
      : await readFilesRecursive(
          skillPath,
          options.trackSymlinks
            ? { onExternalSymlink: (link) => links.push(link) }
            : {},
        );
  const files = allFiles.filter((f) => !isDocFile(f.relPath));
  const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0);

  // Source analysis (if GitHub source available)
  let source: SourceAnalysis | null = null;
  if (sourceOwner && sourceRepo) {
    source = await analyzeSource(sourceOwner, sourceRepo);
  }

  // Code scanning
  const codeScans = scanCode(files);

  // Permission analysis
  const permissions = analyzePermissions(codeScans);

  // Verdict
  const base = calculateVerdict(codeScans, permissions, source);
  const { verdict, reason } = applyExternalSymlinks(
    base.verdict,
    base.reason,
    links,
  );

  return {
    scannedAt: new Date().toISOString(),
    skillName,
    skillPath,
    source,
    codeScans,
    permissions,
    totalFiles: files.length,
    totalLines,
    verdict,
    verdictReason: reason,
    ...(links.length > 0 ? { externalSymlinks: links } : {}),
  };
}

// Re-exports — public surface preserved after the split (#677).
export {
  scanCode,
  analyzeSource,
  analyzePermissions,
} from "./security-auditor-scan";
export {
  formatSecurityReport,
  formatSecurityReportJSON,
} from "./security-auditor-report";
