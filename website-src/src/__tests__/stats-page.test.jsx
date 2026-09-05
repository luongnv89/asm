/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import MiniSearch from "minisearch";
import StatsPage from "../pages/StatsPage.jsx";
import { CatalogProvider } from "../hooks/useCatalog.jsx";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";
import { encodeSkillId } from "../lib/utils.js";

const generatedAt = "2026-07-07T00:00:00.000Z";

const catalog = {
  generatedAt,
  totalSkills: 3,
  totalRepos: 2,
  skills: [
    {
      id: "alice/repo::a::skill-a",
      name: "skill-a",
      description: "Skill A",
      categories: ["dev", "docs"],
      owner: "alice",
      repo: "repo",
    },
    {
      id: "alice/repo::b::skill-b",
      name: "skill-b",
      description: "Skill B",
      categories: ["dev"],
      owner: "alice",
      repo: "repo",
    },
    {
      id: "bob/other::c::skill-c",
      name: "skill-c",
      description: "Skill C",
      categories: ["testing"],
      owner: "bob",
      repo: "other",
    },
  ],
  categories: ["dev", "docs", "testing"],
  repos: [],
};

const authorStats = {
  stats: [
    {
      owner: "alice",
      totalSkills: 2,
      repos: [{ owner: "alice", repo: "repo" }],
    },
    { owner: "bob", totalSkills: 1, repos: [{ owner: "bob", repo: "other" }] },
  ],
};

function rankedSkill(index) {
  return {
    id: `alice/repo::skills/ranked-${index}::ranked-${index}`,
    name: `ranked-${index}`,
    owner: "alice",
    repo: "repo",
    evalSummary: {
      overallScore: 100 - index,
      grade: index < 10 ? "A" : "B",
      evaluatedAt: "2026-07-07T00:00:00.000Z",
      categories: [
        { id: "instructions", name: "Instructions", score: 30, max: 30 },
        { id: "safety", name: "Safety", score: 20, max: 20 },
      ],
    },
  };
}

const categoryRanking = Array.from({ length: 11 }, (_, index) =>
  rankedSkill(index),
);

const indexStats = {
  stats: {
    totalRepos: 2,
    totalSkills: 3,
    totalAuthors: 2,
    verifiedCount: 1,
    categoryTopSkills: { dev: categoryRanking },
  },
};

function buildIndexJson() {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(
    catalog.skills.map((s, i) => ({
      id: i,
      name: s.name,
      description: s.description || "",
      categoriesStr: (s.categories || []).join(" "),
    })),
  );
  const payload = ms.toJSON();
  payload.generatedAt = generatedAt;
  return JSON.stringify(payload);
}

function mockFetch() {
  global.fetch = vi.fn(async (url) => {
    const path = String(url);
    if (path.endsWith("skills.min.json")) {
      return { ok: true, json: async () => catalog };
    }
    if (path.endsWith("search.idx.json")) {
      return { ok: true, text: async () => buildIndexJson() };
    }
    if (path.endsWith("repo-stats.json")) {
      return {
        ok: true,
        json: async () => ({
          stats: [
            {
              owner: "alice",
              repo: "repo",
              repoUrl: "https://github.com/alice/repo",
              skillCount: 2,
            },
          ],
        }),
      };
    }
    if (path.endsWith("author-stats.json")) {
      return { ok: true, json: async () => authorStats };
    }
    if (path.endsWith("index-stats.json")) {
      return { ok: true, json: async () => indexStats };
    }
    return { ok: false, status: 404, json: async () => null };
  });
}

function renderStatsPage() {
  return render(
    <HashRouter>
      <CatalogProvider>
        <StatsPage />
      </CatalogProvider>
    </HashRouter>,
  );
}

