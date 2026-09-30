/** @vitest-environment jsdom */
import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import DocsPage from "../pages/DocsPage.jsx";
import { DOC_NAV } from "../components/DocsToc.jsx";

/**
 * Commands and flags that must appear on /docs. Keep this list aligned with
 * `printMainHelp()` in src/cli.ts plus documented subcommands in README.md.
 */
const COMMANDS = [
  "asm list",
  "asm search <query>",
  "asm tag add|remove",
  "asm inspect <skill-name>",
  "asm get <skill>",
  "asm install <source>",
  "asm activate <skill>",
  "asm deactivate <skill>",
  "asm library",
  "asm uninstall <skill-name>",
  "asm disable <target>",
  "asm enable <target>",
  "asm init <name>",
  "asm export",
  "asm import <file>",
  "asm outdated",
  "asm update [name...]",
  "asm audit",
  "asm audit overlap",
  "asm audit security <name|source>",
  "asm audit residency",
  "asm publish [path]",
  "asm eval <skill-path>",
  "asm eval-providers list",
  "asm bundle <subcommand>",
  "asm index <subcommand>",
  "asm stats",
  "asm stats --tokens",
  "asm stats repo <repo>",
  "asm stats author <owner>",
  "asm stats index",
  "asm doctor",
  "asm config <subcommand>",
  "asm library list",
  "asm library update <skill>",
  "bundle modify <name>",
  "bundle export <name> [file]",
  "index overlap",
];

function renderDocs() {
  cleanup();
  return render(
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <DocsPage />
    </HashRouter>,
  );
}

describe("DocsPage", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    if (typeof IntersectionObserver === "undefined") {
      globalThis.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("documents the current Node floor and CLI surface", () => {
    renderDocs();

    expect(screen.getByRole("heading", { name: "Documentation" })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Node\.js\s*≥ 22/);

    for (const cmd of COMMANDS) {
      expect(screen.getAllByText(cmd, { exact: true }).length).toBeGreaterThan(
        0,
      );
    }

    expect(
      screen.getAllByText("--library", { exact: true }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("--tokens", { exact: true }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Toggle help")).toBeTruthy();
  });

  it("renders an on-this-page nav that jumps to sections", () => {
    renderDocs();

    const { container } = renderDocs();

    expect(
      container.querySelectorAll('nav[aria-label="On this page"]').length,
    ).toBe(2);

    for (const item of DOC_NAV) {
      expect(document.getElementById(item.id)).toBeTruthy();
      expect(screen.getAllByRole("button", { name: item.label }).length).toBe(
        2,
      );
    }

    fireEvent.click(screen.getAllByRole("button", { name: "Evaluating" })[0]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toMatch(/s=eval/);
  });

  it("lists providers in picker order with the Agents harness note", () => {
    renderDocs();
    const section = document.getElementById("tools");
    const names = [...section.querySelectorAll("tbody tr td:first-child")].map(
      (td) => td.textContent,
    );
    expect(names.slice(0, 7)).toEqual([
      "Agents — most harnesses except Claude Code",
      "Claude Code",
      "Pi",
      "OpenCode",
      "Codex",
      "Oh My Pi",
      "Grok CLI",
    ]);
    expect(names).toHaveLength(21);
  });
});
