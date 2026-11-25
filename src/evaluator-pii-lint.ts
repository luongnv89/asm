/**
 * PII detection and script linting scorers for the skill evaluator.
 *
 * Issues #492 (PII detection) and #494 (script linting).
 * These scorers need filesystem access so they are async and called from
 * evaluateSkillContent via Promise.all.
 */

import type { CategoryResult } from "./evaluator-core";
import type { RunCommandOptions } from "./utils/spawn";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "fs/promises";
import { constants as fsConstants } from "fs";
import { tmpdir } from "os";
import { basename, delimiter, isAbsolute, join, resolve } from "path";
import {
  listSkillFiles,
  readSkillFile,
  readSkillFileBytes,
  type SkillFile,
  type SkillFiles,
} from "./evaluator-files";

// ─── PII detection scorer ──────────────────────────────────────────────────

/**
 * PII detection categories and their regex patterns.
 *
 * In-scope (detected):
 *   - Email addresses
 *   - Phone numbers (US / international formats)
 *   - Postal / mailing addresses (street, city, state, zip)
 *   - US Social Security Numbers
 *   - US / UK driver licence numbers
 *
 * Deliberately out of scope:
 *   - Full names (too many false positives from common words)
 *   - IP addresses / hostnames (infrastructure, not PII)
 *   - Credit-card numbers (handled by a separate secrets scan)
 *   - Passport / visa numbers (jurisdictional noise)
 *
 * Email addresses on domains reserved for documentation and testing
 * (RFC 2606 / RFC 6761) are placeholders, not personal data, and are ignored —
 * see isReservedEmailDomain (issue #772). Versioned file names and package
 * specs such as `web@0.4.1.js` share the `local@domain.tld` shape and are
 * ignored too — see isVersionSpecMatch (issue #841).
 *
 * Severity: "warning" — a PII hit does NOT block indexing; it warns the
 * author so they can scrub examples, transcripts, or fixture data before
 * publishing.
 */

/** Second-level domains reserved for documentation by RFC 2606 §3. */
const RESERVED_EMAIL_DOMAINS = ["example.com", "example.org", "example.net"];

/** Top-level domains reserved by RFC 2606 §2 and RFC 6761 §6. */
const RESERVED_EMAIL_TLDS = new Set([
  "example",
  "test",
  "invalid",
  "localhost",
]);

/**
 * True when `domain` is reserved for documentation or testing: example.com,
 * example.org, example.net or a subdomain of one, any name under the
 * .example, .test, .invalid or .localhost TLDs, or `localhost` itself.
 * Matching is case-insensitive and on whole labels, so look-alikes such as
 * `example.com.evil.io`, `notexample.com` and `example.co` are not reserved.
 */
export function isReservedEmailDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.+$/, "");
  if (d === "localhost") return true;
  const tld = d.slice(d.lastIndexOf(".") + 1);
  if (RESERVED_EMAIL_TLDS.has(tld)) return true;
  return RESERVED_EMAIL_DOMAINS.some((r) => d === r || d.endsWith("." + r));
}

/** True when an email address's domain is reserved (see isReservedEmailDomain). */
export function isPlaceholderEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at >= 0 && isReservedEmailDomain(email.slice(at + 1));
}

/**
 * File extensions that end a versioned file name such as `web@0.js`. Only
 * consulted when the part after `@` is a single number, which on its own is
 * also the shape of real mail domains like `163.com`.
 */
const VERSIONED_FILE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "mts",
  "cts",
  "css",
  "scss",
  "less",
  "map",
  "json",
  "wasm",
  "html",
  "htm",
  "svg",
  "md",
  "txt",
  "tgz",
  "gz",
  "zip",
  "tar",
  "whl",
]);

/**
 * True when an email-shaped match is a versioned file name or package spec
 * (issue #841): the part after the last `@` starts with a version number that
 * ends at a `.`, `-`, `+` or the end of the match, and either
 *   - the version has two or more numeric parts (`web@0.4.1.js`,
 *     `lib@3.7.1.min.js`, `pkg@1.2.3-beta.rc`) — no mail domain starts with
 *     two all-digit labels, or
 *   - it is a single number and the last label is a file extension
 *     (`name@0.js`, `styles@2.css`).
 * Digit-led mail domains such as `user@163.com` or `ops@1and1.com` match
 * neither arm and are still reported.
 */
