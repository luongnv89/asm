/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HashRouter, Route, Routes } from "react-router-dom";
import MiniSearch from "minisearch";
import RepoPage from "../pages/RepoPage.jsx";
import { CatalogProvider } from "../hooks/useCatalog.jsx";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";
import { encodeSkillId } from "../lib/utils.js";

const generatedAt = "2026-09-05T00:00:00.000Z";

const catalog = {
  generatedAt,
  totalSkills: 3,
  totalRepos: 2,
  categories: ["coding", "docs"],
  categoryCounts: { coding: 2, docs: 1 },
  repos: [
    {
      owner: "alice",
      repo: "tools",
      repoUrl: "https://github.com/alice/tools",
      description: "Alice's toolbox",
      maintainer: "Alice",
      skillCount: 2,
      stars: 1234,
    },
    {
      owner: "bob",
      repo: "other",
      repoUrl: "https://github.com/bob/other",
      description: "",
      maintainer: "",
      skillCount: 1,
    },
  ],
  skills: [
    {
      id: "alice/tools::skills/alpha::alpha",
      name: "alpha",
      description: "Alpha skill",
      owner: "alice",
      repo: "tools",
      categories: ["coding"],
      installUrl: "github:alice/tools:skills/alpha",
      license: "MIT",
      version: "1.0.0",
      verified: true,
      tokenCount: 300,
    },
    {
      id: "alice/tools::skills/beta::beta",
      name: "beta",
      description: "Beta skill",
      owner: "alice",
      repo: "tools",
      categories: ["coding"],
      installUrl: "github:alice/tools:skills/beta",
      license: "MIT",
      version: "1.0.0",
      verified: false,
      tokenCount: 500,
    },
    {
      id: "bob/other::skills/gamma::gamma",
      name: "gamma",
      description: "Gamma skill",
      owner: "bob",
      repo: "other",
      categories: ["docs"],
      installUrl: "github:bob/other:skills/gamma",
      license: "MIT",
      version: "1.0.0",
      verified: false,
      tokenCount: 100,
    },
  ],
};

const repoStats = {
  stats: [
    {
      owner: "alice",
      repo: "tools",
      repoUrl: "https://github.com/alice/tools",
      skillCount: 2,
      categories: { coding: 2 },
      verifiedCount: 1,
      totalTokens: 800,
    },
  ],
};

function buildIndexJson() {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(
    catalog.skills.map((s, i) => ({
      id: i,
      name: s.name,
      description: s.description,
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
      return { ok: true, json: async () => repoStats };
    }
    return { ok: false, status: 404, json: async () => null };
  });
}

function renderRepoPage(initialHash) {
  window.history.replaceState(null, "", initialHash);
  return render(
    <HashRouter>
      <CatalogProvider>
        <Routes>
          <Route path="/repos/:owner/:repo" element={<RepoPage />} />
        </Routes>
      </CatalogProvider>
    </HashRouter>,
  );
}

describe("RepoPage — repo detail page (issue #623)", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the repo info header with description, stars, and counts", async () => {
    renderRepoPage("/#/repos/alice/tools");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "alice/tools" })).toBeTruthy();
    });
    expect(screen.getByText("Alice's toolbox")).toBeTruthy();
    expect(screen.getByText(/2 skills/)).toBeTruthy();
    expect(screen.getByText(/1 verified/)).toBeTruthy();
    // 1234 -> "1.2k" via formatStars
    expect(screen.getByText(/1\.2k/)).toBeTruthy();
    const github = screen.getByRole("link", { name: /GitHub/ });
    expect(github.getAttribute("href")).toBe("https://github.com/alice/tools");
  });

  it("lists every skill in the repo with links to the skill detail route", async () => {
    renderRepoPage("/#/repos/alice/tools");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "alice/tools" })).toBeTruthy();
    });
    const alpha = await screen.findByRole("link", { name: "alpha" });
    expect(alpha.getAttribute("href")).toBe(
      `#/skills/${encodeSkillId("alice/tools::skills/alpha::alpha")}`,
    );
    const beta = screen.getByRole("link", { name: "beta" });
    expect(beta.getAttribute("href")).toBe(
      `#/skills/${encodeSkillId("alice/tools::skills/beta::beta")}`,
    );
    // Skills from other repos must not leak in.
    expect(screen.queryByText("gamma")).toBeNull();
  });

  it("links back to the filtered catalog and the author profile", async () => {
    renderRepoPage("/#/repos/alice/tools");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "alice/tools" })).toBeTruthy();
    });
    const filter = screen.getByRole("link", { name: "Filter in catalog" });
    expect(filter.getAttribute("href")).toContain("/skills?repo=");
    expect(filter.getAttribute("href")).toContain("alice");
    const profile = screen.getByRole("link", {
      name: "View stats for alice",
    });
    expect(profile.getAttribute("href")).toBe("#/profile/alice");
  });

  it("renders a not-found state for an unknown repo", async () => {
    renderRepoPage("/#/repos/nobody/nothing");
    await waitFor(() => {
      expect(screen.getByText("Repository not found")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: /Back to Stats/ })).toBeTruthy();
  });
});
