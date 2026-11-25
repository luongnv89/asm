import { posix } from "path";
import { debug } from "./logger";
import type { FileContent } from "./utils/fs";
import type {
  SourceAnalysis,
  CodeScanMatch,
  CodeScanCategory,
  ExternalSymlink,
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
    ? String.raw`|(?<![\w$.])(?:${aliases.join("|")})`
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
  // The interpreted text too, so `(0, \u0065val)(x)` is still indirect eval.
  const texts =
    context.language === null
      ? [line]
      : [line, interpretedText(line, context.language)];
  if (!texts.some((t) => rule.pattern.test(t))) return null;
  if (texts.some((t) => rule.unless?.test(t))) return null;
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
// The `as` type is bounded so a long line cannot backtrack quadratically.
const INDIRECT_EVAL =
  /\beval\s*(?:!\s*|\bas\s+[^()\n]{0,80}?)?\)\s*(?:\?\.\s*)?\(/;
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
      /\b(?:curl|wget)(?:\s+[^\s|\\]+)+\s*\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+(?:\w+=\S*\s+)*)?(?:\/\S*\/)?(?:ba|z|da|k|fi)?sh\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
  },
  // Python 2's `exec` statement: `exec "code"`, `exec code in ns`.
  {
    kind: "code",
    pattern: /^\s*exec\s+(?:[rbuRBU]{0,2}['"]|[\w.]+\s*(?:$|#|\bin\b))/,
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
      /(?:(?<![=!<>])=(?!=)|=>|[?:]|\|\||&&|\b(?:return|yield|else|or|and)\b)\s*eval\s*(?:$|[;)\]}]|:(?!\w)|\b(?:if|else|or|and)\b|\|\||&&|\?\?)/,
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

// ─── MCP server and hook configs (#886) ─────────────────────────────────────
//
// A skill can ship the config an agent reads to start tool servers
// (`.mcp.json`) or run hooks (`settings.json`). Each entry runs a command on
// the user's machine. Configs are matched by exact file name (any case),
// anywhere in the folder the confined walk read, and only parsed as JSON:
// nothing in them is run, and a path they name is looked up only among the
// files the walk already read, never opened. Decisions use the original
// strings; only renderers strip control bytes and clip.

/** Audit and install-preview category for these configs (#886). */
export const AGENT_CONFIG_CATEGORY = "MCP servers and hooks";
/** Install-preview category for a config finding with a risk: high risk. */
export const AGENT_CONFIG_RISK_CATEGORY =
  "MCP servers and hooks (unpinned or credentials)";
export const AGENT_CONFIG_DESCRIPTION =
  "MCP servers and hooks the skill ships: an agent that loads the config runs each command on the user's machine";

/** Files that are an MCP config whatever they hold. */
const MCP_CONFIG_NAMES = new Set([".mcp.json", "mcp.json"]);
/** Agent configs and manifests: a finding when they hold servers or hooks. */
const AGENT_CONFIG_NAMES = new Set([
  ...MCP_CONFIG_NAMES,
  "plugin.json",
  "gemini-extension.json",
  "settings.json",
  "settings.local.json",
  "hooks.json",
]);

/**
 * Findings listed per config file; the rest fold into one that keeps their
 * risks. Also bounds the line lookups, each a scan of the file.
 */
const MAX_FINDINGS_PER_CONFIG = 100;
/** How deep the hook walk descends into `hooks`. */
const MAX_HOOK_DEPTH = 8;
/** Paths a manifest's `mcpServers` / `hooks` may name that are looked up. */
const MAX_CONFIG_REFERENCES = 20;

function lowerBaseName(relPath: string): string {
  return (relPath.split("/").pop() ?? "").toLowerCase();
}

/** Whether `relPath` names an agent config, by exact name in any case. */
export function isAgentConfigFile(relPath: string): boolean {
  return AGENT_CONFIG_NAMES.has(lowerBaseName(relPath));
}

export interface AgentConfigFinding {
  /** Config path relative to the skill folder (original string). */
  file: string;
  line: number;
  kind: "mcp-server" | "hook" | "config" | "unreadable";
  /** Server name, hook event, or what is wrong with the config. */
  name: string;
  /** The full command line or URL; empty when there is none. */
  command: string;
  /** Why the finding is dangerous; empty: a warning. */
  risks: string[];
}