function isVersionSpecMatch(match: string): boolean {
  const domain = match.slice(match.lastIndexOf("@") + 1);
  const version = /^\d+(?:\.\d+)*(?=$|[.+-])/.exec(domain);
  if (!version) return false;
  if (version[0].includes(".")) return true;
  const ext = domain.slice(domain.lastIndexOf(".") + 1).toLowerCase();
  return VERSIONED_FILE_EXTENSIONS.has(ext);
}

/**
 * True when an email match may be exempted as a placeholder or a versioned
 * file name / package spec. The email pattern's `\b` and character classes
 * are ASCII-only, so a non-ASCII letter, combining mark (decomposed accents)
 * or digit ends the match early: `contact@team.testé.fr` matches as
 * `contact@team.test`. A match followed directly by one of those does not
 * show the real domain, so it is not exempted and stays flagged.
 */
function isIgnorableEmailMatch(match: string, nextChar: string): boolean {
  if (/[\p{L}\p{M}\p{N}]/u.test(nextChar)) return false;
  return isPlaceholderEmail(match) || isVersionSpecMatch(match);
}

/** The full code point at UTF-16 index `i` of `line` ("" past the end). */
function codePointAt(line: string, i: number): string {
  const cp = line.codePointAt(i);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

const PII_PATTERNS: {
  category: string;
  pattern: RegExp;
  /**
   * Matches for which this returns true are not reported. `nextChar` is the
   * code point right after the match ("" at end of line).
   */
  ignore?: (match: string, nextChar: string) => boolean;
}[] = [
  {
    category: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
    ignore: isIgnorableEmailMatch,
  },
  {
    category: "phone",
    pattern: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[\s-]?\d{3}[-.]?\d{4}\b/g,
  },
  {
    category: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    category: "address",
    pattern:
      /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Place|Pl|Way|Circle|Cir)\b/gi,
  },
  {
    category: "license",
    pattern: /\b[A-Z]{2}\d{6,8}\b/g,
  },
];

/**
 * Scan all text files in a skill directory for PII patterns.
 *
 * Scans files with extensions: .md, .txt, .json, .yaml, .yml, .sh, .py, .bash,
 * .js, .ts, .jsx, .tsx, .html, .css, .log.
 *
 * Only files inside the skill folder are read (#825); `files` is the
 * folder's confined listing, computed here when the caller has none.
 *
 * Returns a CategoryResult with findings per-file:per-line.
 */
export async function scorePII(
  skillPath: string,
  files?: SkillFiles,
): Promise<CategoryResult> {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 10; // start perfect; deduct for each category found
  const categoryHits = new Set<string>();

  // Collect text files to scan
  const textExtensions = new Set([
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".sh",
    ".py",
    ".bash",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".html",
    ".css",
    ".log",
  ]);

  for (const file of (files ?? (await listSkillFiles(skillPath))).files) {
    const entry = file.name;
    const ext = entry.includes(".") ? "." + entry.split(".").pop() : "";
    if (!textExtensions.has(ext)) continue;
    const content = await readSkillFile(file);
    if (content === null) continue; // Skip files we can't read
    const lines = content.split("\n");
    for (const pii of PII_PATTERNS) {
      pii.pattern.lastIndex = 0;
      let inFrontmatter = false;
      let inCodeFence = false;
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        // Toggle frontmatter block
        if (line.trim() === "---") {
          inFrontmatter = !inFrontmatter;
          continue;
        }
        // Toggle code fence blocks
        if (line.trim().startsWith("```")) {
          inCodeFence = !inCodeFence;
          continue;
        }
        // Skip lines inside frontmatter or code fences
        if (inFrontmatter || inCodeFence) continue;
        const matches = [...line.matchAll(pii.pattern)]
          .filter(
            (m) =>
              !pii.ignore?.(m[0], codePointAt(line, m.index + m[0].length)),
          )
          .map((m) => m[0]);
        if (matches.length > 0) {
          if (!categoryHits.has(pii.category)) {
            categoryHits.add(pii.category);
            score -= 2;
          }
          findings.push(
            `[${pii.category}] ${file.relPath}:${lineIdx + 1} — found ${matches.length} match(es)`,
          );
        }
      }
    }
  }

  if (categoryHits.size === 0) {
    findings.push("No PII detected in skill files.");
  } else {
    findings.push(
      `PII detected in ${categoryHits.size} category/categories: ${[...categoryHits].join(", ")}.`,
    );
    suggestions.push(
      "Remove or redact personal data from examples, transcripts, and fixture files before publishing.",
    );
  }

  return {
    id: "pii",
    name: "PII detection",
    score: Math.max(0, Math.min(10, Math.round(score))),
    max: 10,
    findings,
    suggestions,
  };
}

