import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import {
  discoverExplicitRepoBundles,
  inferRepoBundles,
  mergeRepoBundles,
  repoBundlesForIndex,
} from "./repo-bundles";
import type { IndexedSkill, RepoIndex } from "./utils/types";

function skill(overrides: Partial<IndexedSkill>): IndexedSkill {
  return {
    name: "skill",
    description: "",
    version: "1.0.0",
    license: "MIT",
    creator: "tester",
    compatibility: "",
    allowedTools: [],
    installUrl: "github:owner/repo:skills/skill",
    relPath: "skills/skill",
    ...overrides,
  };
}

function repo(skills: IndexedSkill[]): RepoIndex {
  return {
    repoUrl: "https://github.com/owner/repo.git",
    owner: "owner",
    repo: "repo",
    updatedAt: "2026-05-10T00:00:00.000Z",
    skillCount: skills.length,
    skills,
  };
}

describe("repo-derived bundle inference", () => {
  it("creates category bundles from indexed skills with provenance", () => {
    const index = repo([
      skill({
        name: "seo-auditor",
        description: "SEO marketing and growth audit",
        installUrl: "github:owner/repo:skills/seo-auditor",
        relPath: "skills/seo-auditor",
      }),
      skill({
        name: "aso-marketing",
        description: "ASO marketing workflow",
        installUrl: "github:owner/repo:skills/aso-marketing",
        relPath: "skills/aso-marketing",
      }),
      skill({
        name: "unit-test-writer",
        description: "Write tests for code",
        installUrl: "github:owner/repo:skills/unit-test-writer",
        relPath: "skills/unit-test-writer",
      }),
    ]);

    const bundles = inferRepoBundles(index);
    const marketing = bundles.find((bundle) => bundle.name === "owner-repo-marketing");

    expect(marketing).toBeDefined();
    expect(marketing!.inferred).toBe(true);
    expect(marketing!.sourceRepo).toMatchObject({ owner: "owner", repo: "repo" });
    expect(marketing!.skills.map((s) => s.name)).toEqual([
      "aso-marketing",
      "seo-auditor",
    ]);
    expect(marketing!.skills[0].installUrl).toContain("github:owner/repo:");
  });

  it("does not infer bundles from singleton categories", () => {
    const bundles = inferRepoBundles(
      repo([
        skill({
          name: "seo-auditor",
          description: "SEO marketing audit",
        }),
      ]),
    );

    expect(bundles).toEqual([]);
  });

  it("keeps explicit bundles over inferred bundles with the same name", () => {
    const index = repo([
      skill({ name: "seo-auditor", description: "SEO marketing audit" }),
      skill({ name: "aso-marketing", description: "ASO marketing workflow" }),
    ]);
    index.bundles = [
      {
        version: 1,
        name: "owner-repo-marketing",
        description: "Maintainer curated marketing bundle",
        author: "owner",
        createdAt: index.updatedAt,
        tags: ["explicit"],
        skills: [index.skills[0]],
        sourceRepo: {
          owner: index.owner,
          repo: index.repo,
          repoUrl: index.repoUrl,
          relPath: ".asm/bundles.json",
        },
        explicit: true,
      },
    ];

    const bundles = repoBundlesForIndex(index);
    const marketing = bundles.find((bundle) => bundle.name === "owner-repo-marketing");

    expect(marketing!.explicit).toBe(true);
    expect(marketing!.description).toBe("Maintainer curated marketing bundle");
  });

  it("normalizes explicit bundle skill install URLs to indexed repo skills", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "repo-bundles-test-"));
    try {
      const index = repo([
        skill({
          name: "seo-auditor",
          description: "SEO marketing audit",
          installUrl: "github:owner/repo:skills/seo-auditor",
          relPath: "skills/seo-auditor",
        }),
      ]);
      await writeFile(
        join(tmpDir, "asm-bundles.json"),
        JSON.stringify({
          name: "marketing",
          skills: [
            {
              name: "seo-auditor",
              installUrl: "github:attacker/malicious:skills/seo-auditor",
              description: "Curated SEO workflow",
            },
          ],
        }),
      );

      const bundles = await discoverExplicitRepoBundles(tmpDir, index);

      expect(bundles).toHaveLength(1);
      expect(bundles[0].skills[0]).toMatchObject({
        name: "seo-auditor",
        installUrl: "github:owner/repo:skills/seo-auditor",
        description: "Curated SEO workflow",
      });
      expect(bundles[0].sourceRepo).toMatchObject({
        owner: "owner",
        repo: "repo",
        relPath: "asm-bundles.json",
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("drops explicit bundle entries that do not reference indexed skills", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "repo-bundles-test-"));
    try {
      const index = repo([
        skill({
          name: "seo-auditor",
          description: "SEO marketing audit",
          installUrl: "github:owner/repo:skills/seo-auditor",
        }),
      ]);
      await writeFile(
        join(tmpDir, "asm-bundles.json"),
        JSON.stringify({
          name: "marketing",
          skills: [
            { name: "not-in-this-repo", installUrl: "github:attacker/malicious" },
          ],
        }),
      );

      const bundles = await discoverExplicitRepoBundles(tmpDir, index);

      expect(bundles).toEqual([]);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("dedupes bundles by name", () => {
    const merged = mergeRepoBundles([
      {
        version: 1,
        name: "owner-repo-marketing",
        description: "inferred",
        author: "ASM",
        createdAt: "2026-05-10T00:00:00.000Z",
        tags: ["repo-derived"],
        skills: [skill({ name: "seo" })],
        sourceRepo: { owner: "owner", repo: "repo", repoUrl: "https://github.com/owner/repo.git" },
        inferred: true,
      },
      {
        version: 1,
        name: "owner-repo-marketing",
        description: "explicit",
        author: "owner",
        createdAt: "2026-05-10T00:00:00.000Z",
        tags: ["repo-derived"],
        skills: [skill({ name: "aso" })],
        sourceRepo: { owner: "owner", repo: "repo", repoUrl: "https://github.com/owner/repo.git" },
        explicit: true,
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe("explicit");
  });
});
