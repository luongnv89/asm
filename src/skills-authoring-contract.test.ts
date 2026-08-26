import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRepoFile(relPath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relPath}`, import.meta.url)),
    "utf8",
  );
}

const creatorSkill = readRepoFile("skills/skill-creator/SKILL.md");
const creatorPreflight = readRepoFile(
  "skills/skill-creator/references/dependency-preflight.md",
);
const improverSkill = readRepoFile("skills/skill-auto-improver/SKILL.md");
const improverChecklist = readRepoFile(
  "skills/skill-auto-improver/references/skill-creator-checklist.md",
);
const improverReport = readRepoFile(
  "skills/skill-auto-improver/references/report-template.md",
);

const authoringSkills: Array<[string, string]> = [
  ["skill-creator", creatorSkill],
  ["skill-auto-improver", improverSkill],
];

describe("dependency preflight rule (#571)", () => {
  it("skill-creator establishes skill dependencies during the interview", () => {
    expect(creatorSkill).toContain(
      "## Mandatory Rule for Skills That Invoke Other Skills",
    );
    expect(creatorSkill).toContain("Does this skill invoke other skills?");
    expect(creatorSkill).toContain("references/dependency-preflight.md");
  });

  it.each([
    ["skill-creator reference", creatorPreflight],
    ["skill-auto-improver checklist", improverChecklist],
  ])("%s documents all four preflight elements", (_name, doc) => {
    expect(doc).toContain("## Dependency Preflight (mandatory)");
    expect(doc).toContain("asm install <skill-name> -p <tool> --yes");
    expect(doc).toContain("npm install -g agent-skill-manager");
    expect(doc).toContain("asm list -p <tool> --json | grep '<skill-name>'");
  });

  it("skill-auto-improver reports a missing gate as a Gate 1 finding", () => {
    expect(improverSkill).toMatch(
      /If the target skill invokes another skill\*\*, it carries a dependency preflight/,
    );
    expect(improverSkill).toContain(
      "Skill invokes another skill with no preflight gate",
    );
  });

  it.each([
    ["skill-creator", creatorSkill],
    ["skill-creator reference", creatorPreflight],
    ["skill-auto-improver", improverSkill],
    ["skill-auto-improver checklist", improverChecklist],
  ])("%s leaves a skill with no dependencies untouched", (_name, doc) => {
    expect(doc).toMatch(
      /empty\s+preflight|no such section|nothing is added|add nothing/i,
    );
  });

  it("skill-auto-improver carries the gate it enforces, for its own skill-creator dependency", () => {
    expect(improverSkill).toContain("## Dependency Preflight (mandatory)");
    expect(improverSkill).toContain(
      "asm install skill-creator -p claude --yes",
    );
    expect(improverSkill).toContain("npm install -g agent-skill-manager");
    expect(improverSkill).toContain(
      "asm list -p claude --json | grep 'skill-creator'",
    );
  });

  it("the report template marks the preflight row conditional", () => {
    expect(improverReport).toContain("Dependency preflight");
    expect(improverReport).toMatch(/conditional/i);
  });
});

describe("run stats block (#572)", () => {
  it.each(authoringSkills)("%s defines the run-stats block", (_name, doc) => {
    expect(doc).toContain("## Run stats (mandatory)");
    expect(doc).toMatch(/Run stats {3}elapsed /);
  });

  it.each(authoringSkills)("%s reports every required figure", (_name, doc) => {
    const block = doc.slice(doc.indexOf("## Run stats (mandatory)"));
    for (const field of [
      "`elapsed`",
      "`tokens`",
      "`cost`",
      "`agents`",
      "`skills`",
      "`tool calls`",
    ]) {
      expect(block).toContain(field);
    }
  });

  it.each(authoringSkills)(
    "%s omits or marks unavailable figures instead of inventing them",
    (_name, doc) => {
      const block = doc.slice(doc.indexOf("## Run stats (mandatory)"));
      expect(block).toMatch(
        /omitted entirely when the host reported no figure/,
      );
      expect(block).toContain("prints the literal `n/a`");
      expect(block).toContain(
        "A missing optional figure never suppresses the rest of the block.",
      );
    },
  );

  it("skill-creator prints run stats on every create/update path", () => {
    const block = creatorSkill.slice(
      creatorSkill.indexOf("## Run stats (mandatory)"),
    );
    expect(block).toContain("Path A, Subpath B1, and Subpath B2");
  });

  it("skill-auto-improver prints run stats at every terminal outcome", () => {
    const block = improverSkill.slice(
      improverSkill.indexOf("## Run stats (mandatory)"),
    );
    expect(block).toMatch(/every\*\* terminal outcome/);
    expect(block).toContain("BLOCKER");
  });
});

describe("authoring skills stay within the skill-creator standard", () => {
  it.each(authoringSkills)("%s body is under 500 lines", (_name, doc) => {
    expect(doc.split("\n").length).toBeLessThan(500);
  });
});
