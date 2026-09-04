import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAP_THRESHOLD,
  HIGH_CONFIDENCE_OVERLAP_THRESHOLD,
  buildIdfWeights,
  computeInstalledOverlapScore,
  dedupeForComparison,
  detectSemanticOverlaps,
  formatOverlapReport,
  formatOverlapReportJSON,
} from "./installed-overlap";
import type { InstalledOverlapReport, SkillInfo } from "./utils/types";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/home/user/.claude/skills/test-skill";
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path,
    originalPath: path,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: path,
    ...overrides,
  };
}

describe("buildIdfWeights", () => {
  it("collapses to weight 1 when every token appears in every skill", () => {
    const weights = buildIdfWeights([
      new Set(["shared", "alpha"]),
      new Set(["shared", "beta"]),
      new Set(["shared", "gamma"]),
    ]);
    expect(weights.get("shared")).toBeCloseTo(1, 10);
  });

  it("gives rare tokens more weight than common ones", () => {
    const weights = buildIdfWeights([
      new Set(["common", "rare-a"]),
      new Set(["common", "rare-b"]),
    ]);
    expect(weights.get("rare-a")!).toBeGreaterThan(weights.get("common")!);
  });

  it("returns an empty map for an empty corpus", () => {
    expect(buildIdfWeights([]).size).toBe(0);
  });
});

describe("computeInstalledOverlapScore", () => {
  const weights = buildIdfWeights([
    new Set(["kubernetes", "manifests", "deploy"]),
    new Set(["docker", "images", "build"]),
    new Set(["kubernetes", "deployments", "rollout"]),
  ]);

  it("scores identical name+description at 1", () => {
    const score = computeInstalledOverlapScore(
      "kube-deploy",
      "Deploy kubernetes manifests",
      "kube-deploy",
      "Deploy kubernetes manifests",
      weights,
    );
    expect(score).toBe(1);
  });

  it("caps different-name identical descriptions at the description weight", () => {
    const score = computeInstalledOverlapScore(
      "alpha-tools",
      "Deploy kubernetes manifests",
      "beta-kit",
      "Deploy kubernetes manifests",
      weights,
    );
    expect(score).toBeCloseTo(0.6, 10);
  });

  it("scores unrelated descriptions near 0", () => {
    const score = computeInstalledOverlapScore(
      "a",
      "Deploy kubernetes manifests",
      "b",
      "Build docker images",
      weights,
    );
    expect(score).toBeLessThan(0.2);
  });

  it("down-weights boilerplate so filler-only overlap scores low", () => {
    // Same corpus trick: pretend every skill contains the boilerplate terms.
    const boilerHeavy = buildIdfWeights([
      new Set(["use", "this", "skill", "provides", "kubernetes"]),
      new Set(["use", "this", "skill", "provides", "photography"]),
      new Set(["use", "this", "skill", "provides", "cooking"]),
    ]);
    const score = computeInstalledOverlapScore(
      "a",
      "Use this skill — provides help",
      "b",
      "Use this skill — provides help",
      boilerHeavy,
    );
    // All shared tokens are boilerplate with weight 1; nothing distinctive.
    expect(score).toBeLessThan(DEFAULT_OVERLAP_THRESHOLD);
  });

  it("returns 0 for two empty descriptions", () => {
    const score = computeInstalledOverlapScore("a", "", "b", "", weights);
    expect(score).toBe(0);
  });
});

describe("dedupeForComparison", () => {
  it("collapses same-realPath rows across providers to one unit", () => {
    const skills = [
      makeSkill({ provider: "claude", path: "/lib/foo", realPath: "/lib/foo" }),
      makeSkill({
        provider: "codex",
        path: "/home/.codex/skills/foo",
        realPath: "/lib/foo",
        isSymlink: true,
        symlinkTarget: "/lib/foo",
      }),
    ];
    expect(dedupeForComparison(skills)).toHaveLength(1);
  });

  it("keeps distinct realPaths as separate units", () => {
    const skills = [
      makeSkill({ path: "/a", realPath: "/a" }),
      makeSkill({ path: "/b", realPath: "/b" }),
    ];
    expect(dedupeForComparison(skills)).toHaveLength(2);
  });

  it("prefers the non-symlink row for a shared realPath", () => {
    const skills = [
      makeSkill({
        path: "/link",
        realPath: "/real",
        isSymlink: true,
        symlinkTarget: "/real",
      }),
      makeSkill({ path: "/real", realPath: "/real" }),
    ];
    const [kept] = dedupeForComparison(skills);
    expect(kept.isSymlink).toBe(false);
    expect(kept.path).toBe("/real");
  });
});

