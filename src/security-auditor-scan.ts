import { debug } from "./logger";
import type { FileContent } from "./utils/fs";
import type {
  SourceAnalysis,
  CodeScanMatch,
  CodeScanCategory,
  PermissionRequest,
} from "./utils/types";
import { errorMessage } from "./utils/errors";
// Split from security-auditor.ts (issue #677).

// ─── Code Scan Patterns ─────────────────────────────────────────────────────

interface ScanPattern {
  category: string;
  description: string;
  pattern: RegExp;
  severity: "critical" | "warning" | "info";
  permissionType?: PermissionRequest["type"];
}

const SCAN_PATTERNS: ScanPattern[] = [
  // Network / Data Exfiltration
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\bcurl\b/,
    severity: "critical",
    permissionType: "network",
  },
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\bwget\b/,
    severity: "critical",
    permissionType: "network",
  },
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\bfetch\s*\(/,
    severity: "warning",
    permissionType: "network",
  },
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\baxios\b/,
    severity: "warning",
    permissionType: "network",
  },
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\bhttp\.request\b/,
    severity: "warning",
    permissionType: "network",
  },
  {
    category: "Network requests",
    description:
      "Commands or APIs that download or upload data over the network",
    pattern: /\bXMLHttpRequest\b/,
    severity: "warning",
    permissionType: "network",
  },

  // External URLs
  {
    category: "External URLs",
    description:
      "Hardcoded URLs that may indicate data exfiltration or remote payload loading",
    pattern: /https?:\/\/(?!github\.com|localhost|127\.0\.0\.1|example\.com)/,
    severity: "warning",
    permissionType: "network",
  },

  // Shell Execution
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bexec\s*\(/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bexecSync\b/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bchild_process\b/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bspawn\s*\(/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bBun\.spawn\b/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\bshelljs\b/,
    severity: "critical",
    permissionType: "shell",
  },
  {
    category: "Shell execution",
    description:
      "Commands that execute shell processes or arbitrary system commands",
    pattern: /\b(?:bash|sh|zsh)\s+-c\b/,
    severity: "critical",
    permissionType: "shell",
  },

  // Code Execution
  {
    category: "Dynamic code execution",
    description:
      "Patterns that execute dynamically constructed code at runtime",
    pattern: /\beval\s*\(/,
    severity: "critical",
    permissionType: "code-execution",
  },
  {
    category: "Dynamic code execution",
    description:
      "Patterns that execute dynamically constructed code at runtime",
    pattern: /\bnew\s+Function\b/,
    severity: "critical",
    permissionType: "code-execution",
  },
  {
    category: "Dynamic code execution",
    description:
      "Patterns that execute dynamically constructed code at runtime",
    pattern: /\bFunction\s*\(/,
    severity: "critical",
    permissionType: "code-execution",
  },
  {
    category: "Dynamic code execution",
    description:
      "Patterns that execute dynamically constructed code at runtime",
    pattern: /\bimport\s*\(\s*[^'"]/,
    severity: "warning",
    permissionType: "code-execution",
  },

  // File System Access
  {
    category: "File system access",
    description: "Operations that read, write, or modify files on disk",
    pattern: /\bfs\.(?:write|append|unlink|rm|mkdir|rename)\b/,
    severity: "warning",
    permissionType: "filesystem",
  },
  {
    category: "File system access",
    description: "Operations that read, write, or modify files on disk",
    pattern: /\bwriteFile(?:Sync)?\b/,
    severity: "warning",
    permissionType: "filesystem",
  },
  {
    category: "File system access",
    description: "Operations that read, write, or modify files on disk",
    pattern: /\brm\s+-rf?\b/,
    severity: "critical",
    permissionType: "filesystem",
  },
  {
    category: "File system access",
    description: "Operations that read, write, or modify files on disk",
    pattern: /\bchmod\b/,
    severity: "warning",
    permissionType: "filesystem",
  },

  // Credentials / Secrets
  {
    category: "Embedded credentials",
    description: "Hardcoded secrets, API keys, tokens, or passwords",
    pattern: /\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_KEY)\s*[=:]/,
    severity: "critical",
  },
  {
    category: "Embedded credentials",
    description: "Hardcoded secrets, API keys, tokens, or passwords",
    pattern: /\bPASSWORD\s*[=:]/,
    severity: "critical",
  },
  {
    category: "Embedded credentials",
    description: "Hardcoded secrets, API keys, tokens, or passwords",
    pattern: /(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/,
    severity: "critical",
  },

  // Environment Access
  {
    category: "Environment variable access",
    description:
      "Reading environment variables which may contain secrets or configuration",
    pattern: /\bprocess\.env\b/,
    severity: "info",
    permissionType: "environment",
  },
  {
    category: "Environment variable access",
    description:
      "Reading environment variables which may contain secrets or configuration",
    pattern: /\bBun\.env\b/,
    severity: "info",
    permissionType: "environment",
  },

  // Obfuscation
  {
    category: "Obfuscation patterns",
    description:
      "Base64 encoding, hex strings, or other obfuscation techniques",
    pattern: /\batob\s*\(/,
    severity: "warning",
  },
  {
    category: "Obfuscation patterns",
    description:
      "Base64 encoding, hex strings, or other obfuscation techniques",
    pattern: /\bBuffer\.from\s*\([^,]+,\s*['"]base64['"]\)/,
    severity: "warning",
  },
  {
    category: "Obfuscation patterns",
    description:
      "Base64 encoding, hex strings, or other obfuscation techniques",
    pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){5,}/,
    severity: "warning",
  },
];

// ─── Source Analysis ─────────────────────────────────────────────────────────

export async function analyzeSource(
  owner: string,
  repo: string,
): Promise<SourceAnalysis> {
  const result: SourceAnalysis = {
    owner,
    repo,
    profileUrl: `https://github.com/${owner}`,
    reposUrl: `https://github.com/${owner}?tab=repositories`,
    isOrganization: null,
    publicRepos: null,
    accountAge: null,
    fetchError: null,
  };

  try {
    const response = await fetch(`https://api.github.com/users/${owner}`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "agent-skill-manager",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      result.fetchError = `GitHub API returned ${response.status}`;
      return result;
    }

    const data = (await response.json()) as Record<string, unknown>;
    result.isOrganization = data.type === "Organization";
    result.publicRepos =
      typeof data.public_repos === "number" ? data.public_repos : null;

    if (typeof data.created_at === "string") {
      const created = new Date(data.created_at);
      const now = new Date();
      const years = Math.floor(
        (now.getTime() - created.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
      );
      const months = Math.floor(
        ((now.getTime() - created.getTime()) % (365.25 * 24 * 60 * 60 * 1000)) /
          (30.44 * 24 * 60 * 60 * 1000),
      );
      result.accountAge = years > 0 ? `${years}y ${months}m` : `${months}m`;
    }

    debug(
      `security-audit: source analysis for ${owner} -> repos=${result.publicRepos}, org=${result.isOrganization}, age=${result.accountAge}`,
    );
  } catch (err) {
    result.fetchError = errorMessage(err) || "Failed to fetch GitHub profile";
    debug(`security-audit: source analysis failed -> ${result.fetchError}`);
  }

  return result;
}

// ─── Code Scanning ───────────────────────────────────────────────────────────

export function scanCode(files: FileContent[]): CodeScanCategory[] {
  const categoryMap = new Map<
    string,
    { description: string; matches: CodeScanMatch[] }
  >();

  for (const { relPath, content } of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      for (const pattern of SCAN_PATTERNS) {
        if (pattern.pattern.test(line)) {
          const key = pattern.category;
          if (!categoryMap.has(key)) {
            categoryMap.set(key, {
              description: pattern.description,
              matches: [],
            });
          }
          const match =
            trimmed.length > 120 ? trimmed.slice(0, 120) + "..." : trimmed;
          categoryMap.get(key)!.matches.push({
            file: relPath,
            line: i + 1,
            match,
            severity: pattern.severity,
          });
        }
      }
    }
  }

  const categories: CodeScanCategory[] = [];
  for (const [category, data] of categoryMap) {
    categories.push({
      category,
      description: data.description,
      matches: data.matches,
    });
  }

  // Sort: critical categories first
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  categories.sort((a, b) => {
    const aMax = Math.min(...a.matches.map((m) => severityOrder[m.severity]));
    const bMax = Math.min(...b.matches.map((m) => severityOrder[m.severity]));
    return aMax - bMax;
  });

  return categories;
}

// ─── Permission Analysis ─────────────────────────────────────────────────────

export function analyzePermissions(
  scanResults: CodeScanCategory[],
): PermissionRequest[] {
  const permMap = new Map<
    PermissionRequest["type"],
    { evidence: PermissionRequest["evidence"]; categories: Set<string> }
  >();

  for (const category of scanResults) {
    for (const match of category.matches) {
      // Find which pattern matched to get permission type
      for (const pattern of SCAN_PATTERNS) {
        if (
          pattern.permissionType &&
          pattern.category === category.category &&
          pattern.pattern.test(match.match)
        ) {
          const type = pattern.permissionType;
          if (!permMap.has(type)) {
            permMap.set(type, { evidence: [], categories: new Set() });
          }
          const entry = permMap.get(type)!;
          entry.evidence.push({
            file: match.file,
            line: match.line,
            match: match.match,
          });
          entry.categories.add(category.category);
          break;
        }
      }
    }
  }

  const PERMISSION_REASONS: Record<PermissionRequest["type"], string> = {
    filesystem:
      "Skill reads, writes, or modifies files on disk. Verify it only accesses intended paths.",
    shell:
      "Skill executes shell commands or spawns processes. This allows arbitrary system access.",
    network:
      "Skill makes network requests or downloads external content. Data may be sent to remote servers.",
    "code-execution":
      "Skill dynamically constructs and executes code. This can bypass static analysis.",
    environment:
      "Skill reads environment variables, which may contain secrets or API keys.",
  };

  const permissions: PermissionRequest[] = [];
  for (const [type, data] of permMap) {
    permissions.push({
      type,
      evidence: data.evidence,
      reason: PERMISSION_REASONS[type],
    });
  }

  // Sort by risk: shell and code-execution first
  const typeOrder: Record<string, number> = {
    shell: 0,
    "code-execution": 1,
    network: 2,
    filesystem: 3,
    environment: 4,
  };
  permissions.sort(
    (a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99),
  );

  return permissions;
}
