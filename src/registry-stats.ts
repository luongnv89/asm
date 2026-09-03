/**
 * External registry usage stats (ClawHub / skills.sh) used by the catalog
 * website and `asm search --popularity`.
 *
 * Network I/O is best-effort and fully injectable so unit tests never hit
 * a live registry. Failures return an empty map — callers must tolerate
 * missing stats the same way GitHub star fetches already do.
 */

export type RegistrySource = "clawdhub" | "skills.sh";

export interface RegistrySkillStats {
  source: RegistrySource;
  slug: string;
  displayName: string;
  installCount: number;
  downloadCount: number;
  stars: number;
  /** ISO-8601 timestamp when the registry last updated the skill. */
  updatedAt?: string;
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface FetchRegistryStatsOptions {
  fetch?: FetchLike;
  /** Hard cap on ClawHub list pages (each page is ~25 skills). */
  maxPages?: number;
  signal?: AbortSignal;
  /** Optional bearer token for skills.sh (`SKILLS_SH_TOKEN`). */
  skillsShToken?: string;
  /** Skip the live fetch (CI/local override). */
  skip?: boolean;
}

const CLAWHUB_LIST_URL = "https://clawhub.ai/api/v1/skills";
const SKILLS_SH_LIST_URL = "https://www.skills.sh/api/v1/skills";
const DEFAULT_MAX_PAGES = 8;
const USER_AGENT = "agent-skill-manager (https://github.com/luongnv89/asm)";

/** Lowercase, hyphenated key so `Foo_Bar` and `foo-bar` collide. */
export function normalizeSkillKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

/** Convert a unix epoch (seconds or milliseconds) to ISO-8601, or omit. */
export function epochToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const ms = value > 1e12 ? value : value * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseClawHubItem(raw: unknown): RegistrySkillStats | null {
  const item = asRecord(raw);
  if (!item) return null;
  const slug = typeof item.slug === "string" ? item.slug : "";
  if (!slug) return null;
  const stats = asRecord(item.stats) || {};
  const displayName =
    typeof item.displayName === "string" && item.displayName.trim()
      ? item.displayName
      : slug;
  return {
    source: "clawdhub",
    slug,
    displayName,
    installCount: asNumber(stats.installs),
    downloadCount: asNumber(stats.downloads),
    stars: asNumber(stats.stars),
    updatedAt: epochToIso(item.updatedAt) || epochToIso(item.createdAt),
  };
}

export function parseClawHubPage(payload: unknown): {
  items: RegistrySkillStats[];
  nextCursor?: string;
} {
  const body = asRecord(payload);
  if (!body) return { items: [] };
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items: RegistrySkillStats[] = [];
  for (const raw of rawItems) {
    const parsed = parseClawHubItem(raw);
    if (parsed) items.push(parsed);
  }
  const nextCursor =
    typeof body.nextCursor === "string" && body.nextCursor
      ? body.nextCursor
      : undefined;
  return { items, nextCursor };
}

/** Loose parser for skills.sh payloads (schema is auth-gated and may drift). */
export function parseSkillsShPayload(payload: unknown): RegistrySkillStats[] {
  const body = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(body?.skills)
      ? body!.skills
      : Array.isArray(body?.items)
        ? body!.items
        : [];
  const out: RegistrySkillStats[] = [];
  for (const raw of list) {
    const item = asRecord(raw);
    if (!item) continue;
    const slug =
      (typeof item.slug === "string" && item.slug) ||
      (typeof item.name === "string" && item.name) ||
      (typeof item.id === "string" && item.id) ||
      "";
    if (!slug) continue;
    const stats = asRecord(item.stats) || item;
    out.push({
      source: "skills.sh",
      slug,
      displayName:
        typeof item.displayName === "string" && item.displayName
          ? item.displayName
          : slug,
      installCount: asNumber(
        stats.installs ?? stats.installCount ?? item.installs,
      ),
      downloadCount: asNumber(
        stats.downloads ?? stats.downloadCount ?? item.downloads,
      ),
      stars: asNumber(stats.stars ?? item.stars),
      updatedAt:
        (typeof item.updatedAt === "string" && item.updatedAt) ||
        epochToIso(item.updatedAt) ||
        (typeof item.updated_at === "string" && item.updated_at) ||
        undefined,
    });
  }
  return out;
}

function indexStats(
  map: Map<string, RegistrySkillStats>,
  stats: RegistrySkillStats,
): void {
  const keys = new Set([
    normalizeSkillKey(stats.slug),
    normalizeSkillKey(stats.displayName),
  ]);
  for (const key of keys) {
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, stats);
      continue;
    }
    // Prefer the row with more installs; ClawHub wins ties (richer stats).
    if (stats.installCount > existing.installCount) {
      map.set(key, stats);
    } else if (
      stats.installCount === existing.installCount &&
      stats.source === "clawdhub" &&
      existing.source !== "clawdhub"
    ) {
      map.set(key, stats);
    }
  }
}

