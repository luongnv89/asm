import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render } from "ink-testing-library";
import type { SkillInfo, AppConfig, AuditReport } from "./utils/types";

// ── Hermetic stubs for the domain modules the App container orchestrates ───
// The container's job is to wire these together and drive view transitions via
// keyboard. We stub the domain modules so the test asserts container behavior,
// not real scanner/auditor/uninstaller I/O.
//
// vi.mock factories are hoisted above all top-level code, so the mock fns and
// the return data they close over must live inside a single vi.hoisted() block.
const mocks = vi.hoisted(() => {
  const SKILLS: SkillInfo[] = [
    {
      name: "skill-one",
      version: "1.0.0",
      description: "First skill.",
      creator: "tester",
      license: "MIT",
      compatibility: "",
      allowedTools: [],
      dirName: "skill-one",
      path: "/tmp/skill-one",
      originalPath: "/tmp/skill-one",
      location: "global",
      scope: "global",
      provider: "claude",
      providerLabel: "Claude",
      isSymlink: false,
      symlinkTarget: null,
      realPath: "/tmp/skill-one",
      fileCount: 1,
    },
    {
      name: "skill-two",
      version: "2.0.0",
      description: "Second skill.",
      creator: "tester",
      license: "MIT",
      compatibility: "",
      allowedTools: [],
      dirName: "skill-two",
      path: "/tmp/skill-two",
      originalPath: "/tmp/skill-two",
      location: "project",
      scope: "project",
      provider: "codex",
      providerLabel: "Codex",
      isSymlink: false,
      symlinkTarget: null,
      realPath: "/tmp/skill-two",
      fileCount: 2,
    },
  ];

  const EMPTY_AUDIT: AuditReport = {
    scannedAt: "2026-08-19T00:00:00.000Z",
    totalSkills: 2,
    duplicateGroups: [],
    totalDuplicateInstances: 0,
  };

  const CONFIG: AppConfig = {
    version: 1,
    providers: [
      {
        name: "claude",
        label: "Claude",
        global: "/g/claude",
        project: "/p/claude",
        enabled: true,
      },
      {
        name: "codex",
        label: "Codex",
        global: "/g/codex",
        project: "/p/codex",
        enabled: true,
      },
    ],
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
  };

  return {
    SKILLS,
    EMPTY_AUDIT,
    CONFIG,
    scanAllSkills: vi.fn(async () => SKILLS),
    searchSkills: vi.fn((skills: SkillInfo[]) => skills),
    sortSkills: vi.fn((skills: SkillInfo[]) => skills),
    detectDuplicates: vi.fn(() => EMPTY_AUDIT),
    loadConfig: vi.fn(async () => CONFIG),
    saveConfig: vi.fn(async () => {}),
    getConfigPath: vi.fn(() => "/tmp/config.json"),
    buildFullRemovalPlan: vi.fn(() => ({
      directories: [],
      ruleFiles: [],
      agentsBlocks: [],
    })),
    buildRemovalPlan: vi.fn(() => ({
      directories: [],
      ruleFiles: [],
      agentsBlocks: [],
    })),
    executeRemoval: vi.fn(async () => {}),
    getExistingTargets: vi.fn(async () => ["/tmp/target"]),
  };
});

vi.mock("./scanner", () => ({
  scanAllSkills: mocks.scanAllSkills,
  searchSkills: mocks.searchSkills,
  sortSkills: mocks.sortSkills,
}));

vi.mock("./auditor", () => ({
  detectDuplicates: mocks.detectDuplicates,
}));

vi.mock("./config", () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
  getConfigPath: mocks.getConfigPath,
}));

vi.mock("./uninstaller", () => ({
  buildFullRemovalPlan: mocks.buildFullRemovalPlan,
  buildRemovalPlan: mocks.buildRemovalPlan,
  executeRemoval: mocks.executeRemoval,
  getExistingTargets: mocks.getExistingTargets,
}));

// Mock ink's render so main()'s waitUntilExit resolves immediately instead of
// blocking on a real interactive terminal. The real render is exercised by the
// App-level tests above; here we only characterize the bootstrap/restore path.
const inkRenderMock = vi.hoisted(() => ({
  render: vi.fn(() => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    waitUntilExit: vi.fn(async () => {}),
    clear: vi.fn(),
    write: vi.fn(),
  })),
}));
vi.mock("ink", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("ink");
  return { ...actual, render: inkRenderMock.render };
});

// Import App AFTER the mocks are in place.
const { App } = await import("./index");

const { CONFIG } = mocks;
const tick = () => new Promise<void>((r) => setTimeout(r, 60));

