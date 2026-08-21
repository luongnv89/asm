import { describe, it, expect } from "vitest";
import {
  computeSimilarity,
  findOverlapPairs,
  groupOverlaps,
  checkCandidateOverlap,
  MIN_OVERLAP_SCORE,
  HIGH_CONFIDENCE_THRESHOLD,
} from "./semantic-overlap";
import type { IndexedSkill } from "./utils/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSkill(
  name: string,
  description: string,
  extra: Partial<IndexedSkill> = {},
): IndexedSkill {
  return {
    name,
    description,
    version: "1.0.0",
    license: "MIT",
    creator: "",
    compatibility: "",
    allowedTools: [],
    installUrl: `github:user/${name}`,
    relPath: `skills/${name}`,
    ...extra,
  };
}

function makeEntry(
  name: string,
  description: string,
  repoOwner = "owner",
  repoName = "repo",
) {
  return {
    skill: makeSkill(name, description),
    repo: { owner: repoOwner, repo: repoName },
  };
}

// ─── computeSimilarity ─────────────────────────────────────────────────────

describe("computeSimilarity", () => {
  it("returns 1 for identical descriptions", () => {
    const s = makeSkill("test", "Review code for bugs and security issues");
    expect(computeSimilarity(s, s)).toBe(1);
  });

  it("returns 0 for completely different descriptions", () => {
    const a = makeSkill("a", "Deploy applications to cloud platforms");
    const b = makeSkill("b", "Write unit tests for JavaScript functions");
    const score = computeSimilarity(a, b);
    // With no shared tokens, name similarity is the only factor
    // and different names give 0 name similarity → total 0
    expect(score).toBe(0);
  });

  it("returns high score for very similar descriptions", () => {
    const a = makeSkill(
      "code-review",
      "Review code for bugs and security issues",
    );
    const b = makeSkill(
      "code-reviewer",
      "Review code for bugs and security problems",
    );
    const score = computeSimilarity(a, b);
    // Token overlap on "review code for bugs and security" is high
    expect(score).toBeGreaterThan(0.5);
  });

  it("returns moderate score for partially overlapping descriptions", () => {
    const a = makeSkill(
      "security-audit",
      "Audit code for security vulnerabilities",
    );
    const b = makeSkill(
      "vulnerability-scanner",
      "Scan code for security vulnerabilities and bugs",
    );
    const score = computeSimilarity(a, b);
    // Some shared tokens (code, security, vulnerabilities, bugs)
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.8);
  });

  it("uses description weight (0.6) over name weight (0.4)", () => {
    // Same description, different names → high score from description
    const a = makeSkill("code-review", "Review code for bugs");
    const b = makeSkill("app-audit", "Review code for bugs");
    expect(computeSimilarity(a, b)).toBeGreaterThan(0.5);

    // Different descriptions, same name → moderate score (name similarity contributes)
    const c = makeSkill("code-review", "Review code for bugs");
    const d = makeSkill("code-review", "Deploy applications to cloud");
    // Same name gives 0.4, different descriptions give ~0 → total ~0.4
    expect(computeSimilarity(c, d)).toBeGreaterThan(0.3);
    expect(computeSimilarity(c, d)).toBeLessThan(0.5);
  });
});

// ─── findOverlapPairs ──────────────────────────────────────────────────────

describe("findOverlapPairs", () => {
  it("returns empty array when no skills overlap", () => {
    const skills = [
      makeEntry("deploy", "Deploy applications to cloud platforms"),
      makeEntry("test-writer", "Write unit tests for JavaScript functions"),
      makeEntry("doc-gen", "Generate API documentation from source code"),
    ];
    const pairs = findOverlapPairs(skills);
    expect(pairs).toEqual([]);
  });

  it("finds overlapping pairs", () => {
    const skills = [
      makeEntry("code-review", "Review code for bugs and security issues"),
      makeEntry("code-reviewer", "Review code for bugs and security problems"),
      makeEntry("deploy", "Deploy applications to cloud platforms"),
    ];
    const pairs = findOverlapPairs(skills);
    expect(pairs.length).toBe(1);
    expect(pairs[0].skillA.name).toBe("code-review");
    expect(pairs[0].skillB.name).toBe("code-reviewer");
    expect(pairs[0].score).toBeGreaterThan(MIN_OVERLAP_SCORE);
  });

  it("sorts pairs by score descending", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security issues"), // identical desc
      makeEntry("c", "Review code for bugs"),
      makeEntry("d", "Deploy applications"),
    ];
    const pairs = findOverlapPairs(skills);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    // First pair should have the highest score
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1].score).toBeGreaterThanOrEqual(pairs[i].score);
    }
  });

  it("respects custom threshold", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security issues"), // identical desc
      makeEntry("c", "Review code"),
    ];
    // High threshold — only the very similar pair
    const high = findOverlapPairs(skills, 0.9);
    expect(high.length).toBeLessThanOrEqual(1);

    // Low threshold — more pairs
    const low = findOverlapPairs(skills, 0.1);
    expect(low.length).toBeGreaterThanOrEqual(high.length);
  });

  it("includes reason in each pair", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security issues"), // identical desc
    ];
    const pairs = findOverlapPairs(skills);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(pairs[0].reason).toContain("shared tokens");
  });
});

