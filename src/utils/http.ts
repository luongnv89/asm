/**
 * Shared HTTP utility with caching support.
 *
 * Provides `fetchWithCache()` for fetching remote JSON data with a
 * file-based cache and configurable TTL. Falls back to stale cache
 * on network errors.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { debug } from "../logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  fetched_at: string;
  ttl_seconds: number;
  data: T;
}

export interface FetchWithCacheOptions {
  /** Time-to-live in seconds (default: 3600 = 1 hour) */
  ttl?: number;
  /** Skip cache and force a fresh fetch */
  noCache?: boolean;
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

async function readCache<T>(cachePath: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await readFile(cachePath, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry.fetched_at || entry.data === undefined || entry.data === null)
      return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeCache<T>(
  cachePath: string,
  data: T,
  ttl: number,
): Promise<void> {
  const entry: CacheEntry<T> = {
    fetched_at: new Date().toISOString(),
    ttl_seconds: ttl,
    data,
  };
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(entry, null, 2), "utf-8");
    debug(`http: wrote cache -> ${cachePath}`);
  } catch (err) {
    debug(`http: failed to write cache: ${err}`);
  }
}

function isCacheFresh(entry: CacheEntry): boolean {
  const fetchedAt = new Date(entry.fetched_at).getTime();
  const now = Date.now();
  const ageSeconds = (now - fetchedAt) / 1000;
  return ageSeconds < entry.ttl_seconds;
}

// ─── fetchWithCache ─────────────────────────────────────────────────────────

/**
 * Fetch JSON data from a URL with file-based caching.
 *
 * - Returns cached data if fresh (within TTL).
 * - Fetches fresh data on cache miss, expiry, or `noCache: true`.
 * - Falls back to stale cache on network failure.
 * - Returns `null` only if both fetch and cache fail.
 */
export async function fetchWithCache<T = unknown>(
  url: string,
  cachePath: string,
  options: FetchWithCacheOptions = {},
): Promise<T | null> {
  const ttl = options.ttl ?? 3600;
  const noCache = options.noCache ?? false;

  // Try cache first (unless --no-cache)
  const cached = await readCache<T>(cachePath);

  if (cached && !noCache && isCacheFresh(cached)) {
    debug(`http: cache hit (fresh) -> ${cachePath}`);
    return cached.data;
  }

  // Fetch fresh data
  try {
    debug(`http: fetching -> ${url}`);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as T;
    await writeCache(cachePath, data, ttl);
    return data;
  } catch (err) {
    debug(`http: fetch failed: ${err}`);

    // Fall back to stale cache if available
    if (cached) {
      debug(`http: using stale cache as fallback -> ${cachePath}`);
      return cached.data;
    }

    return null;
  }
}