describe("App container", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the default mock implementation so tests that override it
    // (mockReturnValue, mockRejectedValue) don't pollute subsequent tests.
    mocks.scanAllSkills.mockResolvedValue(mocks.SKILLS);
  });

  it("renders the dashboard with the scanned skill list on mount", async () => {
    const { lastFrame, unmount } = render(<App initialConfig={CONFIG} />);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("agent-skill-manager");
    expect(frame).toContain("skill-one");
    expect(frame).toContain("skill-two");
    expect(frame).toContain("Total: 2");
    unmount();
  });

  it("opens the help view on '?' from the dashboard and closes it on '?' again", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    expect(lastFrame()).toContain("Navigate");
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("Keyboard Shortcuts");
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });

  it("opens the help view on '?' and closes it on Esc", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("Keyboard Shortcuts");
    stdin.write("\u001b"); // Esc
    await tick();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });

  it("opens the config view on 'c' and returns to dashboard on Esc", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("c");
    await tick();
    const configFrame = lastFrame() ?? "";
    expect(configFrame).toContain("Configuration");
    // Config owns its Esc handling; closing it calls onClose → saveConfig + dashboard.
    stdin.write("\u001b"); // Esc
    await tick();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });

  it("opens the audit view on 'a' and returns to dashboard on its Esc", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("a");
    await tick();
    // The audit (Duplicates) view renders its own panel, not the search prompt.
    const auditFrame = lastFrame() ?? "";
    expect(auditFrame).not.toContain("press / to search...");
    stdin.write("\u001b"); // Esc — DuplicatesView onClose → dashboard
    await tick();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });

  it("moves the cursor down with j and opens the detail view on Enter", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    // Cursor starts on skill-one (index 0). Move to skill-two.
    stdin.write("j");
    await tick();
    stdin.write("\r"); // Enter → detail
    await tick();
    const detailFrame = lastFrame() ?? "";
    expect(detailFrame).toContain("skill-two");
    expect(detailFrame).toContain("Esc Back d Uninstall");
    unmount();
  });

  it("enters search mode on '/' and exits on Esc", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("type to search...");
    stdin.write("\u001b"); // Esc → leave search mode
    await tick();
    expect(lastFrame()).toContain("press / to search...");
    unmount();
  });

  it("cycles the sort order on 's'", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    // Starts on name → [name]. After 's' it becomes [version].
    stdin.write("s");
    await tick();
    expect(lastFrame()).toContain("[version]");
    unmount();
  });

  it("cycles the scope on Tab", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    // Starts on both. Tab cycles to global.
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("Global");
    unmount();
  });

  it("opens the confirm view on 'd' for the selected skill", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("d");
    await tick();
    const confirmFrame = lastFrame() ?? "";
    expect(confirmFrame).toContain("Uninstall:");
    expect(confirmFrame).toContain("skill-one");
    unmount();
  });

  it("navigates to the detail view then opens confirm on 'd' from detail", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("\r"); // Enter → detail
    await tick();
    expect(lastFrame()).toContain("Esc Back d Uninstall");
    stdin.write("d"); // 'd' in detail view → showConfirm
    await tick();
    const confirmFrame = lastFrame() ?? "";
    expect(confirmFrame).toContain("Uninstall:");
    unmount();
  });

  it("exits the detail view on Esc back to the dashboard", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("\r"); // Enter → detail
    await tick();
    expect(lastFrame()).toContain("Esc Back d Uninstall");
    stdin.write("\u001b"); // Esc → dashboard
    await tick();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });

  it("refreshes the skill list on 'r'", async () => {
    const { stdin, unmount } = render(<App initialConfig={CONFIG} />);
    await tick();
    const callsBefore = mocks.scanAllSkills.mock.calls.length;
    stdin.write("r");
    await tick();
    expect(mocks.scanAllSkills.mock.calls.length).toBeGreaterThan(callsBefore);
    unmount();
  });

  it("shows a spinner during the first scan and does not render '(no skills found)'", async () => {
    // Make the mock return a promise that never resolves, so scanning stays true.
    mocks.scanAllSkills.mockImplementation(
      () =>
        new Promise<SkillInfo[]>(() => {
          // never resolves
        }),
    );
    const { lastFrame, unmount } = render(<App initialConfig={CONFIG} />);
    await tick();
    const frame = lastFrame() ?? "";
    // Spinner should be visible during first scan
    expect(frame).toContain("Scanning");
    // '(no skills found)' must NOT appear while scanning
    expect(frame).not.toContain("no skills found");
    unmount();
  });

  it("renders '(no skills found)' only after a scan completes with zero skills", async () => {
    mocks.scanAllSkills.mockResolvedValue([]);
    const { lastFrame, unmount } = render(<App initialConfig={CONFIG} />);
    await tick();
    // After the promise resolves with [], '(no skills found)' appears
    const frame = lastFrame() ?? "";
    expect(frame).toContain("no skills found");
    unmount();
  });

  it("shows an error panel when scanAllSkills rejects", async () => {
    // Use mockImplementation to return a rejected promise
    mocks.scanAllSkills.mockImplementation(() =>
      Promise.reject(new Error("provider unreachable")),
    );
    const { lastFrame, unmount } = render(<App initialConfig={CONFIG} />);
    // Wait for the async error to propagate through state updates
    await act(async () => {
      await tick();
      await tick();
      await tick();
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Scan failed");
    expect(frame).toContain("provider unreachable");
    // Must NOT show '(no skills found)' on error
    expect(frame).not.toContain("no skills found");
    unmount();
  });

  it("shows 'Updated!' feedback after pressing r", async () => {
    mocks.scanAllSkills.mockResolvedValue(mocks.SKILLS);
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    const callsBefore = mocks.scanAllSkills.mock.calls.length;
    stdin.write("r");
    // Wait for the async refresh to complete
    await act(async () => {
      await tick();
      await tick();
    });
    // Verify the refresh was triggered (scanAllSkills called again)
    expect(mocks.scanAllSkills.mock.calls.length).toBeGreaterThan(callsBefore);
    // The footer should contain "Updated!"
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Updated!");
    unmount();
  });

  it("moves the cursor up with k and stays in bounds", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("k"); // up from index 0 — clamped
    await tick();
    stdin.write("\r"); // Enter → detail of skill-one (still at 0)
    await tick();
    expect(lastFrame()).toContain("skill-one");
    unmount();
  });

  it("pages down with PageDown and opens detail on Enter", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("\u001b[6~"); // PageDown
    await tick();
    stdin.write("\r"); // Enter → detail
    await tick();
    // Two skills; PageDown moves to the last one.
    expect(lastFrame()).toContain("Esc Back d Uninstall");
    unmount();
  });

  it("submits a search query and returns to the dashboard", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    stdin.write("/");
    await tick();
    expect(lastFrame()).toContain("type to search...");
    // Type a query then Enter to submit (onSearchSubmit path, lines 329-332).
    stdin.write("skill-one");
    stdin.write("\r");
    await tick();
    // Submitting search leaves search mode and applies the query as a filter.
    expect(lastFrame()).not.toContain("type to search...");
    unmount();
  });

  it("confirms an uninstall and returns to the dashboard after removal", async () => {
    const { stdin, lastFrame, unmount } = render(
      <App initialConfig={CONFIG} />,
    );
    await tick();
    // Open the confirm view for skill-one.
    stdin.write("d");
    await tick();
    expect(lastFrame()).toContain("Uninstall:");
    // The @inkjs/ui Select defaults to "Cancel". Move up to "Yes, uninstall"
    // then press Enter to fire onResult(true) → handleConfirmResult(true).
    stdin.write("\u001b[A"); // up arrow → "Yes, uninstall"
    await tick();
    stdin.write("\r"); // Enter → confirm
    await tick();
    await tick();
    // The confirmed path calls executeRemoval then returns to dashboard.
    expect(mocks.executeRemoval).toHaveBeenCalled();
    expect(lastFrame()).toContain("Navigate");
    unmount();
  });
});

