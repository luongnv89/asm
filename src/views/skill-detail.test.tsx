import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SkillDetailView } from "./skill-detail";
import type { SkillInfo } from "../utils/types";

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "sample-skill",
    version: "2.3.4",
    description: "A sample skill that does things.",
    creator: "tester",
    license: "MIT",
    compatibility: "claude>=1.0",
    allowedTools: ["Read", "Grep", "Bash"],
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
    fileCount: 5,
    effort: "medium",
    ...over,
  };
}

describe("SkillDetailView", () => {
  it("renders the skill name as the centered title", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    expect(lastFrame()).toContain("sample-skill");
  });

  it("renders the core metadata rows", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Name:");
    expect(frame).toContain("Version:");
    expect(frame).toContain("2.3.4");
    expect(frame).toContain("Creator:");
    expect(frame).toContain("tester");
    expect(frame).toContain("License:");
    expect(frame).toContain("MIT");
    expect(frame).toContain("Compatibility:");
    expect(frame).toContain("claude>=1.0");
    expect(frame).toContain("Effort:");
    expect(frame).toContain("medium");
    expect(frame).toContain("Location:");
    expect(frame).toContain("Path:");
    expect(frame).toContain("/tmp/sample-skill");
    expect(frame).toContain("Scope:");
    expect(frame).toContain("global");
    expect(frame).toContain("Tool:");
    expect(frame).toContain("Claude Code");
  });

  it("shows the provided file count", () => {
    const { lastFrame } = render(
      <SkillDetailView skill={makeSkill({ fileCount: 42 })} />,
    );
    expect(lastFrame()).toContain("Files:");
    expect(lastFrame()).toContain("42");
  });

  it("renders 'no' for the symlink row when the skill is not a symlink", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Symlink:");
    expect(frame).toContain("no");
  });

  it("renders the symlink target when the skill is a symlink", () => {
    const { lastFrame } = render(
      <SkillDetailView
        skill={makeSkill({ isSymlink: true, symlinkTarget: "/real/path" })}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("yes → /real/path");
  });

  it("renders the description, word-wrapped", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Description:");
    expect(frame).toContain("A sample skill that does things.");
  });

  it("renders '(no description)' when the skill has none", () => {
    const { lastFrame } = render(
      <SkillDetailView skill={makeSkill({ description: "" })} />,
    );
    expect(lastFrame()).toContain("(no description)");
  });

  it("lists allowed tools", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Allowed Tools:");
    expect(frame).toContain("Read");
    expect(frame).toContain("Grep");
    expect(frame).toContain("Bash");
  });

  it("warns that a Bash skill can execute shell commands", () => {
    const { lastFrame } = render(
      <SkillDetailView skill={makeSkill({ allowedTools: ["Bash"] })} />,
    );
    expect(lastFrame()).toContain("execute shell commands");
  });

  it("warns that a Write/Edit skill can modify files", () => {
    const { lastFrame } = render(
      <SkillDetailView
        skill={makeSkill({ allowedTools: ["Write", "Edit"] })}
      />,
    );
    expect(lastFrame()).toContain("modify files");
  });

  it("does not show a tool-risk warning when only low-risk tools are present", () => {
    const { lastFrame } = render(
      <SkillDetailView skill={makeSkill({ allowedTools: ["Read", "Grep"] })} />,
    );
    expect(lastFrame()).not.toContain("This skill can");
  });

  it("renders the Invocable row from formatInvocability", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Invocable:");
  });

  it("shows the not-available eval message when there is no eval summary", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Eval Score:");
    expect(frame).toContain("Not available");
    expect(frame).toContain("asm eval");
  });

  it("renders the Esc/d footer hint", () => {
    const { lastFrame } = render(<SkillDetailView skill={makeSkill()} />);
    expect(lastFrame()).toContain("Esc Back d Uninstall");
  });

  it("renders em-dash for missing creator and license", () => {
    const { lastFrame } = render(
      <SkillDetailView skill={makeSkill({ creator: "", license: "" })} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Creator:");
    expect(frame).toContain("License:");
    expect(frame).toContain("—");
  });
});