describe("detectSemanticOverlaps", () => {
  it("returns an empty report for no installed skills", () => {
    const report = detectSemanticOverlaps([]);
    expect(report.totalSkills).toBe(0);
    expect(report.comparedSkills).toBe(0);
    expect(report.pairs).toHaveLength(0);
    expect(report.highConfidenceCount).toBe(0);
    expect(report.scannedAt).toBeTruthy();
  });

  it("finds different-name skills doing the same job", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "kube-helper",
        dirName: "kube-helper",
        path: "/a",
        realPath: "/a",
        description:
          "Manage kubernetes deployments: apply manifests, roll out updates and debug pods in a cluster.",
      }),
      makeSkill({
        name: "cluster-ops",
        dirName: "cluster-ops",
        path: "/b",
        realPath: "/b",
        description:
          "Operate kubernetes deployments — apply manifests, roll out releases and debug pods.",
      }),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].score).toBeGreaterThanOrEqual(
      DEFAULT_OVERLAP_THRESHOLD,
    );
    expect(report.pairs[0].highConfidence).toBe(false);
  });

  it("flags near-identical descriptions as high confidence", () => {
    const description =
      "Manage kubernetes deployments: apply manifests, roll out updates and debug pods in a cluster.";
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "kube-helper",
        dirName: "kube-helper",
        path: "/a",
        realPath: "/a",
        description,
      }),
      makeSkill({
        name: "cluster-ops",
        dirName: "cluster-ops",
        path: "/b",
        realPath: "/b",
        description,
      }),
    ]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].highConfidence).toBe(true);
    expect(report.highConfidenceCount).toBe(1);
  });

  it("does not flag unrelated skills", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "kube-helper",
        dirName: "kube-helper",
        path: "/a",
        realPath: "/a",
        description:
          "Manage kubernetes deployments: apply manifests and roll out updates.",
      }),
      makeSkill({
        name: "sous-chef",
        dirName: "sous-chef",
        path: "/b",
        realPath: "/b",
        description:
          "Suggest dinner recipes from pantry ingredients with step-by-step cooking timers.",
      }),
    ]);
    expect(report.pairs).toHaveLength(0);
  });

  it("skips same-normalized-name pairs — duplicates territory", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "Code Review",
        dirName: "code-review",
        path: "/a",
        realPath: "/a",
        description: "Reviews code for defects and style issues before merge.",
      }),
      makeSkill({
        name: "code_review",
        dirName: "code-review-2",
        path: "/b",
        realPath: "/b",
        description: "Reviews code for defects and style issues before merge.",
      }),
    ]);
    expect(report.pairs).toHaveLength(0);
  });

  it("never pairs multi-provider copies of one install against itself", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "deployer",
        dirName: "deployer",
        path: "/lib/deployer",
        realPath: "/lib/deployer",
        description: "Deploys services to production clusters safely.",
      }),
      makeSkill({
        name: "deployer",
        dirName: "deployer",
        provider: "codex",
        path: "/home/.codex/skills/deployer",
        realPath: "/lib/deployer",
        isSymlink: true,
        symlinkTarget: "/lib/deployer",
        description: "Deploys services to production clusters safely.",
      }),
    ]);
    expect(report.comparedSkills).toBe(1);
    expect(report.pairs).toHaveLength(0);
  });

  it("boilerplate-heavy descriptions do not create false pairs", () => {
    const filler =
      "Use this skill to get help. This skill provides support for your work.";
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "alpha",
        dirName: "alpha",
        path: "/a",
        realPath: "/a",
        description: filler,
      }),
      makeSkill({
        name: "beta",
        dirName: "beta",
        path: "/b",
        realPath: "/b",
        description: filler,
      }),
    ]);
    expect(report.pairs).toHaveLength(0);
  });

  it("ranks pairs by score descending", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "md-format",
        dirName: "md-format",
        path: "/a",
        realPath: "/a",
        description:
          "Format markdown tables, sort sections and fix heading levels in documents.",
      }),
      makeSkill({
        name: "strong-pair-a",
        dirName: "strong-pair-a",
        path: "/b",
        realPath: "/b",
        description:
          "Manage kubernetes deployments: apply manifests, roll out updates and debug pods.",
      }),
      makeSkill({
        name: "strong-pair-b",
        dirName: "strong-pair-b",
        path: "/c",
        realPath: "/c",
        description:
          "Operate kubernetes deployments — apply manifests, roll out releases, debug pods.",
      }),
      makeSkill({
        name: "pdf-export",
        dirName: "pdf-export",
        path: "/d",
        realPath: "/d",
        description:
          "Convert markdown notes to a shareable PDF deck with one command.",
      }),
    ]);
    expect(report.pairs.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < report.pairs.length; i++) {
      expect(report.pairs[i - 1].score).toBeGreaterThanOrEqual(
        report.pairs[i].score,
      );
    }
    // The paraphrased same-job pair outranks the incidental markdown share.
    const top = report.pairs[0];
    expect([top.a.name, top.b.name].sort().join("/")).toBe(
      "strong-pair-a/strong-pair-b",
    );
  });

  it("respects an explicit threshold", () => {
    const skills = [
      makeSkill({
        name: "kube-helper",
        dirName: "kube-helper",
        path: "/a",
        realPath: "/a",
        description:
          "Manage kubernetes deployments: apply manifests, roll out updates and debug pods.",
      }),
      makeSkill({
        name: "cluster-ops",
        dirName: "cluster-ops",
        path: "/b",
        realPath: "/b",
        description:
          "Operate kubernetes deployments — apply manifests, roll out releases and debug pods.",
      }),
    ];
    const strict = detectSemanticOverlaps(skills, 0.99);
    expect(strict.pairs).toHaveLength(0);
    const loose = detectSemanticOverlaps(skills, 0.01);
    expect(loose.pairs).toHaveLength(1);
  });

  it("explains the overlap with distinctive shared terms", () => {
    const report = detectSemanticOverlaps(
      [
        makeSkill({
          name: "kube-helper",
          dirName: "kube-helper",
          path: "/a",
          realPath: "/a",
          description:
            "Manage kubernetes deployments: apply manifests, roll out updates and debug pods.",
        }),
        makeSkill({
          name: "cluster-ops",
          dirName: "cluster-ops",
          path: "/b",
          realPath: "/b",
          description:
            "Operate kubernetes deployments — apply manifests, roll out releases and debug pods.",
        }),
      ],
      0.01,
    );
    expect(report.pairs[0].reason).toMatch(/shared terms/i);
    expect(report.pairs[0].reason).toMatch(
      /kubernetes|deployments|manifests|apply/i,
    );
  });

  it("credits the name side when descriptions share no distinctive terms", () => {
    const report = detectSemanticOverlaps(
      [
        makeSkill({
          name: "kube-helper",
          dirName: "kube-helper",
          path: "/a",
          realPath: "/a",
          description: "Manage kubernetes deployments and debug pods.",
        }),
        makeSkill({
          name: "helper-kube",
          dirName: "helper-kube",
          path: "/b",
          realPath: "/b",
          description: "Cook dinner recipes from pantry ingredients.",
        }),
      ],
      0.01,
    );
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0].reason).toMatch(/similar names/i);
    expect(report.pairs[0].reason).not.toMatch(/near-identical/i);
  });
});

