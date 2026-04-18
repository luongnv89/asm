/**
 * Tiny semver range matcher for `externalRequires` — skillgrade binary pin.
 *
 * The main registry's `satisfiesRange` handles the shapes ASM cares about
 * internally (`^`, `~`, exact, `*`) but `externalRequires` in
 * `~/.asm/config.yml` typically uses **compound comparator ranges** like
 * `">=0.1.3 <0.3.0"` — ANDed inequalities. Rather than expand the registry
 * matcher and ripple changes through every provider, this helper stays
 * local to the skillgrade provider: it understands the subset we use for
 * external binary pins and nothing more.
 *
 * Supported range shapes:
 *   - `"*"` / `"x"` / `""`            — any version matches
 *   - `"X.Y.Z"` (exact)               — strict equality
 *   - `"^X.Y.Z"`                      — caret (delegated to registry matcher)
 *   - `"~X.Y.Z"`                      — tilde (delegated to registry matcher)
 *   - `">=X.Y.Z"`, `">X.Y.Z"`,
 *     `"<=X.Y.Z"`, `"<X.Y.Z"`,
 *     `"=X.Y.Z"`                     — single comparator
 *   - Space-separated conjunction of the above: `">=0.1.3 <0.3.0"`
 *
 * Pre-release versions are accepted but follow standard SemVer ordering
 * (a pre-release is strictly less than its base release). Invalid ranges
 * throw — silently matching nothing would mask config mistakes.
 */
import {
  compareSemver,
  parseSemver,
  satisfiesRange as satisfiesRegistryRange,
} from "../../../registry";

type Comparator = ">=" | ">" | "<=" | "<" | "=";

interface SingleComparator {
  op: Comparator;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const COMPARATOR_RE = /^(>=|<=|>|<|=)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Parse a single comparator clause like `">=0.1.3"` or `"<0.3.0"`.
 * Returns null for shapes this helper does not own (e.g. `^1.0.0`).
 */
function parseComparator(clause: string): SingleComparator | null {
  const m = COMPARATOR_RE.exec(clause);
  if (!m) return null;
  const [, op, ver] = m;
  const parsed = parseSemver(ver);
  if (!parsed) return null;
  return {
    op: op as Comparator,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    prerelease: parsed.prerelease,
  };
}

/**
 * Evaluate a single comparator clause against a parsed version.
 * Throws only if the clause is structurally invalid (already filtered
 * by `parseComparator`), which is why this is a pure function.
 */
function matchComparator(
  version: ReturnType<typeof parseSemver>,
  clause: SingleComparator,
): boolean {
  if (!version) return false;
  const diff = compareSemver(version, {
    major: clause.major,
    minor: clause.minor,
    patch: clause.patch,
    prerelease: clause.prerelease,
  });
  switch (clause.op) {
    case ">=":
      return diff >= 0;
    case ">":
      return diff > 0;
    case "<=":
      return diff <= 0;
    case "<":
      return diff < 0;
    case "=":
      return diff === 0;
  }
}

/**
 * Main entry point — does `version` satisfy `range`?
 *
 * Empty / wildcard range matches every version. Compound ranges (space
 * separated) require every clause to match (AND semantics). Invalid
 * ranges throw so bad config is loud, not silent.
 */
export function satisfiesExternalRange(
  version: string,
  range: string | undefined,
): boolean {
  if (!range || range.trim().length === 0) return true;
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "x" || trimmed === "X") return true;

  const parsedVersion = parseSemver(version);
  if (!parsedVersion) return false;

  const clauses = trimmed.split(/\s+/);
  for (const raw of clauses) {
    if (raw.length === 0) continue;

    // Comparator clauses owned by this helper: >=, >, <=, <, =
    const comp = parseComparator(raw);
    if (comp) {
      if (!matchComparator(parsedVersion, comp)) return false;
      continue;
    }

    // Shapes the registry matcher understands: ^, ~, exact
    // Delegate so we stay consistent with internal resolution rules.
    try {
      if (!satisfiesRegistryRange(version, raw)) return false;
      continue;
    } catch {
      throw new Error(
        `invalid externalRequires range clause: ${JSON.stringify(raw)} in ${JSON.stringify(range)}`,
      );
    }
  }
  return true;
}
