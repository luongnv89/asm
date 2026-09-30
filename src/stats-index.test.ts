import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeRepoStats,
  computeAuthorStats,
  computeIndexStats,
  formatRepoStatsReport,
  formatAuthorStatsReport,
  formatIndexStatsReport,
} from "./stats-index";
import type {
  RepoStatsReport,
  AuthorStatsReport,
  IndexStatsReport,
} from "./utils/types";
import { makeRepoIndex } from "./stats-test-fixtures";
describe("computeRepoStats", () => {
  it("returns empty array for no indices", () => {
    const result = computeRepoStats([]);
    expect(result).toEqual([]);
  });

  it("computes stats for a single repo", () => {
    const index = makeRepoIndex({
      owner: "anthropics",
      repo: "skills",
      skills: [
        {
          name: "code-review",
          description: "Code review best practices",
          version: "1.0.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: ["read", "edit", "str_replace_editor"],
          installUrl: "github:anthropics/skills:skills/code-review",
          relPath: "skills/code-review",
          verified: true,
          tokenCount: 1200,
        },
        {
          name: "openspec",
          description: "OpenSpec workflow for spec-driven development",
          version: "0.2.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: ["read", "write", "edit"],
          installUrl: "github:anthropics/skills:skills/openspec",
          relPath: "skills/openspec",
          verified: false,
          tokenCount: 3500,
        },
      ],
    });

    const result = computeRepoStats([index]);
    expect(result).toHaveLength(1);
    expect(result[0].owner).toBe("anthropics");
    expect(result[0].repo).toBe("skills");
    expect(result[0].skillCount).toBe(2);
    expect(result[0].verifiedCount).toBe(1);
    expect(result[0].totalTokens).toBe(4700);
    expect(result[0].categories["coding"]).toBe(1);
  });

  it("sorts repos by skill count descending", () => {
    const indexA = makeRepoIndex({
      owner: "user",
      repo: "small",
      skills: [
        {
          name: "a",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user/small:a",
          relPath: "a",
        },
      ],
    });
    const indexB = makeRepoIndex({
      owner: "user",
      repo: "big",
      skills: [
        {
          name: "a",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user/big:a",
          relPath: "a",
        },
        {
          name: "b",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user/big:b",
          relPath: "b",
        },
        {
          name: "c",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user/big:c",
          relPath: "c",
        },
      ],
    });

    const result = computeRepoStats([indexA, indexB]);
    expect(result[0].repo).toBe("big");
    expect(result[1].repo).toBe("small");
  });

  it("handles skills with evalSummary", () => {
    const index = makeRepoIndex({
      owner: "test",
      repo: "eval-repo",
      skills: [
        {
          name: "skill-a",
          description: "A skill",
          version: "1.0.0",
          license: "MIT",
          creator: "test",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:test/eval-repo:skill-a",
          relPath: "skill-a",
          evalSummary: {
            overallScore: 90,
            grade: "A",
            categories: [],
            evaluatedAt: new Date().toISOString(),
          },
        },
        {
          name: "skill-b",
          description: "B skill",
          version: "1.0.0",
          license: "MIT",
          creator: "test",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:test/eval-repo:skill-b",
          relPath: "skill-b",
          evalSummary: {
            overallScore: 75,
            grade: "C",
            categories: [],
            evaluatedAt: new Date().toISOString(),
          },
        },
      ],
    });

    const result = computeRepoStats([index]);
    expect(result[0].avgEvalScore).toBe(83);
  });
});

// ─── computeAuthorStats ──────────────────────────────────────────────────────