// ─── Script lint scorer ─────────────────────────────────────────────────────

/**
 * Script languages and their linter commands.
 *
 * In-scope:
 *   - Bash / shell scripts (.sh, .bash) → shellcheck
 *   - Python scripts (.py) → in-memory syntax check (PY_SYNTAX_CHECK)
 *
 * Deliberately out of scope:
 *   - JavaScript / TypeScript (handled by the build system)
 *   - Ruby, Perl, etc. (not commonly bundled with skills)
 *
 * Graceful degradation: when a linter is unavailable the scorer records a
 * "skipped" finding instead of silently passing, so the author knows the
 * check was not performed.
 */

const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".py"]);

/**
 * Python syntax check that writes nothing (issue #823).
 *
 * `python3 -m py_compile <file>` writes `__pycache__/<name>.cpython-*.pyc`
 * next to the source and ignores PYTHONDONTWRITEBYTECODE, so linting
 * mutated the skill folder being evaluated. This runs the same compile step
 * as `py_compile.compile()` (SourceFileLoader.source_to_code), raises the
 * same `py_compile.PyCompileError`, and prints what `py_compile`'s CLI
 * prints (the same stderr text and exit code 1). It skips the bytecode
 * write, so the stderr parser below sees the same output as before.
 * Run with `-I -B`: isolated mode keeps the skill folder off `sys.path`,
 * and -B stops any stdlib import from writing bytecode.
 */
const PY_SYNTAX_CHECK = [
  "import sys, importlib.machinery, py_compile",
  "f = sys.argv[1]",
  "try:",
  "    loader = importlib.machinery.SourceFileLoader('<py_compile>', f)",
  "    data = loader.get_data(f)",
  "    try:",
  "        loader.source_to_code(data, f)",
  "    except Exception as err:",
  "        raise py_compile.PyCompileError(err.__class__, err, f)",
  "except py_compile.PyCompileError as e:",
  "    sys.stderr.write(e.msg)",
  "    sys.exit(1)",
  "except OSError as e:",
  "    sys.stderr.write(str(e))",
  "    sys.exit(1)",
].join("\n");

const LINTER_CONFIG: Record<
  string,
  {
    command: string;
    args: string[];
    language: string;
  }
> = {
  ".sh": {
    command: "shellcheck",
    // --norc: a .shellcheckrc in the skill folder or above it could turn on
    // external-sources and make shellcheck open files outside it (#825).
    args: ["--norc", "--format=json1"],
    language: "bash/shell",
  },
  ".bash": {
    command: "shellcheck",
    // --norc: a .shellcheckrc in the skill folder or above it could turn on
    // external-sources and make shellcheck open files outside it (#825).
    args: ["--norc", "--format=json1"],
    language: "bash/shell",
  },
  ".py": {
    command: "python3",
    args: ["-I", "-B", "-c", PY_SYNTAX_CHECK],
    language: "python",
  },
};

