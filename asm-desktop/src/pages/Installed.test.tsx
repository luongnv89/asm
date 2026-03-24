import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Installed } from "./Installed";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../lib/tauri-commands", () => ({
  listInstalledSkills: vi.fn(),
  uninstallSkill: vi.fn(),
  parseSkillsFromJson: vi.fn(),
  isSkillSymlink: vi.fn(),
}));

vi.mock("../components/SkillCard", () => ({
  SkillCard: ({
    skill,
    onUninstall,
  }: {
    skill: { name: string };
    onUninstall: (n: string) => void;
  }) => (
    <div data-testid="skill-card">
      <span>{skill.name}</span>
      <button onClick={() => onUninstall(skill.name)}>Uninstall</button>
    </div>
  ),
}));

vi.mock("../components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    title?: string;
    message?: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog">
      {title && <div data-testid="dialog-title">{title}</div>}
      {message && <div data-testid="dialog-message">{message}</div>}
      <button data-testid="confirm-btn" onClick={onConfirm}>
        {confirmLabel || "Confirm"}
      </button>
      <button data-testid="cancel-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock("../components/Toast", () => ({
  Toast: vi.fn(() => null),
}));

import {
  listInstalledSkills,
  uninstallSkill,
  parseSkillsFromJson,
  isSkillSymlink,
} from "../lib/tauri-commands";

const mockedListInstalledSkills = listInstalledSkills as ReturnType<
  typeof vi.fn
>;
const mockedUninstallSkill = uninstallSkill as ReturnType<typeof vi.fn>;
const mockedParseSkillsFromJson = parseSkillsFromJson as ReturnType<
  typeof vi.fn
>;
const mockedIsSkillSymlink = isSkillSymlink as ReturnType<typeof vi.fn>;

describe("Installed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", () => {
    mockedListInstalledSkills.mockImplementation(() => new Promise(() => {}));
    render(<Installed />);
    expect(screen.getByText("Loading installed skills...")).toBeInTheDocument();
  });

  it("renders installed skills after loading", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });
  });

  it("shows empty state when no skills installed", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: "[]",
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([]);

    render(<Installed />);

    await waitFor(() => {
      expect(screen.getByText("No skills installed yet")).toBeInTheDocument();
    });
  });

  it("shows confirmation dialog on uninstall click", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);
    mockedIsSkillSymlink.mockResolvedValue(false);

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });

    const uninstallButton = screen.getByText("Uninstall");
    await userEvent.click(uninstallButton);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    });
  });

  it.skip("shows symlink confirmation dialog when skill is a symlink", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([
        { name: "symlink-skill", description: "A symlink" },
      ]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "symlink-skill", description: "A symlink" },
    ]);

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });

    mockedIsSkillSymlink.mockResolvedValue(true);
    mockedUninstallSkill.mockResolvedValue({
      success: true,
      stdout: "Removed",
      stderr: "",
      code: 0,
    });

    const uninstallButton = await screen.findByText("Uninstall");
    await userEvent.click(uninstallButton);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Remove Skill")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("confirm-btn");
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText("Remove Symlink")).toBeInTheDocument();
    });
  });

  it("removes skill from list after successful uninstall", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);
    mockedIsSkillSymlink.mockResolvedValue(false);
    mockedUninstallSkill.mockResolvedValue({
      success: true,
      stdout: "Removed",
      stderr: "",
      code: 0,
    });

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });

    const uninstallButton = screen.getByText("Uninstall");
    await userEvent.click(uninstallButton);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("confirm-btn");
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockedUninstallSkill).toHaveBeenCalledWith("test-skill");
    });
  });

  it("cancels uninstall on cancel click", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);
    mockedIsSkillSymlink.mockResolvedValue(false);

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });

    const uninstallButton = screen.getByText("Uninstall");
    await userEvent.click(uninstallButton);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    });

    const cancelButton = screen.getByTestId("cancel-btn");
    await userEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
      expect(mockedUninstallSkill).not.toHaveBeenCalled();
    });
  });

  it("shows error message when uninstall fails", async () => {
    mockedListInstalledSkills.mockResolvedValue({
      success: true,
      stdout: JSON.stringify([{ name: "test-skill", description: "A test" }]),
      stderr: "",
      code: 0,
    });
    mockedParseSkillsFromJson.mockReturnValue([
      { name: "test-skill", description: "A test" },
    ]);
    mockedIsSkillSymlink.mockResolvedValue(false);
    mockedUninstallSkill.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "Remove failed",
      code: 1,
    });

    render(<Installed />);

    await waitFor(() => {
      expect(
        screen.queryByText("Loading installed skills..."),
      ).not.toBeInTheDocument();
    });

    const uninstallButton = screen.getByText("Uninstall");
    await userEvent.click(uninstallButton);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    });

    const confirmButton = screen.getByTestId("confirm-btn");
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText(/Uninstall failed/)).toBeInTheDocument();
    });
  });
});
