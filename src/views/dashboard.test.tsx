import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { DashboardHeader, DashboardFooter } from "./dashboard";
import type { SkillInfo, AppConfig } from "../utils/types";

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

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    version: 1,
    providers: [
      {
        name: "claude",
        label: "Claude",
        global: "/a",
        project: "/b",
        enabled: true,
      },
      {
        name: "codex",
        label: "Codex",
        global: "/c",
        project: "/d",
        enabled: true,
      },
    ],
    customPaths: [],
    preferences: { defaultScope: "both", defaultSort: "name" },
    ...over,
  };
}

// ink lays the stats row out in a bordered row Box, so multi-token fields like
// "Total: 3 (2 unique)" can wrap across rendered lines. Collapse whitespace so
// assertions are layout-agnostic.
function collapse(frame: string): string {
  return frame.replace(/\s+/g, " ");
}

describe("DashboardHeader", () => {
  it("renders the app title and aggregate stats from the skill list", () => {
    const skills = [
      makeSkill({ dirName: "a", scope: "global" }),
      makeSkill({ dirName: "b", scope: "project" }),
      makeSkill({
        dirName: "a",
        scope: "global",
        isSymlink: true,
        provider: "codex",
      }),
    ];
    const { lastFrame } = render(
      <DashboardHeader
        config={makeConfig()}
        skills={skills}
        duplicateCount={1}
        sort="name"
        scope="both"
        searchMode={false}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    const frame = collapse(lastFrame() ?? "");
    expect(frame).toContain("agent-skill-manager");
    // The stats row wraps inside a bordered Box at 80 cols, so assert each label
    // and its computed value separately. Aggregate is: total=3, unique=2,
    // global=2, project=1, symlinks=1, providers=2, dupes=1.
    expect(frame).toContain("Total: 3");
    expect(frame).toContain("unique");
    expect(frame).toContain("Global:");
    expect(frame).toContain("Project:");
    expect(frame).toContain("Symlinks:");
    expect(frame).toContain("Tools:");
    expect(frame).toContain("Dupes:");
    // The values column-group renders as "2 1 1 2 1" after the labels (global
    // 2, project 1, symlinks 1, tools 2, dupes 1).
    expect(frame).toContain("2 1 1 2 1");
  });

  it("renders the sort label with the active sort bracketed", () => {
    const { lastFrame } = render(
      <DashboardHeader
        config={makeConfig()}
        skills={[]}
        duplicateCount={0}
        sort="version"
        scope="both"
        searchMode={false}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    const frame = lastFrame() ?? "";
    // buildSortLabel: "(s) Sort: name  [version]  location"
    expect(frame).toContain("[version]");
    expect(frame).toContain("Sort:");
  });

  it("highlights the active scope tab and dims the others", () => {
    const { lastFrame } = render(
      <DashboardHeader
        config={makeConfig()}
        skills={[]}
        duplicateCount={0}
        sort="name"
        scope="project"
        searchMode={false}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Global");
    expect(frame).toContain("Project");
    expect(frame).toContain("Both");
  });

  it("shows the search prompt when not in search mode", () => {
    const { lastFrame } = render(
      <DashboardHeader
        config={makeConfig()}
        skills={[]}
        duplicateCount={0}
        sort="name"
        scope="both"
        searchMode={false}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    expect(lastFrame()).toContain("press / to search...");
  });

  it("shows the current query when a filter is set but search mode is off", () => {
    const { lastFrame } = render(
      <DashboardHeader
        config={makeConfig()}
        skills={[]}
        duplicateCount={0}
        sort="name"
        scope="both"
        searchMode={false}
        searchQuery="my-filter"
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    expect(lastFrame()).toContain("my-filter");
    expect(lastFrame()).not.toContain("press / to search...");
  });

  it("truncates the scope description when more than 3 providers are enabled", () => {
    const config = makeConfig({
      providers: [
        { name: "a", label: "Alpha", global: "/a", project: "", enabled: true },
        { name: "b", label: "Beta", global: "/b", project: "", enabled: true },
        { name: "c", label: "Gamma", global: "/c", project: "", enabled: true },
        { name: "d", label: "Delta", global: "/d", project: "", enabled: true },
        {
          name: "e",
          label: "Epsilon",
          global: "/e",
          project: "",
          enabled: false,
        },
      ],
    });
    const { lastFrame } = render(
      <DashboardHeader
        config={config}
        skills={[]}
        duplicateCount={0}
        sort="name"
        scope="both"
        searchMode={false}
        searchQuery=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );
    const frame = lastFrame() ?? "";
    // 4 enabled → "Alpha, Beta +2"
    expect(frame).toContain("Alpha, Beta +2");
    expect(frame).not.toContain("Epsilon");
  });
});

describe("DashboardFooter", () => {
  it("renders the keybinding hint line with · separators", () => {
    const { lastFrame } = render(
      <DashboardFooter
        refreshFeedback={false}
        scanning={false}
        hasScanned={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Navigate");
    expect(frame).toContain("View");
    expect(frame).toContain("Uninstall");
    expect(frame).toContain("Audit");
    expect(frame).toContain("Filter");
    expect(frame).toContain("Scope");
    expect(frame).toContain("Sort");
    expect(frame).toContain("Refresh");
    expect(frame).toContain("Config");
    expect(frame).toContain("Quit");
    expect(frame).toContain("Help");
    // Footer uses · as separator between key/label pairs
    expect(frame).toContain("·");
  });

  it("shows refresh feedback when refreshFeedback is true", () => {
    const { lastFrame } = render(
      <DashboardFooter
        refreshFeedback={true}
        scanning={false}
        hasScanned={true}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Updated!");
  });

  it("shows scanning indicator when scanning and not yet scanned", () => {
    const { lastFrame } = render(
      <DashboardFooter
        refreshFeedback={false}
        scanning={true}
        hasScanned={false}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Scanning...");
  });
});