export function lookupStats(
  map: Map<string, RegistrySkillStats>,
  name: string,
): RegistrySkillStats | undefined {
  if (!name) return undefined;
  return map.get(normalizeSkillKey(name));
}

function defaultFetch(): FetchLike {
  return globalThis.fetch as FetchLike;
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, { headers, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchClawHubStats(
  options: FetchRegistryStatsOptions = {},
): Promise<Map<string, RegistrySkillStats>> {
  const map = new Map<string, RegistrySkillStats>();
  if (options.skip) return map;
  const fetchImpl = options.fetch ?? defaultFetch();
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ sort: "downloads" });
    if (cursor) params.set("cursor", cursor);
    const url = `${CLAWHUB_LIST_URL}?${params.toString()}`;
    const payload = await getJson(fetchImpl, url, headers, options.signal);
    if (!payload) break;
    const { items, nextCursor } = parseClawHubPage(payload);
    for (const item of items) indexStats(map, item);
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }
  return map;
}

export async function fetchSkillsShStats(
  options: FetchRegistryStatsOptions = {},
): Promise<Map<string, RegistrySkillStats>> {
  const map = new Map<string, RegistrySkillStats>();
  const token = options.skillsShToken || process.env.SKILLS_SH_TOKEN;
  if (options.skip || !token) return map;
  const fetchImpl = options.fetch ?? defaultFetch();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    Authorization: `Bearer ${token}`,
  };
  const payload = await getJson(
    fetchImpl,
    SKILLS_SH_LIST_URL,
    headers,
    options.signal,
  );
  if (!payload) return map;
  for (const item of parseSkillsShPayload(payload)) indexStats(map, item);
  return map;
}

/** Merge ClawHub + optional skills.sh maps. ClawHub wins on install-count ties. */
export function mergeRegistryMaps(
  ...maps: Array<Map<string, RegistrySkillStats>>
): Map<string, RegistrySkillStats> {
  const out = new Map<string, RegistrySkillStats>();
  for (const map of maps) {
    for (const stats of map.values()) indexStats(out, stats);
  }
  return out;
}

export async function fetchRegistryStats(
  options: FetchRegistryStatsOptions = {},
): Promise<Map<string, RegistrySkillStats>> {
  if (options.skip || process.env.ASM_SKIP_REGISTRY_STATS === "1") {
    return new Map();
  }
  const [claw, skillsSh] = await Promise.all([
    fetchClawHubStats(options),
    fetchSkillsShStats(options),
  ]);
  return mergeRegistryMaps(claw, skillsSh);
}

export function compareByPopularity<
  T extends {
    installCount?: number;
    stars?: number;
    name?: string;
  },
>(a: T, b: T): number {
  const ai = typeof a.installCount === "number" ? a.installCount : -1;
  const bi = typeof b.installCount === "number" ? b.installCount : -1;
  if (ai !== bi) return bi - ai;
  const as = typeof a.stars === "number" ? a.stars : -1;
  const bs = typeof b.stars === "number" ? b.stars : -1;
  if (as !== bs) return bs - as;
  return (a.name || "").localeCompare(b.name || "");
}

export function compareByRecency<
  T extends { updatedAt?: string; name?: string },
>(a: T, b: T): number {
  const at = a.updatedAt ? Date.parse(a.updatedAt) : NaN;
  const bt = b.updatedAt ? Date.parse(b.updatedAt) : NaN;
  const aOk = Number.isFinite(at);
  const bOk = Number.isFinite(bt);
  if (aOk && bOk && at !== bt) return bt - at;
  if (aOk !== bOk) return aOk ? -1 : 1;
  return (a.name || "").localeCompare(b.name || "");
}
