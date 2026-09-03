/**
 * GitHub star counts for the skill-catalog build (issue #598).
 *
 * The catalog build fetches `GET /repos/{owner}/{repo}` once per indexed
 * repo. Unauthenticated callers get 60 requests/hour, so with ~73 repos the
 * tail of the fetch loop was rate-limited and every failure path published
 * `0` — indistinguishable from "zero stars" and fatal to the default
 * "Most popular" sort. This module keeps the fetch testable and honest:
 *
 * - failures resolve to `null` (unknown), never `0`;
 * - `403`/`429` responses honour `retry-after` / `x-ratelimit-reset`
 *   instead of a fixed 1–2 s sleep, with a cap so the build never stalls;
 * - a committed `data/repo-stars.json` baseline supplies the last known
 *   value when a fetch fails, so a blip degrades to stale data, not zeros;
 * - the build fails loudly when more than a few percent of repos end up
 *   with unknown stars, so this cannot silently regress again.
 */

export const STAR_FETCH_CONCURRENCY = 8;
export const STAR_FETCH_ATTEMPTS = 3;
export const STAR_FETCH_MAX_WAIT_MS = 30_000;
export const STAR_FAILURE_RATE = 0.05;
export const STAR_FAILURE_MIN = 2;
export const STAR_BASELINE_PATH = "data/repo-stars.json";
export const STAR_USER_AGENT =
  "asm-build-catalog (+https://github.com/luongnv89/asm)";

export interface StarFetchOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  maxWaitMs?: number;
}

export interface StarBaseline {
  generatedAt: string;
  stars: Record<string, number>;
}

/** Token source for the star fetch — never logged, only sent as a header. */
export function starTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.GITHUB_TOKEN || env.GH_TOKEN || undefined;
}

/**
 * How long to wait before retrying a `403`/`429`, in milliseconds, or
 * `null` when retrying is pointless (the limit resets too far away — return
 * `null` from the fetch instead of stalling the build).
 */
export function rateLimitDelayMs(
  retryAfter: string | null,
  resetEpochSec: string | null,
  attempt: number,
  nowMs: number = Date.now(),
  maxWaitMs: number = STAR_FETCH_MAX_WAIT_MS,
): number | null {
  if (retryAfter !== null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) {
      if (secs * 1000 > maxWaitMs) return null;
      return secs * 1000;
    }
  }
  if (resetEpochSec !== null) {
    const reset = Number(resetEpochSec);
    if (Number.isFinite(reset) && reset > 0) {
      const waitMs = reset * 1000 - nowMs;
      if (waitMs > maxWaitMs) return null;
      if (waitMs > 0) return waitMs;
    }
  }
  return Math.min(1000 * (attempt + 1), maxWaitMs);
}

/** Fetch one repo's star count; `null` means unknown (never `0`-on-error). */
export async function fetchRepoStars(
  owner: string,
  repo: string,
  opts: StarFetchOptions = {},
): Promise<number | null> {
  const {
    token,
    fetchImpl = fetch,
    attempts = STAR_FETCH_ATTEMPTS,
    maxWaitMs = STAR_FETCH_MAX_WAIT_MS,
  } = opts;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": STAR_USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
      });
    } catch {
      if (attempt === attempts - 1) return null;
      await sleep(
        rateLimitDelayMs(null, null, attempt, Date.now(), maxWaitMs)!,
      );
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      const delay = rateLimitDelayMs(
        res.headers.get("retry-after"),
        res.headers.get("x-ratelimit-reset"),
        attempt,
        Date.now(),
        maxWaitMs,
      );
      if (delay === null || attempt === attempts - 1) return null;
      await sleep(delay);
      continue;
    }
    if (!res.ok) return null;
    let data: { stargazers_count?: unknown };
    try {
      data = (await res.json()) as { stargazers_count?: unknown };
    } catch {
      return null;
    }
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch every repo with bounded concurrency; failures are listed, not zeroed. */
export async function collectRepoStars(
  keys: string[],
  opts: StarFetchOptions & { concurrency?: number } = {},
): Promise<{ stars: Map<string, number>; failures: string[] }> {
  const { concurrency = STAR_FETCH_CONCURRENCY, ...fetchOpts } = opts;
  const stars = new Map<string, number>();
  const failures: string[] = [];
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (key) => {
        const [owner, repo] = key.split("/");
        const value = await fetchRepoStars(owner, repo, fetchOpts);
        if (value === null) failures.push(key);
        else stars.set(key, value);
      }),
    );
  }
  return { stars, failures };
}

/** Defensive parse of the committed baseline — invalid content means empty. */
export function parseStarBaseline(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const stars = (raw as { stars?: unknown }).stars;
  if (typeof stars !== "object" || stars === null) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(stars)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = value;
    }
  }
  return out;
}

/** Merge fresh successes over the baseline; failures keep the last known value. */
export function mergeStarBaseline(
  baseline: Record<string, number>,
  fetched: Map<string, number>,
): Record<string, number> {
  return { ...baseline, ...Object.fromEntries(fetched) };
}

/** Resolve every repo to a number or `null` (unknown); unknowns are listed. */
export function resolveRepoStars(
  keys: string[],
  fetched: Map<string, number>,
  baseline: Record<string, number>,
): { values: Map<string, number | null>; unknown: string[] } {
  const values = new Map<string, number | null>();
  const unknown: string[] = [];
  for (const key of keys) {
    const value = fetched.get(key) ?? baseline[key] ?? null;
    values.set(key, value);
    if (value === null) unknown.push(key);
  }
  return { values, unknown };
}

/** True when so many repos lack star data that the build must fail loudly. */
export function exceedsStarFailureThreshold(
  unknownCount: number,
  totalCount: number,
  rate: number = STAR_FAILURE_RATE,
  min: number = STAR_FAILURE_MIN,
): boolean {
  if (totalCount <= 0) return false;
  return unknownCount > Math.max(min, Math.ceil(totalCount * rate));
}
