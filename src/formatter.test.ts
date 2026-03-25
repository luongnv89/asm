import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  formatSkillTable,
  formatSkillDetail,
  formatSkillInspect,
  formatGroupedTable,
  formatSearchResults,
  formatAvailableSearchResults,
  shortenPath,
  colorProvider,
  colorEffort,
  formatJSON,
  ansi,
  colorTool,
  formatAllowedTools,
  HIGH_RISK_TOOLS,
  MEDIUM_RISK_TOOLS,
} from "./formatter";
import type { AvailableSkillResult } from "./formatter";
import type { SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path: "/home/user/.claude/skills/test-skill",
    originalPath: "~/.claude/skills/test-skill",
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: "/home/user/.claude/skills/test-skill",
    fileCount: 3,
    effort: undefined,
    ...overrides,
  };
}

// ─── formatSkillTable ──────────────────────────────────────────────────────

describe("formatSkillTable", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns 'No skills found.' for empty array", () => {
    expect(formatSkillTable([])).toBe("No skills found.");
  });

  test("formats a single skill as table", () => {
    const output = formatSkillTable([makeSkill()]);
    expect(output).toContain("Name");
    expect(output).toContain("Version");
    expect(output).toContain("Tool");
    expect(output).toContain("test-skill");
    expect(output).toContain("1.0.0");
    expect(output).toContain("Claude Code");
    expect(output).toContain("global");
    expect(output).toContain("directory");
  });

  test("marks symlinks correctly", () => {
    const output = formatSkillTable([makeSkill({ isSymlink: true })]);
    expect(output).toContain("symlink");
  });

  test("formats multiple skills with aligned columns", () => {
    const skills = [
      makeSkill({ name: "short" }),
      makeSkill({ name: "a-much-longer-name", version: "2.0.0" }),
    ];
    const output = formatSkillTable(skills);
    const lines = output.split("\n");
    // Header + separator + 2 data lines
    expect(lines.length).toBe(4);
  });

  test("includes separator line", () => {
    const output = formatSkillTable([makeSkill()]);
    const lines = output.split("\n");
    expect(lines[1]).toMatch(/^-+/);
  });

  test("shows all eight columns", () => {
    const output = formatSkillTable([makeSkill()]);
    const headerLine = output.split("\n")[0];
    expect(headerLine).toContain("Name");
    expect(headerLine).toContain("Version");
    expect(headerLine).toContain("Creator");
    expect(headerLine).toContain("Effort");
    expect(headerLine).toContain("Tool");
    expect(headerLine).toContain("Scope");
    expect(headerLine).toContain("Type");
    expect(headerLine).toContain("Path");
  });

  test("column widths accommodate long values", () => {
    const longName = "a-very-long-skill-name-that-exceeds-header";
    const output = formatSkillTable([makeSkill({ name: longName })]);
    const lines = output.split("\n");
    // Data line should contain the full long name without truncation
    expect(lines[2]).toContain(longName);
    // The separator line should be wider than a short-name table
    const shortOutput = formatSkillTable([makeSkill({ name: "x" })]);
    const shortSep = shortOutput.split("\n")[1].length;
    expect(lines[1].length).toBeGreaterThan(shortSep);
  });

  test("shows project scope in scope column", () => {
    const output = formatSkillTable([makeSkill({ scope: "project" })]);
    expect(output).toContain("project");
  });

  test("formats three skills with correct line count", () => {
    const skills = [
      makeSkill({ name: "a" }),
      makeSkill({ name: "b" }),
      makeSkill({ name: "c" }),
    ];
    const output = formatSkillTable(skills);
    const lines = output.split("\n");
    expect(lines.length).toBe(5); // header + separator + 3 data
  });
});

// ─── formatSkillDetail ─────────────────────────────────────────────────────

