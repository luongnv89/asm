/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  return render(<SkillDetail slim={baseSkill} {...props} />);
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
      screen.getByText("Install the skill to your Claude Code environment"),
    ).toBeTruthy();
    // Note: install command appears twice (Quick Start + legacy card)
    const installCommands = screen.getAllByText(
      "asm install github:test/repo:skills/test-skill",
    );
    expect(installCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("uses the skill's installUrl for all three commands", () => {
    const customSkill = {
      ...baseSkill,
      installUrl: "github:custom/path:to/skill",
    };
    render(<SkillDetail slim={customSkill} />);
    expect(
      screen.getByText("asm audit security github:custom/path:to/skill"),
    ).toBeTruthy();
    expect(
      screen.getByText("asm eval github:custom/path:to/skill"),
    ).toBeTruthy();
    // Note: install command appears twice (Quick Start + legacy card)
    const installCommands = screen.getAllByText(
      "asm install github:custom/path:to/skill",
    );
    expect(installCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("renders copy buttons for each command", () => {
    renderDetail();
    // The CopyButton component renders buttons - we should have at least 3 for Quick Start
    // plus 1 for the legacy install command card = 4 total
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it("does not render Quick Start section when installUrl is missing", () => {
    const skillWithoutUrl = {
      ...baseSkill,
      installUrl: undefined,
    };
    render(<SkillDetail slim={skillWithoutUrl} />);
    expect(screen.queryByText("Quick Start")).toBeNull();
  });

  it("does not render Quick Start section when installUrl is null", () => {
    const skillWithNullUrl = {
      ...baseSkill,
      installUrl: null,
    };
    render(<SkillDetail slim={skillWithNullUrl} />);
    expect(screen.queryByText("Quick Start")).toBeNull();
  });
});
