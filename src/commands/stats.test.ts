import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { IndexedSkill, RepoIndex } from "../utils/types";

/**
 * Minimal `IndexedSkill` fixture. Only `name`/`relPath`/`tokenCount`/`verified`
 * matter to the stats math; the rest are required by the interface, so they get
 * inert defaults rather than a cast.
 */
function makeSkill(
  name: string,
  description: string,
  relPath: string,
  tokenCount: number,
  verified: boolean,
): IndexedSkill {
  return {
    name,
    description,
    relPath,
    tokenCount,
    verified,
    version: "1.0.0",
    license: "MIT",
    creator: "test",
    compatibility: "claude-code",
    allowedTools: [],
    installUrl: `https://example.com/${relPath}`,
  };
}

// Mock loadAllIndices before importing cmdStatsAuthor
const mockIndices: RepoIndex[] = [
  {
    owner: "anthropic",
    repo: "claude-skills",
    repoUrl: "https://github.com/anthropic/claude-skills",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skillCount: 15,
    skills: [
      makeSkill("test-skill-1", "Test skill 1", "skills/test-1", 100, true),
      makeSkill("test-skill-2", "Test skill 2", "skills/test-2", 200, false),
    ],
  },
  {
    owner: "anthropic",
    repo: "other-skills",
    repoUrl: "https://github.com/anthropic/other-skills",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skillCount: 8,
    skills: [
      makeSkill("other-skill", "Other skill", "skills/other", 150, true),
    ],
  },
  {
    owner: "luongnv89",
    repo: "asm",
    repoUrl: "https://github.com/luongnv89/asm",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skillCount: 5,
    skills: [makeSkill("asm-skill", "ASM skill", "skills/asm", 300, true)],
  },
  {
    owner: "google",
    repo: "gemini-skills",
    repoUrl: "https://github.com/google/gemini-skills",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skillCount: 12,
    skills: [
      makeSkill("gemini-skill", "Gemini skill", "skills/gemini", 250, false),
    ],
  },
  {
    owner: "microsoft",
    repo: "copilot-skills",
    repoUrl: "https://github.com/microsoft/copilot-skills",
    updatedAt: "2026-01-01T00:00:00.000Z",
    skillCount: 3,
    skills: [
      makeSkill("copilot-skill", "Copilot skill", "skills/copilot", 180, false),
    ],
  },
];

vi.mock("../skill-index", () => ({
  loadAllIndices: vi.fn().mockResolvedValue(mockIndices),
}));

describe("cmdStatsAuthor", () => {
  let stderrOutput: string;
  let exitCode: string | number | null | undefined;

  beforeEach(() => {
    stderrOutput = "";
    exitCode = undefined;
    vi.spyOn(console, "error").mockImplementation((...args) => {
      stderrOutput += args.map(String).join(" ") + "\n";
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode = code;
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows error with available authors when author not found", async () => {
    const { cmdStatsAuthor } = await import("./stats");
    const { parseArgs } = await import("../cli");

    const args = parseArgs([
      "node",
      "asm",
      "stats",
      "author",
      "unknown-author",
    ]);

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
    const { parseArgs } = await import("../cli");

    const args = parseArgs(["node", "asm", "stats", "author", "nonexistent"]);

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