describe("computeAuthorStats", () => {
  it("returns empty array for no indices", () => {
    const result = computeAuthorStats([]);
    expect(result).toEqual([]);
  });

  it("aggregates across multiple repos for same author", () => {
    const index1 = makeRepoIndex({
      owner: "anthropics",
      repo: "skills",
      skills: [
        {
          name: "code-review",
          description: "Code review",
          version: "1.0.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:anthropics/skills:cr",
          relPath: "cr",
        },
      ],
    });
    const index2 = makeRepoIndex({
      owner: "anthropics",
      repo: "more-skills",
      skills: [
        {
          name: "openspec",
          description: "OpenSpec workflow",
          version: "0.2.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:anthropics/more-skills:os",
          relPath: "os",
        },
        {
          name: "eval",
          description: "Eval best practices",
          version: "1.0.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:anthropics/more-skills:eval",
          relPath: "eval",
        },
      ],
    });

    const result = computeAuthorStats([index1, index2]);
    expect(result).toHaveLength(1);
    expect(result[0].owner).toBe("anthropics");
    expect(result[0].totalSkills).toBe(3);
    expect(result[0].repos).toContain("anthropics/skills");
    expect(result[0].repos).toContain("anthropics/more-skills");
    expect(result[0].repos).toHaveLength(2);
  });

  it("sorts authors by total skills descending", () => {
    const indexA = makeRepoIndex({
      owner: "big-author",
      repo: "repo-a",
      skills: [
        {
          name: "a",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:big-author/repo-a:a",
          relPath: "a",
        },
        {
          name: "b",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:big-author/repo-a:b",
          relPath: "b",
        },
      ],
    });
    const indexB = makeRepoIndex({
      owner: "small-author",
      repo: "repo-b",
      skills: [
        {
          name: "x",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:small-author/repo-b:x",
          relPath: "x",
        },
      ],
    });

    const result = computeAuthorStats([indexA, indexB]);
    expect(result[0].owner).toBe("big-author");
    expect(result[1].owner).toBe("small-author");
  });

  it("handles multiple authors", () => {
    const indexA = makeRepoIndex({
      owner: "user-a",
      repo: "repo-a",
      skills: [
        {
          name: "a",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user-a/repo-a:a",
          relPath: "a",
        },
      ],
    });
    const indexB = makeRepoIndex({
      owner: "user-b",
      repo: "repo-b",
      skills: [
        {
          name: "b",
          description: "",
          version: "1.0.0",
          license: "MIT",
          creator: "",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:user-b/repo-b:b",
          relPath: "b",
        },
      ],
    });

    const result = computeAuthorStats([indexA, indexB]);
    expect(result).toHaveLength(2);
    const owners = result.map((r) => r.owner);
    expect(owners).toContain("user-a");
    expect(owners).toContain("user-b");
  });
});

// ─── computeIndexStats ───────────────────────────────────────────────────────

describe("computeIndexStats", () => {
  it("returns empty stats for no indices", () => {
    const result = computeIndexStats([]);
    expect(result.totalRepos).toBe(0);
    expect(result.totalSkills).toBe(0);
    expect(result.totalAuthors).toBe(0);
    expect(result.verifiedCount).toBe(0);
    expect(result.avgTokensPerSkill).toBe(0);
  });

  it("computes aggregate stats across all indices", () => {
    const index1 = makeRepoIndex({
      owner: "anthropics",
      repo: "skills",
      skills: [
        {
          name: "code-review",
          description: "Code review",
          version: "1.0.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:anthropics/skills:cr",
          relPath: "cr",
          verified: true,
          tokenCount: 1200,
        },
        {
          name: "openspec",
          description: "OpenSpec workflow",
          version: "0.2.0",
          license: "MIT",
          creator: "anthropics",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:anthropics/skills:os",
          relPath: "os",
          tokenCount: 3500,
        },
      ],
    });
    const index2 = makeRepoIndex({
      owner: "luongnv89",
      repo: "asm",
      skills: [
        {
          name: "hello-world",
          description: "Hello world skill",
          version: "1.0.0",
          license: "MIT",
          creator: "luongnv89",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:luongnv89/asm:h",
          relPath: "h",
          tokenCount: 500,
        },
      ],
    });

    const result = computeIndexStats([index1, index2]);
    expect(result.totalRepos).toBe(2);
    expect(result.totalSkills).toBe(3);
    expect(result.totalAuthors).toBe(2);
    expect(result.verifiedCount).toBe(1);
    expect(result.totalTokens).toBe(5200);
    expect(result.avgTokensPerSkill).toBe(1733);
  });

  it("computes category distribution", () => {
    const index = makeRepoIndex({
      owner: "test",
      repo: "repo",
      skills: [
        {
          name: "code-review",
          description: "Code review best practices",
          version: "1.0.0",
          license: "MIT",
          creator: "test",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:test/repo:cr",
          relPath: "cr",
        },
        {
          name: "docker-setup",
          description: "Docker containerization",
          version: "1.0.0",
          license: "MIT",
          creator: "test",
          compatibility: "claude",
          allowedTools: [],
          installUrl: "github:test/repo:ds",
          relPath: "ds",
        },
      ],
    });

    const result = computeIndexStats([index]);
    expect(result.categoryDistribution["coding"]).toBe(1);
    expect(result.categoryDistribution["devops"]).toBe(1);
  });
});

// ─── formatRepoStatsReport ───────────────────────────────────────────────────