interface LintFinding {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

/** A lint that did not happen, and why (the text after "lint skipped — "). */
interface LintSkip {
  skipped: string;
}

const MAX_LINT_TEXT = 200;

/**
 * The first `max` code points of `s`, never splitting a surrogate pair.
 * The first 2*max UTF-16 units always hold those code points intact.
 */
function clip(s: string, max = MAX_LINT_TEXT): string {
  return Array.from(s.slice(0, 2 * max))
    .slice(0, max)
    .join("");
}

/**
 * The single warning for a linter that ran but exited non-zero without
 * output we could parse: reported, never counted as clean (#884).
 */
function exitedWarning(
  filePath: string,
  result: { exitCode: number; stdout: string; stderr: string },
): LintFinding[] {
  return [
    {
      file: filePath,
      line: 0,
      severity: "warning",
      message: `Linter exited with code ${result.exitCode}: ${clip(result.stderr || result.stdout)}`,
    },
  ];
}

/**
 * The search path libuv uses when PATH is unset (glibc and macOS
 * `_PATH_DEFPATH`), so an unset PATH finds the same linter as before.
 */
const DEFAULT_PATH = "/usr/bin:/bin";

/**
 * The linter `cmd` resolved to an absolute path (#890), or null when it is
 * not installed.
 *
 * Only absolute PATH entries are searched: an empty, `.` or relative entry
 * names the current directory or a folder under it, which can be the skill
 * being evaluated, and spawning the bare name would run a file the skill
 * ships. Like execvp, the first executable regular file wins; when no entry
 * holds one, the first regular file found is returned so spawning it fails
 * with EACCES and #884's "could not be run" warning still applies.
 * Missing, unsearchable and non-directory entries are passed over. Unlike
 * execvp, a hit whose start fails with ENOENT (a shim whose interpreter is
 * gone) is not retried with a later entry: the lint is skipped as not
 * installed.
 *
 * Windows keeps the bare name: its lookup adds PATHEXT extensions, which
 * this search does not model, and starts in the spawn's cwd (see runLinter).
 */
export async function resolveLinter(cmd: string): Promise<string | null> {
  if (process.platform === "win32") return cmd;
  let fallback: string | null = null;
  for (const dir of (process.env.PATH ?? DEFAULT_PATH).split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, cmd);
    try {
      if (!(await stat(candidate)).isFile()) continue;
    } catch {
      continue; // Missing or unsearchable entry: not here.
    }
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      fallback ??= candidate;
    }
  }
  return fallback;
}

/**
 * How runLinter starts a linter: in `cwd` and, off Windows, with a PATH cut
 * down to its absolute entries (#890). A linter that looks up another
 * program (an `env bash` shebang, a version-manager shim) would otherwise
 * resolve an empty, `.`, relative or `..` entry against its cwd, and from a
 * TMPDIR inside the skill a `..` entry climbs back into the skill folder.
 * The rest of the environment is passed through unchanged.
 */
function linterSpawnOptions(cwd: string | undefined): RunCommandOptions {
  const opts: RunCommandOptions = cwd === undefined ? {} : { cwd };
  if (process.platform !== "win32") {
    opts.env = {
      ...process.env,
      PATH: (process.env.PATH ?? DEFAULT_PATH)
        .split(delimiter)
        .filter(isAbsolute)
        .join(delimiter),
    };
  }
  return opts;
}

/** Spawn failures that mean the linter is there but this user cannot run it. */
const CANNOT_RUN = new Set(["EACCES", "EPERM", "ENOEXEC"]);

/** Per-run memo of resolveLinter results, keyed by command name. */
export type LinterPaths = Map<string, Promise<string | null>>;

export interface RunLinterOptions {
  /** Resolve each linter once per run (#890). */
  paths?: LinterPaths;
  /**
   * The linter's working directory. scoreScriptLint passes its private copy
   * folder so a linter that looks up another program (an `env bash` shebang,
   * a version-manager shim) through a relative PATH entry never finds one the
   * skill ships in the caller's cwd (#890). Omitted: the caller's cwd.
   */
  cwd?: string;
}

/**
 * Run a linter on a single script file and return structured findings, or
 * why it was skipped: the extension has no linter, the linter is not
 * installed, or it could not be started for a reason that says nothing
 * about the script (#884). The linter is spawned by the absolute path
 * resolveLinter finds (#890), never by its bare name.
 */
