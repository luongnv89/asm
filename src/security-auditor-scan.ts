import { debug } from "./logger";
import type { FileContent } from "./utils/fs";
import type {
  SourceAnalysis,
  CodeScanMatch,
  CodeScanCategory,
  PermissionRequest,
} from "./utils/types";
import { errorMessage } from "./utils/errors";
import { stripControlBytes } from "./utils/control-chars";
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
  /** Only in these files (`"other"`: neither Python nor JS/TS). */
  languages?: FileLanguage[];
  /** A line this also matches is left to the rule that owns it. */
  unless?: RegExp;
}

// ─── Real-call matchers (#809) ──────────────────────────────────────────────
//
// `eval`, `exec`, `spawn` and `Function` are only dangerous as calls to the
// language's own builtin: a bare `eval(x)` / `exec(x)` or one through a global
// object (`window.eval(x)`, `builtins.exec(x)`). A method with the same name
// usually is not: a Python `def eval(self, …)`, `self.eval(…)` in Python,
// `browser.eval(…)` or a regex's `re.exec(s)`.
//
// A JS/TS method definition (`eval(x) {`, `async eval(x): T {`) and a JS
// `function eval(` are not exempt: a call's own arguments can forge the
// method shape (`eval("){".slice(2) + c)`, `eval(/*){*/c)`), so every such
// line is a call, as before #809 (AC1 addendum). Only a Python `def` makes a
// name a definition.
//
// Invariant: every line the candidate pattern (the rule before #809) matches
// is still reported. A real call keeps its critical rule; a method-shaped one
// is a warning under `METHOD_CALL_CATEGORY`, never nothing. A line regex
// cannot tell `obj.eval` from an alias of the global object, so the warning
// keeps that line in front of the reader.

/** The builtins a method can share a name with. */
export type CallName = "eval" | "exec" | "spawn" | "Function";

/**
 * The opening of a call after the name: `(`, or TypeScript's `<T>(`, `!(`
 * and the optional call `?.(` (#820): `eval<any>(x)`, `eval!(x)`.
 */
const CALL_OPEN = String.raw`\s*(?:<[^<>()\n]*>\s*)?(?:!\s*)?(?:\?\.\s*)?\(`;

/** The rules before #809, plus TS call syntax: every line they match is reported. */
export const CALL_CANDIDATE: Readonly<Record<CallName, RegExp>> = {
  eval: new RegExp(String.raw`\beval${CALL_OPEN}`),
  exec: new RegExp(String.raw`\bexec${CALL_OPEN}`),
  spawn: new RegExp(String.raw`\bspawn${CALL_OPEN}`),
  Function: new RegExp(String.raw`\bFunction${CALL_OPEN}`),
};

/** Rule for a candidate that `isRealCall` rejects: a warning (#809). */
export const METHOD_CALL_CATEGORY = "Method named eval/exec/spawn/Function";
const METHOD_CALL_DESCRIPTION =
  "A method or attribute call named like a builtin (`obj.eval(…)`, `def eval(self, …)`): check it is not dynamic code";

/** The only files whose method shapes the real-call matchers model (#809). */
type CallLanguage = "python" | "js";
/** A file's language for rules gated by `languages`. */
export type FileLanguage = CallLanguage | "other";
const PYTHON_FILE = /\.py$/i;
/** JavaScript and TypeScript source. */
const JS_FILE = /\.(?:[mc]?js|tsx?|[mc]ts)$/i;

function callLanguage(relPath: string): CallLanguage | null {
  if (PYTHON_FILE.test(relPath)) return "python";
  if (JS_FILE.test(relPath)) return "js";
  return null;
}

/**
 * Whitespace within one line. `\s` would also span `\r`, which ends a line
 * in JS and Python but not in the `\n` split, so `def\reval(x)` (`def`, then
 * a call) would pass for a definition (#809).
 */
const H = String.raw`[^\S\r\n\u2028\u2029]`;

/**
 * A Python `def name(`: a definition, the only one exempt (#809). Within one
 * line only (`H`): `def<CR>eval(x)` is `def` and then a call.
 */
const NOT_A_DEFINITION = String.raw`(?<!\bdef${H}+)`;