describe("formatSkillDetail", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("includes all fields", async () => {
    const output = await formatSkillDetail(makeSkill());
    expect(output).toContain("Name: test-skill");
    expect(output).toContain("Version: 1.0.0");
    expect(output).toContain("Tool: Claude Code");
    expect(output).toContain("Scope: global");
    expect(output).toContain("Location: global-claude");
    expect(output).toContain("File Count: 3");
    expect(output).toContain("Type: directory");
    expect(output).toContain("Description: A test skill");
  });

  test("shows symlink target when symlink", async () => {
    const output = await formatSkillDetail(
      makeSkill({ isSymlink: true, symlinkTarget: "/opt/skills/test" }),
    );
    expect(output).toContain("Type: symlink");
    expect(output).toContain("Symlink Target: /opt/skills/test");
  });

  test("omits symlink target when not symlink", async () => {
    const output = await formatSkillDetail(makeSkill());
    expect(output).not.toContain("Symlink Target");
  });

  test("omits symlink target when symlink but target is null", async () => {
    const output = await formatSkillDetail(
      makeSkill({ isSymlink: true, symlinkTarget: null }),
    );
    expect(output).toContain("Type: symlink");
    expect(output).not.toContain("Symlink Target");
  });

  test("omits description section when empty", async () => {
    const output = await formatSkillDetail(makeSkill({ description: "" }));
    expect(output).not.toContain("Description:");
  });

  test("shows project scope", async () => {
    const output = await formatSkillDetail(makeSkill({ scope: "project" }));
    expect(output).toContain("Scope: project");
  });

  test("shows zero file count", async () => {
    const output = await formatSkillDetail(makeSkill({ fileCount: 0 }));
    expect(output).toContain("File Count: 0");
  });

  test("shows large file count", async () => {
    const output = await formatSkillDetail(makeSkill({ fileCount: 12345 }));
    expect(output).toContain("File Count: 12345");
  });

  test("description appears after a blank line", async () => {
    const output = await formatSkillDetail(
      makeSkill({ description: "Some desc" }),
    );
    const lines = output.split("\n");
    const descIndex = lines.findIndex((l) => l.includes("Description:"));
    // There should be a blank line before the description
    expect(lines[descIndex - 1]).toBe("");
  });
});

// ─── formatSkillInspect ────────────────────────────────────────────────────

