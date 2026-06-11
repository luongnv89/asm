/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HashRouter } from "react-router-dom";

/**
 * Tests for issue #308 — the catalog header shows the GitHub star count.
 * It now fetches the live count from the GitHub API on mount and only
 * falls back to the static `catalog.stars` value when that fetch does not
 * yield a usable number. These tests pin the two behaviours that matter:
 * the page always renders the static value first, and a successful live
 * fetch replaces it while a failed one leaves it untouched.
 */

// Control the catalog the header reads from without standing up the real
// CatalogProvider (which fetches skills.min.json / search.idx.json).
const mockCatalog = { stars: 552, version: "2.11.0" };
vi.mock("../hooks/useCatalog.jsx", () => ({
  useCatalog: () => ({ catalog: mockCatalog }),
}));

import Header from "../components/Header.jsx";

function renderHeader() {
  return render(
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Header />
    </HashRouter>,
  );
}

describe("Header — live GitHub star count (issue #308)", () => {
  beforeEach(() => {
    mockCatalog.stars = 552;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the static catalog star count immediately on mount", () => {
    // fetch never resolves — the static value must already be on screen.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    renderHeader();
    expect(screen.getByText("★ 552")).toBeTruthy();
  });

  it("updates to the live star count once the GitHub API responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ stargazers_count: 1234 }),
        }),
      ),
    );
    renderHeader();
    // 1234 -> "1.2k" via formatStars.
    await waitFor(() => expect(screen.getByText("★ 1.2k")).toBeTruthy());
  });

  it("falls back to the static count when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    renderHeader();
    // The rejected fetch is swallowed; the static value stays put.
    await waitFor(() => expect(screen.getByText("★ 552")).toBeTruthy());
    expect(screen.queryByText(/1\.2k/)).toBeNull();
  });

  it("falls back to the static count on a non-OK API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({}),
        }),
      ),
    );
    renderHeader();
    await waitFor(() => expect(screen.getByText("★ 552")).toBeTruthy());
  });
});
