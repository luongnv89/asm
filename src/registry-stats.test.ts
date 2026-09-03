import { describe, expect, test } from "vitest";
import {
  compareByPopularity,
  compareByRecency,
  epochToIso,
  fetchClawHubStats,
  fetchRegistryStats,
  fetchSkillsShStats,
  lookupStats,
  mergeRegistryMaps,
  normalizeSkillKey,
  parseClawHubItem,
  parseClawHubPage,
  parseSkillsShPayload,
  type FetchLike,
  type RegistrySkillStats,
} from "./registry-stats";

const clawItem = {
  slug: "self-improving-agent",
  displayName: "Self Improving Agent",
  stats: { comments: 53, downloads: 476064, installs: 18374, stars: 3976 },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_780_000_000_000,
};

describe("normalizeSkillKey", () => {
  test("lowercases and hyphenates", () => {
    expect(normalizeSkillKey("Foo_Bar")).toBe("foo-bar");
    expect(normalizeSkillKey("  Foo Bar  ")).toBe("foo-bar");
  });
});

describe("epochToIso", () => {
  test("treats millisecond timestamps as ms", () => {
    expect(epochToIso(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });
  test("treats second timestamps as seconds", () => {
    expect(epochToIso(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
  });
  test("rejects non-positive / non-numeric", () => {
    expect(epochToIso(0)).toBeUndefined();
    expect(epochToIso("nope")).toBeUndefined();
  });
});

describe("parseClawHubItem / parseClawHubPage", () => {
  test("extracts installs, downloads, and updatedAt", () => {
    const parsed = parseClawHubItem(clawItem);
    expect(parsed).toMatchObject({
      source: "clawdhub",
      slug: "self-improving-agent",
      installCount: 18374,
      downloadCount: 476064,
      stars: 3976,
    });
    expect(parsed?.updatedAt).toBe("2026-05-28T20:26:40.000Z");
  });
  test("skips items without a slug", () => {
    expect(parseClawHubItem({ stats: { installs: 1 } })).toBeNull();
  });
  test("walks items + nextCursor", () => {
    const page = parseClawHubPage({
      items: [clawItem, { not: "a skill" }],
      nextCursor: "abc",
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("abc");
  });
});

describe("parseSkillsShPayload", () => {
  test("accepts { skills: [...] } and { items: [...] }", () => {
    const fromSkills = parseSkillsShPayload({
      skills: [{ name: "foo", downloads: 12, installs: 3 }],
    });
    const fromItems = parseSkillsShPayload({
      items: [{ slug: "foo", stats: { downloads: 12, installs: 3 } }],
    });
    expect(fromSkills[0]?.installCount).toBe(3);
    expect(fromItems[0]?.downloadCount).toBe(12);
  });
});

describe("lookupStats / mergeRegistryMaps", () => {
  test("matches by slug or display name", () => {
    const map = new Map<string, RegistrySkillStats>();
    const stats: RegistrySkillStats = {
      source: "clawdhub",
      slug: "self-improving-agent",
      displayName: "Self Improving Agent",
      installCount: 10,
      downloadCount: 20,
      stars: 1,
    };
    map.set(normalizeSkillKey(stats.slug), stats);
    map.set(normalizeSkillKey(stats.displayName), stats);
    expect(lookupStats(map, "Self Improving Agent")?.installCount).toBe(10);
    expect(lookupStats(map, "self-improving-agent")?.installCount).toBe(10);
  });
  test("prefers the higher install count when merging", () => {
    const a = new Map<string, RegistrySkillStats>([
      [
        "foo",
        {
          source: "skills.sh",
          slug: "foo",
          displayName: "foo",
          installCount: 2,
          downloadCount: 2,
          stars: 0,
        },
      ],
    ]);
    const b = new Map<string, RegistrySkillStats>([
      [
        "foo",
        {
          source: "clawdhub",
          slug: "foo",
          displayName: "foo",
          installCount: 9,
          downloadCount: 90,
          stars: 1,
        },
      ],
    ]);
    const merged = mergeRegistryMaps(a, b);
    expect(merged.get("foo")?.installCount).toBe(9);
    expect(merged.get("foo")?.source).toBe("clawdhub");
  });
});

function jsonFetch(payload: unknown, status = 200): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

describe("fetchClawHubStats", () => {
  test("paginates until maxPages or missing cursor", async () => {
    const pages = [
      { items: [clawItem], nextCursor: "p2" },
      {
        items: [
          {
            slug: "evolver",
            displayName: "evolver",
            stats: { installs: 100, downloads: 200, stars: 1 },
            updatedAt: 1_780_000_000_000,
          },
        ],
      },
    ];
    let calls = 0;
    const fetchImpl: FetchLike = async (url) => {
      calls += 1;
      const idx = url.includes("cursor=") ? 1 : 0;
      return {
        ok: true,
        status: 200,
        json: async () => pages[idx],
      };
    };
    const map = await fetchClawHubStats({ fetch: fetchImpl, maxPages: 8 });
    expect(calls).toBe(2);
    expect(lookupStats(map, "evolver")?.installCount).toBe(100);
    expect(lookupStats(map, "self-improving-agent")?.installCount).toBe(18374);
  });

  test("returns empty on HTTP failure", async () => {
    const map = await fetchClawHubStats({
      fetch: jsonFetch({ error: "nope" }, 500),
    });
    expect(map.size).toBe(0);
  });

  test("skip option short-circuits", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    const map = await fetchClawHubStats({ fetch: fetchImpl, skip: true });
    expect(called).toBe(false);
    expect(map.size).toBe(0);
  });
});

describe("fetchSkillsShStats", () => {
  test("does nothing without a token", async () => {
    const prev = process.env.SKILLS_SH_TOKEN;
    delete process.env.SKILLS_SH_TOKEN;
    try {
      let called = false;
      const fetchImpl: FetchLike = async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ skills: [] }) };
      };
      const map = await fetchSkillsShStats({ fetch: fetchImpl });
      expect(called).toBe(false);
      expect(map.size).toBe(0);
    } finally {
      if (prev !== undefined) process.env.SKILLS_SH_TOKEN = prev;
    }
  });

  test("indexes a token-authenticated payload", async () => {
    const map = await fetchSkillsShStats({
      skillsShToken: "test-token",
      fetch: jsonFetch({
        skills: [{ name: "bar", installs: 4, downloads: 8 }],
      }),
    });
    expect(lookupStats(map, "bar")?.installCount).toBe(4);
  });
});

describe("fetchRegistryStats", () => {
  test("honours ASM_SKIP_REGISTRY_STATS", async () => {
    const prev = process.env.ASM_SKIP_REGISTRY_STATS;
    process.env.ASM_SKIP_REGISTRY_STATS = "1";
    try {
      const map = await fetchRegistryStats({
        fetch: jsonFetch({ items: [clawItem] }),
      });
      expect(map.size).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.ASM_SKIP_REGISTRY_STATS;
      else process.env.ASM_SKIP_REGISTRY_STATS = prev;
    }
  });
});

describe("compareByPopularity / compareByRecency", () => {
  test("ranks missing install counts last", () => {
    const rows = [
      { name: "none" },
      { name: "mid", installCount: 10 },
      { name: "top", installCount: 99 },
    ];
    rows.sort(compareByPopularity);
    expect(rows.map((r) => r.name)).toEqual(["top", "mid", "none"]);
  });
  test("recency puts undated last", () => {
    const rows = [
      { name: "old", updatedAt: "2020-01-01T00:00:00.000Z" },
      { name: "new", updatedAt: "2026-01-01T00:00:00.000Z" },
      { name: "none" },
    ];
    rows.sort(compareByRecency);
    expect(rows.map((r) => r.name)).toEqual(["new", "old", "none"]);
  });
});
