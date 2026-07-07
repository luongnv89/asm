/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import MiniSearch from "minisearch";
import StatsPage from "../pages/StatsPage.jsx";
import { CatalogProvider } from "../hooks/useCatalog.jsx";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";

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

const indexStats = {
  stats: {
    totalRepos: 2,
    totalSkills: 3,
    totalAuthors: 2,
    verifiedCount: 1,
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
      return { ok: true, json: async () => ({ stats: [] }) };
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
    expect(screen.getByText("dev")).toBeTruthy();
    expect(screen.getByText("docs")).toBeTruthy();
    expect(screen.getByText("testing")).toBeTruthy();
  });
});