// ── main() bootstrap smoke test ────────────────────────────────────────────
// main() is the TUI entry point: it loads config, enters the alt-screen buffer,
// renders <App>, and restores the buffer on exit. We mock ink's render so
// waitUntilExit resolves immediately, exercising the bootstrap + restore path
// without spawning a real interactive terminal.
describe("main()", () => {
  it("loads config, renders the app, and restores the alt-screen buffer on exit", async () => {
    const { main } = await import("./index");
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    // Capture the process listeners so we can assert they were registered.
    const onSpy = vi.spyOn(process, "on");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // no-op: prevent actual exit
    }) as never);

    await main();

    // loadConfig was called (mocked) — the config path is exercised.
    expect(mocks.loadConfig).toHaveBeenCalled();
    // The alt-screen enter sequence was written to stdout.
    expect(writeSpy).toHaveBeenCalledWith("\u001b[?1049h");
    // The exit listener was registered for restore-on-exit.
    expect(onSpy).toHaveBeenCalledWith("exit", expect.any(Function));
    // The leave-alt-screen sequence is written by restore() in the finally.
    expect(writeSpy).toHaveBeenCalledWith("\u001b[?1049l");

    writeSpy.mockRestore();
    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("restores the alt-screen buffer and exits on SIGINT/SIGTERM", async () => {
    const { main } = await import("./index");
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    // Capture the SIGINT/SIGTERM listeners main() registers.
    const signalListeners: Record<
      string,
      ((...a: unknown[]) => void) | undefined
    > = {};
    const onSpy = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      cb: (...a: unknown[]) => void,
    ) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        signalListeners[event] = cb;
      }
      return process;
    }) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // no-op
    }) as never);

    await main();

    // Trigger the SIGINT handler — it restores the buffer and calls
    // process.exit(130). restore() is idempotent (guarded by a `restored`
    // flag, already set by the finally), so we assert the exit code, not a
    // second leave-sequence write.
    signalListeners.SIGINT?.();
    expect(exitSpy).toHaveBeenCalledWith(130);

    // Trigger the SIGTERM handler — exits 143.
    signalListeners.SIGTERM?.();
    expect(exitSpy).toHaveBeenCalledWith(143);

    writeSpy.mockRestore();
    onSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
