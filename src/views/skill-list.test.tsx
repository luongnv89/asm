import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { SkillListView, calcDescWidth } from "./skill-list";
import { stringWidth } from "./skill-list";
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

describe("calcDescWidth", () => {
  // Regression test for issue #417 review: adding the Invoke column must not
  // silently grow the fixed (non-description) row budget beyond what was
  // reclaimed from other columns. See the comment on calcDescWidth for the
  // full addend breakdown that sums to this constant.
  it("pins the fixed row-content budget", () => {
    const fixed = 105;
    expect(calcDescWidth(200)).toBe(200 - fixed);
  });

  it("never returns a negative width on narrow terminals", () => {
    expect(calcDescWidth(80)).toBe(0);
    expect(calcDescWidth(0)).toBe(0);
  });
});

describe("SkillListView row width", () => {
  it("keeps CJK rows within the fixed budget on wide terminals", () => {
    // Mixed CJK sample: Han, Hiragana, Hangul, fullwidth punctuation.
    const cjkSkill = makeSkill({
      name: "中文技能名稱超過欄位寬度限制測試用例",
      description: "これは日本語の説明です。한국어 설명도 포함합니다。混合中文與全形標點。",
      creator: "作者名前황",
      effort: "중간",
    });
    const termWidth = 120;
    const { lastFrame, unmount } = render(
      <SkillListView
        skills={[cjkSkill]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={termWidth}
        hasScanned={true}
        searchQuery=""
      />,
    );
    const frame = lastFrame() ?? "";
    // The CJK row is not wrapped: exactly one line carries the Han name,
    // and the Hiragana description stays on its own continuation-free line.
    const lines = frame.split("\n");
    expect(lines.filter((l) => l.includes("中文"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("これは日本語の"))).toHaveLength(1);
    unmount();
  });

  it("keeps the Invoke column while staying within the pinned fixed budget", () => {
    const { lastFrame, unmount } = render(
      <SkillListView
        skills={[makeSkill({ modelInvocable: true, userInvocable: false })]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={200}
        hasScanned={true}
        searchQuery=""
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Invoke");
    // formatInvocability("model", true, false) === "model".
    expect(frame).toContain("model");
    unmount();
  });
});

describe("SkillListView empty state", () => {
  const renderEmpty = (searchQuery: string) =>
    render(
      <SkillListView
        skills={[]}
        selectedIndex={0}
        visibleCount={5}
        termWidth={200}
        hasScanned={true}
        searchQuery={searchQuery}
      />,
    );

  it("names the query when a search filter emptied the list", () => {
    const { lastFrame, unmount } = renderEmpty("foobar");
    const frame = lastFrame() ?? "";
    expect(frame).toContain('no matches for "foobar"');
    expect(frame).not.toContain("(no skills found)");
    unmount();
  });

  it("keeps the empty-install message when no query is active", () => {
    const { lastFrame, unmount } = renderEmpty("");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("(no skills found)");
    expect(frame).not.toContain("no matches for");
    unmount();
  });
});
