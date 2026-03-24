import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Catalog } from "./Catalog";

vi.mock("../lib/tauri-commands", () => ({
  searchSkills: vi.fn(),
  installSkill: vi.fn(),
  getSkillIndex: vi.fn(),
  parseSkillsFromJson: vi.fn(),
}));

vi.mock("../components/SearchBar", () => ({
  SearchBar: ({ onSearch }: { onSearch: (q: string) => void }) => (
    <input
      data-testid="search-bar"
      onChange={(e) => onSearch(e.target.value)}
      placeholder="Search skills..."
    />
  ),
}));

vi.mock("../components/SkillCard", () => ({
  SkillCard: ({
    skill,
    onInstall,
  }: {
    skill: { name: string };
    onInstall: (n: string) => void;
  }) => (
    <div data-testid="skill-card">
      <span>{skill.name}</span>
      <button onClick={() => onInstall(skill.name)}>Install</button>
    </div>
  ),
}));

import {
  searchSkills,
  installSkill,
  getSkillIndex,
  parseSkillsFromJson,
} from "../lib/tauri-commands";

const mockedSearchSkills = searchSkills as ReturnType<typeof vi.fn>;
const mockedGetSkillIndex = getSkillIndex as ReturnType<typeof vi.fn>;
const mockedParseSkillsFromJson = parseSkillsFromJson as ReturnType<
  typeof vi.fn
>;

describe("Catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    mockedGetSkillIndex.mockImplementation(() => new Promise(() => {}));
    render(<Catalog />);
    expect(screen.getByText("Loading skills...")).toBeInTheDocument();
  });

  it("renders skills after loading", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });
  });

  it("renders error message when loading fails", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Network error",
      code: 1,
    });

    render(<Catalog />);

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load skill index/),
      ).toBeInTheDocument();
    });
  });

  it("handles search input", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([]);
    mockedSearchSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "found-skill" }]),
      stderr: "",
      code: 0,
    });

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });

    const searchInput = screen.getByTestId("search-bar");
    await userEvent.type(searchInput, "react");

    await waitFor(() => {
      expect(mockedSearchSkills).toHaveBeenCalledWith("react");
    });
  });

  it("shows empty state when no skills found", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([]);

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.getByText("No skills found")).toBeInTheDocument();
    });
  });

  it("installs a skill successfully", async () => {
    const mockInstall = installSkill as ReturnType<typeof vi.fn>;
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);
    mockInstall.mockResolvedValue({
      success: true,
      stdout: "Installed",
      stderr: "",
      code: 0,
    });

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });

    const installButton = screen.getByText("Install");
    await userEvent.click(installButton);

    await waitFor(() => {
      expect(mockInstall).toHaveBeenCalledWith("test-skill");
    });
  });

  it("rejects invalid skill name with special characters", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test@skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test@skill", description: "A test" },
    ]);

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });

    const installButton = screen.getByText("Install");
    await userEvent.click(installButton);

    await waitFor(() => {
      expect(
        screen.getByText("Skill name contains invalid characters"),
      ).toBeInTheDocument();
    });
  });

  it("rejects empty skill name", async () => {
    mockedGetSkillIndex.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "", description: "A test" },
    ]);

    render(<Catalog />);

    await waitFor(() => {
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });

    const skillCard = screen.getByTestId("skill-card");
    const installButton = within(skillCard).getByText("Install");
    await userEvent.click(installButton);

    await waitFor(() => {
      expect(screen.getByText("Invalid skill name")).toBeInTheDocument();
    });
  });
});
