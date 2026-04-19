/**
 * Provider registry for the `asm eval` framework.
 *
 * Providers are indexed by `id` with an array of versions per id so multiple
 * majors/minors can coexist (e.g. for gradual provider upgrades). Resolution
 * is by semver range: `resolve("id", "^1.0.0")` returns the highest-versioned
 * provider whose `version` falls inside the range.
 *
 * The repo intentionally avoids a dependency on the `semver` npm package
 * for this PR — the minimal matcher below covers the shapes the framework
 * actually uses: exact `X.Y.Z`, caret `^X.Y.Z`, tilde `~X.Y.Z`, and the
 * wildcards `*` / `x`. Pre-release suffixes (`1.0.0-next`) are parsed and
 * ordered correctly (pre-release sorts strictly less than its base release,
 * per standard semver).
 */

import type { EvalProvider } from "./types";

// ─── Parsed semver representation ───────────────────────────────────────────

/** Internal parsed form of a semver string. */
interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers (e.g. ["next"] for "1.0.0-next"). */
  prerelease: string[];
}

const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parse a semver string. Returns `null` for invalid input.
 *
 * Build metadata (`+sha.1234`) is accepted but discarded — it does not
 * participate in precedence per SemVer 2.0.0 §10.
 */
export function parseSemver(v: string): SemVer | null {
  if (typeof v !== "string") return null;
  const match = SEMVER_RE.exec(v.trim());
  if (!match) return null;
  const [, maj, min, pat, pre] = match;
  return {
    major: Number(maj),
    minor: Number(min),
    patch: Number(pat),
    prerelease: pre ? pre.split(".") : [],
  };
}

/**
 * Compare two parsed semvers. Returns `<0`, `0`, or `>0` like `Array.sort`.
 *
 * Pre-release versions have lower precedence than the corresponding
 * release (1.0.0-next < 1.0.0). Pre-release identifiers compare segment
 * by segment: numeric segments numerically, alphanumeric lexically,
 * numeric < alphanumeric.
 */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // A version with no prerelease > a version with prerelease.
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (aNum && !bNum) {
      return -1;
    } else if (!aNum && bNum) {
      return 1;
    } else if (ai < bi) {
      return -1;
    } else if (ai > bi) {
      return 1;
    }
  }
  return 0;
}

/**
 * Throw `Error("invalid semver: …")` for an invalid version string.
 * The registry uses this for `register()` input validation.
 */
function assertValidVersion(v: string, context: string): SemVer {
  const parsed = parseSemver(v);
  if (!parsed) {
    throw new Error(`invalid semver: ${context} "${v}"`);
  }
  return parsed;
}

// ─── Range matching ─────────────────────────────────────────────────────────

/**
 * Test whether a semver string satisfies a range expression.
 *
 * Supported range shapes:
 *   - `"*"` or `"x"`  — any version
 *   - `"X.Y.Z"`       — exact match (including pre-release)
 *   - `"^X.Y.Z"`      — same major (if X>0), same minor (if X=0)
 *   - `"~X.Y.Z"`      — same major.minor
 *
 * Throws on invalid range syntax so callers get an explicit error
 * rather than silently matching nothing.
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (typeof range !== "string" || range.trim().length === 0) {
    throw new Error(`invalid semver range: ${JSON.stringify(range)}`);
  }
  const v = parseSemver(version);
  if (!v) return false;
  const r = range.trim();

  if (r === "*" || r === "x" || r === "X") return true;

  if (r.startsWith("^")) {
    const base = assertValidVersion(r.slice(1), "range base");
    if (compareSemver(v, base) < 0) return false;
    if (base.major > 0) {
      return v.major === base.major;
    }
    if (base.minor > 0) {
      return v.major === 0 && v.minor === base.minor;
    }
    return v.major === 0 && v.minor === 0 && v.patch === base.patch;
  }

  if (r.startsWith("~")) {
    const base = assertValidVersion(r.slice(1), "range base");
    if (compareSemver(v, base) < 0) return false;
    return v.major === base.major && v.minor === base.minor;
  }

  // Exact match (optionally prefixed with "=")
  const exact = r.startsWith("=") ? r.slice(1).trim() : r;
  const base = parseSemver(exact);
  if (!base) {
    throw new Error(`invalid semver range: ${JSON.stringify(range)}`);
  }
  return compareSemver(v, base) === 0;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const providers = new Map<string, EvalProvider[]>();

/**
 * Register a provider. Multiple versions per id are allowed but exact
 * `(id, version)` duplicates throw.
 */
export function register(provider: EvalProvider): void {
  if (
    !provider ||
    typeof provider.id !== "string" ||
    provider.id.length === 0
  ) {
    throw new Error("register: provider.id is required");
  }
  // Validate version up front so registration fails fast — PR 2+ relies on
  // this to prevent malformed providers from slipping into the catalog.
  assertValidVersion(provider.version, `provider ${provider.id} version`);
  if (
    typeof provider.schemaVersion !== "number" ||
    !Number.isInteger(provider.schemaVersion)
  ) {
    throw new Error(
      `register: provider ${provider.id} schemaVersion must be an integer`,
    );
  }
  const existing = providers.get(provider.id) ?? [];
  if (existing.some((p) => p.version === provider.version)) {
    throw new Error(
      `register: provider ${provider.id}@${provider.version} already registered`,
    );
  }
  existing.push(provider);
  providers.set(provider.id, existing);
}

/**
 * Resolve the highest-versioned provider for `id` whose version satisfies
 * `semverRange`.
 *
 * Throws:
 *   - When `id` is not registered at all.
 *   - When `semverRange` is syntactically invalid.
 *   - When no registered version satisfies the range.
 */
export function resolve(id: string, semverRange: string): EvalProvider {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("resolve: id is required");
  }
  const versions = providers.get(id);
  if (!versions || versions.length === 0) {
    throw new Error(`resolve: provider "${id}" is not registered`);
  }
  // `satisfiesRange` throws on invalid range syntax — bubble that up so
  // callers can distinguish "unknown id" from "bad range".
  const matching = versions.filter((p) =>
    satisfiesRange(p.version, semverRange),
  );
  if (matching.length === 0) {
    const available = versions.map((p) => p.version).join(", ");
    throw new Error(
      `resolve: no version of "${id}" satisfies "${semverRange}" (have: ${available})`,
    );
  }
  // Highest wins.
  matching.sort((a, b) =>
    compareSemver(parseSemver(b.version)!, parseSemver(a.version)!),
  );
  return matching[0]!;
}

/**
 * List every registered `(id, version)` pair, flattened.
 *
 * Used by `asm eval-providers list` in PR 3. The returned array is a
 * shallow copy; callers may mutate it freely.
 */
export function list(): EvalProvider[] {
  const out: EvalProvider[] = [];
  for (const versions of providers.values()) {
    for (const p of versions) out.push(p);
  }
  return out;
}

/**
 * Clear the registry. Test-only utility — not re-exported from the
 * framework entry point. Production code should never call this.
 */
export function __resetForTests(): void {
  providers.clear();
}
