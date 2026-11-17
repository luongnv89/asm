import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { SkillListView } from "./skill-list";
import { SkillDetailView } from "./skill-detail";
import { ConfirmView } from "./confirm";
import { DuplicatesView } from "./duplicates";
import { LinkModal } from "./link-modal";
import type { AuditReport, SkillInfo } from "../utils/types";

// Issue #834: the TUI shows author strings with their control bytes replaced
// by `?`. Ink adds its own SGR colour codes, so the checks look for the
// hostile bytes Ink never emits: BEL, OSC, C1 CSI and DEL.
const H = "\x1b]8;;x\x07\u009b\x7f";
const SHOWN = "?]8;;x???";

function expectClean(frame: string | undefined) {
  const text = frame ?? "";
  expect(text).toContain(SHOWN);
  // eslint-disable-next-line no-control-regex
  expect(text).not.toMatch(/[\x07\x7f-\x9f]|\x1b\]/);
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: `n${H}`,
    version: "1.0.0",
    description: `d${H}`,
    creator: `c${H}`,
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "dir",
    path: `/tmp/p${H}`,
    originalPath: "/tmp/p",
    location: "global",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/tmp/p",
    fileCount: 1,
    ...over,
  };
}

const tick = async (ms = 50) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("TUI views strip author control bytes (#834)", () => {
  it("skill list rows", () => {
    const { lastFrame, unmount } = render(
      <SkillListView
        skills={[makeSkill()]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={160}
        hasScanned
        searchQuery=""
      />,
    );
    expectClean(lastFrame());
    unmount();
  });

  it("skill detail fields and description", () => {
    const { lastFrame, unmount } = render(
      <SkillDetailView skill={makeSkill()} />,
    );
    const frame = lastFrame();
    expectClean(frame);
    expect(frame).toContain(`n${SHOWN}`);
    expect(frame).toContain(`d${SHOWN}`);
    unmount();
  });

  it("uninstall confirmation", () => {
    const { lastFrame, unmount } = render(
      <ConfirmView
        skill={makeSkill()}
        targets={[`/tmp/t${H}`]}
        onResult={vi.fn()}
      />,
    );
    const frame = lastFrame();
    expectClean(frame);
    expect(frame).toContain(`t${SHOWN}`);
    unmount();
  });

  it("duplicate groups and instances", async () => {
    const instances = [
      makeSkill({ path: `/a/x${H}`, location: `a${H}` }),
      makeSkill({ path: "/b/x", location: "b" }),
    ];
    const report: AuditReport = {
      scannedAt: new Date().toISOString(),
      totalSkills: 2,
      duplicateGroups: [{ key: `k${H}`, reason: "same-dirName", instances }],
      totalDuplicateInstances: 2,
    };
    const { lastFrame, stdin, unmount } = render(
      <DuplicatesView report={report} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expectClean(lastFrame());
    await tick();
    stdin.write("\r");
    await tick();
    expectClean(lastFrame());
    expect(lastFrame()).toContain(`/a/x${SHOWN}`);
    unmount();
  });

  it("link modal title", () => {
    const { lastFrame, unmount } = render(
      <LinkModal
        skillName={`s${H}`}
        scope="global"
        options={[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expectClean(lastFrame());
    unmount();
  });
});