describe("formatRepoStatsReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  function makeReport(
    overrides: Partial<RepoStatsReport> = {},
  ): RepoStatsReport {
    return {
      owner: "anthropics",
      repo: "skills",
      repoUrl: "https://github.com/anthropics/skills",
      skillCount: 5,
      categories: { coding: 2, testing: 1, security: 1, devops: 1 },
      verifiedCount: 3,
      totalTokens: 10000,
      avgEvalScore: 85,
      ...overrides,
    };
  }

  it("includes repo name and overview", () => {
    const output = formatRepoStatsReport(makeReport());
    expect(output).toContain("Repo: anthropics/skills");
    expect(output).toContain("Skills:");
    expect(output).toContain("5");
    expect(output).toContain("Verified:");
    expect(output).toContain("3");
    expect(output).toContain("Avg Eval:");
    expect(output).toContain("85");
  });

  it("shows category distribution with bars", () => {
    const output = formatRepoStatsReport(makeReport());
    expect(output).toContain("Categories");
    expect(output).toContain("coding");
    expect(output).toContain("testing");
    expect(output).toContain("#");
  });

  it("handles zero skills", () => {
    const output = formatRepoStatsReport(
      makeReport({ skillCount: 0, categories: {}, verifiedCount: 0 }),
    );
    expect(output).toContain("Repo: anthropics/skills");
    expect(output).toContain("0");
  });
});

// ─── formatAuthorStatsReport ─────────────────────────────────────────────────

describe("formatAuthorStatsReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  function makeReport(
    overrides: Partial<AuthorStatsReport> = {},
  ): AuthorStatsReport {
    return {
      owner: "anthropics",
      totalSkills: 10,
      repos: ["anthropics/skills", "anthropics/more"],
      categories: { coding: 4, testing: 3, security: 2, devops: 1 },
      verifiedCount: 7,
      totalTokens: 25000,
      topSkills: [
        { name: "code-review", repo: "anthropics/skills" },
        { name: "openspec", repo: "anthropics/skills" },
      ],
      ...overrides,
    };
  }

  it("includes author name and overview", () => {
    const output = formatAuthorStatsReport(makeReport());
    expect(output).toContain("Author: anthropics");
    expect(output).toContain("Total Skills:");
    expect(output).toContain("10");
    expect(output).toContain("Repos:");
    expect(output).toContain("2");
  });

  it("shows categories with bars", () => {
    const output = formatAuthorStatsReport(makeReport());
    expect(output).toContain("Categories");
    expect(output).toContain("coding");
    expect(output).toContain("#");
  });

  it("shows top skills", () => {
    const output = formatAuthorStatsReport(makeReport());
    expect(output).toContain("Top Skills");
    expect(output).toContain("code-review");
    expect(output).toContain("openspec");
  });

  it("handles zero skills", () => {
    const output = formatAuthorStatsReport(
      makeReport({
        totalSkills: 0,
        repos: [],
        categories: {},
        verifiedCount: 0,
        topSkills: [],
      }),
    );
    expect(output).toContain("Author: anthropics");
    expect(output).toContain("Total Skills:");
    expect(output).toContain("0");
  });
});

// ─── formatIndexStatsReport ──────────────────────────────────────────────────

describe("formatIndexStatsReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });
  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  function makeReport(
    overrides: Partial<IndexStatsReport> = {},
  ): IndexStatsReport {
    return {
      totalRepos: 5,
      totalSkills: 50,
      totalAuthors: 3,
      categoryDistribution: {
        coding: 15,
        testing: 10,
        security: 8,
        devops: 7,
        frontend: 5,
        general: 5,
      },
      verifiedCount: 20,
      totalTokens: 100000,
      avgTokensPerSkill: 2000,
      ...overrides,
    };
  }

  it("includes overview stats", () => {
    const output = formatIndexStatsReport(makeReport());
    expect(output).toContain("Index Statistics");
    expect(output).toContain("Repos:");
    expect(output).toContain("5");
    expect(output).toContain("Skills:");
    expect(output).toContain("50");
    expect(output).toContain("Authors:");
    expect(output).toContain("3");
    expect(output).toContain("Avg Tokens/Skill:");
    // Token figures render via formatTokenCount, never as a bare or byte-sized
    // number (issues #188, #421).
    expect(output).toContain("~2k tokens");
  });

  it("shows category distribution with bars", () => {
    const output = formatIndexStatsReport(makeReport());
    expect(output).toContain("Category Distribution");
    expect(output).toContain("coding");
    expect(output).toContain("#");
  });

  it("handles zero stats", () => {
    const output = formatIndexStatsReport(
      makeReport({
        totalRepos: 0,
        totalSkills: 0,
        totalAuthors: 0,
        categoryDistribution: {},
        verifiedCount: 0,
        totalTokens: 0,
        avgTokensPerSkill: 0,
      }),
    );
    expect(output).toContain("Index Statistics");
    expect(output).toContain("0");
  });
});

// ─── Attention budget (issue #421) ──────────────────────────────────────────
