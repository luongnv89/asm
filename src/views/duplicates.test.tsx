import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { DuplicatesView } from "./duplicates";
import type { AuditReport, SkillInfo } from "../utils/types";

const ARROW_DOWN = "\u001B[B";
const ENTER = "\r";

function makeSkill(over: Partial<SkillInfo> & { path: string }): SkillInfo {
  return {
    name: "dupe",
    version: "1.0.0",
    description: "",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "dupe",
    originalPath: over.path,
    location: "global",
    scope: "global",
    provider: "claude",
    providerLabel: "claude",
    isSymlink: false,
    symlinkTarget: null,
    realPath: over.path,
    ...over,
  };
}

function makeReport(): AuditReport {
  const instances = [
    makeSkill({ path: "/a/dupe", location: "a" }),
    makeSkill({ path: "/b/dupe", location: "b" }),
  ];
  return {
    scannedAt: new Date().toISOString(),
    totalSkills: 2,
    duplicateGroups: [{ key: "dupe", reason: "same-dirName", instances }],
    totalDuplicateInstances: 2,
  };
}

const tick = async (ms = 50) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("DuplicatesView raw-mode lifetime", () => {
  // Regression test for the TUI freeze after removing duplicates.
  //
  // ink reference-counts raw mode: when the last active `useInput` releases it,
  // App.handleSetRawMode drops to 0 and runs the full teardown —
  // `stdin.setRawMode(false)`, removing the 'readable' listener and
  // `stdin.unref()`. On Windows, re-enabling raw mode after that teardown has
  // spanned event-loop turns leaves stdin permanently silent: the process stays
  // alive and idle but never receives another keypress.
  //
  // That is exactly what happened here. While the removal was awaited, the
  // parent App had already disabled its own `useInput` (`isActive: view !==
  // "audit"`), so gating this view's `useInput` on `!busy` left ZERO holders of
  // raw mode for the whole duration of the await.
  //
  // The view must therefore keep its `useInput` mounted while busy and ignore
  // keystrokes inside the handler instead (the handler's `if (busy) return`
  // guard already does this).
  it("never releases raw mode while the removal is in flight", async () => {
    let resolveRemoval: (() => void) | undefined;
    const onRemove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRemoval = resolve;
        }),
    );

    const { stdin, lastFrame, unmount } = render(
      <DuplicatesView
        report={makeReport()}
        onRemove={onRemove}
        onClose={() => {}}
      />,
    );

    // Let ink mount and subscribe to stdin before driving any keys.
    await tick();

    const setRawMode = vi.spyOn(
      stdin as unknown as { setRawMode: (v: boolean) => void },
      "setRawMode",
    );

    // groups phase → Enter opens the group (pre-marks every instance but the
    // first), instances phase starts with the cursor on instance 0.
    stdin.write(ENTER);
    await tick();

    // Move onto the ">>> Remove N marked instance(s) <<<" action row: two
    // instances means the action row sits at index 2.
    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ARROW_DOWN);
    await tick();
    expect(lastFrame()).toContain("Remove 1 marked instance(s)");

    // Enter triggers the removal and flips `busy`.
    stdin.write(ENTER);
    await tick();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(resolveRemoval).toBeDefined();

    // The removal is still pending here — this is the window in which the real
    // app hung. Raw mode must still be held.
    expect(setRawMode).not.toHaveBeenCalledWith(false);

    resolveRemoval!();
    await tick();

    setRawMode.mockRestore();
    unmount();
  });
});
