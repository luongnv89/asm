/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Vitest/jsdom 25 ships `localStorage` as a plain object without Storage
 * methods, which breaks the cart's persistence layer. Install a minimal
 * in-memory Storage shim on both `window.localStorage` and
 * `globalThis.localStorage` so the provider's `setItem`/`getItem` calls
 * work under test.
 */
function installLocalStorageShim() {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: shim,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    configurable: true,
  });
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
 * Bundle cart flow (#238). Covers:
 *   - add-to-bundle button in a list row doesn't navigate (it must
 *     call preventDefault on the wrapping <Link>)
 *   - cart count in the header reflects selections
 *   - opening the builder shows the skill, validates metadata, and
 *     can trigger the export path
 */
const generatedAt = "2026-04-24T00:00:00.000Z";

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

const FETCH_MAP = {
  "skills.min.json": () => new Response(JSON.stringify(catalog)),
  "search.idx.json": () => new Response(buildIndexJson()),
  "bundles.json": () => new Response(JSON.stringify({ bundles: [] })),
  "skills/hello.json": () => new Response(JSON.stringify(catalog.skills[0])),
};

function mockFetch() {
  return vi.fn(async (url) => {
    for (const [suffix, fn] of Object.entries(FETCH_MAP)) {
      if (String(url).endsWith(suffix)) return fn();
    }
    return new Response("not found", { status: 404 });
  });
}

describe("Bundle cart flow", () => {
  beforeEach(() => {
    // The catalog list (with add-to-bundle buttons) now lives at /skills;
    // `/` renders the marketing landing page.
    window.history.replaceState(null, "", "/#/skills");
    globalThis.fetch = mockFetch();
    installLocalStorageShim();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("adding a skill from the list increments the cart without navigating", async () => {
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());

    // Find the compact add-to-bundle button on the hello-world row
    const helloAddBtn = screen.getByRole("button", {
      name: /Add hello-world to bundle/i,
    });
    expect(helloAddBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(helloAddBtn);
    });

    // Cart count should appear in the header
    await waitFor(() => {
      const count = container.querySelector(
        "[data-testid='bundle-cart-count']",
      );
      expect(count?.textContent).toBe("1");
    });

    // URL should still be the catalog root — no navigation happened
    expect(window.location.hash).not.toContain("/skills/");

    // Click again to toggle off
    const helloRemoveBtn = screen.getByRole("button", {
      name: /Remove hello-world from bundle/i,
    });
    await act(async () => {
      fireEvent.click(helloRemoveBtn);
    });
    await waitFor(() => {
      const count = container.querySelector(
        "[data-testid='bundle-cart-count']",
      );
      expect(count).toBeNull();
    });
  });

  it("opens the builder dialog and validates the bundle name", async () => {
    const { container } = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());

    // Add one skill
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Add hello-world to bundle/i }),
      );
    });

    // Open the builder via the header cart button
    const cartBtn = screen.getByRole("button", {
      name: /Open bundle builder/i,
    });
    await act(async () => {
      fireEvent.click(cartBtn);
    });

    // The dialog renders with the skill visible (labelled by the h2)
    const dialog = await screen.findByRole("dialog", {
      name: /Build a bundle/i,
    });
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/skills? in this bundle/i)).toBeTruthy();
    // The skill name should appear in the dialog item list
    const withinDialog = dialog.querySelectorAll("li");
    expect(withinDialog.length).toBe(1);

    // Export button is enabled (there's ≥1 skill) but the name is blank,
    // so clicking should show a validation error message
    const exportBtn = screen.getByRole("button", { name: /Export \.json/i });
    expect(exportBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    await waitFor(() => {
      expect(screen.getByText(/Bundle name is required/i)).toBeTruthy();
    });

    // Fill a valid name + description + author (all three required —
    // mirrors the CLI's validateBundle) and publish. Opens a new tab
    // so we stub window.open.
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const nameInput = container.querySelector("#bundle-name");
    const descInput = container.querySelector("#bundle-description");
    const authorInput = container.querySelector("#bundle-author");
    expect(nameInput).toBeTruthy();
    expect(descInput).toBeTruthy();
    expect(authorInput).toBeTruthy();
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "my-test-pack" } });
      fireEvent.change(descInput, { target: { value: "A test pack." } });
      fireEvent.change(authorInput, { target: { value: "alice" } });
    });
    const publishBtn = screen.getByRole("button", { name: /^Publish/i });
    await act(async () => {
      fireEvent.click(publishBtn);
    });
    expect(openSpy).toHaveBeenCalledOnce();
    const urlArg = openSpy.mock.calls[0][0];
    expect(urlArg).toMatch(/github\.com\/luongnv89\/asm\/issues\/new/);
    expect(urlArg).toContain("my-test-pack");
    openSpy.mockRestore();
  });

  it("persists the cart across remounts via localStorage", async () => {
    const first = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() => expect(screen.getByText("hello-world")).toBeTruthy());
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Add hello-world to bundle/i }),
      );
    });
    await waitFor(() => {
      expect(
        first.container.querySelector("[data-testid='bundle-cart-count']")
          ?.textContent,
      ).toBe("1");
    });

    // Confirm the provider persisted to localStorage before unmounting.
    const saved = JSON.parse(
      window.localStorage.getItem("asm-bundle-cart:v1") || "{}",
    );
    expect(saved.items?.length).toBe(1);
    expect(saved.items[0].name).toBe("hello-world");

    first.unmount();

    const second = render(
      <HashRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </HashRouter>,
    );
    await waitFor(() =>
      expect(
        second.container.querySelectorAll("[aria-label='Skill results'] a")
          .length,
      ).toBeGreaterThan(0),
    );
    await waitFor(() => {
      const count = second.container.querySelector(
        "[data-testid='bundle-cart-count']",
      );
      expect(count?.textContent).toBe("1");
    });
  });
});
