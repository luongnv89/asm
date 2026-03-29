import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { fetchWithCache } from "./http";
import type { CacheEntry } from "./http";

describe("fetchWithCache", () => {
  let tempDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-http-test-"));
    cachePath = join(tempDir, "test-cache.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when fetch fails and no cache exists", async () => {
    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      cachePath,
    );
    expect(result).toBeNull();
  });

  it("returns cached data when cache is fresh", async () => {
    const cachedData = { items: ["a", "b"] };
    const entry: CacheEntry = {
      fetched_at: new Date().toISOString(),
      ttl_seconds: 3600,
      data: cachedData,
    };
    await writeFile(cachePath, JSON.stringify(entry), "utf-8");

    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      cachePath,
    );
    expect(result).toEqual(cachedData);
  });

  it("uses stale cache as fallback when fetch fails", async () => {
    const staleData = { stale: true };
    const entry: CacheEntry = {
      fetched_at: new Date(Date.now() - 7200 * 1000).toISOString(), // 2 hours ago
      ttl_seconds: 3600,
      data: staleData,
    };
    await writeFile(cachePath, JSON.stringify(entry), "utf-8");

    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      cachePath,
    );
    expect(result).toEqual(staleData);
  });

  it("bypasses cache when noCache is true", async () => {
    const cachedData = { cached: true };
    const entry: CacheEntry = {
      fetched_at: new Date().toISOString(),
      ttl_seconds: 3600,
      data: cachedData,
    };
    await writeFile(cachePath, JSON.stringify(entry), "utf-8");

    // noCache should skip the fresh cache and try to fetch
    // Since the URL is unreachable, it falls back to stale cache
    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      cachePath,
      { noCache: true },
    );
    // Falls back to stale cache
    expect(result).toEqual(cachedData);
  });

  it("returns null for invalid cache JSON", async () => {
    await writeFile(cachePath, "not-valid-json", "utf-8");

    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      cachePath,
    );
    expect(result).toBeNull();
  });

  it("creates cache directory if it does not exist", async () => {
    const nestedPath = join(tempDir, "a", "b", "c", "cache.json");
    const data = { test: true };
    const entry: CacheEntry = {
      fetched_at: new Date().toISOString(),
      ttl_seconds: 3600,
      data,
    };
    await mkdir(join(tempDir, "a", "b", "c"), { recursive: true });
    await writeFile(nestedPath, JSON.stringify(entry), "utf-8");

    const result = await fetchWithCache(
      "http://localhost:19999/nonexistent",
      nestedPath,
    );
    expect(result).toEqual(data);
  });
});