/**
 * Match a call to `name` that can reach the builtin: bare (not preceded by
 * an identifier character or by a receiver's `.`), or through one of
 * `receivers`. Calls on any other object do not match, nor, with `python`,
 * a `def`.
 */
function realCall(
  name: string,
  receivers: string[],
  python: boolean,
  aliases: string[] = [],
): RegExp {
  // Not after an identifier, and not after `.` when an identifier receiver
  // precedes it on this line. Any other receiver may be the global object:
  // `(globalThis).eval(`, `globalThis/**/.eval(`, `f().exec(`. A spread
  // `...eval(` is a call, and so is a line opening with `.eval(` or
  // `?.eval(`: its receiver is on the line before and may be `globalThis`
  // (#809). A wrapped `browser\n  .eval(` is flagged too, by design, and so
  // is `browser\r  .eval(`.
  const definition = python ? NOT_A_DEFINITION : "";
  const bare = String.raw`(?<![\w$])(?<![\w$]${H}*\??\.)${definition}`;
  // An alias may start with `$`, where `\b` cannot anchor it.
  const alias = aliases.length
    ? String.raw`|(?<![\w$])(?:${aliases.join("|")})`
    : "";
  const via = String.raw`(?:\b(?:${receivers.join("|")})${alias})\s*\??\.\s*`;
  return new RegExp(String.raw`(?:${bare}|${via})${name}${CALL_OPEN}`);
}

/** Objects whose `eval` / `Function` is the global one. */
const GLOBAL_OBJECTS = ["window", "globalThis", "global"];
/**
 * Browser aliases of the global object, JS/TS only (#820): `top.eval(x)`,
 * `window.parent.eval(x)`, `frames.eval(x)`, `document.defaultView.eval(x)`.
 * `this` is not one: in a class it is the instance, so `this.eval(x)` stays
 * a method-shaped warning.
 */
const JS_GLOBAL_ALIASES = ["self", "top", "parent", "frames", "defaultView"];
/** Python modules whose `eval` / `exec` is the builtin. */
const PY_BUILTINS = [
  "builtins",
  "__builtins__",
  String.raw`__import__\s*\(\s*['"](?:builtins|__builtin__)['"]\s*\)`,
  String.raw`importlib\s*\.\s*import_module\s*\(\s*['"]builtins['"]\s*\)`,
];

const EVAL_RECEIVERS = [...GLOBAL_OBJECTS, ...PY_BUILTINS];
const EXEC_RECEIVERS = ["child_process", "childProcess", "cp", ...PY_BUILTINS];

/**
 * Real-call matchers per language. `self.` is the global object outside
 * Python. `spawn(` is a process spawn on any receiver, so only a Python
 * `def spawn(` is exempt; in JS/TS every `spawn(` is real.
 */
function realCalls(
  language: CallLanguage,
  aliases: string[] = [],
): Record<CallName, RegExp> {
  if (language === "python") {
    return {
      eval: realCall("eval", EVAL_RECEIVERS, true, aliases),
      exec: realCall("exec", EXEC_RECEIVERS, true, aliases),
      spawn: new RegExp(String.raw`${NOT_A_DEFINITION}\bspawn${CALL_OPEN}`),
      Function: realCall("Function", GLOBAL_OBJECTS, true),
    };
  }
  const globals = [...GLOBAL_OBJECTS, ...JS_GLOBAL_ALIASES];
  return {
    eval: realCall("eval", [...PY_BUILTINS, ...globals], false, aliases),
    exec: realCall("exec", EXEC_RECEIVERS, false),
    spawn: CALL_CANDIDATE.spawn,
    Function: realCall("Function", globals, false, aliases),
  };
}

const REAL_CALL: Record<CallLanguage, Record<CallName, RegExp>> = {
  python: realCalls("python"),
  js: realCalls("js"),
};

