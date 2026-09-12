import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfigView } from "./config";
import type { AppConfig } from "../utils/types";

const ENTER = "\r";
const ESC = "\u001b";
const ARROW_DOWN = "\u001b[B";
const ARROW_UP = "\u001b[A";

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    providers: [
      {
        name: "claude",
        label: "Claude Code",
        global: "/global/claude",
        project: "/proj/claude",
        enabled: true,
      },
      {
        name: "codex",
        label: "Codex",
        global: "/global/codex",
        project: "/proj/codex",
        enabled: false,
      },
    ],
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
    ...over,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 50));

describe("ConfigView", () => {
  it("renders the configuration panel with each provider row and its status", () => {
    const config = makeConfig();
    const { lastFrame } = render(
      <ConfigView
        config={config}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Configuration");
    expect(frame).toContain("Claude Code");
    expect(frame).toContain("Codex");
    expect(frame).toContain("Tools (Enter to toggle, e to edit file & exit):");
    // The footer can wrap at the 72-col box width — assert fragments.
    expect(frame).toContain("Edit file & exit");
    expect(frame).toContain("Discard");
    expect(frame).toContain("Save");
    // First provider enabled, second disabled.
    expect(frame).toContain("✔ ON");
    expect(frame).toContain("✘ OFF");
  });

  it("shows the project path for the selected (first) row", () => {
    const { lastFrame } = render(
      <ConfigView
        config={makeConfig()}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain("Project: /proj/claude");
  });

  it("renders custom paths when present", () => {
    const config = makeConfig({
      customPaths: [{ path: "/custom/x", label: "Custom X", scope: "global" }],
    });
    const { lastFrame } = render(
      <ConfigView
        config={config}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Custom Paths:");
    expect(frame).toContain("Custom X: /custom/x (global)");
  });

  it("toggles the selected provider on Enter", async () => {
    const onClose = vi.fn();
    const config = makeConfig();
    const { stdin, unmount } = render(
      <ConfigView
        config={config}
        onClose={onClose}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    // First provider starts ON; Enter flips it OFF.
    stdin.write(ENTER);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    // Confirm by closing with Esc and inspecting the emitted config.
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    const emitted = onClose.mock.calls[0][0] as AppConfig;
    expect(emitted.providers[0].enabled).toBe(false);
    unmount();
  });

  it("moves the selection down with the down arrow", async () => {
    const onClose = vi.fn();
    const { stdin, lastFrame, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={onClose}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    // Initially the first provider (Claude Code) is selected → its project path shows.
    expect(lastFrame()).toContain("Project: /proj/claude");
    stdin.write(ARROW_DOWN);
    await tick();
    // Now the second provider (Codex) is selected → its project path shows.
    expect(lastFrame()).toContain("Project: /proj/codex");
    unmount();
  });

  it("wraps selection up from the first to the last row", async () => {
    const { stdin, lastFrame, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    expect(lastFrame()).toContain("Project: /proj/claude");
    stdin.write(ARROW_UP);
    await tick();
    expect(lastFrame()).toContain("Project: /proj/codex");
    unmount();
  });

  it("invokes onOpenEditor when e is pressed", async () => {
    const onOpenEditor = vi.fn();
    const { stdin, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onOpenEditor={onOpenEditor}
      />,
    );
    await tick();
    stdin.write("e");
    await tick();
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("q discards in-session toggles — onDiscard fires, onClose does not", async () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const { stdin, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={onClose}
        onDiscard={onDiscard}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    // Flip the first provider OFF, then discard — the save path never runs.
    stdin.write(ENTER);
    await tick();
    stdin.write("q");
    await tick();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledWith();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("Esc still saves after a toggle — onClose receives the edited config", async () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const { stdin, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={onClose}
        onDiscard={onDiscard}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    stdin.write(ENTER);
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    const emitted = onClose.mock.calls[0][0] as AppConfig;
    expect(emitted.providers[0].enabled).toBe(false);
    expect(onDiscard).not.toHaveBeenCalled();
    unmount();
  });

  it("passes the current edit state to onClose on Esc", async () => {
    const onClose = vi.fn();
    const { stdin, unmount } = render(
      <ConfigView
        config={makeConfig()}
        onClose={onClose}
        onDiscard={vi.fn()}
        onOpenEditor={vi.fn()}
      />,
    );
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    const emitted = onClose.mock.calls[0][0] as AppConfig;
    expect(emitted.providers).toHaveLength(2);
    unmount();
  });
});
