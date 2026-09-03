import { describe, expect, it, vi } from "vitest";
import {
  collectRepoStars,
  exceedsStarFailureThreshold,
  fetchRepoStars,
  mergeStarBaseline,
  parseStarBaseline,
  rateLimitDelayMs,
  resolveRepoStars,
  starTokenFromEnv,
} from "./repo-stars";

function mockFetch(
  handler: (url: string) => {
    status: number;
    ok?: boolean;
    headers?: Record<string, string>;
    body?: unknown;
  },
): typeof fetch {
  return (async (url: unknown) => {
    const r = handler(String(url));
    return {
      status: r.status,
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      headers: {
        get: (name: string) => r.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () => {
        if (r.body === undefined) throw new Error("no json");
        return r.body;
      },
    };
  }) as unknown as typeof fetch;
}

describe("repo-stars: token source", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN", () => {
    expect(
      starTokenFromEnv({ GITHUB_TOKEN: "a", GH_TOKEN: "b" } as never),
    ).toBe("a");
    expect(starTokenFromEnv({ GH_TOKEN: "b" } as never)).toBe("b");
    expect(starTokenFromEnv({} as never)).toBeUndefined();
  });
});

describe("repo-stars: rate-limit delay", () => {
  it("honours retry-after within the cap", () => {
    expect(rateLimitDelayMs("2", null, 0, 0, 30_000)).toBe(2000);
  });

  it("gives up when retry-after exceeds the cap instead of stalling", () => {
    expect(rateLimitDelayMs("3600", null, 0, 0, 30_000)).toBeNull();
  });

  it("honours x-ratelimit-reset within the cap", () => {
    expect(rateLimitDelayMs(null, "100", 0, 90_000, 30_000)).toBe(10_000);
  });

  it("gives up when the reset is an hour away", () => {
    expect(rateLimitDelayMs(null, "4600", 0, 1_000_000, 30_000)).toBeNull();
  });

  it("falls back to linear backoff without headers", () => {
    expect(rateLimitDelayMs(null, null, 0, 0, 30_000)).toBe(1000);
    expect(rateLimitDelayMs(null, null, 1, 0, 30_000)).toBe(2000);
  });
});

describe("repo-stars: fetchRepoStars", () => {
  it("returns the star count on success", async () => {
    const f = mockFetch(() => ({
      status: 200,
      body: { stargazers_count: 45866 },
    }));
    await expect(
      fetchRepoStars("sickn33", "x", { fetchImpl: f }),
    ).resolves.toBe(45866);
  });

  it("returns null (not 0) on rate-limit exhaustion", async () => {
    const f = mockFetch(() => ({ status: 403, headers: {} }));
    await expect(
      fetchRepoStars("a", "b", { fetchImpl: f, maxWaitMs: 1 }),
    ).resolves.toBeNull();
  });

  it("returns null (not 0) on 404 and other errors", async () => {
    const notFound = mockFetch(() => ({ status: 404 }));
    await expect(
      fetchRepoStars("a", "b", { fetchImpl: notFound }),
    ).resolves.toBeNull();
    const serverError = mockFetch(() => ({ status: 500 }));
    await expect(
      fetchRepoStars("a", "b", { fetchImpl: serverError }),
    ).resolves.toBeNull();
  });

  it("returns null on network failure after retries", async () => {
    const f = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(
      fetchRepoStars("a", "b", { fetchImpl: f, attempts: 2, maxWaitMs: 1 }),
    ).resolves.toBeNull();
  });

  it("sends authorization only when a token is present", async () => {
    const seen: Record<string, string>[] = [];
    const f = (async (_url: unknown, init: unknown) => {
      seen.push((init as { headers: Record<string, string> }).headers);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ stargazers_count: 1 }),
      };
    }) as unknown as typeof fetch;
    await fetchRepoStars("a", "b", { fetchImpl: f, token: "t" });
    expect(seen[0].Authorization).toBe("Bearer t");
    await fetchRepoStars("a", "b", { fetchImpl: f });
    expect(seen[1].Authorization).toBeUndefined();
  });

  it("retries a 429 after the advertised delay then succeeds", async () => {
    let calls = 0;
    const f = mockFetch(() => {
      calls++;
      if (calls === 1) return { status: 429, headers: { "retry-after": "0" } };
      return { status: 200, body: { stargazers_count: 7 } };
    });
    vi.useFakeTimers();
    try {
      const p = fetchRepoStars("a", "b", { fetchImpl: f });
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBe(7);
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toBe(2);
  });
});

describe("repo-stars: collectRepoStars", () => {
  it("splits successes and failures without zeroing", async () => {
    const f = mockFetch((url) =>
      url.includes("/good/")
        ? { status: 200, body: { stargazers_count: 3 } }
        : { status: 403, headers: {} },
    );
    const { stars, failures } = await collectRepoStars(["good/r", "bad/r"], {
      fetchImpl: f,
      maxWaitMs: 1,
      concurrency: 1,
    });
    expect(stars.get("good/r")).toBe(3);
    expect(stars.has("bad/r")).toBe(false);
    expect(failures).toEqual(["bad/r"]);
  });
});

describe("repo-stars: baseline", () => {
  it("parses only finite non-negative numbers", () => {
    expect(
      parseStarBaseline({ stars: { "a/b": 5, "c/d": -1, "e/f": "x" } }),
    ).toEqual({ "a/b": 5 });
    expect(parseStarBaseline(null)).toEqual({});
    expect(parseStarBaseline({ stars: null })).toEqual({});
  });

  it("fresh fetches win, failures keep the last known value", () => {
    const merged = mergeStarBaseline(
      { "a/b": 10, "c/d": 20 },
      new Map([["a/b", 11]]),
    );
    expect(merged).toEqual({ "a/b": 11, "c/d": 20 });
  });

  it("resolves unknowns explicitly instead of zeroing them", () => {
    const { values, unknown } = resolveRepoStars(
      ["a/b", "c/d", "e/f"],
      new Map([["a/b", 11]]),
      { "c/d": 20 },
    );
    expect(values.get("a/b")).toBe(11);
    expect(values.get("c/d")).toBe(20);
    expect(values.get("e/f")).toBeNull();
    expect(unknown).toEqual(["e/f"]);
  });
});

describe("repo-stars: failure gate", () => {
  it("tolerates a few percent, fails loudly beyond that", () => {
    expect(exceedsStarFailureThreshold(0, 73)).toBe(false);
    expect(exceedsStarFailureThreshold(3, 73)).toBe(false);
    expect(exceedsStarFailureThreshold(5, 73)).toBe(true);
    expect(exceedsStarFailureThreshold(73, 73)).toBe(true);
    expect(exceedsStarFailureThreshold(0, 0)).toBe(false);
  });
});
