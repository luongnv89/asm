/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import MiniSearch from "minisearch";
import App from "../App.jsx";
import { MINISEARCH_OPTIONS } from "../lib/minisearch-options.js";

/**
 * End-to-end smoke test for the React app. Stubs `fetch` to return a
 * tiny catalog so we don't depend on the real build artifacts, builds
 * a matching MiniSearch index so the boot-time parity check passes,
 * and asserts that a skill card renders.
 *
 * This is the acceptance-criteria smoke test (#229): "the site loads,
 * search returns results, a skill detail renders."
 */
const generatedAt = "2026-04-22T00:00:00.000Z";

const catalog = {
  generatedAt,
  totalSkills: 2,
  totalRepos: 1,
  skills: [
    {
      id: "owner/repo::a::hello-world",
      detailPath: "skills/hello.json",
      name: "hello-world",
      description: "A friendly greeting skill.",
      owner: "owner",
      repo: "repo",
      categories: ["demo"],
      installUrl: "github:owner/repo:skills/hello-world",
      license: "MIT",
      version: "1.0.0",
      verified: true,
      hasTools: false,
      tokenCount: 300,
    },
    {
      id: "owner/repo::b::readme-gen",
      detailPath: "skills/readme.json",
      name: "readme-generator",
      description: "Generates great READMEs.",
      owner: "owner",
      repo: "repo",
      categories: ["docs"],
      installUrl: "github:owner/repo:skills/readme-gen",
      license: "MIT",
      version: "0.1.0",
      verified: false,
      hasTools: false,
      tokenCount: 500,
    },
  ],
  categories: ["demo", "docs"],
  repos: [{ owner: "owner", repo: "repo", skillCount: 2 }],
  stars: 0,
};

function buildIndexJson() {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(
    catalog.skills.map((s, i) => ({
      id: i,
      name: s.name,
      description: s.description,
      categoriesStr: s.categories.join(" "),
    })),
  );
  const payload = ms.toJSON();
  payload.generatedAt = generatedAt;
  return JSON.stringify(payload);
}

const SKILL_DETAIL = {
  id: "owner/repo::a::hello-world",
  name: "hello-world",
  description: "A friendly greeting skill.",
  owner: "owner",
  repo: "repo",
  categories: ["demo"],
  installUrl: "github:owner/repo:skills/hello-world",
  license: "MIT",
  version: "1.0.0",
  verified: true,
  allowedTools: [],
  tokenCount: 300,
  skillUrl: "https://github.com/owner/repo/blob/main/SKILL.md",
};

const FETCH_MAP = {
  "skills.min.json": () => new Response(JSON.stringify(catalog)),
  "search.idx.json": () => new Response(buildIndexJson()),
  "bundles.json": () => new Response(JSON.stringify({ bundles: [] })),
  "skills/hello.json": () => new Response(JSON.stringify(SKILL_DETAIL)),
};

function mockFetch() {
  return vi.fn(async (url) => {
    for (const [suffix, fn] of Object.entries(FETCH_MAP)) {
      if (String(url).endsWith(suffix)) return fn();
    }
    return new Response("not found", { status: 404 });
  });
}

describe("App smoke", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    globalThis.fetch = mockFetch();
    // localStorage sometimes throws in jsdom — stub safely.
    try {
      localStorage.clear();
    } catch {
      /* noop */
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the catalog and renders a skill card", async () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("hello-world")).toBeTruthy();
    });
    expect(screen.getByText("readme-generator")).toBeTruthy();
  });

  it("navigates to a skill detail route and renders lazy-fetched detail", async () => {
    const { container } = render(
      <HashRouter>
        <App />
      </HashRouter>,
    );
    // Wait for catalog render.
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());
    // Click the "Open details" link on the first card. Skill IDs contain
    // `/` and `::`, so this exercises the encodeURIComponent round-trip
    // through react-router's `useParams`.
    const link = container.querySelector(
      'a[aria-label="Open details for hello-world"]',
    );
    expect(link).toBeTruthy();
    await act(async () => {
      fireEvent.click(link);
    });
    // Detail page renders the lazy-loaded skillUrl link.
    await waitFor(() => {
      const back = screen.getByText(/Back to catalog/i);
      expect(back).toBeTruthy();
      expect(screen.getByText(/View SKILL.md on GitHub/i)).toBeTruthy();
    });
  });
});
