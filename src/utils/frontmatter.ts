import { parse as parseYaml } from "yaml";

function parseDependencyScalar(raw: string): string {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error("Invalid dependencies metadata: malformed YAML scalar.", {
      cause: err,
    });
  }
  if (typeof parsed !== "string" || !parsed.trim()) {
    throw new Error(
      "Invalid dependencies metadata: entries must be non-empty scalar strings.",
    );
  }
  return parsed.trim();
}

export function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  let inFrontmatter = false;
  let foundFirst = false;
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let multilineMode: "none" | "literal" | "folded" = "none";
  let baseIndent = -1;
  let parentKey: string | null = null;

  function flushKey() {
    if (currentKey) {
      const joined = currentValue.join(" ").trim();
      if (joined) result[currentKey] = joined;
      currentKey = null;
      currentValue = [];
      multilineMode = "none";
      baseIndent = -1;
    }
  }

  for (const line of lines) {
    if (line.trim() === "---") {
      if (!foundFirst) {
        foundFirst = true;
        inFrontmatter = true;
        continue;
      } else {
        flushKey();
        break;
      }
    }

    if (!inFrontmatter) continue;

    // Check if this is a continuation line (indented) for a multiline value
    if (multilineMode !== "none" && currentKey) {
      const stripped = line.replace(/^\s*/, "");
      const indent = line.length - stripped.length;

      // Continuation line: must be indented more than the key
      if (indent > 0 && stripped.length > 0) {
        if (baseIndent === -1) baseIndent = indent;
        currentValue.push(stripped);
        continue;
      } else if (stripped.length === 0) {
        // Blank line inside multiline — skip it
        continue;
      } else {
        // Not indented — end of multiline, fall through to parse as new key
        flushKey();
      }
    }

    // Handle nested sub-keys under a parent (one-level nesting with dot notation)
    if (parentKey !== null) {
      if (parentKey === "dependencies" && line.trim().startsWith("#")) {
        continue;
      }
      const listMatch = line.match(/^\s+-\s*(.*?)\s*$/);
      if (listMatch) {
        if (parentKey === "dependencies") {
          const dependencies = result[parentKey]
            ? (JSON.parse(result[parentKey]) as string[])
            : [];
          dependencies.push(parseDependencyScalar(listMatch[1]));
          result[parentKey] = JSON.stringify(dependencies);
          continue;
        }
        const cleaned = listMatch[1].replace(/^["']|["']$/g, "");
        if (cleaned) {
          result[parentKey] = result[parentKey]
            ? `${result[parentKey]}\n${cleaned}`
            : cleaned;
        }
        continue;
      }
      if (parentKey === "dependencies" && /^\s+\S/.test(line)) {
        throw new Error(
          "Invalid dependencies metadata: use a sequence of scalar strings, not a nested mapping.",
        );
      }
      const subMatch = line.match(/^\s+(\w[\w-]*):\s*(.*?)\s*$/);
      if (subMatch) {
        const subKey = subMatch[1];
        const rawSubValue = subMatch[2];
        const cleaned = rawSubValue.replace(/^["']|["']$/g, "");
        if (cleaned) result[`${parentKey}.${subKey}`] = cleaned;
        continue;
      }
      // Non-indented or blank line — end of nested block
      if (line.trim().length > 0) {
        parentKey = null;
        // Fall through to parse as top-level key
      } else {
        continue;
      }
    }

    // Try to match a key: value line
    const match = line.match(/^(\w[\w-]*):\s*(.*?)\s*$/);
    if (match) {
      flushKey();
      const key = match[1];
      const rawValue = match[2];

      if (
        key === "dependencies" &&
        ["|", ">", "|+", ">+", "|-", ">-"].includes(rawValue)
      ) {
        throw new Error(
          "Invalid dependencies metadata: block scalars are unsupported; use a YAML sequence or a delimited scalar.",
        );
      }
      if (rawValue === "|" || rawValue === ">") {
        // Multiline block scalar
        currentKey = key;
        currentValue = [];
        multilineMode = rawValue === "|" ? "literal" : "folded";
      } else if (
        rawValue === "|+" ||
        rawValue === ">+" ||
        rawValue === "|-" ||
        rawValue === ">-"
      ) {
        currentKey = key;
        currentValue = [];
        multilineMode = rawValue.startsWith("|") ? "literal" : "folded";
      } else {
        // Single-line value — strip surrounding quotes
        const cleaned = rawValue.replace(/^["']|["']$/g, "");
        if (cleaned) {
          result[key] = cleaned;
        } else {
          // Empty value — treat as parent key for potential nested block
          parentKey = key;
        }
      }
    }
  }

  flushKey();
  return result;
}

export function resolveVersion(fm: Record<string, string>): string {
  return fm["metadata.version"] || fm.version || "0.0.0";
}

/**
 * Tokens: whitespace-delimited runs, also split where `<` or `(` follows text,
 * so `Name<a@b.c>` and `[Alice](mailto:a@b.c)` keep their name part. `[` and
 * `{` do not split, so `a@[1.2.3.4]` and `a{b}@x.com` stay one token.
 */
const CREATOR_TOKEN = /[<(]*[^\s<(]+|[<(]+/g;

/** A double-quoted local part, `@`, and its domain: `"john doe"@x.com`. */
const QUOTED_LOCAL_EMAIL = /"[^"]*"[@\uFF20\uFE6B]\S*/g;

/** Opening wrapper characters ignored when deciding if a token is an email. */
const LEADING_WRAPPERS = /^[<([{`'"*]+/;

/** An `@` (or its fullwidth / small form) with a non-space character before it. */
const AT_AFTER_CHARACTER = /\S[@\uFF20\uFE6B]/;

const WRAPPER_PAIR: Record<string, string> = {
  "<": ">",
  "(": ")",
  "[": "]",
  "{": "}",
  ">": "<",
  ")": "(",
  "]": "[",
  "}": "{",
};

/**
 * A whitespace-delimited token is an email when, past any opening wrapper
 * characters, an `@` has a non-space character before it, or when it carries
 * `mailto:`. Whatever else it contains does not matter: `a@[1.2.3.4]`,
 * `a{b}@x.com` and `Contact:alice@x.org` all count. `@luongnv89`,
 * `(@luongnv89)` and the lone `@` in `Team @ Acme` do not.
 */
function isEmailToken(token: string): boolean {
  return (
    AT_AFTER_CHARACTER.test(token.replace(LEADING_WRAPPERS, "")) ||
    /mailto:/i.test(token)
  );
}

/**
 * Remove an email token but keep what belongs to the text around it: a
 * trailing `,` / `;`, and opening or closing brackets whose partner is
 * outside the token (`(maintainer, a@b.c)` keeps its `)`).
 */
function removeEmailToken(token: string): string {
  let start = 0;
  let end = token.length;
  while (
    start < end &&
    "<([{".includes(token[start]) &&
    !token.slice(start + 1, end).includes(WRAPPER_PAIR[token[start]])
  ) {
    start++;
  }
  while (
    end > start &&
    (",;".includes(token[end - 1]) ||
      (">)]}".includes(token[end - 1]) &&
        !token.slice(start, end - 1).includes(WRAPPER_PAIR[token[end - 1]])))
  ) {
    end--;
  }
  return `${token.slice(0, start)} ${token.slice(end)}`;
}

/** Tidy-ups after removing emails, applied in order until nothing changes. */
const CREATOR_TIDY: Array<[RegExp, string]> = [
  [/<[\s,;]*>|\([\s,;]*\)|\[[\s,;]*\]|\{[\s,;]*\}|`[\s,;]*`/g, " "], // emptied wrappers
  [/([(<[{])[\s,;]+/g, "$1"], // separator right after an opening bracket
  [/[\s,;]+([)>\]}])/g, "$1"], // separator right before a closing bracket
  [/\s+([,;])/g, "$1"], // space before a separator
  [/([,;])(?:\s*[,;])+/g, "$1"], // repeated separators
  [/\s{2,}/g, " "], // doubled spaces
  [/^[\s,;]+|[\s,;]+$/g, ""], // leading or trailing separators
];

/** One creator entry as a display name, with every email token removed. */
function creatorDisplayName(part: string): string {
  let name = part.trim();
  // Unwrap only a matching pair of quotes, so `'quoted' name` keeps both.
  const quoted = name.match(/^(["'])(.*)\1$/s);
  if (quoted) name = quoted[2].trim();
  for (let previous = ""; previous !== name;) {
    previous = name;
    // The quoted part may hold spaces, so remove it before splitting tokens;
    // keep any closer or separator after the domain that belongs outside it.
    name = name.replace(QUOTED_LOCAL_EMAIL, (match) =>
      removeEmailToken(match.slice(match.lastIndexOf('"') + 2)),
    );
    name = name.replace(CREATOR_TOKEN, (token) =>
      isEmailToken(token) ? removeEmailToken(token) : token,
    );
    for (const [pattern, replacement] of CREATOR_TIDY) {
      name = name.replace(pattern, replacement);
    }
  }
  // Nothing meaningful left (only punctuation): drop the entry.
  return /[\p{L}\p{N}]/u.test(name) ? name : "";
}

/** Split a raw creator value into entries: a flow list, else one per line. */
function creatorEntries(value: string): string[] {
  const flow = value.match(/^\[([^[\]]*)\]$/);
  return flow ? flow[1].split(",") : value.split(/\r?\n/);
}

/**
 * Resolve a skill's display creator from the first key that yields one:
 * `metadata.creator`, then `metadata.author` (the skill-creator standard),
 * then the legacy top-level `creator` / `author` keys the evaluator already
 * accepts. The creator is a display name only, so no email address reaches
 * the index or the public catalog: every whitespace-delimited token with an
 * `@` that has a character before it (or `mailto:`) is removed, as is a
 * quoted local part (`"john doe"@x.com`); wrappers left empty and separators
 * are tidied (`Name <user@host>` → `Name`, `Cocoon AI (hi@x.com), ported by
 * B` → `Cocoon AI, ported by B`). A key left with no name falls through to
 * the next one. List values (one entry per line, or a `[a, b]` flow list) are
 * joined with ", ", dropping empty entries. "" when no key yields a name.
 */
export function resolveCreator(fm: Record<string, string>): string {
  for (const key of [
    "metadata.creator",
    "metadata.author",
    "creator",
    "author",
  ]) {
    const creator = creatorEntries((fm[key] || "").trim())
      .map(creatorDisplayName)
      .filter(Boolean)
      .join(", ");
    if (creator) return creator;
  }
  return "";
}

export function resolveAllowedTools(fm: Record<string, string>): string[] {
  const raw = fm["allowed-tools"] || "";
  if (!raw.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Optional skill references acquired by a caller only when a run needs them.
 *
 * This intentionally supports only scalar-string YAML block/flow sequences
 * and legacy comma/whitespace-delimited scalars. Nested collections and
 * non-string entries are rejected. Entries use the same names and explicit
 * sources accepted by `asm get` and `asm deps acquire`.
 */
export function resolveSkillDependencies(fm: Record<string, string>): string[] {
  const raw = (fm.dependencies || "").trim();
  if (!raw) return [];

  let entries: string[];
  if (raw.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(
        "Invalid dependencies metadata: malformed YAML flow sequence.",
        { cause: err },
      );
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some((entry) => typeof entry !== "string" || !entry.trim())
    ) {
      throw new Error(
        "Invalid dependencies metadata: flow sequences must contain only non-empty strings.",
      );
    }
    entries = parsed;
  } else {
    const tokens: string[] = [];
    let token = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;
    const flush = () => {
      if (token.trim()) tokens.push(token.trim());
      token = "";
    };

    for (let i = 0; i < raw.length; i++) {
      const char = raw[i];
      if (quote) {
        token += char;
        if (escaped) {
          escaped = false;
        } else if (quote === '"' && char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        token += char;
      } else if (char === "#" && (i === 0 || /\s/.test(raw[i - 1]))) {
        while (i + 1 < raw.length && raw[i + 1] !== "\n") i++;
        flush();
      } else if (char === "," || /\s/.test(char)) {
        flush();
      } else {
        token += char;
      }
    }
    if (quote) {
      throw new Error(
        "Invalid dependencies metadata: unterminated quoted string.",
      );
    }
    flush();
    entries = tokens.map(parseDependencyScalar);
  }

  const seen = new Set<string>();
  const dependencies: string[] = [];
  for (const entry of entries) {
    const normalized = entry.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      dependencies.push(normalized);
    }
  }
  return dependencies;
}

export function resolveTags(fm: Record<string, string>): string[] {
  const raw = (fm.tags || "").trim();
  if (!raw) return [];

  // Support both `tags: cli, testing` and the common inline YAML array form
  // `tags: [cli, testing]`. The frontmatter reader intentionally returns
  // strings, so normalize the lightweight array syntax here.
  const value =
    raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return normalizeTags(
    value.split(/[\s,]+/).map((tag) => tag.replace(/^['"]|['"]$/g, "")),
  );
}

const TAG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function normalizeTag(tag: string): string | null {
  const normalized = tag.trim().toLowerCase();
  if (!normalized || normalized.length > 32) return null;
  if (!TAG_RE.test(normalized)) return null;
  return normalized;
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const n = normalizeTag(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function normalizeFmBool(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isTruthyFm(value: string | undefined): boolean {
  const v = normalizeFmBool(value);
  return v === "true" || v === "yes" || v === "1";
}

function isFalsyFm(value: string | undefined): boolean {
  const v = normalizeFmBool(value);
  return v === "false" || v === "no" || v === "0";
}

/** Agent Skills: `disable-model-invocation: true` turns off model invocation. Default on. */
export function resolveModelInvocable(fm: Record<string, string>): boolean {
  return !isTruthyFm(fm["disable-model-invocation"]);
}

/** Agent Skills: `user-invocable: false` turns off slash/user invocation. Default on. */
export function resolveUserInvocable(fm: Record<string, string>): boolean {
  if (!("user-invocable" in fm)) return true;
  return !isFalsyFm(fm["user-invocable"]);
}

export type InvocabilityLabel = "model" | "user" | "both" | "none";

export function formatInvocability(
  modelInvocable?: boolean,
  userInvocable?: boolean,
): InvocabilityLabel {
  const model = modelInvocable !== false;
  const user = userInvocable !== false;
  if (model && user) return "both";
  if (model) return "model";
  if (user) return "user";
  return "none";
}

export function matchesInvocabilityFilters(
  skill: { modelInvocable?: boolean; userInvocable?: boolean },
  filters: { modelInvocable?: boolean; userInvocable?: boolean },
): boolean {
  const model = skill.modelInvocable !== false;
  const user = skill.userInvocable !== false;
  if (filters.modelInvocable && !model) return false;
  if (filters.userInvocable && !user) return false;
  return true;
}