describe("formatOverlapReport", () => {
  it("shows the empty-set sentence when nothing is installed", () => {
    const out = formatOverlapReport(detectSemanticOverlaps([]));
    expect(out).toContain("No installed skills.");
  });

  it("reports no overlaps without pairs", () => {
    const out = formatOverlapReport(
      detectSemanticOverlaps([makeSkill({ path: "/a", realPath: "/a" })]),
    );
    expect(out).toContain("No overlapping skills found.");
  });

  it("lists pair names, score, reason, paths and read-only note", () => {
    const report = detectSemanticOverlaps([
      makeSkill({
        name: "kube-helper",
        dirName: "kube-helper",
        path: "/a",
        realPath: "/a",
        description:
          "Manage kubernetes deployments: apply manifests, roll out updates and debug pods.",
      }),
      makeSkill({
        name: "cluster-ops",
        dirName: "cluster-ops",
        path: "/b",
        realPath: "/b",
        description:
          "Operate kubernetes deployments — apply manifests, roll out releases and debug pods.",
      }),
    ]);
    const out = formatOverlapReport(report as InstalledOverlapReport);
    expect(out).toContain("Semantic Overlap Audit");
    expect(out).toContain("kube-helper");
    expect(out).toContain("cluster-ops");
    expect(out).toMatch(/\d{1,3}%/);
    expect(out).toContain("/a");
    expect(out).toContain("/b");
    expect(out).toContain("Nothing was changed");
  });
});

describe("formatOverlapReportJSON", () => {
  it("emits parseable JSON with the report shape", () => {
    const json = JSON.parse(
      formatOverlapReportJSON(detectSemanticOverlaps([])),
    ) as InstalledOverlapReport;
    expect(json).toHaveProperty("scannedAt");
    expect(json).toHaveProperty("totalSkills");
    expect(json).toHaveProperty("comparedSkills");
    expect(json).toHaveProperty("pairs");
    expect(json).toHaveProperty("highConfidenceCount");
  });
});

describe("thresholds", () => {
  it("high confidence sits above the default threshold", () => {
    expect(HIGH_CONFIDENCE_OVERLAP_THRESHOLD).toBeGreaterThan(
      DEFAULT_OVERLAP_THRESHOLD,
    );
  });
});