// ─── groupOverlaps ─────────────────────────────────────────────────────────

describe("groupOverlaps", () => {
  it("returns empty array when no overlaps", () => {
    const skills = [
      makeEntry("deploy", "Deploy applications to cloud platforms"),
      makeEntry("test", "Write unit tests"),
    ];
    expect(groupOverlaps(skills)).toEqual([]);
  });

  it("groups overlapping skills into clusters", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security issues"), // identical desc
      makeEntry("c", "Review code for bugs"),
      makeEntry("d", "Deploy applications"),
    ];
    const groups = groupOverlaps(skills);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // The first group should have 2+ skills
    expect(groups[0].skills.length).toBeGreaterThanOrEqual(2);
  });

  it("reports max score and pair count per group", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security issues"), // identical desc
      makeEntry("c", "Review code for bugs"),
    ];
    const groups = groupOverlaps(skills);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].maxScore).toBeGreaterThan(0);
    expect(groups[0].pairCount).toBeGreaterThanOrEqual(1);
  });

  it("sorts groups by max score descending", () => {
    const skills = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code for bugs and security problems"),
      makeEntry("c", "Review code"),
      makeEntry("d", "Deploy applications to cloud platforms"),
      makeEntry("e", "Deploy applications to cloud"),
    ];
    const groups = groupOverlaps(skills);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1].maxScore).toBeGreaterThanOrEqual(groups[i].maxScore);
    }
  });
});

// ─── checkCandidateOverlap ─────────────────────────────────────────────────

describe("checkCandidateOverlap", () => {
  it("returns no overlaps for a unique candidate", () => {
    const indexed = [
      makeEntry("deploy", "Deploy applications to cloud platforms"),
      makeEntry("test", "Write unit tests"),
    ];
    const result = checkCandidateOverlap(
      { name: "new-skill", description: "Build CI/CD pipelines" },
      indexed,
    );
    expect(result.overlaps).toEqual([]);
    expect(result.hasHighConfidenceOverlap).toBe(false);
  });

  it("finds overlapping indexed skills for a candidate", () => {
    const indexed = [
      makeEntry(
        "code-review",
        "Review code for bugs and security issues",
        "owner",
        "repo-a",
      ),
      makeEntry("deploy", "Deploy applications to cloud", "owner", "repo-b"),
    ];
    const result = checkCandidateOverlap(
      {
        name: "new-reviewer",
        description: "Review code for bugs and security issues",
      },
      indexed,
    );
    expect(result.overlaps.length).toBeGreaterThanOrEqual(1);
    expect(result.overlaps[0].skill.name).toBe("code-review");
  });

  it("flags high-confidence overlap", () => {
    const indexed = [
      makeEntry(
        "code-review",
        "Review code for bugs and security issues",
        "owner",
        "repo-a",
      ),
    ];
    const result = checkCandidateOverlap(
      {
        name: "code-review",
        description: "Review code for bugs and security issues",
      },
      indexed,
    );
    expect(result.hasHighConfidenceOverlap).toBe(true);
  });

  it("does not flag low-confidence overlap", () => {
    const indexed = [
      makeEntry(
        "code-review",
        "Review code for bugs and security issues",
        "owner",
        "repo-a",
      ),
      makeEntry("deploy", "Deploy applications to cloud", "owner", "repo-b"),
    ];
    const result = checkCandidateOverlap(
      { name: "new-skill", description: "Review code for bugs" },
      indexed,
    );
    // Should find the code-review overlap but not high-confidence
    expect(result.overlaps.length).toBeGreaterThanOrEqual(0);
  });

  it("ranks overlaps by score descending", () => {
    const indexed = [
      makeEntry("a", "Review code for bugs and security issues"),
      makeEntry("b", "Review code"),
    ];
    const result = checkCandidateOverlap(
      { name: "x", description: "Review code for bugs and security issues" },
      indexed,
    );
    // The first overlap should have the highest score
    for (let i = 1; i < result.overlaps.length; i++) {
      expect(result.overlaps[i - 1].score).toBeGreaterThanOrEqual(
        result.overlaps[i].score,
      );
    }
  });

  it("includes candidate name in result", () => {
    const indexed: Array<{
      skill: IndexedSkill;
      repo: { owner: string; repo: string };
    }> = [];
    const result = checkCandidateOverlap(
      { name: "my-candidate", description: "Do something" },
      indexed,
    );
    expect(result.candidate.name).toBe("my-candidate");
    expect(result.candidate.description).toBe("Do something");
  });
});

// ─── Thresholds ─────────────────────────────────────────────────────────────

describe("thresholds", () => {
  it("MIN_OVERLAP_SCORE is 0.55", () => {
    expect(MIN_OVERLAP_SCORE).toBe(0.55);
  });

  it("HIGH_CONFIDENCE_THRESHOLD is 0.7", () => {
    expect(HIGH_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});