export async function runLinter(
  filePath: string,
  ext: string,
  { paths = new Map(), cwd }: RunLinterOptions = {},
): Promise<LintFinding[] | LintSkip> {
  const config = LINTER_CONFIG[ext];
  if (!config) return { skipped: `no linter for ${ext || "this file"}` };
  const notInstalled = { skipped: `${config.command} is not installed` };

  let resolved = paths.get(config.command);
  if (!resolved) {
    resolved = resolveLinter(config.command);
    paths.set(config.command, resolved);
  }
  const linter = await resolved;
  if (linter === null) return notInstalled;

  try {
    const { runCommand } = await import("./utils/spawn");
    const argv = [linter, ...config.args, filePath];
    const result = await runCommand(argv, linterSpawnOptions(cwd));

    // Not installed (#884): runCommand reports a missing binary (spawn
    // ENOENT) as exit 127 instead of rejecting, and 127 is also the shell's
    // "command not found". Skip it so the score does not depend on the host;
    // any other non-zero exit is still reported below.
    if (result.exitCode === 127) return notInstalled;
    if (result.exitCode !== 0) {
      // Parse output based on linter type
      if (ext === ".py") {
        // Python compile errors are multi-line:
        //   File "path", line N
        //     code
        //           ^
        // SyntaxError: message
        // Any other compile error is one line (#891), its line number in a
        // trailing "(<file basename>, line N)" when there is one:
        //   Sorry: TabError: inconsistent use of tabs ... (t.py, line 3)
        //   Sorry: MemoryError: Parser stack overflowed - ...
        const lines = result.stderr.split("\n");
        const findings: LintFinding[] = [];
        const lineSuffix = ` (${basename(filePath)}, line `;
        let pendingLine = 0;
        for (const line of lines) {
          const fileMatch = line.match(/File "([^"]+)", line (\d+)/);
          if (fileMatch) {
            pendingLine = parseInt(fileMatch[2], 10);
            continue;
          }
          const sorryMatch = line.match(
            /^\s*Sorry: (IndentationError|TabError|MemoryError):\s*(.+)$/,
          );
          if (sorryMatch) {
            let message = sorryMatch[2].trim();
            let lineNo = 0;
            const trailer = message.match(/, line (\d+)\)$/);
            if (trailer) {
              lineNo = parseInt(trailer[1], 10);
              // Drop the file name: it is the private copy's, not the skill's.
              const tail = `${lineSuffix}${trailer[1]})`;
              if (message.length > tail.length && message.endsWith(tail)) {
                message = message.slice(0, -tail.length);
              }
            }
            findings.push({
              file: filePath,
              line: lineNo,
              severity: "error",
              message: `${sorryMatch[1]}: ${message}`,
            });
            pendingLine = 0;
            continue;
          }
          const syntaxMatch = line.match(
            /^\s*(SyntaxError|IndentationError|ImportError|AttributeError|TypeError|ValueError):\s*(.+)$/,
          );
          if (syntaxMatch) {
            findings.push({
              file: filePath,
              line: pendingLine || 0,
              severity: "error",
              message: `${syntaxMatch[1]}: ${syntaxMatch[2].trim()}`,
            });
            pendingLine = 0;
          }
        }
        // A bad flag (exit 2), a signal (-1) or a broken interpreter prints
        // no SyntaxError line; report it rather than call the file clean.
        return findings.length > 0 ? findings : exitedWarning(filePath, result);
      }

      // Shellcheck JSON output — shellcheck --format=json1 emits the report
      // on stdout as {"comments": [...]} (the legacy json format is a bare
      // array); runCommand keeps stdout and stderr separate.
      try {
        const parsed: unknown = JSON.parse(result.stdout);
        const issues = Array.isArray(parsed)
          ? parsed
          : (parsed as { comments?: unknown }).comments;
        const findings: LintFinding[] = [];
        if (Array.isArray(issues)) {
          for (const issue of issues) {
            if (issue && typeof issue === "object") {
              const i = issue as Record<string, unknown>;
              findings.push({
                file: filePath,
                line: Number(i.line) || 0,
                severity:
                  i.level === "error" || i.level === "e"
                    ? "error"
                    : i.level === "warning" || i.level === "w"
                      ? "warning"
                      : "info",
                message: (i.message as string) || "Unknown issue",
              });
            }
          }
        }
        return findings;
      } catch {
        // If JSON parsing fails, fall back to stderr text
        return exitedWarning(filePath, result);
      }
    }
    return [];
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return notInstalled;
    // Installed (resolveLinter found it) but this user cannot run it.
    if (typeof code === "string" && CANNOT_RUN.has(code)) {
      return [
        {
          file: filePath,
          line: 0,
          severity: "warning",
          message: `Linter could not be run: ${code}`,
        },
      ];
    }
    // Anything else (EMFILE, ENOMEM, an asm-internal failure) is about this
    // host or run, not the script: skip without a deduction.
    return {
      skipped: `could not start ${config.command}: ${clip(typeof code === "string" ? code : String(err))}`,
    };
  }
}

let lintCopies = 0;

