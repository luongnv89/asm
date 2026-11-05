import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import {
  collectRepoStars,
  describeFailedResponse,
  exceedsStarFailureThreshold,
  fetchRepoStars,
  mergeStarBaseline,
  parseStarBaseline,
  rateLimitDelayMs,
  resolveRepoStars,
  STAR_BASELINE_PATH,
  starsOfflineFromEnv,
  starTokenFromEnv,
} from "./repo-stars";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

describe("repo-stars: offline mode (issue #784)", () => {
  it("is on only for ASM_STARS_OFFLINE=1 or true", () => {
    expect(starsOfflineFromEnv({ ASM_STARS_OFFLINE: "1" })).toBe(true);
    expect(starsOfflineFromEnv({ ASM_STARS_OFFLINE: " TRUE " })).toBe(true);
    expect(starsOfflineFromEnv({ ASM_STARS_OFFLINE: "" })).toBe(false);
    expect(starsOfflineFromEnv({ ASM_STARS_OFFLINE: "0" })).toBe(false);
    expect(starsOfflineFromEnv({})).toBe(false);
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

describe("repo-stars: failure reasons (issue #784)", () => {
  const headers = (h: Record<string, string>) => ({
    get: (name: string) => h[name.toLowerCase()] ?? null,
  });

  it("describes status, retry-after and the reset time as ISO", () => {
    expect(describeFailedResponse({ status: 500, headers: headers({}) })).toBe(
      "HTTP 500",
    );
    expect(
      describeFailedResponse({
        status: 403,
        headers: headers({
          "retry-after": "60",
          "x-ratelimit-reset": "1793919600",
        }),
      }),
    ).toBe(
      "HTTP 403, retry-after 60s, x-ratelimit-reset 2026-11-05T23:00:00.000Z",
    );
    expect(
      describeFailedResponse({
        status: 429,
        headers: headers({ "x-ratelimit-reset": "soon" }),
      }),
    ).toBe("HTTP 429, x-ratelimit-reset soon");
    expect(
      describeFailedResponse({
        status: 429,
        headers: headers({ "retry-after": "Thu, 05 Nov 2026 23:00:00 GMT" }),
      }),
    ).toBe("HTTP 429, retry-after Thu, 05 Nov 2026 23:00:00 GMT");
  });

  it("reports why each fetch resolved to null", async () => {
    const seen: string[] = [];
    const onFailure = (r: string) => seen.push(r);
    const limited = mockFetch(() => ({
      status: 403,
      headers: { "x-ratelimit-reset": "4102444800" },
    }));
    await fetchRepoStars("a", "b", { fetchImpl: limited, onFailure });
    await fetchRepoStars("a", "b", {
      fetchImpl: mockFetch(() => ({ status: 404 })),
      onFailure,
    });
    await fetchRepoStars("a", "b", {
      fetchImpl: mockFetch(() => ({ status: 200, body: {} })),
      onFailure,
    });
    await fetchRepoStars("a", "b", {
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
      attempts: 1,
      onFailure,
    });
    expect(seen).toEqual([
      "HTTP 403, x-ratelimit-reset 2100-01-01T00:00:00.000Z",
      "HTTP 404",
      "HTTP 200, no numeric stargazers_count",
      "network error: ECONNREFUSED",
    ]);
  });

  it("does not report a reason on success", async () => {
    const onFailure = vi.fn();
    await fetchRepoStars("a", "b", {
      fetchImpl: mockFetch(() => ({
        status: 200,
        body: { stargazers_count: 1 },
      })),
      onFailure,
    });
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe("repo-stars: collectRepoStars", () => {
  it("splits successes and failures without zeroing", async () => {
    const f = mockFetch((url) =>
      url.includes("/good/")
        ? { status: 200, body: { stargazers_count: 3 } }
        : { status: 403, headers: {} },
    );
    const { stars, failures, reasons } = await collectRepoStars(
      ["good/r", "bad/r"],
      {
        fetchImpl: f,
        maxWaitMs: 1,
        concurrency: 1,
      },
    );
    expect(stars.get("good/r")).toBe(3);
    expect(stars.has("bad/r")).toBe(false);
    expect(failures).toEqual(["bad/r"]);
    expect(reasons.get("bad/r")).toBe("HTTP 403");
    expect(reasons.has("good/r")).toBe(false);
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

describe("repo-stars: committed baseline (issue #784)", () => {
  // Offline CI builds resolve stars from this file alone, and the deploy
  // falls back to it when a fetch fails — a newly indexed repo needs one.
  it("has a star count for every enabled repo in skill-index-resources", () => {
    const resources = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "data", "skill-index-resources.json"),
        "utf-8",
      ),
    ) as { repos: { owner: string; repo: string; enabled?: boolean }[] };
    const baseline = parseStarBaseline(
      JSON.parse(readFileSync(join(REPO_ROOT, STAR_BASELINE_PATH), "utf-8")),
    );
    const missing = resources.repos
      .filter((r) => r.enabled !== false)
      .map((r) => `${r.owner}/${r.repo}`)
      .filter((key) => baseline[key] === undefined);
    expect(
      missing,
      `add these to ${STAR_BASELINE_PATH}: gh api repos/<owner>/<repo> --jq .stargazers_count`,
    ).toEqual([]);
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