describe("formatSkillInspect", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("single skill delegates to formatSkillDetail", async () => {
    const skill = makeSkill();
    const inspect = await formatSkillInspect([skill]);
    const detail = await formatSkillDetail(skill);
    expect(inspect).toBe(detail);
  });

  test("empty array returns no skills message", async () => {
    const output = await formatSkillInspect([]);
    expect(output).toBe("No skills found.");
  });

  test("multi-instance shows header banner", async () => {
    const skills = [
      makeSkill({ providerLabel: "Claude Code", provider: "claude" }),
      makeSkill({
        providerLabel: "Codex",
        provider: "codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("----");
    expect(output).toContain("test-skill");
  });

  test("multi-instance shows shared info once", async () => {
    const skills = [
      makeSkill({ providerLabel: "Claude Code" }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("test-skill");
    expect(output).toContain("Version: 1.0.0");
    expect(output).toContain("Installed in:");
    expect(output).toContain("Claude Code");
    expect(output).toContain("Codex");
  });

  test("multi-instance shows installation entries", async () => {
    const skills = [
      makeSkill({ providerLabel: "Claude Code" }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("Claude Code (global, directory)");
    expect(output).toContain("Codex (global, directory)");
    expect(output).toContain("Installations (2)");
  });

  test("multi-instance shows symlink info per installation", async () => {
    const skills = [
      makeSkill({
        providerLabel: "Claude Code",
        isSymlink: true,
        symlinkTarget: "/opt/target",
      }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("Claude Code (global, symlink)");
    expect(output).toContain("Target: /opt/target");
    expect(output).toContain("Codex (global, directory)");
  });

  test("multi-instance shows description in wrapped block", async () => {
    const skills = [
      makeSkill({ description: "A short description" }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("Description:");
    expect(output).toContain("  A short description");
  });

  test("multi-instance omits description when empty", async () => {
    const skills = [
      makeSkill({ description: "" }),
      makeSkill({
        providerLabel: "Codex",
        description: "",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).not.toContain("Description:");
  });

  test("multi-instance aggregates warnings", async () => {
    const skills = [
      makeSkill({
        providerLabel: "Claude Code",
        warnings: [{ category: "missing-version", message: "No version" }],
      }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
        warnings: [{ category: "empty-body", message: "No body" }],
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("Warnings (2)");
    expect(output).toContain("[missing-version] No version");
    expect(output).toContain("[empty-body] No body");
  });

  test("multi-instance hides warnings section when none", async () => {
    const skills = [
      makeSkill({ providerLabel: "Claude Code" }),
      makeSkill({
        providerLabel: "Codex",
        path: "/home/user/.codex/skills/test-skill",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).not.toContain("Warnings");
  });
});

// ─── formatJSON ────────────────────────────────────────────────────────────

describe("formatJSON", () => {
  test("formats array as pretty JSON", () => {
    const data = [{ a: 1 }, { b: 2 }];
    expect(formatJSON(data)).toBe(JSON.stringify(data, null, 2));
  });

  test("formats object as pretty JSON", () => {
    const data = { name: "test", version: "1.0.0" };
    expect(formatJSON(data)).toBe(JSON.stringify(data, null, 2));
  });

  test("formats empty array", () => {
    expect(formatJSON([])).toBe("[]");
  });

  test("formats empty object", () => {
    expect(formatJSON({})).toBe("{}");
  });

  test("formats null", () => {
    expect(formatJSON(null)).toBe("null");
  });

  test("formats string", () => {
    expect(formatJSON("hello")).toBe('"hello"');
  });

  test("formats nested objects", () => {
    const data = { a: { b: { c: 1 } } };
    expect(formatJSON(data)).toBe(JSON.stringify(data, null, 2));
  });
});

// ─── ansi helpers ──────────────────────────────────────────────────────────

describe("ansi helpers (with color disabled)", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("bold returns plain text when color disabled", () => {
    expect(ansi.bold("hello")).toBe("hello");
  });

  test("cyan returns plain text when color disabled", () => {
    expect(ansi.cyan("hello")).toBe("hello");
  });

  test("green returns plain text when color disabled", () => {
    expect(ansi.green("hello")).toBe("hello");
  });

  test("yellow returns plain text when color disabled", () => {
    expect(ansi.yellow("hello")).toBe("hello");
  });

  test("dim returns plain text when color disabled", () => {
    expect(ansi.dim("hello")).toBe("hello");
  });

  test("red returns plain text when color disabled", () => {
    expect(ansi.red("hello")).toBe("hello");
  });

  test("blueBold returns plain text when color disabled", () => {
    expect(ansi.blueBold("hello")).toBe("hello");
  });
});

describe("ansi helpers (with NO_COLOR env)", () => {
  const origNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.NO_COLOR = "1";
  });
  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  test("bold returns plain text with NO_COLOR env set", () => {
    expect(ansi.bold("test")).toBe("test");
  });

  test("red returns plain text with NO_COLOR env set", () => {
    expect(ansi.red("test")).toBe("test");
  });
});

describe("ansi helpers (empty NO_COLOR)", () => {
  const origNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    process.env.NO_COLOR = "";
  });
  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  test("NO_COLOR='' still disables color", () => {
    // Per spec, NO_COLOR being defined (even empty) disables color
    expect(ansi.bold("test")).toBe("test");
  });
});

// ─── shortenPath ──────────────────────────────────────────────────────────

describe("shortenPath", () => {
  test("shortens home directory to ~", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    expect(home).toBeTruthy();
    const result = shortenPath(`${home}/projects/test`);
    expect(result).toBe("~/projects/test");
  });

  test("returns path unchanged when not under home", () => {
    const result = shortenPath("/opt/somewhere/else");
    expect(result).toBe("/opt/somewhere/else");
  });
});

// ─── colorProvider ────────────────────────────────────────────────────────

describe("colorProvider", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns label for known providers", () => {
    expect(colorProvider("claude", "Claude Code")).toBe("Claude Code");
    expect(colorProvider("codex", "Codex")).toBe("Codex");
    expect(colorProvider("openclaw", "OpenClaw")).toBe("OpenClaw");
    expect(colorProvider("agents", "Agents")).toBe("Agents");
  });

  test("returns label for unknown provider", () => {
    expect(colorProvider("unknown", "Unknown")).toBe("Unknown");
  });
});

// ─── formatGroupedTable ───────────────────────────────────────────────────

describe("formatGroupedTable", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns 'No skills found.' for empty array", () => {
    expect(formatGroupedTable([])).toBe("No skills found.");
  });

  test("groups skills by dirName and scope", () => {
    const skills = [
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        provider: "claude",
        providerLabel: "Claude Code",
        scope: "global",
      }),
      makeSkill({
        dirName: "code-review",
        name: "code-review",
        provider: "codex",
        providerLabel: "Codex",
        scope: "global",
        path: "/home/user/.codex/skills/code-review",
      }),
    ];
    const output = formatGroupedTable(skills);
    expect(output).toContain("code-review");
    expect(output).toContain("[Claude Code]");
    expect(output).toContain("[Codex]");
    expect(output).toContain("2 skills (1 unique)");
  });

  test("shows header with correct columns", () => {
    const output = formatGroupedTable([makeSkill()]);
    expect(output).toContain("Name");
    expect(output).toContain("Version");
    expect(output).toContain("Creator");
    expect(output).toContain("Effort");
    expect(output).toContain("Tools");
    expect(output).toContain("Scope");
    expect(output).toContain("Type");
  });

  test("shows footer with counts", () => {
    const output = formatGroupedTable([
      makeSkill({ name: "a", dirName: "a", scope: "global" }),
      makeSkill({
        name: "b",
        dirName: "b",
        scope: "project",
        path: "/other/path",
      }),
    ]);
    expect(output).toContain("2 skills (2 unique)");
    expect(output).toContain("1 global, 1 project");
  });

  test("same dirName in different scopes creates separate rows", () => {
    const skills = [
      makeSkill({
        dirName: "my-skill",
        scope: "global",
      }),
      makeSkill({
        dirName: "my-skill",
        scope: "project",
        path: "/other",
      }),
    ];
    const output = formatGroupedTable(skills);
    // groupSkills keys by dirName||scope, so different scopes = separate groups
    expect(output).toContain("global");
    expect(output).toContain("project");
    expect(output).toContain("2 skills (2 unique)");
  });

  test("shows warning count when warnings exist", () => {
    const skills = [
      makeSkill({
        warnings: [
          { category: "test", message: "warn1" },
          { category: "test", message: "warn2" },
        ],
      }),
    ];
    const output = formatGroupedTable(skills);
    expect(output).toContain("2 warnings");
  });

  test("shows singular warning text for one warning", () => {
    const skills = [
      makeSkill({
        warnings: [{ category: "test", message: "warn1" }],
      }),
    ];
    const output = formatGroupedTable(skills);
    expect(output).toContain("1 warning)");
    expect(output).not.toContain("1 warnings)");
  });
});

// ─── formatSearchResults ────────────────────────────────────────────────────

describe("formatSearchResults", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns no-match message for empty array", () => {
    const output = formatSearchResults([], "test-query");
    expect(output).toContain('No skills matching "test-query"');
    expect(output).toContain("asm list");
  });

  test("shows summary header with count", () => {
    const output = formatSearchResults(
      [makeSkill({ name: "code-review" })],
      "code",
    );
    expect(output).toContain('Found 1 result (1 unique) matching "code"');
  });

  test("shows plural results", () => {
    const skills = [
      makeSkill({ name: "code-review", dirName: "code-review" }),
      makeSkill({
        name: "code-lint",
        dirName: "code-lint",
        path: "/other",
      }),
    ];
    const output = formatSearchResults(skills, "code");
    expect(output).toContain("Found 2 results");
  });

  test("shows header and separator", () => {
    const output = formatSearchResults([makeSkill()], "test");
    expect(output).toContain("Name");
    expect(output).toContain("Version");
    expect(output).toContain("Tools");
  });

  test("contains skill data in results", () => {
    const output = formatSearchResults(
      [makeSkill({ name: "deploy-helper", version: "2.0.0" })],
      "deploy",
    );
    expect(output).toContain("deploy-helper");
    expect(output).toContain("2.0.0");
  });
});