export interface AgentConfigInputs {
  /** Files the walk read. */
  files: FileContent[];
  /** Entries the walk saw but did not read: over the size cap, not regular. */
  unread?: string[];
  /** Links the confined walk did not follow; their targets are never read. */
  externalSymlinks?: ExternalSymlink[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(obj: JsonObject, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** An exact version: `1.2.3`, `v1.2.3-rc.1`. Ranges and tags are not. */
const EXACT_VERSION =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A local path: running it fetches nothing. */
function isLocalSpec(spec: string): boolean {
  return /^(?:\.{1,2}[\\/]|[\\/~]|file:|[A-Za-z]:[\\/])/.test(spec);
}

/** `name@1.2.3`, `@scope/name@1.2.3`, `npm:name@1.2.3`, `jsr:@s/n@1.2.3`. */
function isPinnedNpmSpec(spec: string): boolean {
  const m =
    /^(?:npm:|jsr:)?(?:@[^/@\s]+\/)?[^/@\s:]+@([^@\s/]+)(?:\/.*)?$/.exec(spec);
  return m !== null && EXACT_VERSION.test(m[1]);
}

/** `name==1.2.3`, `name[extra]==1.2.3`, uv's `name@1.2.3`. */
function isPinnedPySpec(spec: string): boolean {
  const m = /^[A-Za-z0-9][\w.-]*(?:\[[\w.,\s-]*\])?(?:==|@)([^=@\s,;]+)$/.exec(
    spec,
  );
  return m !== null && EXACT_VERSION.test(m[1]);
}

/** An image with a digest, or a tag other than `latest`. */
function isPinnedImage(image: string): boolean {
  if (/@sha256:[0-9a-f]{64}$/i.test(image)) return true;
  const name = image.slice(image.lastIndexOf("/") + 1);
  const colon = name.lastIndexOf(":");
  return colon !== -1 && name.slice(colon + 1).toLowerCase() !== "latest";
}

/** `module@v1.2.3`. */
function isPinnedGoSpec(spec: string): boolean {
  const at = spec.lastIndexOf("@");
  return at !== -1 && EXACT_VERSION.test(spec.slice(at + 1));
}

type Ecosystem = "npm" | "py" | "image" | "deno" | "go";

/** Whether `spec` names remote code, and whether it is pinned. */
const SPEC_RULES: Record<
  Ecosystem,
  { remote: (spec: string) => boolean; pinned: (spec: string) => boolean }
> = {
  npm: { remote: (s) => !isLocalSpec(s), pinned: isPinnedNpmSpec },
  py: { remote: (s) => !isLocalSpec(s), pinned: isPinnedPySpec },
  image: { remote: () => true, pinned: isPinnedImage },
  // `deno run main.ts` is local; `npm:`, `jsr:` and URLs are fetched.
  deno: {
    remote: (s) => /^(?:npm:|jsr:|https?:)/i.test(s),
    pinned: (s) => !/^https?:/i.test(s) && isPinnedNpmSpec(s),
  },
  // `go run ./cmd` builds local code; `go run mod@version` fetches.
  go: {
    remote: (s) => s.includes("@") && !isLocalSpec(s),
    pinned: isPinnedGoSpec,
  },
};

/** Options whose value is a package spec to check. */
const SPEC_OPTIONS: Partial<Record<Ecosystem, ReadonlySet<string>>> = {
  npm: new Set(["-p", "--package"]),
  py: new Set(["--from", "--spec", "--with"]),
};
/** Words a runner reads after it, at most: bounds the scan (#886). */
const RUNNER_WINDOW = 32;

/** Runners that fetch only through a subcommand (`npm exec`, `docker run`). */
const SUBCOMMAND_RUNNERS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "uv",
  "pipx",
  "docker",
  "podman",
  "deno",
  "go",
]);

/** Options known to take no value. */
const FLAG_OPTIONS: Record<Ecosystem, ReadonlySet<string>> = {
  npm: new Set([
    "-y",
    "--yes",
    "--no",
    "--no-install",
    "-q",
    "--quiet",
    "-s",
    "--silent",
    "--ignore-existing",
    "--offline",
  ]),
  py: new Set([
    "-q",
    "--quiet",
    "-v",
    "--verbose",
    "--offline",
    "--isolated",
    "-n",
    "--no-cache",
    "--refresh",
    "--system-site-packages",
    "--include-deps",
  ]),
  image: new Set([
    "-i",
    "-t",
    "-it",
    "-ti",
    "-d",
    "--rm",
    "--init",
    "--privileged",
    "--read-only",
    "--interactive",
    "--tty",
    "--detach",
    "-P",
    "--publish-all",
  ]),
  deno: new Set([
    "-A",
    "--allow-all",
    "-q",
    "--quiet",
    "-r",
    "--reload",
    "--no-prompt",
    "--unstable",
    "--no-check",
    "--watch",
  ]),
  go: new Set(["-race", "-v", "-x", "-a", "-n", "-work", "-trimpath"]),
};

/** Options that take a separate value that is not a package spec. */
const VALUE_OPTIONS: Record<Ecosystem, ReadonlySet<string>> = {
  npm: new Set([
    "--registry",
    "--cache",
    "--userconfig",
    "--globalconfig",
    "--prefix",
    "-w",
    "--workspace",
    "--loglevel",
    "-c",
    "--call",
  ]),
  py: new Set([
    "-p",
    "--python",
    "--index",
    "--index-url",
    "-i",
    "--extra-index-url",
    "--pip-args",
    "--python-preference",
    "--directory",
    "--cache-dir",
    "--project",
    "--config-file",
    "--index-strategy",
  ]),
  image: new Set([
    "-e",
    "--env",
    "--env-file",
    "-v",
    "--volume",
    "--mount",
    "--name",
    "-p",
    "--publish",
    "--network",
    "--net",
    "-w",
    "--workdir",
    "-u",
    "--user",
    "--entrypoint",
    "--platform",
    "-l",
    "--label",
    "--add-host",
    "--cap-add",
    "--cap-drop",
    "-m",
    "--memory",
    "--cpus",
    "--pull",
    "--restart",
    "-h",
    "--hostname",
    "--device",
    "--tmpfs",
    "--ulimit",
    "--log-driver",
    "--security-opt",
    "--gpus",
    "--volumes-from",
    "--link",
    "--sysctl",
    "--log-opt",
    "--ipc",
    "--pid",
    "--cidfile",
    "--shm-size",
    "--dns",
    "--expose",
    "--group-add",
    "--runtime",
    "--uts",
    "--cgroupns",
  ]),
  deno: new Set([
    "-c",
    "--config",
    "--import-map",
    "--lock",
    "--cert",
    "--location",
  ]),
  go: new Set([
    "-C",
    "-exec",
    "-tags",
    "-ldflags",
    "-gcflags",
    "-mod",
    "-modfile",
    "-p",
  ]),
};

/** A runner token's command name: `/usr/bin/npx`, `npx.cmd` -> `npx`. */
function commandName(token: string): string {
  return (token.split(/[\\/]/).pop() ?? "")
    .toLowerCase()
    .replace(/\.(?:cmd|exe|bat|ps1)$/, "");
}

/** Where a remote-fetch runner starts at `tokens[i]`, if one does. */
function fetchRunner(
  tokens: string[],
  i: number,
): {
  ecosystem: Ecosystem;
  next: number;
  label: string;
  /** The subcommand lies past the window: not checked, so a risk. */
  overflow?: boolean;
} | null {
  const base = commandName(tokens[i]);
  // `npm --yes exec x`: options may come before the subcommand.
  let k = i + 1;
  while (
    k < tokens.length &&
    k - i <= RUNNER_WINDOW &&
    tokens[k].startsWith("-")
  )
    k++;
  if (
    k < tokens.length &&
    tokens[k].startsWith("-") &&
    SUBCOMMAND_RUNNERS.has(base)
  )
    return {
      ecosystem: "npm",
      next: tokens.length,
      label: base,
      overflow: true,
    };
  const sub = tokens[k]?.toLowerCase();
  const sub2 = tokens[k + 1]?.toLowerCase();
  if (base === "npx" || base === "bunx" || base === "pnpx")
    return { ecosystem: "npm", next: i + 1, label: base };
  if (base === "npm" && (sub === "exec" || sub === "x"))
    return { ecosystem: "npm", next: k + 1, label: `npm ${sub}` };
  if ((base === "pnpm" || base === "yarn") && sub === "dlx")
    return { ecosystem: "npm", next: k + 1, label: `${base} dlx` };
  if (base === "bun" && sub === "x")
    return { ecosystem: "npm", next: k + 1, label: "bun x" };
  if (base === "uvx") return { ecosystem: "py", next: i + 1, label: "uvx" };
  if (base === "uv" && sub === "tool" && sub2 === "run")
    return { ecosystem: "py", next: k + 2, label: "uv tool run" };
  if (base === "pipx" && sub === "run")
    return { ecosystem: "py", next: k + 1, label: "pipx run" };
  if (base === "docker" || base === "podman") {
    if (sub === "run")
      return { ecosystem: "image", next: k + 1, label: `${base} run` };
    if (sub === "container" && sub2 === "run")
      return { ecosystem: "image", next: k + 2, label: `${base} run` };
  }
  if (base === "deno" && sub === "run")
    return { ecosystem: "deno", next: k + 1, label: "deno run" };
  if (base === "go" && sub === "run")
    return { ecosystem: "go", next: k + 1, label: "go run" };
  return null;
}

/** The package specs a runner fetches, read from `tokens[start]` on. */
function runnerSpecs(
  tokens: string[],
  start: number,
  ecosystem: Ecosystem,
): { specs: string[]; overflow: boolean } {
  const specs: string[] = [];
  const rule = SPEC_RULES[ecosystem];
  let explicit = false;
  // An option this scan does not know may take the next word as its value.
  let afterUnknown = false;
  // Bounded: a crafted command line repeating a runner cannot make the
  // scan quadratic (#886).
  const end = Math.min(tokens.length, start + RUNNER_WINDOW);
  for (let j = start; j < end; j++) {
    const t = tokens[j];
    if (t === "--") continue;
    if (t.startsWith("-")) {
      const eq = t.indexOf("=");
      const key = eq === -1 ? t : t.slice(0, eq);
      const value = eq === -1 ? undefined : t.slice(eq + 1);
      afterUnknown = false;
      if (SPEC_OPTIONS[ecosystem]?.has(key)) {
        const spec = value ?? tokens[++j];
        if (spec !== undefined) {
          specs.push(spec);
          if (key !== "--with") explicit = true;
        }
      } else if (VALUE_OPTIONS[ecosystem].has(key)) {
        if (value === undefined) j++;
      } else if (value === undefined && !FLAG_OPTIONS[ecosystem].has(key)) {
        afterUnknown = true;
      }
      continue;
    }
    if (explicit) break;
    specs.push(t);
    // The first positional is the package, unless an option named it: then
    // it is the binary to run from that package. After an unknown option a
    // local or pinned word may be that option's value: the next positional
    // is checked too, so the package cannot hide behind it.
    if (afterUnknown && (!rule.remote(t) || rule.pinned(t))) {
      afterUnknown = false;
      continue;
    }
    return { specs, overflow: false };
  }
  // The window ran out before the package was settled: fail closed (#886).
  return { specs, overflow: !explicit && end < tokens.length };
}

/** Split a command line into words: whitespace and shell separators. */
function commandTokens(argv: string[]): string[] {
  return argv
    .flatMap((a) => a.split(/[\s;&|()`<>]+/))
    .map(trimQuotes)
    .filter((t) => t.length > 0);
}

/**
 * `t` without leading and trailing quotes. A loop, not a regex: an
 * alternation anchored at the end backtracks quadratically on a long run of
 * quotes inside an untrusted word (#886).
 */
function trimQuotes(t: string): string {
  const quote = (c: string) => c === '"' || c === "'";
  let start = 0;
  let end = t.length;
  while (start < end && quote(t[start])) start++;
  while (end > start && quote(t[end - 1])) end--;
  return t.slice(start, end);
}

/**
 * Remote code a command line fetches without an exact version (#886):
 * `npx`, `bunx`, `pnpx`, `npm exec`, `pnpm`/`yarn dlx`, `bun x`, `uvx`,
 * `uv tool run`, `pipx run`, `docker`/`podman run`, `deno run` and `go run`
 * with a remote spec that is not pinned, and any `…@latest`.
 */
export function unpinnedFetchRisks(argv: string[]): string[] {
  const tokens = commandTokens(argv);
  const risks: string[] = [];
  const reported = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const runner = fetchRunner(tokens, i);
    if (runner === null) continue;
    const rule = SPEC_RULES[runner.ecosystem];
    const { specs, overflow } = runnerSpecs(
      tokens,
      runner.next,
      runner.ecosystem,
    );
    if (runner.overflow || overflow)
      risks.push(
        `unpinned remote fetch: ${runner.label} (package past the first ${RUNNER_WINDOW} words, not checked)`,
      );
    for (const spec of specs) {
      if (!rule.remote(spec) || rule.pinned(spec)) continue;
      risks.push(`unpinned remote fetch: ${runner.label} ${spec}`);
      reported.add(spec);
    }
  }
  // `@latest` with any runner, or one this scan does not know.
  for (const t of tokens) {
    if (/@latest$/i.test(t) && !reported.has(t))
      risks.push(`fetches @latest: ${t}`);
  }
  return risks;
}

/** A name segment that names a credential: `GITHUB_TOKEN`, `apiKey`. */
export function looksLikeCredential(name: string): boolean {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .some((part) =>
      /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/.test(
        part.toUpperCase(),
      ),
    );
}

/** `$NAME` and `${NAME}` references in `text`. */
function envReferences(text: string): string[] {
  // `$NAME`, `${NAME}`, VS Code's `${env:NAME}` / `${input:NAME}`, `%NAME%`.
  return [
    ...text.matchAll(
      /\$\{(?:env:|input:)?([A-Za-z_][\w-]*)|\$([A-Za-z_]\w*)|%([A-Za-z_]\w*)%/g,
    ),
  ].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Credentials a URL carries: a password, or a credential-named parameter. */
function urlCredentials(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const risks: string[] = [];
  if (parsed.password) risks.push("credential in url: password");
  for (const key of new Set(parsed.searchParams.keys())) {
    if (looksLikeCredential(key)) risks.push(`credential in url: ${key}`);
  }
  return risks;
}

/** Credentials a server definition passes to what it starts or calls. */
function credentialRisks(
  server: JsonObject,
  argv: string[],
  url: string | undefined,
): string[] {
  const risks: string[] = [];
  const passed: string[] = [...argv];
  const env = own(server, "env");
  if (isObject(env)) {
    for (const [key, value] of Object.entries(env)) {
      if (looksLikeCredential(key)) risks.push(`credential env: ${key}`);
      if (typeof value === "string") passed.push(value);
    }
  }
  const headers = own(server, "headers");
  if (isObject(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (looksLikeCredential(key) || key.toLowerCase() === "authorization")
        risks.push(`credential header: ${key}`);
      if (typeof value === "string") passed.push(value);
    }
  }
  if (url !== undefined) {
    passed.push(url);
    risks.push(...urlCredentials(url));
  }
  for (const text of passed) {
    for (const ref of envReferences(text)) {
      if (looksLikeCredential(ref)) risks.push(`credential reference: $${ref}`);
    }
  }
  return risks;
}

/**
 * A string, or an array's strings. Nothing else is read: a nested value is
 * never joined, stringified or walked, so its depth cannot matter.
 */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.map((v) => (typeof v === "string" ? v : "(not-a-string)"));
  return [];
}

/**
 * Join argv for display: an argument after the command with whitespace is
 * double-quoted, its characters left as they are (stripped only when
 * printed). The command is shown as written.
 */
function commandLine(argv: string[]): string {
  return argv
    .map((a, i) => (i > 0 && /\s|^$/.test(a) ? `"${a}"` : a))
    .join(" ");
}

function serverFinding(
  file: string,
  name: string,
  def: unknown,
): AgentConfigFinding {
  const server = isObject(def) ? def : {};
  const argv = [
    ...strings(own(server, "command")),
    ...strings(own(server, "args")),
  ];
  const url = ["url", "httpUrl", "serverUrl"]
    .map((k) => own(server, k))
    .find((v): v is string => typeof v === "string");
  const risks = [
    ...unpinnedFetchRisks(argv),
    ...credentialRisks(server, argv, url),
  ];
  return {
    file,
    line: 1,
    kind: "mcp-server",
    name,
    command:
      argv.length > 0
        ? commandLine(argv)
        : (url ?? "(no command: not a recognised server entry)"),
    risks: [...new Set(risks)],
  };
}

/** Every `command` under `hooks`, with the event it hangs under. */
function hookCommands(hooks: JsonObject): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const walk = (value: unknown, event: string, depth: number): void => {
    if (depth > MAX_HOOK_DEPTH) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, event, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    const command = own(value, "command");
    if (typeof command === "string" || Array.isArray(command))
      found.push([event, commandLine(strings(command))]);
    for (const [key, child] of Object.entries(value)) {
      if (key !== "command") walk(child, event, depth + 1);
    }
  };
  for (const [event, value] of Object.entries(hooks)) walk(value, event, 0);
  return found;
}

function note(
  file: string,
  kind: "config" | "unreadable",
  name: string,
): AgentConfigFinding {
  return { file, line: 1, kind, name, command: "", risks: [] };
}

/** The 1-based line of the first `"key"` in `content`, else 1. */
function lineFinder(content: string): (key: string) => number {
  // Newline offsets, found once per file: each lookup is then a search of
  // the content for the key plus a binary search, never a newline walk.
  let newlines: number[] | null = null;
  return (key) => {
    const at = content.indexOf(JSON.stringify(key));
    if (at === -1) return 1;
    if (newlines === null) {
      newlines = [];
      for (
        let i = content.indexOf("\n");
        i !== -1;
        i = content.indexOf("\n", i + 1)
      )
        newlines.push(i);
    }
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

interface ConfigScanContext {
  /** What the walk read, by relative path. */
  contents: ReadonlyMap<string, string>;
  /** What the walk saw and did not read. */
  unread: ReadonlySet<string>;
  /**
   * Referenced files already scanned in this run, as `key:path`: each is
   * scanned once however many manifests name it, so the work stays linear
   * in what the walk read (#886).
   */
  scanned: Set<string>;
}

/**
 * The file a manifest path names, relative to the skill folder, or null
 * when it leaves the folder. A `.claude-plugin/plugin.json` path is relative
 * to the plugin root, the folder above `.claude-plugin`.
 */
function resolveConfigReference(
  file: string,
  ref: string,
  ctx: ConfigScanContext,
): string | null {
  const rel = ref.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}[\\/]/, "./");
  if (/^[\\/~]|^[A-Za-z][\w+.-]*:/.test(rel)) return null;
  const dir = posix.dirname(file);
  const bases =
    posix.basename(dir) === ".claude-plugin"
      ? [posix.dirname(dir), dir]
      : [dir];
  const candidates = bases.map((b) =>
    posix.normalize(posix.join(b, rel.replace(/\\/g, "/"))),
  );
  if (candidates.some((c) => c === ".." || c.startsWith("../"))) return null;
  return (
    candidates.find((c) => ctx.contents.has(c) || ctx.unread.has(c)) ??
    candidates[0]
  );
}

/** Findings for a manifest key that names other files instead (#886). */
function referencedConfigs(
  file: string,
  key: "mcpServers" | "hooks",
  refs: string[],
  ctx: ConfigScanContext,
): AgentConfigFinding[] {
  const findings: AgentConfigFinding[] = [];
  for (const ref of refs.slice(0, MAX_CONFIG_REFERENCES)) {
    const target = resolveConfigReference(file, ref, ctx);
    if (target === null) {
      findings.push(
        note(
          file,
          "unreadable",
          `${key} names ${ref}, outside the skill folder: not read`,
        ),
      );
    } else if (isAgentConfigFile(target)) {
      // Scanned on its own, or reported unread, under its own name.
      if (!ctx.contents.has(target) && !ctx.unread.has(target))
        findings.push(
          note(
            file,
            "unreadable",
            `${key} names ${ref}, not in the skill folder`,
          ),
        );
    } else if (ctx.contents.has(target)) {
      // Listed once, under its own name, for the first manifest naming it.
      if (ctx.scanned.has(`${key}:${target}`)) continue;
      ctx.scanned.add(`${key}:${target}`);
      findings.push(
        ...scanConfigFile(target, ctx.contents.get(target)!, ctx, {
          mcp: key === "mcpServers",
          nested: true,
        }),
      );
    } else {
      findings.push(
        note(
          file,
          "unreadable",
          `${key} names ${ref}, ${ctx.unread.has(target) ? "not read" : "not in the skill folder"}`,
        ),
      );
    }
  }
  if (refs.length > MAX_CONFIG_REFERENCES) {
    findings.push(
      note(
        file,
        "unreadable",
        `${key} names ${refs.length - MAX_CONFIG_REFERENCES} more files: not read`,
      ),
    );
  }
  return findings;
}

/** Findings for a config's `mcpServers` (or a `.mcp.json`'s `servers`). */
function serverFindings(
  file: string,
  value: unknown,
  ctx: ConfigScanContext,
  nested: boolean,
): AgentConfigFinding[] {
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0)
      return [note(file, "config", "mcpServers is empty")];
    return entries.map(([name, def]) => serverFinding(file, name, def));
  }
  const refs =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (refs === null)
    return [note(file, "config", "mcpServers is not an object")];
  if (refs.length === 0) return [note(file, "config", "mcpServers is empty")];
  const findings: AgentConfigFinding[] = [];
  const paths: string[] = [];
  for (const item of refs) {
    if (typeof item === "string") paths.push(item);
    else if (isObject(item))
      findings.push(
        ...Object.entries(item).map(([n, d]) => serverFinding(file, n, d)),
      );
    else
      findings.push(
        note(file, "config", "mcpServers holds a value that is not an object"),
      );
  }
  if (paths.length > 0) {
    findings.push(
      ...(nested
        ? [
            note(
              file,
              "unreadable",
              "mcpServers names another file: not followed",
            ),
          ]
        : referencedConfigs(file, "mcpServers", paths, ctx)),
    );
  }
  return findings;
}

/** Findings for a config's `hooks`. */
function hookFindings(
  file: string,
  value: unknown,
  ctx: ConfigScanContext,
  nested: boolean,
): AgentConfigFinding[] {
  // An object of events, or a path, or an array of paths and objects.
  const items = isObject(value) ? [] : Array.isArray(value) ? value : [value];
  const paths = items.filter((v): v is string => typeof v === "string");
  const findings: AgentConfigFinding[] =
    paths.length === 0
      ? []
      : nested
        ? [note(file, "unreadable", "hooks names another file: not followed")]
        : referencedConfigs(file, "hooks", paths, ctx);
  const commands = isObject(value)
    ? hookCommands(value)
    : hookCommands({ hooks: items.filter(isObject) });
  for (const [event, command] of commands) {
    findings.push({
      file,
      line: 1,
      kind: "hook",
      name: event,
      command,
      risks: [
        ...new Set([
          ...unpinnedFetchRisks([command]),
          ...envReferences(command)
            .filter(looksLikeCredential)
            .map((ref) => `credential reference: $${ref}`),
        ]),
      ],
    });
  }
  if (findings.length === 0)
    return [note(file, "config", "hooks present, no command found")];
  return findings;
}

/** Findings for one config file the walk read. */
function scanConfigFile(
  file: string,
  content: string,
  ctx: ConfigScanContext,
  as: { mcp: boolean; nested: boolean } = {
    mcp: MCP_CONFIG_NAMES.has(lowerBaseName(file)),
    nested: false,
  },
): AgentConfigFinding[] {
  let data: unknown;
  try {
    data = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch {
    return [note(file, "unreadable", "not valid JSON: not parsed")];
  }
  if (!isObject(data)) {
    return as.mcp
      ? [note(file, "config", "top level is not a JSON object")]
      : [];
  }
  const findings: AgentConfigFinding[] = [];
  if (Object.hasOwn(data, "mcpServers")) {
    findings.push(...serverFindings(file, data.mcpServers, ctx, as.nested));
  } else if (as.mcp && Object.hasOwn(data, "servers")) {
    findings.push(...serverFindings(file, data.servers, ctx, as.nested));
  } else if (as.mcp) {
    findings.push(note(file, "config", "no mcpServers listed"));
  }
  if (Object.hasOwn(data, "hooks")) {
    findings.push(...hookFindings(file, data.hooks, ctx, as.nested));
  }
  // Bound what is listed (and the line lookups); the rest keep their risks.
  if (findings.length > MAX_FINDINGS_PER_CONFIG) {
    const rest = findings.splice(MAX_FINDINGS_PER_CONFIG - 1);
    findings.push({
      ...note(
        file,
        "config",
        `${rest.length} more servers or hooks not listed`,
      ),
      risks: [...new Set(rest.flatMap((f) => f.risks))],
    });
  }
  const lineOf = lineFinder(content);
  for (const f of findings) {
    if (f.file === file && (f.kind === "mcp-server" || f.kind === "hook"))
      f.line = lineOf(f.name);
  }
  return findings;
}

/**
 * MCP servers and hooks a skill ships (#886): one finding per server or hook
 * command, and one per config asm did not read — not valid JSON, over the
 * walk's size cap, not a regular file, or a link out of the folder. Shared
 * by `asm audit security` and the `asm install` / `asm get` preview.
 */
export function scanAgentConfigs(
  inputs: AgentConfigInputs,
): AgentConfigFinding[] {
  const ctx: ConfigScanContext = {
    contents: new Map(inputs.files.map((f) => [f.relPath, f.content])),
    unread: new Set(inputs.unread ?? []),
    scanned: new Set(),
  };
  const findings: AgentConfigFinding[] = [];
  for (const file of ctx.unread) {
    if (isAgentConfigFile(file))
      findings.push(
        note(
          file,
          "unreadable",
          "over the size cap or not a regular file: not read",
        ),
      );
  }
  for (const link of inputs.externalSymlinks ?? []) {
    if (isAgentConfigFile(link.path))
      findings.push(
        note(
          link.path,
          "unreadable",
          `symlink not followed (${link.kind}): not read`,
        ),
      );
  }
  for (const { relPath, content } of inputs.files) {
    if (!isAgentConfigFile(relPath)) continue;
    try {
      findings.push(...scanConfigFile(relPath, content, ctx));
    } catch {
      // A shape this scan did not foresee is a config asm did not read.
      findings.push(note(relPath, "unreadable", "could not be scanned"));
    }
  }
  return findings;
}

/** One line for a finding, from the original strings; strip it to print. */
export function describeAgentConfigFinding(f: AgentConfigFinding): string {
  const label =
    f.kind === "mcp-server"
      ? `MCP server "${f.name}"`
      : f.kind === "hook"
        ? `hook ${f.name}`
        : f.kind === "unreadable"
          ? `unreadable config (${f.name})`
          : `config (${f.name})`;
  // The command line first: a printer clips the end, and the risks are
  // also told by the severity and category.
  const risk = f.risks.length > 0 ? ` [${f.risks.join("; ")}]` : "";
  return f.command ? `${label}: ${f.command}${risk}` : `${label}${risk}`;
}

/** The audit category for `findings`, or null when there are none. */
export function agentConfigCategory(
  findings: AgentConfigFinding[],
): CodeScanCategory | null {
  if (findings.length === 0) return null;
  return {
    category: AGENT_CONFIG_CATEGORY,
    description: AGENT_CONFIG_DESCRIPTION,
    matches: findings.map((f) => ({
      file: f.file,
      line: f.line,
      match: describeAgentConfigFinding(f),
      severity: f.risks.length > 0 ? "critical" : "warning",
    })),
  };
}