/** A JS/TS global object, as the right-hand side of an alias. */
const JS_GLOBAL_VALUE = String.raw`(?:globalThis|window|global|self|top|parent|frames|(?:document\s*\??\.\s*)?defaultView)`;
/** `g = globalThis;`, `const w = window.parent` (#820). */
const JS_ALIAS = new RegExp(
  String.raw`(?<![\w$.])([A-Za-z_$][\w$]*)\s*=\s*${JS_GLOBAL_VALUE}(?:\s*\??\.\s*${JS_GLOBAL_VALUE})*\s*(?=[;,)\]}]|$)`,
  "gm",
);
/** `import builtins as b`, `b = builtins`, `b = __builtins__` (#820). */
const PY_ALIAS =
  /(?:\bimport\s+(?:builtins|__builtin__)\s+as\s+([A-Za-z_]\w*))|(?:^|[;\s])([A-Za-z_]\w*)\s*=\s*(?:builtins|__builtins__)\s*(?=[;#]|$)/gm;

/** Per-file state for the line rules: language and global aliases (#820). */
export interface FileScanContext {
  relPath: string;
  language: CallLanguage | null;
  /** Real-call matchers widened by this file's aliases; null: the defaults. */
  realCalls: Record<CallName, RegExp> | null;
}

/**
 * The context for one file. A name the file assigns from the global object
 * (`g = globalThis`) or imports as `builtins` is a receiver like the global
 * itself, anywhere in that file: the alias residual of #809, accepted there
 * and made critical by #820. A bare `g.eval(x)` with no such assignment is
 * still a method-shaped warning.
 */
export function fileScanContext(
  relPath: string,
  content: string,
): FileScanContext {
  const language = callLanguage(relPath);
  const aliases = new Set<string>();
  if (language !== null) {
    const text = interpretedText(content, language);
    const re = language === "js" ? JS_ALIAS : PY_ALIAS;
    for (const m of text.matchAll(re)) aliases.add((m[1] ?? m[2])!);
  }
  const receivers = [...aliases].map((a) => a.replace(/\$/g, "\\$"));
  return {
    relPath,
    language,
    realCalls:
      language !== null && receivers.length > 0
        ? realCalls(language, receivers)
        : null,
  };
}

/**
 * Whether a line that `CALL_CANDIDATE[name]` matches can call the builtin.
 * Only `.py`, `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts` files get
 * the method-shape exemptions; in any other file every candidate is real, as
 * before #809. A line is real when either its raw text or its interpreted
 * text matches, so a spelling can only make a call more real, never exempt
 * it. Shared with the `asm install` preview so both scans agree.
 */
export function isRealCall(
  name: CallName,
  line: string,
  relPath: string,
  context?: FileScanContext,
): boolean {
  const language = callLanguage(relPath);
  if (language === null) return true;
  const matcher = (context?.realCalls ?? REAL_CALL[language])[name];
  return matcher.test(line) || matcher.test(interpretedText(line, language));
}

/**
 * Whether `line` is a candidate for `name`: its raw text or, in a Python or
 * JS/TS file, its interpreted text matches (#820). CPython runs `ｅｖａｌ(x)`
 * as `eval(x)` (NFKC) and JS runs `\u0065val(x)` as `eval(x)`.
 */
export function isCallCandidate(
  name: CallName,
  line: string,
  relPath: string,
): boolean {
  if (CALL_CANDIDATE[name].test(line)) return true;
  const language = callLanguage(relPath);
  if (language === null) return false;
  const text = interpretedText(line, language);
  return text !== line && CALL_CANDIDATE[name].test(text);
}

/** The parts of a line rule `matchLineRule` reads. */
export interface LineRule {
  pattern: RegExp;
  call?: CallName;
  languages?: FileLanguage[];
  unless?: RegExp;
}

/**
 * How one rule matches one line, shared by `asm audit security` and the
 * `asm install` / `asm get` preview so both classify a line alike (#820):
 * `"real"` keeps the rule's own category, `"method"` is a
 * `METHOD_CALL_CATEGORY` warning, `null` is no match.
 */
export function matchLineRule(
  rule: LineRule,
  line: string,
  context: FileScanContext,
): "real" | "method" | null {
  if (rule.languages && !rule.languages.includes(context.language ?? "other"))
    return null;
  if (rule.call !== undefined) {
    if (!isCallCandidate(rule.call, line, context.relPath)) return null;
    return isRealCall(rule.call, line, context.relPath, context)
      ? "real"
      : "method";
  }
  if (!rule.pattern.test(line)) return null;
  if (rule.unless?.test(line)) return null;
  return "real";
}

/** A JS/TS `\uXXXX` or `\u{…}` escape, which an identifier may contain. */
const UNICODE_ESCAPE = /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g;

/**
 * The line as the interpreter reads its identifiers, so a receiver cannot
 * hide by spelling (#809): Python NFKC-normalises identifiers (`ｂuiltins` is
 * `builtins`); JS and TS resolve `\u` escapes in them (`glob\u0061lThis`
 * is `globalThis`).
 * The whole line is rewritten, strings and comments included, so it only
 * ever adds a match to the raw line's (`isRealCall`); the candidate still
 * matches the raw line.
 */
function interpretedText(line: string, language: CallLanguage): string {
  // ASCII is its own NFKC form, and a line with no `\u` has no escape.
  if (language === "python") {
    // eslint-disable-next-line no-control-regex
    return /^[\x00-\x7f]*$/.test(line) ? line : line.normalize("NFKC");
  }
  if (!line.includes("\\u")) return line;
  return line.replace(UNICODE_ESCAPE, (escape, braced, plain) => {
    const codePoint = parseInt(braced ?? plain, 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : escape;
  });
}

// Replace control bytes (C0 except tab, DEL, C1) so a finding never writes
// raw NUL or escape sequences to the terminal (#809). Shared with every human
// formatter since #830; re-exported here for existing importers.
export { stripControlBytes };

// ─── Indirect and string-based execution (#815, #820) ───────────────────────

/** Rule for execution a line regex can only suspect: a warning. */
export const POSSIBLE_DYNAMIC_CATEGORY = "Possible dynamic code execution";
const POSSIBLE_DYNAMIC_DESCRIPTION =
  'Heuristic: eval used as a value, a computed `["eval"]` or `getattr(…, "eval")` on an unknown object, or a string passed to setTimeout/setInterval. A line rule cannot confirm it runs code: check it by hand';

/**
 * A shared rule beyond the `CALL_CANDIDATE` calls. `shell` and `code` are
 * critical (audit "Shell execution" / "Dynamic code execution", preview
 * "Shell commands" / "Code execution"); `possible` is a
 * `POSSIBLE_DYNAMIC_CATEGORY` warning in both.
 */
export interface DynamicExecRule extends LineRule {
  kind: "shell" | "code" | "possible";
}

/** A JS global object as a receiver, `globalThis` through `defaultView`. */
const GLOBAL_RECEIVER = String.raw`\b(?:globalThis|window|global|self|top|parent|frames|defaultView)\s*(?:\?\.\s*)?`;
/** A quoted `eval` or `Function` key: `["eval"]`, `['Function']`. */
const QUOTED_EVAL = String.raw`\[\s*(['"\`])(?:eval|Function)\1\s*\]`;
/** `(0, eval)(x)`, `(eval as any)(x)`, `(<any>eval)(x)`: eval called indirectly. */
const INDIRECT_EVAL = /\beval\s*(?:!\s*|\bas\s+[^()\n]*?)?\)\s*\(/;
const GLOBAL_BRACKET_EVAL = new RegExp(GLOBAL_RECEIVER + QUOTED_EVAL);
const PY_BUILTINS_GETATTR = new RegExp(
  String.raw`\bgetattr\s*\(\s*(?:${PY_BUILTINS.join("|")})\s*,\s*['"](?:eval|exec)['"]`,
);

export const DYNAMIC_EXEC_RULES: readonly DynamicExecRule[] = [
  // Shell `eval "$x"` / `eval $(…)` at a command position. Not `asm eval
  // "$dir"`: there `eval` is an argument.
  {
    kind: "shell",
    pattern:
      /(?:^|[;&|({`]|\$\(|\b(?:then|do|else|sudo|command|builtin)\b)\s*eval\s+["'$`]/,
  },
  // A download piped into a shell, with or without flags: `curl … | sh`,
  // `wget -qO- … | sudo bash -s --`, `bash <(curl …)`. The command needs an
  // argument, so prose shorthand such as "a `curl | sh` installer" is not one.
  {
    kind: "shell",
    pattern:
      /\b(?:curl|wget)(?:\s+[^\s|\\]+)+\s*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+(?:\w+=\S*\s+)*)?(?:ba|z|da|k|fi)?sh\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
  },
  // Python 2's `exec` statement: `exec "code"`, `exec code in ns`.
  {
    kind: "code",
    pattern: /^\s*exec\s+(?![=(])\S/,
    languages: ["python"],
  },
  { kind: "code", pattern: INDIRECT_EVAL },
  // `globalThis["eval"](x)`: the global's eval through a computed key.
  {
    kind: "code",
    pattern: GLOBAL_BRACKET_EVAL,
    languages: ["js", "other"],
  },
  {
    kind: "code",
    pattern: PY_BUILTINS_GETATTR,
    languages: ["python", "other"],
  },
  // The same on another object: may be a method, so a warning.
  {
    kind: "possible",
    pattern: /\[\s*(['"`])(?:eval|exec|Function|spawn)\1\s*\]\s*(?:\?\.\s*)?\(/,
    unless: GLOBAL_BRACKET_EVAL,
    languages: ["js", "other"],
  },
  {
    kind: "possible",
    pattern: /\bgetattr\s*\([^,\n]+,\s*['"](?:eval|exec)['"]/,
    unless: PY_BUILTINS_GETATTR,
    languages: ["python", "other"],
  },
  // eval as a value, called later: `f = eval if c else y`, `const f = eval;`,
  // `c ? eval : y`. Python and JS/TS only, and only between an assignment,
  // `return` or a ternary and the end of an expression: in a comment or
  // docstring, "network, eval, git" or "layouts: eval dirs" is prose.
  {
    kind: "possible",
    pattern:
      /(?:(?<![=!<>])=(?!=)|=>|[?:]|\|\||&&|\b(?:return|yield|else|or|and)\b)\s*eval\s*(?:$|[;,)\]}]|:(?!\w)|\b(?:if|else|or|and)\b|\|\||&&|\?\?)/,
    unless: INDIRECT_EVAL,
    languages: ["python", "js"],
  },
  // A string timer body is code: `setTimeout("run()", 10)`.
  {
    kind: "possible",
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
  },
];

const SHELL_DESCRIPTION =
  "Commands that execute shell processes or arbitrary system commands";
const DYNAMIC_DESCRIPTION =
  "Patterns that execute dynamically constructed code at runtime";

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
    // Only a Python `def spawn(` is method-shaped: `cp.spawn(`, `pty.spawn(`
    // and `pexpect.spawn(` are real process spawns (#809).
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
  ...DYNAMIC_EXEC_RULES.map(({ kind, ...rule }): ScanPattern =>
    kind === "possible"
      ? {
          ...rule,
          category: POSSIBLE_DYNAMIC_CATEGORY,
          description: POSSIBLE_DYNAMIC_DESCRIPTION,
          severity: "warning",
        }
      : {
          ...rule,
          category:
            kind === "shell" ? "Shell execution" : "Dynamic code execution",
          description:
            kind === "shell" ? SHELL_DESCRIPTION : DYNAMIC_DESCRIPTION,
          severity: "critical",
          permissionType: kind === "shell" ? "shell" : "code-execution",
        },
  ),

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

  // Hidden Unicode (#835): bidi embeddings, overrides and isolates make code
  // read differently from how it runs. LRM/RLM/ALM are left out: they occur
  // in ordinary right-to-left text.
  {
    category: "Hidden Unicode (Trojan Source)",
    description:
      "Unicode bidi control characters that can make code display differently from how it runs",
    pattern: /[\u202a-\u202e\u2066-\u2069]/,
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
    const context = fileScanContext(relPath, content);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = stripControlBytes(line.trim());

      for (const pattern of SCAN_PATTERNS) {
        // A candidate is always reported: critical when it can reach the
        // builtin, otherwise a method-shaped warning (#809).
        const hit = matchLineRule(pattern, line, context);
        if (hit === null) continue;
        const method = hit === "method";
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
          file: stripControlBytes(relPath),
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
          matchLineRule(
            pattern,
            match.match,
            fileScanContext(match.file, ""),
          ) !== null
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