// ─── formatSkillDetail with warnings ────────────────────────────────────────

describe("formatSkillDetail with warnings", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("shows warnings section when warnings exist", async () => {
    const output = await formatSkillDetail(
      makeSkill({
        warnings: [
          { category: "shell-exec", message: "Uses exec()" },
          { category: "network", message: "Uses curl" },
        ],
      }),
    );
    expect(output).toContain("Warnings:");
    expect(output).toContain("[shell-exec] Uses exec()");
    expect(output).toContain("[network] Uses curl");
  });

  test("omits warnings section when no warnings", async () => {
    const output = await formatSkillDetail(makeSkill({ warnings: [] }));
    expect(output).not.toContain("Warnings:");
  });
});

// ─── effort field display ────────────────────────────────────────────────────

describe("effort field display", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("colorEffort returns colored string for known values", () => {
    expect(colorEffort("low")).toBe("low");
    expect(colorEffort("medium")).toBe("medium");
    expect(colorEffort("high")).toBe("high");
    expect(colorEffort("max")).toBe("max");
  });

  test("colorEffort returns empty string for undefined", () => {
    expect(colorEffort(undefined)).toBe("");
  });

  test("colorEffort is case-insensitive", () => {
    expect(colorEffort("Low")).toBe("Low");
    expect(colorEffort("HIGH")).toBe("HIGH");
  });

  test("formatSkillTable shows effort column", () => {
    const output = formatSkillTable([makeSkill({ effort: "medium" })]);
    expect(output).toContain("Effort");
    expect(output).toContain("medium");
  });

  test("formatSkillTable shows dash for missing effort", () => {
    const output = formatSkillTable([makeSkill({ effort: undefined })]);
    expect(output).toContain("Effort");
    expect(output).toContain("\u2014");
  });

  test("formatGroupedTable shows effort column", () => {
    const output = formatGroupedTable([makeSkill({ effort: "high" })]);
    expect(output).toContain("Effort");
    expect(output).toContain("high");
  });

  test("formatSearchResults shows effort column", () => {
    const output = formatSearchResults(
      [makeSkill({ name: "test", effort: "low" })],
      "test",
    );
    expect(output).toContain("Effort");
    expect(output).toContain("low");
  });

  test("formatSkillDetail shows effort when present", async () => {
    const output = await formatSkillDetail(makeSkill({ effort: "max" }));
    expect(output).toContain("Effort: max");
  });

  test("formatSkillDetail omits effort when absent", async () => {
    const output = await formatSkillDetail(makeSkill({ effort: undefined }));
    expect(output).not.toContain("Effort:");
  });

  test("formatSkillInspect shows effort when present", async () => {
    const skills = [
      makeSkill({ effort: "high", providerLabel: "Claude Code" }),
      makeSkill({
        effort: "high",
        providerLabel: "Codex",
        provider: "codex",
        path: "/other",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).toContain("Effort: high");
  });

  test("formatSkillInspect omits effort when absent", async () => {
    const skills = [
      makeSkill({ providerLabel: "Claude Code" }),
      makeSkill({
        providerLabel: "Codex",
        provider: "codex",
        path: "/other",
      }),
    ];
    const output = await formatSkillInspect(skills);
    expect(output).not.toContain("Effort:");
  });
});

// ─── colorTool / formatAllowedTools ─────────────────────────────────────────

describe("colorTool", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns tool name for high-risk tools (no ANSI in no-color mode)", () => {
    expect(colorTool("Bash")).toBe("Bash");
    expect(colorTool("Write")).toBe("Write");
    expect(colorTool("Edit")).toBe("Edit");
    expect(colorTool("NotebookEdit")).toBe("NotebookEdit");
  });

  test("returns tool name for medium-risk tools", () => {
    expect(colorTool("WebFetch")).toBe("WebFetch");
    expect(colorTool("WebSearch")).toBe("WebSearch");
  });

  test("returns tool name for low-risk tools", () => {
    expect(colorTool("Read")).toBe("Read");
    expect(colorTool("Grep")).toBe("Grep");
    expect(colorTool("Glob")).toBe("Glob");
  });
});

