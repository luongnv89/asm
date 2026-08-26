/**
 * Direct-import tests for `formatter-core.ts` internals.
 *
 * The #455 split newly exported `useColor`, `providerBadge`, and
 * `toolRiskWarning` from `formatter-core.ts` for cross-module wiring, but they
 * are deliberately NOT re-exported through the `./formatter` facade, so
 * `formatter.test.ts` cannot reach them. These tests import them directly.
 */
import { describe, it, expect, afterEach } from "vitest";

import { useColor, providerBadge, toolRiskWarning } from "./formatter-core";

const ORIG_NO_COLOR = process.env.NO_COLOR;
const ORIG_IS_TTY = process.stdout.isTTY;
const ORIG_CLI_NO_COLOR = globalThis.__CLI_NO_COLOR;

/** Force `useColor()` to return true by clearing every disabling signal. */
function enableColor(): void {
  delete process.env.NO_COLOR;
  globalThis.__CLI_NO_COLOR = undefined;
  process.stdout.isTTY = true;
}

afterEach(() => {
  if (ORIG_NO_COLOR === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = ORIG_NO_COLOR;
  }
  globalThis.__CLI_NO_COLOR = ORIG_CLI_NO_COLOR;
  process.stdout.isTTY = ORIG_IS_TTY;
});

describe("useColor", () => {
  it("returns false when NO_COLOR is defined, even on a TTY", () => {
    enableColor();
    process.env.NO_COLOR = "1";
    expect(useColor()).toBe(false);
  });

  it("returns false when NO_COLOR is defined but empty", () => {
    enableColor();
    process.env.NO_COLOR = "";
    expect(useColor()).toBe(false);
  });

  it("returns false when the __CLI_NO_COLOR global is set", () => {
    enableColor();
    globalThis.__CLI_NO_COLOR = true;
    expect(useColor()).toBe(false);
  });

  it("returns false when stdout is not a TTY", () => {
    enableColor();
    process.stdout.isTTY = false;
    expect(useColor()).toBe(false);
  });

  it("returns true on a TTY with no disabling signals", () => {
    enableColor();
    expect(useColor()).toBe(true);
  });

  it("treats __CLI_NO_COLOR=false as not disabling", () => {
    enableColor();
    globalThis.__CLI_NO_COLOR = false;
    expect(useColor()).toBe(true);
  });
});

describe("providerBadge", () => {
  it("returns a plain bracketed label when color is disabled", () => {
    process.env.NO_COLOR = "1";
    expect(providerBadge("claude", "Claude Code")).toBe("[Claude Code]");
  });

  it("returns a plain bracketed label for unknown providers when color is disabled", () => {
    process.env.NO_COLOR = "1";
    expect(providerBadge("totally-unknown", "Mystery")).toBe("[Mystery]");
  });

  it("wraps the bracketed label in the provider color when color is enabled", () => {
    enableColor();
    // claude -> blueBold
    expect(providerBadge("claude", "Claude Code")).toBe(
      "\x1b[34;1m[Claude Code]\x1b[0m",
    );
  });

  it.each([
    ["codex", "\x1b[36m"],
    ["codex-plugin", "\x1b[36m"],
    ["openclaw", "\x1b[33m"],
    ["agents", "\x1b[32m"],
    ["custom", "\x1b[35m"],
    ["cursor", "\x1b[34m"],
    ["windsurf", "\x1b[36m"],
    ["cline", "\x1b[32m"],
    ["roocode", "\x1b[35m"],
    ["continue", "\x1b[33m"],
    ["copilot", "\x1b[37m"],
    ["aider", "\x1b[31m"],
    ["opencode", "\x1b[36m"],
    ["zed", "\x1b[34m"],
    ["augment", "\x1b[32m"],
    ["amp", "\x1b[33m"],
  ])("colors the %s badge with its own escape code", (provider, prefix) => {
    enableColor();
    expect(providerBadge(provider, "L")).toBe(`${prefix}[L]\x1b[0m`);
  });

  it("falls back to dim for an unknown provider when color is enabled", () => {
    enableColor();
    expect(providerBadge("totally-unknown", "Mystery")).toBe(
      "\x1b[2m[Mystery]\x1b[0m",
    );
  });

  it("still brackets an empty label", () => {
    process.env.NO_COLOR = "1";
    expect(providerBadge("claude", "")).toBe("[]");
  });
});

describe("toolRiskWarning", () => {
  it("returns null for an empty tool list", () => {
    expect(toolRiskWarning([])).toBeNull();
  });

  it("returns null for medium-risk tools only", () => {
    expect(toolRiskWarning(["WebFetch", "WebSearch"])).toBeNull();
  });

  it("returns null for low-risk tools only", () => {
    expect(toolRiskWarning(["Read", "Grep", "Glob"])).toBeNull();
  });

  it("warns about shell execution for Bash", () => {
    expect(toolRiskWarning(["Bash"])).toBe(
      "This skill can execute shell commands",
    );
  });

  it.each(["Write", "Edit", "NotebookEdit"])(
    "warns about file modification for %s",
    (tool) => {
      expect(toolRiskWarning([tool])).toBe("This skill can modify files");
    },
  );

  it("collapses multiple file-writing tools into one clause", () => {
    expect(toolRiskWarning(["Write", "Edit", "NotebookEdit"])).toBe(
      "This skill can modify files",
    );
  });

  it("joins both clauses when Bash and a file-writing tool are present", () => {
    expect(toolRiskWarning(["Bash", "Write"])).toBe(
      "This skill can execute shell commands and modify files",
    );
  });

  it("keeps clause order stable regardless of input order", () => {
    expect(toolRiskWarning(["Edit", "Bash"])).toBe(
      "This skill can execute shell commands and modify files",
    );
  });

  it("ignores non-high-risk tools mixed in with high-risk ones", () => {
    expect(toolRiskWarning(["Read", "WebFetch", "Bash"])).toBe(
      "This skill can execute shell commands",
    );
  });

  it("is case-sensitive — lowercase tool names are not high risk", () => {
    expect(toolRiskWarning(["bash", "write"])).toBeNull();
  });
});
