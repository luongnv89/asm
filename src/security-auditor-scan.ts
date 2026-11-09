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
  /**
   * `pattern` is the candidate (`CALL_CANDIDATE[call]`): a line it matches is
   * always reported, at `severity` when `isRealCall` accepts it and as a
   * `METHOD_CALL_CATEGORY` warning otherwise (#809).
   */
  call?: CallName;
}

// ─── Real-call matchers (#809) ──────────────────────────────────────────────
//
// `eval`, `exec`, `spawn` and `Function` are only dangerous as calls to the
// language's own builtin: a bare `eval(x)` / `exec(x)` or one through a global
// object (`window.eval(x)`, `builtins.exec(x)`). A method with the same name
// usually is not: `def eval(self, …)`, a JS method `eval(expr) {`,
// `self.eval(…)` in Python, `browser.eval(…)` or a regex's `re.exec(s)`.
//
// Invariant: every line the candidate pattern (the rule before #809) matches
// is still reported. A real call keeps its critical rule; a method-shaped one
// is a warning under `METHOD_CALL_CATEGORY`, never nothing. A line regex
// cannot tell `obj.eval` from an alias of the global object, so the warning
// keeps that line in front of the reader.

/** The builtins a method can share a name with. */
export type CallName = "eval" | "exec" | "spawn" | "Function";

