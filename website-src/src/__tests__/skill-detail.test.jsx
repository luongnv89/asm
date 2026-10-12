/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import SkillDetail from "../components/SkillDetail.jsx";

/**
 * Tests for SkillDetail component — specifically the Quick Start section
 * added in issue #273.
 */

const baseSkill = {
  id: "test/repo::skills/test-skill::test-skill",
  name: "test-skill",
  description: "A test skill for unit testing",
  owner: "test",
  repo: "repo",
  categories: ["testing"],
  installUrl: "github:test/repo:skills/test-skill",
  license: "MIT",
  version: "1.0.0",
  verified: true,
  hasTools: false,
  tokenCount: 500,
  evalSummary: {
    overallScore: 85,
    grade: "B",
    evaluatedAt: "2026-05-09T00:00:00.000Z",
    evaluatedVersion: "1.0.0",
    categories: [
      { id: "metadata", name: "Metadata", score: 20, max: 25 },
      { id: "security", name: "Security", score: 30, max: 35 },
    ],
  },
};

function renderDetail(props) {
  return render(
    <HashRouter>
      <SkillDetail slim={baseSkill} {...props} />
    </HashRouter>,
  );
}

describe("SkillDetail — Quick Start section (issue #273)", () => {
  afterEach(() => cleanup());

  it("renders the Quick Start heading", () => {
    renderDetail();
    expect(screen.getByText("Quick Start")).toBeTruthy();
  });

  it("renders all three numbered steps", () => {
    renderDetail();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders Security Check step with correct command", () => {
    renderDetail();
    expect(screen.getByText("Security Check")).toBeTruthy();
    expect(
      screen.getByText("Check for security issues before installation"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm audit security github:test/repo:skills/test-skill"),
    ).toBeTruthy();
  });

  it("renders Quality Evaluation step with correct command", () => {
    renderDetail();
    expect(screen.getByText("Quality Evaluation")).toBeTruthy();
    expect(
      screen.getByText("Evaluate skill quality and metadata"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm eval github:test/repo:skills/test-skill"),
    ).toBeTruthy();
  });

  it("renders Install step with correct command", () => {
    renderDetail();
    expect(screen.getByText("Install")).toBeTruthy();
    expect(
      screen.getByText("Install the skill to your environment"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm install github:test/repo:skills/test-skill"),
    ).toBeTruthy();
  });

  it("uses the skill's installUrl for all three commands", () => {
    const customSkill = {
      ...baseSkill,
      installUrl: "github:custom/path:to/skill",
    };
    render(
      <HashRouter>
        <SkillDetail slim={customSkill} />
      </HashRouter>,
    );
    expect(
      screen.getByText("asm audit security github:custom/path:to/skill"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm eval github:custom/path:to/skill"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm install github:custom/path:to/skill"),
    ).toBeTruthy();
  });

  it("renders copy buttons for each command", () => {
    renderDetail();
    // The CopyButton component renders buttons - we should have 3 for Quick Start
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("does not render Quick Start section when installUrl is missing", () => {
    const skillWithoutUrl = {
      ...baseSkill,
      installUrl: undefined,
    };
    render(
      <HashRouter>
        <SkillDetail slim={skillWithoutUrl} />
      </HashRouter>,
    );
    expect(screen.queryByText("Quick Start")).toBeNull();
  });

  it("does not render Quick Start section when installUrl is null", () => {
    const skillWithNullUrl = {
      ...baseSkill,
      installUrl: null,
    };
    render(
      <HashRouter>
        <SkillDetail slim={skillWithNullUrl} />
      </HashRouter>,
    );
    expect(screen.queryByText("Quick Start")).toBeNull();
  });
});

describe("SkillDetail — author stats link (issue #351)", () => {
  afterEach(() => cleanup());

  it("renders a labeled link to the author stats page", () => {
    renderDetail();
    const link = screen.getByRole("link", { name: "View stats for test" });
    expect(link.getAttribute("href")).toBe("#/profile/test");
    expect(screen.getByText("Author stats")).toBeTruthy();
  });

  it("uses the skill owner in the profile link href", () => {
    const customSkill = {
      ...baseSkill,
      owner: "custom-author",
    };
    render(
      <HashRouter>
        <SkillDetail slim={customSkill} />
      </HashRouter>,
    );
    const link = screen.getByRole("link", {
      name: "View stats for custom-author",
    });
    expect(link.getAttribute("href")).toBe("#/profile/custom-author");
  });
});

describe("SkillDetail — repo detail link (issue #623)", () => {
  afterEach(() => cleanup());

  it("links the repo row to the repo detail page alongside GitHub", () => {
    renderDetail();
    const internal = screen.getByRole("link", { name: "(view all skills)" });
    expect(internal.getAttribute("href")).toBe("#/repos/test/repo");
    const external = screen.getByRole("link", { name: "test/repo" });
    expect(external.getAttribute("href")).toBe("https://github.com/test/repo");
  });
});

describe("SkillDetail — full-details fetch resilience (issue #737)", () => {
  // detailCache is module-level, so every test uses its own detailPath.
  let seq = 0;
  const nextSkill = () => ({
    ...baseSkill,
    detailPath: `skills/issue-737-${++seq}.json`,
  });
  const fullDetail = (slim) => ({
    ...slim,
    description: "Full description loaded from the detail file",
  });
  const okResponse = (body) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
  const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a transient network failure and then shows the full details", async () => {
    const slim = nextSkill();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(okResponse(fullDetail(slim)));
    vi.stubGlobal("fetch", fetchMock);

    renderDetail({ slim });
    await flush(5000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Full description loaded from the detail file"),
    ).toBeTruthy();
    expect(screen.queryByText(/Could not load full details/)).toBeNull();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });

  it("shows a clear message and a retry button when the network stays down", async () => {
    const slim = nextSkill();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    renderDetail({ slim });
    await flush(10000);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Could not load full details/);
    expect(alert.textContent).toMatch(/connection/i);
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
    // Summary and install command stay usable.
    expect(screen.getByText("A test skill for unit testing")).toBeTruthy();
    expect(
      screen.getByText("asm install github:test/repo:skills/test-skill"),
    ).toBeTruthy();

    const callsBefore = fetchMock.mock.calls.length;
    fetchMock.mockResolvedValue(okResponse(fullDetail(slim)));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await flush(5000);

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByText("Full description loaded from the detail file"),
    ).toBeTruthy();
  });

  it("does not retry a 404", async () => {
    const slim = nextSkill();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderDetail({ slim });
    await flush(10000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toMatch(/HTTP 404/);
  });

  it("retries a 503 before giving up", async () => {
    const slim = nextSkill();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce(okResponse(fullDetail(slim)));
    vi.stubGlobal("fetch", fetchMock);

    renderDetail({ slim });
    await flush(5000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops retrying once the component unmounts", async () => {
    const slim = nextSkill();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderDetail({ slim });
    await flush(0);
    unmount();
    await flush(10000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
