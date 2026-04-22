/**
 * TUI smoke test (issue #224).
 *
 * Uses ink-testing-library to render each view component against a virtual
 * stdin/stdout, proving the tree mounts on node without throwing. This does
 * NOT verify visual or behavioral parity with the previous opentui
 * implementation — a human must still verify UX before shipping.
 *
 * The test avoids spawning the packaged dist under a PTY because raw mode is
 * unavailable when stdin is a pipe, and maintaining a cross-platform PTY
 * harness is disproportionate to the smoke-level signal we want here.
 */
import { describe, test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { HelpView } from "../../src/views/help";
import { SkillListView } from "../../src/views/skill-list";
import { SkillDetailView } from "../../src/views/skill-detail";
import { ConfirmView } from "../../src/views/confirm";
import { DashboardFooter } from "../../src/views/dashboard";
import type { SkillInfo } from "../../src/utils/types";

const SAMPLE_SKILL: SkillInfo = {
  name: "sample-skill",
  version: "1.0.0",
  description: "A sample skill used only by the smoke test.",
  creator: "tester",
  license: "MIT",
  compatibility: "",
  allowedTools: ["Read", "Edit"],
  dirName: "sample-skill",
  path: "/tmp/sample-skill",
  originalPath: "/tmp/sample-skill",
  location: "global",
  scope: "global",
  provider: "claude",
  providerLabel: "Claude Code",
  isSymlink: false,
  symlinkTarget: null,
  realPath: "/tmp/sample-skill",
  fileCount: 1,
};

describe("TUI smoke test (issue #224)", () => {
  test("HelpView mounts and renders keybindings", () => {
    const { lastFrame, unmount } = render(<HelpView />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Quit");
    unmount();
  });

  test("SkillListView mounts with empty and populated lists", () => {
    const emptyView = render(
      <SkillListView
        skills={[]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={120}
      />,
    );
    expect(emptyView.lastFrame() ?? "").toContain("(no skills found)");
    emptyView.unmount();

    const populatedView = render(
      <SkillListView
        skills={[SAMPLE_SKILL]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={120}
      />,
    );
    expect(populatedView.lastFrame() ?? "").toContain("sample-skill");
    populatedView.unmount();
  });

  test("SkillDetailView mounts for a skill with all optional fields", () => {
    const { lastFrame, unmount } = render(
      <SkillDetailView skill={SAMPLE_SKILL} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("sample-skill");
    expect(frame).toContain("Claude Code");
    expect(frame).toContain("MIT");
    unmount();
  });

  test("ConfirmView mounts with targets", () => {
    const { lastFrame, unmount } = render(
      <ConfirmView
        skill={SAMPLE_SKILL}
        targets={["/tmp/sample-skill"]}
        onResult={() => {}}
      />,
    );
    expect(lastFrame() ?? "").toContain("Uninstall");
    unmount();
  });

  test("DashboardFooter mounts", () => {
    const { lastFrame, unmount } = render(<DashboardFooter />);
    expect(lastFrame() ?? "").toContain("Quit");
    unmount();
  });
});
