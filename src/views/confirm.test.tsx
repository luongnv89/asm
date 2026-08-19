import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmView } from "./confirm";
import type { SkillInfo } from "../utils/types";

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "sample-skill",
    version: "1.0.0",
    description: "A sample skill.",
    creator: "tester",
    license: "MIT",
    compatibility: "",
    allowedTools: [],
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
    ...over,
  };
}

describe("ConfirmView", () => {
  it("renders the uninstall title with the skill name", () => {
    const { lastFrame } = render(
      <ConfirmView
        skill={makeSkill({ name: "dangerous-skill" })}
        targets={["/tmp/dangerous-skill"]}
        onResult={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Uninstall: dangerous-skill");
  });

  it("lists the target paths that will be removed", () => {
    const targets = ["/path/a", "/path/b", "/path/c"];
    const { lastFrame } = render(
      <ConfirmView skill={makeSkill()} targets={targets} onResult={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("The following will be removed:");
    for (const t of targets) {
      expect(frame).toContain(t);
    }
  });

  it("shows a no-files-found message when targets is empty", () => {
    const { lastFrame } = render(
      <ConfirmView skill={makeSkill()} targets={[]} onResult={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("(no files found to remove)");
  });

  it("renders the confirm and cancel choices", () => {
    const { lastFrame } = render(
      <ConfirmView skill={makeSkill()} targets={["/x"]} onResult={vi.fn()} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Yes, uninstall");
    expect(frame).toContain("Cancel");
  });
});