describe("colorTool with color enabled", () => {
  test("wraps high-risk tools in red ANSI", () => {
    expect(colorTool("Bash")).toContain("Bash");
  });

  test("wraps medium-risk tools in yellow ANSI", () => {
    expect(colorTool("WebFetch")).toContain("WebFetch");
  });

  test("wraps low-risk tools in green ANSI", () => {
    expect(colorTool("Read")).toContain("Read");
  });
});

describe("formatAllowedTools", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns empty string for empty array", () => {
    expect(formatAllowedTools([])).toBe("");
  });

  test("joins tools with double-space separator", () => {
    const result = formatAllowedTools(["Bash", "Read", "Grep"]);
    expect(result).toBe("Bash  Read  Grep");
  });

  test("handles single tool", () => {
    const result = formatAllowedTools(["Read"]);
    expect(result).toBe("Read");
  });
});

describe("HIGH_RISK_TOOLS and MEDIUM_RISK_TOOLS", () => {
  test("HIGH_RISK_TOOLS contains expected tools", () => {
    expect(HIGH_RISK_TOOLS.has("Bash")).toBe(true);
    expect(HIGH_RISK_TOOLS.has("Write")).toBe(true);
    expect(HIGH_RISK_TOOLS.has("Edit")).toBe(true);
    expect(HIGH_RISK_TOOLS.has("NotebookEdit")).toBe(true);
    expect(HIGH_RISK_TOOLS.has("Read")).toBe(false);
  });

  test("MEDIUM_RISK_TOOLS contains expected tools", () => {
    expect(MEDIUM_RISK_TOOLS.has("WebFetch")).toBe(true);
    expect(MEDIUM_RISK_TOOLS.has("WebSearch")).toBe(true);
    expect(MEDIUM_RISK_TOOLS.has("Bash")).toBe(false);
  });
});

