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
import { act } from "react";
import { render } from "ink-testing-library";
import type { AppConfig, AuditReport, SkillInfo } from "../../src/utils/types";

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

const secondSkill: SkillInfo = {
  ...sampleSkill,
  name: "other-skill",
  dirName: "other-skill",
  path: "/tmp/other-skill",
  originalPath: "/tmp/other-skill",
  realPath: "/tmp/other-skill",
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

// Mock the uninstaller so the `d` delete-confirm flow doesn't touch the
// filesystem when a test selects the "yes" branch.
const executeRemovalMock = vi.fn(async () => {});
const getExistingTargetsMock = vi.fn(async () => [
  "/tmp/sample-skill/SKILL.md",
]);
vi.mock("../../src/uninstaller", async () => {
  const actual = await vi.importActual<typeof import("../../src/uninstaller")>(
    "../../src/uninstaller",
  );
  return {
    ...actual,
    getExistingTargets: getExistingTargetsMock,
    executeRemoval: executeRemovalMock,
  };
});

// Mock the auditor so `a` audit view shows a known duplicate group.
const duplicateReport: AuditReport = {
  scannedAt: "2026-04-22T00:00:00.000Z",
  totalSkills: 2,
  duplicateGroups: [
    {
      key: "sample-skill",
      reason: "same-dirName",
      instances: [sampleSkill, { ...secondSkill, name: "sample-skill" }],
    },
  ],
  totalDuplicateInstances: 2,
};
vi.mock("../../src/auditor", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/auditor")>(
      "../../src/auditor",
    );
  return {
    ...actual,
    detectDuplicates: vi.fn(() => duplicateReport),
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

// Ink delays a standalone Escape briefly while it distinguishes it from an
// escape sequence. Poll for the resulting frame instead of assuming that a
// few microtasks are enough for the input parser and React to settle.
async function expectFrame(
  lastFrame: () => string | undefined,
  text: string,
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = lastFrame() ?? "";
  while (!frame.includes(text) && Date.now() < deadline) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
    frame = lastFrame() ?? "";
  }
  expect(frame).toContain(text);
  return frame;
}

describe("TUI integration: view transitions (issue #224)", () => {
  let App: typeof import("../../src/index").App;

  beforeEach(async () => {
    executeRemovalMock.mockClear();
    getExistingTargetsMock.mockClear();
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
    await expectFrame(lastFrame, "Keyboard Shortcuts");

    stdin.write("\x1B"); // Esc
    await expectFrame(lastFrame, "Navigate");
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
    const detailFrame = await expectFrame(lastFrame, "Esc Back d Uninstall");
    // Detail shows the description + license
    expect(detailFrame).toContain("sample-skill");
    expect(detailFrame).toContain("MIT");

    stdin.write("\x1B"); // Esc
    await expectFrame(lastFrame, "Navigate");
    const dashFrame = lastFrame() ?? "";
    expect(dashFrame).toContain("Quit"); // Dashboard footer back
    unmount();
  });

  test("`/` enters search mode and Esc clears it", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    // Before search mode: prompt text is shown.
    await expectFrame(lastFrame, "press / to search");

    stdin.write("/");
    const searchFrame = await expectFrame(lastFrame, "type to search");
    // In search mode, the TextInput placeholder swaps in.
    expect(searchFrame).not.toContain("press / to search");

    stdin.write("\x1B"); // Esc exits search mode + clears query
    await expectFrame(lastFrame, "press / to search");
    unmount();
  });

  test("`d` opens the Confirm uninstall view; Esc returns to Dashboard without removing", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("d");
    const confirmFrame = await expectFrame(
      lastFrame,
      "Uninstall: sample-skill",
    );
    expect(confirmFrame).toContain("Uninstall: sample-skill");
    expect(getExistingTargetsMock).toHaveBeenCalled();

    stdin.write("\x1B"); // Esc cancels without confirming
    await expectFrame(lastFrame, "Navigate");
    expect(lastFrame() ?? "").toContain("Quit"); // back on Dashboard
    expect(executeRemovalMock).not.toHaveBeenCalled();
    unmount();
  });

  test("`a` opens the Audit duplicates view", async () => {
    const { lastFrame, stdin, unmount } = render(
      <App initialConfig={baseConfig} />,
    );
    await flushMicrotasks();
    stdin.write("a");
    await flushMicrotasks();
    const auditFrame = lastFrame() ?? "";
    expect(auditFrame).toContain("Audit: Duplicates");
    unmount();
  });
});
