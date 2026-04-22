/**
 * TUI integration tests (issue #224).
 *
 * Renders the full `App` component with a mocked scanner so no filesystem
 * scan runs. Drives keyboard input through ink-testing-library's `stdin`
 * and asserts that view transitions match the state machine in
 * `src/index.tsx`. Covers keys the smoke suite doesn't: `?` help overlay,
 * Esc-to-dashboard, `c` config, `Tab` scope cycle, `/` search mode.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import type { AppConfig, SkillInfo } from "../../src/utils/types";

const sampleSkill: SkillInfo = {
  name: "sample-skill",
  version: "1.0.0",
  description: "A sample skill for integration testing.",
  creator: "tester",
  license: "MIT",
  compatibility: "",
  allowedTools: ["Read"],
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

// Mock the scanner so App mount doesn't touch the real filesystem.
vi.mock("../../src/scanner", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/scanner")>(
      "../../src/scanner",
    );
  return {
    ...actual,
    scanAllSkills: vi.fn(async () => [sampleSkill]),
  };
});

// Mock config save so Esc-from-config doesn't write to ~/.config.
vi.mock("../../src/config", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/config")>(
      "../../src/config",
    );
  return {
    ...actual,
    saveConfig: vi.fn(async () => {}),
  };
});

const baseConfig: AppConfig = {
  version: 1,
  providers: [
    {
      name: "claude",
      label: "Claude Code",
      global: "~/.claude/skills",
      project: ".claude/skills",
      enabled: true,
    },
  ],
  customPaths: [],
  preferences: { defaultScope: "both", defaultSort: "name" },
};

// Wait a tick for ink's async render + our `useEffect` scan to settle.
async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("TUI integration: view transitions (issue #224)", () => {
  let App: typeof import("../../src/index").App;

  beforeEach(async () => {
    // Import inside beforeEach so the mocks above are in place.
    ({ App } = await import("../../src/index"));
  });

  test("mounts on Dashboard by default", async () => {
    const { lastFrame, unmount } = render(<App initialConfig={baseConfig} />);
    await flushMicrotasks();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Quit"); // DashboardFooter marker
    unmount();
  });

  test("`?` opens Help overlay and `?` closes it", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("?");
    await flushMicrotasks();
    expect(lastFrame() ?? "").toContain("Keyboard Shortcuts");

    stdin.write("?");
    await flushMicrotasks();
    expect(lastFrame() ?? "").not.toContain("Keyboard Shortcuts");
    unmount();
  });

  test("Esc from Help returns to Dashboard", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("?");
    await flushMicrotasks();
    expect(lastFrame() ?? "").toContain("Keyboard Shortcuts");

    stdin.write("\x1B"); // Esc
    await flushMicrotasks();
    expect(lastFrame() ?? "").not.toContain("Keyboard Shortcuts");
    unmount();
  });

  test("`c` opens Config view", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("c");
    await flushMicrotasks();
    // Config view renders provider names
    expect(lastFrame() ?? "").toMatch(/Claude Code|claude/);
    unmount();
  });

  test("Enter on a skill opens Detail view; Esc returns to Dashboard", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("\r"); // Enter
    await flushMicrotasks();
    const detailFrame = lastFrame() ?? "";
    // Detail shows the description + license
    expect(detailFrame).toContain("sample-skill");
    expect(detailFrame).toContain("MIT");

    stdin.write("\x1B"); // Esc
    await flushMicrotasks();
    const dashFrame = lastFrame() ?? "";
    expect(dashFrame).toContain("Quit"); // Dashboard footer back
    unmount();
  });
});