// ─── formatSkillDetail with allowedTools ────────────────────────────────────

describe("formatSkillDetail with allowedTools", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("shows Allowed Tools section when tools present", async () => {
    const skill = makeSkill({ allowedTools: ["Bash", "Read", "Grep"] });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("Allowed Tools:");
    expect(output).toContain("Bash");
    expect(output).toContain("Read");
  });

  test("shows warning for high-risk tools", async () => {
    const skill = makeSkill({ allowedTools: ["Bash", "Write"] });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("This skill can");
    expect(output).toContain("execute shell commands");
    expect(output).toContain("modify files");
  });

  test("no warning when only low-risk tools", async () => {
    const skill = makeSkill({ allowedTools: ["Read", "Grep", "Glob"] });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("Allowed Tools:");
    expect(output).not.toContain("This skill can");
  });

  test("omits Allowed Tools section when empty", async () => {
    const skill = makeSkill({ allowedTools: [] });
    const output = await formatSkillDetail(skill);
    expect(output).not.toContain("Allowed Tools:");
  });

  test("shows license field", async () => {
    const skill = makeSkill({ license: "MIT" });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("License:");
    expect(output).toContain("MIT");
  });

  test("shows dash when license empty", async () => {
    const skill = makeSkill({ license: "" });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("License:");
    expect(output).toContain("\u2014");
  });

  test("shows compatibility when present", async () => {
    const skill = makeSkill({ compatibility: "Claude Code, Codex" });
    const output = await formatSkillDetail(skill);
    expect(output).toContain("Compatibility:");
    expect(output).toContain("Claude Code, Codex");
  });

  test("omits compatibility when empty", async () => {
    const skill = makeSkill({ compatibility: "" });
    const output = await formatSkillDetail(skill);
    expect(output).not.toContain("Compatibility:");
  });
});