/**
 * Copy `file`'s bytes, read where the walk found it, into its own folder
 * under `dir` with the same name (linters read the name's extension and
 * shebang only). Returns the copy's path, or null when it was not read.
 * A script the user cannot read becomes an empty copy nobody can read, so
 * the linter reports it as it always did.
 */
async function lintCopy(file: SkillFile, dir: string): Promise<string | null> {
  const bytes = await readSkillFileBytes(file);
  const unreadable = bytes === null && (await isUnreadable(file.fullPath));
  if (bytes === null && !unreadable) return null;
  const folder = join(dir, String(lintCopies++));
  await mkdir(folder);
  const copy = join(folder, file.name);
  await writeFile(copy, bytes ?? "");
  if (unreadable) await chmod(copy, 0o000);
  return copy;
}

/** True when `path` exists but this process may not read it. */
async function isUnreadable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EACCES" || code === "EPERM";
  }
}

/**
 * Lint executable scripts bundled with a skill.
 *
 * Scans for .sh, .bash, and .py files. Runs shellcheck for shell scripts
 * and an in-memory Python compile (no __pycache__) for Python scripts. When a linter is
 * unavailable the check is marked as "skipped". Only scripts inside the
 * skill folder are linted (#825); `files` is as for `scorePII`.
 *
 * The linter never opens the script by its path (#831): it lints a private
 * copy of the bytes read from the folder the walk was confined to, so a
 * folder swapped for a link after the walk is never read through.
 */
export async function scoreScriptLint(
  skillPath: string,
  files?: SkillFiles,
): Promise<CategoryResult> {
  const findings: string[] = [];
  const suggestions: string[] = [];
  let score = 10;
  let lintedCount = 0;
  const skips: string[] = [];
  const allFindings: LintFinding[] = [];
  let copies: string | null = null;
  const linterPaths: LinterPaths = new Map();

  try {
    for (const file of (files ?? (await listSkillFiles(skillPath))).files) {
      const entry = file.name;
      const ext = entry.includes(".") ? "." + entry.split(".").pop() : "";
      if (!SCRIPT_EXTENSIONS.has(ext)) continue;
      const relPath = file.relPath;
      // Absolute even under a relative TMPDIR: the linter runs with `copies`
      // as its cwd (#890), so a relative copy path would not resolve there.
      copies ??= await mkdtemp(join(resolve(tmpdir()), "asm-lint-"));
      const copy = await lintCopy(file, copies);
      // Not read (it changed, or is not a regular file): nothing to lint.
      if (copy === null) continue;
      const linterResult = await runLinter(copy, ext, {
        paths: linterPaths,
        cwd: copies,
      });
      if (!Array.isArray(linterResult)) {
        skips.push(linterResult.skipped);
        const lang = LINTER_CONFIG[ext]?.language || ext;
        findings.push(
          `[${lang}] ${relPath}: lint skipped — ${linterResult.skipped}`,
        );
      } else {
        lintedCount++;
        allFindings.push(...linterResult);
        for (const f of linterResult) {
          const sev = f.severity.toUpperCase();
          findings.push(`[${sev}] ${relPath}:${f.line || "*"} — ${f.message}`);
        }
      }
    }
  } finally {
    if (copies) await rm(copies, { recursive: true, force: true });
  }

  if (lintedCount === 0 && skips.length === 0) {
    findings.push("No bundled scripts found to lint.");
  } else if (lintedCount === 0) {
    findings.push(
      skips.every((r) => r.endsWith(" is not installed"))
        ? "No script was linted: no linter is installed for these scripts."
        : "No script was linted: see the skipped scripts above.",
    );
  } else if (allFindings.length === 0) {
    findings.push(`Linted ${lintedCount} script(s) — no issues found.`);
  } else {
    const errors = allFindings.filter((f) => f.severity === "error").length;
    const warnings = allFindings.filter((f) => f.severity === "warning").length;
    score = Math.max(0, 10 - errors * 3 - warnings);
    findings.push(
      `Found ${errors} error(s) and ${warnings} warning(s) across ${lintedCount} script(s).`,
    );
    suggestions.push(
      "Fix lint errors in bundled scripts — quoting issues, undefined variables, and syntax errors can cause runtime failures.",
    );
  }

  return {
    id: "script-lint",
    name: "Script linting",
    score: Math.max(0, Math.min(10, Math.round(score))),
    max: 10,
    findings,
    suggestions,
  };
}
