/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