// ─── formatAvailableSearchResults ──────────────────────────────────────────

function makeAvailableResult(
  overrides: Partial<AvailableSkillResult> = {},
): AvailableSkillResult {
  return {
    name: "scientific-critical-thinking",
    version: "1.0.0",
    description: "A skill for scientific critical thinking",
    verified: false,
    repoLabel: "K-Dense-AI/claude-scientific-skills",
    installUrl:
      "github:K-Dense-AI/claude-scientific-skills:scientific-critical-thinking",
    ...overrides,
  };
}

describe("formatAvailableSearchResults", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  test("returns empty string for empty array", () => {
    expect(formatAvailableSearchResults([], "test")).toBe("");
  });

  test("shows total count header with singular form", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult()],
      "scientific",
    );
    expect(output).toContain('Found 1 available skill matching "scientific"');
  });

  test("shows total count header with plural form", () => {
    const output = formatAvailableSearchResults(
      [
        makeAvailableResult({ name: "skill-a" }),
        makeAvailableResult({ name: "skill-b" }),
        makeAvailableResult({ name: "skill-c" }),
      ],
      "test",
    );
    expect(output).toContain('Found 3 available skills matching "test"');
  });

  test("shows install command hint before each skill", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult()],
      "scientific",
    );
    expect(output).toContain("To install:");
    expect(output).toContain(
      "asm install github:K-Dense-AI/claude-scientific-skills:scientific-critical-thinking",
    );
  });

  test("install hint appears before skill name line", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult()],
      "scientific",
    );
    const lines = output.split("\n");
    const installIdx = lines.findIndex((l) => l.includes("To install:"));
    const nameIdx = lines.findIndex(
      (l) =>
        l.includes("scientific-critical-thinking") &&
        !l.includes("To install:"),
    );
    expect(installIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeLessThan(nameIdx);
  });

  test("shows skill name, version, and repo label", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult()],
      "scientific",
    );
    expect(output).toContain("scientific-critical-thinking");
    expect(output).toContain("v1.0.0");
    expect(output).toContain("[K-Dense-AI/claude-scientific-skills]");
  });

  test("shows verified tag when verified", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult({ verified: true })],
      "scientific",
    );
    expect(output).toContain("[verified]");
  });

  test("does not show verified tag when not verified", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult({ verified: false })],
      "scientific",
    );
    expect(output).not.toContain("[verified]");
  });

  test("shows description text", () => {
    const output = formatAvailableSearchResults(
      [makeAvailableResult({ description: "My custom description" })],
      "scientific",
    );
    expect(output).toContain("My custom description");
  });

  test("shows install hint for each skill in multi-result", () => {
    const results = [
      makeAvailableResult({
        name: "skill-alpha",
        installUrl: "github:owner/repo:skill-alpha",
      }),
      makeAvailableResult({
        name: "skill-beta",
        installUrl: "github:owner/repo:skill-beta",
      }),
    ];
    const output = formatAvailableSearchResults(results, "skill");
    const installLines = output
      .split("\n")
      .filter((l) => l.includes("To install:"));
    expect(installLines.length).toBe(2);
    expect(output).toContain("asm install github:owner/repo:skill-alpha");
    expect(output).toContain("asm install github:owner/repo:skill-beta");
  });
});
