import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  formatSkillTable,
  formatSkillDetail,
  formatJSON,
  ansi,
} from "./formatter";
import type { SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
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
    expect(output).toContain("Provider");
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

  test("shows all six columns", () => {
    const output = formatSkillTable([makeSkill()]);
    const headerLine = output.split("\n")[0];
    expect(headerLine).toContain("Name");
    expect(headerLine).toContain("Version");
    expect(headerLine).toContain("Provider");
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
    expect(output).toContain("Provider: Claude Code");
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
