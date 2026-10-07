import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import {
  buildLinkOptions,
  LinkModal,
  type LinkTargetOption,
} from "./link-modal";
import type { ProviderConfig } from "../utils/types";

const PROVIDERS: ProviderConfig[] = [
  {
    name: "agents",
    label: "Agents",
    global: "~/.agents/skills",
    project: ".agents/skills",
    enabled: true,
  },
  {
    name: "claude",
    label: "Claude Code",
    global: "~/.claude/skills",
    project: ".claude/skills",
    enabled: true,
  },
  {
    name: "disabled-one",
    label: "Disabled",
    global: "~/.disabled/skills",
    project: ".disabled/skills",
    enabled: false,
  },
];

const ARROW_DOWN = "\u001B[B";
const ENTER = "\r";
const ESCAPE = "\u001B";

describe("buildLinkOptions", () => {
  it("builds project options with the first defaulting to .agents/skills/", () => {
    const options = buildLinkOptions(PROVIDERS, "project");
    expect(options[0].label).toContain("Agents (.agents/skills)");
    expect(options.length).toBe(2);
  });

  it("builds global options with the first defaulting to ~/.agents/skills/", () => {
    const options = buildLinkOptions(PROVIDERS, "global");
    expect(options[0].label).toContain("~/.agents/skills");
  });

  it("skips disabled providers", () => {
    const options = buildLinkOptions(PROVIDERS, "project");
    expect(
      options.find((o) => o.provider.name === "disabled-one"),
    ).toBeUndefined();
  });
});

describe("LinkModal", () => {
  const options: LinkTargetOption[] = buildLinkOptions(PROVIDERS, "project");

  it("renders the project title with the skill name", () => {
    const { lastFrame, unmount } = render(
      <LinkModal
        skillName="my-skill"
        scope="project"
        options={options}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Link to Project: my-skill");
    unmount();
  });

  it("renders the global title in global scope", () => {
    const { lastFrame, unmount } = render(
      <LinkModal
        skillName="my-skill"
        scope="global"
        options={buildLinkOptions(PROVIDERS, "global")}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(lastFrame()).toContain("Link to Global: my-skill");
    unmount();
  });

  it("fires onSelect with the first (default) option on Enter", async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(
      <LinkModal
        skillName="my-skill"
        scope="project"
        options={options}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(ENTER);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as LinkTargetOption;
    expect(arg.provider.name).toBe("agents");
    unmount();
  });

  it("moves focus with arrow keys before confirming", async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = render(
      <LinkModal
        skillName="my-skill"
        scope="project"
        options={options}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(ARROW_DOWN);
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(ENTER);
    await new Promise((r) => setTimeout(r, 50));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = onSelect.mock.calls[0][0] as LinkTargetOption;
    expect(arg.provider.name).toBe("claude");
    unmount();
  });

  it("fires onCancel on Escape", async () => {
    const onCancel = vi.fn();
    const { stdin, unmount } = render(
      <LinkModal
        skillName="my-skill"
        scope="project"
        options={options}
        onSelect={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    stdin.write(ESCAPE);
    await new Promise((r) => setTimeout(r, 120));
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
  });
});
