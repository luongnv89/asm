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
