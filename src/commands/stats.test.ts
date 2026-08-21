import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { ParsedArgs } from "../cli";
import type { RepoIndex } from "../utils/types";

// Mock loadAllIndices before importing cmdStatsAuthor
const mockIndices: RepoIndex[] = [
  {
    owner: "anthropic",
    repo: "claude-skills",
    url: "https://github.com/anthropic/claude-skills",
    skillCount: 15,
    skills: [
      {
        name: "test-skill-1",
        description: "Test skill 1",
        path: "skills/test-1",
        tokenCount: 100,
        verified: true,
      },
      {
        name: "test-skill-2",
        description: "Test skill 2",
        path: "skills/test-2",
        tokenCount: 200,
        verified: false,
      },
    ],
  },
  {
    owner: "anthropic",
    repo: "other-skills",
    url: "https://github.com/anthropic/other-skills",
    skillCount: 8,
    skills: [
      {
        name: "other-skill",
        description: "Other skill",
        path: "skills/other",
        tokenCount: 150,
        verified: true,
      },
    ],
  },
  {
    owner: "luongnv89",
    repo: "asm",
    url: "https://github.com/luongnv89/asm",
    skillCount: 5,
    skills: [
      {
        name: "asm-skill",
        description: "ASM skill",
        path: "skills/asm",
        tokenCount: 300,
        verified: true,
      },
    ],
  },
  {
    owner: "google",
    repo: "gemini-skills",
    url: "https://github.com/google/gemini-skills",
    skillCount: 12,
    skills: [
      {
        name: "gemini-skill",
        description: "Gemini skill",
        path: "skills/gemini",
        tokenCount: 250,
        verified: false,
      },
    ],
  },
  {
    owner: "microsoft",
    repo: "copilot-skills",
    url: "https://github.com/microsoft/copilot-skills",
    skillCount: 3,
    skills: [
      {
        name: "copilot-skill",
        description: "Copilot skill",
        path: "skills/copilot",
        tokenCount: 180,
        verified: false,
      },
    ],
  },
];

vi.mock("../skill-index", () => ({
  loadAllIndices: vi.fn().mockResolvedValue(mockIndices),
}));

describe("cmdStatsAuthor", () => {
  let stderrOutput: string;
  let exitCode: number | undefined;

  beforeEach(() => {
    stderrOutput = "";
    exitCode = undefined;
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderrOutput += args.map(String).join(" ") + "\n";
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      // @ts-expect-error — this function never returns, but TypeScript doesn't know that
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows error with available authors when author not found", async () => {
    const { cmdStatsAuthor } = await import("./stats");

    const args: ParsedArgs = {
      input: "unknown-author",
      subcommand: "author",
      positional: ["unknown-author"],
      flags: { json: false, "no-color": false, help: false },
    };

    try {
      await cmdStatsAuthor(args);
    } catch {
      // process.exit is mocked to throw — expected
    }

    expect(exitCode).toBe(1);
    expect(stderrOutput).toContain('Author "unknown-author" not found');
    expect(stderrOutput).toContain("Available authors");
    // Should list top authors sorted by skill count
    expect(stderrOutput).toContain("anthropic (3 skills)");
    expect(stderrOutput).toContain("luongnv89 (1 skills)");
    expect(stderrOutput).toContain("google (1 skills)");
    expect(stderrOutput).toContain("microsoft (1 skills)");
  });

  test("shows top 10 authors max", async () => {
    const { cmdStatsAuthor } = await import("./stats");

    const args: ParsedArgs = {
      input: "nonexistent",
      subcommand: "author",
      positional: ["nonexistent"],
      flags: { json: false, "no-color": false, help: false },
    };

    try {
      await cmdStatsAuthor(args);
    } catch {
      // process.exit is mocked to throw — expected
    }

    // Count how many author lines are in the output
    const authorLines = stderrOutput
      .split("\n")
      .filter((line) => line.match(/^\s+\w+.*skills/));
    expect(authorLines.length).toBeLessThanOrEqual(10);
  });
});