/** The rules before #809: every line they match is reported. */
export const CALL_CANDIDATE: Readonly<Record<CallName, RegExp>> = {
  eval: /\beval\s*\(/,
  exec: /\bexec\s*\(/,
  spawn: /\bspawn\s*\(/,
  Function: /\bFunction\s*\(/,
};

/** Rule for a candidate that `isRealCall` rejects: a warning (#809). */
export const METHOD_CALL_CATEGORY = "Method named eval/exec/spawn/Function";
const METHOD_CALL_DESCRIPTION =
  "A method or attribute call named like a builtin (`obj.eval(…)`, `def eval(self, …)`): check it is not dynamic code";

/** The only files whose method shapes the real-call matchers model (#809). */
type CallLanguage = "python" | "js" | "ts";
const PYTHON_FILE = /\.py$/i;
const JS_FILE = /\.[mc]?js$/i;
/** TypeScript source, the only place a `name(params): T {` method exists. */
const TYPESCRIPT_FILE = /\.(?:tsx?|mts|cts)$/i;

function callLanguage(relPath: string): CallLanguage | null {
  if (PYTHON_FILE.test(relPath)) return "python";
  if (JS_FILE.test(relPath)) return "js";
  if (TYPESCRIPT_FILE.test(relPath)) return "ts";
  return null;
}

/** Expression keywords: `: void {}` is a ternary's else-branch, not a type. */
const NOT_A_TYPE = String.raw`(?!(?:typeof|class|new|delete|await|yield|void)\b)`;

/** `def name(`, `function name(` or `function* name(`: a definition. */
const NOT_A_DEFINITION = String.raw`(?<!\b(?:def|function\s*\*?)\s+)`;
/**
 * `name(params) {` opening the line (after optional modifiers): a JS/TS
 * method definition. Anchored to the line start so a call in an expression,
 * such as `c ? eval(x) : {}`, is never taken for one. With `typed` (TS files
 * only), a return type is allowed too (#809):
 * - `name(params): T {`, where `T` is a dotted name, optionally `[]`. Never
 *   `: {` — the `: {}` branch of a ternary wrapped onto this line — nor an
 *   expression keyword (`: void {}`, `: class {}`), nor `: a<b>{}`, which is
 *   a comparison;
 * - after a modifier (`async`, `private`, …), any return type not opening
 *   with `{`: a modifier before `name(` never continues an expression.
 */
function notAMethodBody(name: string, typed = false): string {
  const mod = String.raw`(?:async|static|get|set|public|private|protected|override)\s+`;
  const head = String.raw`${name}\s*\([^()]*\)\s*`;
  const plain = String.raw`(?<=^\s*(?:${mod})*)${head}`;
  if (!typed) return String.raw`(?!${plain}\{)`;
  const named = String.raw`(?::\s*${NOT_A_TYPE}[\w$]+(?:\.[\w$]+)*(?:\s*\[\s*\])*\s*)?\{`;
  const modified = String.raw`(?<=^\s*(?:${mod})+)${head}:\s*[\w$][^{;=?]*\{`;
  return String.raw`(?!${plain}${named}|${modified})`;
}

/**
 * Match a call to `name` that can reach the builtin: bare (not preceded by
 * an identifier character or by a receiver's `.`), or through one of
 * `receivers`. Definitions and calls on any other object do not match.
 */
function realCall(
  name: string,
  receivers: string[] = [],
  typed = false,
): RegExp {
  // Not after an identifier, and not after `.` when an identifier receiver
  // precedes it on this line. Any other receiver may be the global object:
  // `(globalThis).eval(`, `globalThis/**/.eval(`, `f().exec(`. A spread
  // `...eval(` is a call, and so is a line opening with `.eval(` or
  // `?.eval(`: its receiver is on the line before and may be `globalThis`
  // (#809). A wrapped `browser\n  .eval(` is flagged too, by design.
  const bare = String.raw`(?<![\w$])(?<![\w$]\s*\??\.)${NOT_A_DEFINITION}`;
  const via = receivers.length
    ? String.raw`|\b(?:${receivers.join("|")})\s*\??\.\s*`
    : "";
  return new RegExp(
    String.raw`(?:${bare}${via})${notAMethodBody(name, typed)}${name}\s*\(`,
  );
}

/** Objects whose `eval` / `Function` is the global one. */
const GLOBAL_OBJECTS = ["window", "globalThis", "global"];
/** Python modules whose `eval` / `exec` is the builtin. */
const PY_BUILTINS = [
  "builtins",
  "__builtins__",
  String.raw`__import__\s*\(\s*['"](?:builtins|__builtin__)['"]\s*\)`,
  String.raw`importlib\s*\.\s*import_module\s*\(\s*['"]builtins['"]\s*\)`,
];

const EVAL_RECEIVERS = [...GLOBAL_OBJECTS, ...PY_BUILTINS];
const EXEC_RECEIVERS = ["child_process", "childProcess", "cp", ...PY_BUILTINS];

/** `spawn(` is a process spawn on any receiver: exempt definitions only. */
function spawnCall(typed = false): RegExp {
  return new RegExp(
    String.raw`${NOT_A_DEFINITION}${notAMethodBody("spawn", typed)}\bspawn\s*\(`,
  );
}

/** Real-call matchers per language. `self.` is the global object outside Python. */
const REAL_CALL: Record<CallLanguage, Record<CallName, RegExp>> = {
  python: {
    eval: realCall("eval", EVAL_RECEIVERS),
    exec: realCall("exec", EXEC_RECEIVERS),
    spawn: spawnCall(),
    Function: realCall("Function", GLOBAL_OBJECTS),
  },
  js: {
    eval: realCall("eval", [...EVAL_RECEIVERS, "self"]),
    exec: realCall("exec", EXEC_RECEIVERS),
    spawn: spawnCall(),
    Function: realCall("Function", [...GLOBAL_OBJECTS, "self"]),
  },
  ts: {
    eval: realCall("eval", [...EVAL_RECEIVERS, "self"], true),
    exec: realCall("exec", EXEC_RECEIVERS, true),
    spawn: spawnCall(true),
    Function: realCall("Function", [...GLOBAL_OBJECTS, "self"], true),
  },
};

/**
 * Whether a line that `CALL_CANDIDATE[name]` matches can call the builtin.
 * Only `.py`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts` files get
 * the method-shape exemptions; in any other file every candidate is real, as
 * before #809. Shared with the `asm install` preview so both scans agree.
 */
export function isRealCall(
  name: CallName,
  line: string,
  relPath: string,
): boolean {
  const language = callLanguage(relPath);
  return language === null || REAL_CALL[language][name].test(line);
}

/**
 * Replace control bytes (C0 except tab, DEL, C1) so a finding never writes
 * raw NUL or escape sequences to the terminal (#809).
 */
export function stripControlBytes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0a-\x1f\x7f-\x9f]/g, "?");
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
    pattern: CALL_CANDIDATE.exec,
    call: "exec",
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
    // Only definitions are method-shaped: `cp.spawn(`, `pty.spawn(` and
    // `pexpect.spawn(` are real process spawns (#809).
    pattern: CALL_CANDIDATE.spawn,
    call: "spawn",
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
    pattern: CALL_CANDIDATE.eval,
    call: "eval",
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
    pattern: CALL_CANDIDATE.Function,
    call: "Function",
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
      const trimmed = stripControlBytes(line.trim());

      for (const pattern of SCAN_PATTERNS) {
        if (!pattern.pattern.test(line)) continue;
        // A candidate is always reported: critical when it can reach the
        // builtin, otherwise a method-shaped warning (#809).
        const method =
          pattern.call !== undefined &&
          !isRealCall(pattern.call, line, relPath);
        const key = method ? METHOD_CALL_CATEGORY : pattern.category;
        if (!categoryMap.has(key)) {
          categoryMap.set(key, {
            description: method ? METHOD_CALL_DESCRIPTION : pattern.description,
            matches: [],
          });
        }
        const match =
          trimmed.length > 120 ? trimmed.slice(0, 120) + "..." : trimmed;
        categoryMap.get(key)!.matches.push({
          file: relPath,
          line: i + 1,
          match,
          severity: method ? "warning" : pattern.severity,
        });
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
