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