describe("StatsPage — author view and pie chart (issue #351)", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders View buttons linking to author profile pages", async () => {
    renderStatsPage();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeTruthy();
    });

    const aliceView = screen.getByRole("link", {
      name: "View stats for alice",
    });
    const bobView = screen.getByRole("link", { name: "View stats for bob" });

    expect(aliceView.getAttribute("href")).toBe("#/profile/alice");
    expect(bobView.getAttribute("href")).toBe("#/profile/bob");
  });

  it("renders category pie chart with distribution data from catalog", async () => {
    renderStatsPage();
    await waitFor(() => {
      expect(screen.getByText("Category Distribution")).toBeTruthy();
    });

    expect(
      screen.getByRole("img", {
        name: /Category distribution pie chart/i,
      }),
    ).toBeTruthy();
    expect(screen.getAllByText("dev").length).toBeGreaterThan(0);
    expect(screen.getByText("docs")).toBeTruthy();
    expect(screen.getByText("testing")).toBeTruthy();
  });

  it("links Top Repositories rows to the repo detail page (issue #623)", async () => {
    renderStatsPage();
    await waitFor(() => {
      expect(screen.getByText("Top Repositories")).toBeTruthy();
    });

    const internal = screen.getByRole("link", { name: "alice/repo" });
    expect(internal.getAttribute("href")).toBe("#/repos/alice/repo");
    // GitHub stays as a secondary external link.
    const external = screen.getByRole("link", { name: "GitHub" });
    expect(external.getAttribute("href")).toBe("https://github.com/alice/repo");
    expect(external.getAttribute("target")).toBe("_blank");
  });

  it("renders at most ten ranked skills in artifact order with detail links", async () => {
    renderStatsPage();
    await screen.findByText("Top Skills by Category");

    const breakdowns = screen.getAllByRole("article", {
      name: /score breakdown/i,
    });
    expect(breakdowns).toHaveLength(10);
    expect(breakdowns[0].textContent).toContain("ranked-0");
    expect(breakdowns[9].textContent).toContain("ranked-9");
    expect(screen.queryByText("ranked-10")).toBeNull();

    const firstLink = screen.getByRole("link", { name: "ranked-0" });
    expect(firstLink.getAttribute("href")).toBe(
      `#/skills/${encodeSkillId(categoryRanking[0].id)}`,
    );
    expect(firstLink.className).toContain("min-h-11");
    expect(firstLink.className).toContain("min-w-11");
  });

  it("shows the complete score breakdown for every ranked skill", async () => {
    renderStatsPage();
    await screen.findByText("Top Skills by Category");

    expect(screen.getAllByText("Instructions")).toHaveLength(10);
    expect(screen.getAllByText("Safety")).toHaveLength(10);
    expect(screen.getAllByText("30/30")).toHaveLength(10);
    expect(screen.getAllByText("20/20")).toHaveLength(10);

    const firstBreakdown = screen.getAllByRole("table", {
      name: "Evaluation score breakdown",
    })[0];
    expect(
      Array.from(firstBreakdown.querySelectorAll('thead th[scope="col"]')).map(
        (header) => header.textContent,
      ),
    ).toEqual(["Category", "Percentage", "Points"]);
    expect(
      firstBreakdown.querySelectorAll('tbody th[scope="row"]'),
    ).toHaveLength(2);

    const firstArticle = firstBreakdown.closest("article");
    const scoreSuffix = screen.getAllByText("/100")[0];
    const evaluatedAt = screen.getAllByText(/^Evaluated /)[0];
    const ranking = firstArticle.querySelector("div > span");
    const repository = screen.getAllByText("alice/repo")[0];
    for (const metadata of [scoreSuffix, evaluatedAt, ranking, repository]) {
      expect(metadata.className).toContain("text-[var(--fg-dim)]");
      expect(metadata.className).not.toContain("text-[var(--fg-muted)]");
    }

    const score = firstBreakdown
      .closest("article")
      .querySelector(".text-3xl").parentElement;
    expect(score.className).toContain("text-emerald-700");
    expect(score.className).toContain("dark:text-emerald-400");
  });
});
