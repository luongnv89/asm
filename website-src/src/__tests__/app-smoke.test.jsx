/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom doesn't ship ResizeObserver; react-window (used by the virtualized
// sidebar) subscribes to one on mount. A no-op stub is sufficient — the
// tests don't measure actual row heights.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
import {
  act,
  cleanup,
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
 * End-to-end smoke tests for the React app.
 *
 * Updated for #228: the catalog now renders as a two-pane layout
 * (sidebar list + detail pane). These tests assert that the list
 * is visible, selecting a skill in the sidebar updates the URL and
 * renders the detail pane, and filter state survives selection.
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

const BUNDLES = {
  bundles: [
    {
      version: 1,
      name: "starter",
      description: "A minimal starter bundle.",
      tags: ["demo"],
      skills: [
        {
          name: "hello-world",
          installUrl: "github:owner/repo:skills/hello-world",
          description: "A friendly greeting skill.",
        },
      ],
    },
  ],
};

const FETCH_MAP = {
  "skills.min.json": () => new Response(JSON.stringify(catalog)),
  "search.idx.json": () => new Response(buildIndexJson()),
  "bundles.json": () => new Response(JSON.stringify(BUNDLES)),
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
    // Reset both pathname AND hash — HashRouter persists its state in the
    // URL hash, so without clearing it a prior test's `/skills/...` hash
    // leaks into the next render and the catalog card links never mount.
    // `vitest.config.ts` has `globals: false` so @testing-library/react's
    // auto-cleanup is NOT registered; call `cleanup()` explicitly in
    // afterEach (below) to unmount the previous test's App tree.
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
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads the catalog and renders skills in the sidebar list", async () => {
    render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    // Both sidebar rows should mount once the catalog hydrates.
    await waitFor(() => {
      expect(screen.getByText("hello-world")).toBeTruthy();
    });
    expect(screen.getByText("readme-generator")).toBeTruthy();
    // The empty-state prompt should render in the detail pane.
    expect(screen.getByText(/Select a skill/i)).toBeTruthy();
  });

  it("selecting a sidebar row updates the URL and renders detail", async () => {
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());

    // Sidebar rows expose the skill name via an `aria-current` link.
    const rows = container.querySelectorAll("aside a[href*='/skills/']");
    expect(rows.length).toBeGreaterThan(0);
    const helloLink = Array.from(rows).find((a) =>
      a.textContent.includes("hello-world"),
    );
    expect(helloLink).toBeTruthy();

    await act(async () => {
      fireEvent.click(helloLink);
    });

    // URL hash should reflect the selected skill.
    await waitFor(() => {
      expect(window.location.hash).toMatch(/\/skills\/[^/]+$|\/skills\/.+/);
    });
    // The lazy-loaded detail renders the SKILL.md link.
    await waitFor(() => {
      expect(screen.getByText(/View SKILL.md on GitHub/i)).toBeTruthy();
    });
    // And the sidebar row is marked active.
    const active = container.querySelector("aside a[aria-current='true']");
    expect(active).toBeTruthy();
    expect(active.textContent).toContain("hello-world");
  });

  it("preserves filter query params across selection", async () => {
    // Start with a category filter already active in the URL.
    window.history.replaceState(null, "", "/#/?cat=demo");
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());

    const helloLink = Array.from(
      container.querySelectorAll("aside a[href*='/skills/']"),
    ).find((a) => a.textContent.includes("hello-world"));
    expect(helloLink).toBeTruthy();
    // The link must carry the current search so the filter survives.
    expect(helloLink.getAttribute("href")).toContain("cat=demo");

    await act(async () => {
      fireEvent.click(helloLink);
    });

    await waitFor(() => {
      expect(window.location.hash).toContain("cat=demo");
      expect(window.location.hash).toContain("/skills/");
    });
  });

  it("bundles page renders a sidebar list and detail empty state", async () => {
    window.history.replaceState(null, "", "/#/bundles");
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("starter")).toBeTruthy());
    // Empty state in detail pane.
    expect(screen.getByText(/Pre-defined Bundles/i)).toBeTruthy();

    const starterLink = Array.from(
      container.querySelectorAll("aside a[href*='/bundles/']"),
    ).find((a) => a.textContent.includes("starter"));
    expect(starterLink).toBeTruthy();
    await act(async () => {
      fireEvent.click(starterLink);
    });
    await waitFor(() => {
      expect(window.location.hash).toContain("/bundles/starter");
    });
    // Detail pane shows the install command.
    await waitFor(() => {
      expect(screen.getByText(/asm bundle install starter/)).toBeTruthy();
    });
  });
});
