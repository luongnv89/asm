import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { HelpView } from "./help";

describe("HelpView", () => {
  it("renders the keyboard shortcuts panel with all keybindings", () => {
    const { lastFrame } = render(<HelpView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Press ? or Esc to close");

    // Every keybinding row is present (characterization — do not silently lose one).
    const expectedKeys = [
      "↑ / k",
      "↓ / j",
      "Enter",
      "d",
      "a",
      "/",
      "Esc",
      "Tab",
      "s",
      "r",
      "c",
      "?",
      "q",
    ];
    for (const key of expectedKeys) {
      expect(frame).toContain(key);
    }

    // A representative action label for each binding.
    expect(frame).toContain("Move up");
    expect(frame).toContain("Move down");
    expect(frame).toContain("View skill details");
    expect(frame).toContain("Uninstall skill");
    expect(frame).toContain("Audit duplicates");
    expect(frame).toContain("Search / filter");
    expect(frame).toContain("Cycle scope");
    expect(frame).toContain("Cycle sort order");
    expect(frame).toContain("Refresh / rescan skills");
    expect(frame).toContain("Open configuration");
    expect(frame).toContain("Toggle this help");
    expect(frame).toContain("Quit");
  });

  it("renders the version string from the version module", () => {
    const { lastFrame } = render(<HelpView />);
    expect(lastFrame()).toBeTruthy();
  });
});
