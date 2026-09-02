/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * Storefront pagination + bulk-add coverage (review note N1).
 *   - buildWindow boundary cases (first/last page, small page counts,
 *     gap rendering) incl. the rendered Pagination output
 *   - useCatalogState resets ?page= on every filter/search/sort change
 *   - useBundleCart.addMany dedups by id and reports added/notice counts
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Pagination, { buildWindow } from "../components/Pagination.jsx";
import { useCatalogState } from "../hooks/useCatalogState.js";
import { BundleCartProvider, useBundleCart } from "../hooks/useBundleCart.jsx";

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

describe("buildWindow", () => {
  it("returns a single page with no gaps", () => {
    expect(buildWindow(1, 1)).toEqual([1]);
  });

  it("lists every page with no gaps for small page counts", () => {
    expect(buildWindow(1, 2)).toEqual([1, 2]);
    expect(buildWindow(2, 2)).toEqual([1, 2]);
    expect(buildWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the tail into a gap on the first page", () => {
    expect(buildWindow(1, 42)).toEqual([1, 2, "gap", 42]);
  });

  it("collapses the head into a gap on the last page", () => {
    expect(buildWindow(42, 42)).toEqual([1, "gap", 41, 42]);
  });

  it("shows gaps on both sides in the middle", () => {
    expect(buildWindow(5, 42)).toEqual([1, "gap", 4, 5, 6, "gap", 42]);
  });

  it("avoids a gap when the window touches the first page", () => {
    expect(buildWindow(2, 10)).toEqual([1, 2, 3, "gap", 10]);
  });

  it("avoids a gap when the window touches the last page", () => {
    expect(buildWindow(9, 10)).toEqual([1, "gap", 8, 9, 10]);
  });
});

describe("Pagination rendering", () => {
  afterEach(() => cleanup());

  it("renders nothing for a single page", () => {
    const { container } = render(
      <Pagination page={1} pageCount={1} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("marks gaps aria-hidden and the current page with aria-current", () => {
    const { container } = render(
      <Pagination page={5} pageCount={42} onChange={() => {}} />,
    );
    const nav = container.querySelector("nav[aria-label='Pagination']");
    expect(nav).toBeTruthy();
    const gaps = container.querySelectorAll("span.gap");
    expect(gaps.length).toBe(2);
    for (const g of gaps) {
      expect(g.getAttribute("aria-hidden")).toBe("true");
    }
    const current = container.querySelector("[aria-current='page']");
    expect(current?.textContent).toBe("5");
  });

  it("disables Prev on the first page and Next on the last page", () => {
    const first = render(
      <Pagination page={1} pageCount={3} onChange={() => {}} />,
    );
    expect(
      first.container
        .querySelector("[aria-label='Previous page']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      first.container
        .querySelector("[aria-label='Next page']")
        ?.hasAttribute("disabled"),
    ).toBe(false);
    first.unmount();

    const last = render(
      <Pagination page={3} pageCount={3} onChange={() => {}} />,
    );
    expect(
      last.container
        .querySelector("[aria-label='Next page']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("calls onChange with the clicked page", () => {
    const onChange = vi.fn();
    render(<Pagination page={5} pageCount={42} onChange={onChange} />);
    screen.getByRole("button", { name: "Page 6" }).click();
    expect(onChange).toHaveBeenCalledWith(6);
  });
});

describe("useCatalogState page reset", () => {
  afterEach(() => cleanup());

  let api;
  function Probe({ onApi }) {
    const hook = useCatalogState();
    onApi(hook);
    return null;
  }

  function setup(initial = "/skills?page=3", expectedPage = 3) {
    api = null;
    render(
      <MemoryRouter
        initialEntries={[initial]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Probe onApi={(h) => void (api = h)} />
      </MemoryRouter>,
    );
    expect(api?.state.page).toBe(expectedPage);
  }

  function searchOf() {
    // MemoryRouter keeps history entries; the active one is last.
    const entries = window.history.length;
    void entries;
    return api.state;
  }

  it("starts on the ?page= from the URL", () => {
    setup();
    expect(searchOf().page).toBe(3);
  });

  it("changing categories resets the page", () => {
    setup();
    act(() => {
      api.setActiveCategories(new Set(["demo"]));
    });
    expect(api.state.page).toBe(1);
    expect(api.state.activeCategories.has("demo")).toBe(true);
  });

  it("changing the repo resets the page", () => {
    setup();
    act(() => {
      api.setActiveRepo("owner/repo");
    });
    expect(api.state.page).toBe(1);
    expect(api.state.activeRepo).toBe("owner/repo");
  });

  it("toggling a facet resets the page", () => {
    setup();
    act(() => {
      api.setFacet("license", new Set(["MIT"]));
    });
    expect(api.state.page).toBe(1);
    expect(api.state.activeFacets.license.has("MIT")).toBe(true);
  });

  it("changing the sort resets the page", () => {
    setup();
    act(() => {
      api.setSort("name");
    });
    expect(api.state.page).toBe(1);
    expect(api.state.sort).toBe("name");
  });

  it("changing the search query resets the page", () => {
    setup();
    act(() => {
      api.setSearchQuery("hello");
    });
    expect(api.state.page).toBe(1);
    expect(api.state.searchQuery).toBe("hello");
  });

  it("setPage navigates without dropping active filters", () => {
    setup("/skills?cat=demo&page=1", 1);
    act(() => {
      api.setPage(2);
    });
    expect(api.state.page).toBe(2);
    expect(api.state.activeCategories.has("demo")).toBe(true);
  });
});

describe("useBundleCart.addMany", () => {
  beforeEach(() => {
    installLocalStorageShim();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const skillA = {
    id: "owner/repo::a::hello-world",
    name: "hello-world",
    installUrl: "github:owner/repo:skills/hello-world",
  };
  const skillB = {
    id: "owner/repo::b::readme-gen",
    name: "readme-generator",
    installUrl: "github:owner/repo:skills/readme-gen",
  };

  let api;
  function CartProbe({ onApi }) {
    const hook = useBundleCart();
    onApi(hook);
    return null;
  }

  function setupCart() {
    api = null;
    render(
      <BundleCartProvider>
        <CartProbe onApi={(h) => void (api = h)} />
      </BundleCartProvider>,
    );
    expect(api).toBeTruthy();
  }

  it("adds fresh skills, skips ids already in the cart, and counts the notice", () => {
    setupCart();
    let added;
    act(() => {
      api.add(skillA);
    });
    expect(api.items.length).toBe(1);

    act(() => {
      added = api.addMany([skillA, skillB]);
    });
    expect(added).toBe(1);
    expect(api.items.length).toBe(2);
    expect(api.notice?.text).toContain("1 skill added to cart");
  });

  it("returns 0 with an already-in-cart notice when everything is carted", () => {
    setupCart();
    let added;
    act(() => {
      api.add(skillA);
    });
    act(() => {
      added = api.addMany([skillA]);
    });
    expect(added).toBe(0);
    expect(api.items.length).toBe(1);
    expect(api.notice?.text).toMatch(/already in your cart/i);
  });

  it("names the source label in the notice and skips invalid entries", () => {
    setupCart();
    let added;
    act(() => {
      added = api.addMany([skillA, { id: "broken" }, skillB], "My bundle");
    });
    expect(added).toBe(2);
    expect(api.items.length).toBe(2);
    expect(api.notice?.text).toBe("2 skills added to cart from My bundle");
  });
});
