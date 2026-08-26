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
const creatorPatterns = readRepoFile(
  "skills/skill-creator/references/subagent-patterns.md",
);
const creatorRubric = readRepoFile(
  "skills/skill-creator/references/predictability-rubric.md",
);
const improverAudit = readRepoFile(
  "skills/skill-auto-improver/references/predictability-audit.md",
);
const improverConversion = readRepoFile(
  "skills/skill-auto-improver/references/delegation-conversion.md",
);
// Not an authoring skill: kept out of `authoringSkills` so the 500-line and
// run-stats assertions below do not bind it.
const indexUpdaterSkill = readRepoFile("skills/skill-index-updater/SKILL.md");
const discoveryContract = readRepoFile(
  "skills/skill-index-updater/references/discovery-contract.md",
);
const auditContract = readRepoFile(
  "skills/skill-index-updater/references/audit-eval-contract.md",
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

describe("per-step context delegation (#574)", () => {
  it("skill-creator documents the pattern and binds the slice to the Input field", () => {
    expect(creatorPatterns).toContain("## Per-Step Context Delegation");
    expect(creatorPatterns).toContain("the slice _is_ the Input");
    expect(creatorPatterns).toContain("#writing-subagent-prompts");
    expect(creatorSkill).toContain("Per-Step Context Delegation");
  });

  it("the predictability rubric carries the delegability sub-check under item 4", () => {
    expect(creatorRubric).toContain("**Delegability (sub-check).**");
    expect(creatorRubric).toContain("**Pass bar for the sub-check:**");
    const item4 = creatorRubric.slice(
      creatorRubric.indexOf("## 4. "),
      creatorRubric.indexOf("## 5. "),
    );
    expect(item4).toContain("**Delegability (sub-check).**");
  });

  it("the rubric still has exactly 7 items", () => {
    expect(creatorRubric.match(/^## \d+\. /gm)).toHaveLength(7);
  });

  it("the audit row demands a reason and routes remediation to Mode 2", () => {
    expect(improverAudit).toContain("**Delegability sub-check:**");
    expect(improverAudit).toContain("step N is not delegable because");
    expect(improverAudit).toContain(
      "**A delegability finding routes to Mode 2, never a Mode 1 edit.**",
    );
  });

  it("the audit checklist table still has exactly 7 rows", () => {
    expect(improverAudit.match(/^\| \d+ +\|/gm)).toHaveLength(7);
  });

  it("skill-auto-improver offers Mode 2 as an opt-in selector, not a gate", () => {
    expect(improverSkill).toContain("## Two modes");
    expect(improverSkill).toContain("**Mode 1 — retrofit (default).**");
    expect(improverSkill).toContain(
      "**Mode 2 — delegation conversion (opt-in).**",
    );
    expect(improverSkill).toContain("references/delegation-conversion.md");
    // The selector must precede Phase 0, whose early exit would otherwise
    // swallow a gate-passing Mode 2 candidate.
    expect(improverSkill.indexOf("## Two modes")).toBeLessThan(
      improverSkill.indexOf("### Phase 0"),
    );
  });

  it("the conversion reference bumps the target MAJOR and says when to skip it", () => {
    expect(improverConversion).toContain("## Version bump");
    expect(improverConversion).toMatch(/\*\*MAJOR\*\* bump on the target/);
    expect(improverConversion).toContain(
      "## When conversion does not pay for itself",
    );
    expect(improverConversion).toMatch(/user has confirmed the restructure/i);
    expect(improverConversion).toMatch(/outside the Phase 6 loop/i);
  });

  it.each([
    ["skill-creator", creatorPatterns],
    ["skill-auto-improver", improverConversion],
  ])("%s says when the pattern is not worth applying", (_name, doc) => {
    expect(doc).toMatch(/single decision/);
    expect(doc).toMatch(/mid-step|mid-way/);
    expect(doc).toMatch(/costs more than (it|the slice) saves/);
  });

  it("skill-index-updater delegates its heavy steps with a named slice each", () => {
    expect(indexUpdaterSkill).toContain(
      "Input: `references/discovery-contract.md`",
    );
    expect(indexUpdaterSkill).toContain(
      "Input: `references/audit-eval-contract.md`",
    );
    expect(indexUpdaterSkill).toMatch(
      /You do NOT read `references\/discovery-contract\.md` yourself/,
    );
    // Step 7's manual-generation fallback is the one place the orchestrator may
    // run `asm eval` itself. With discovery delegated there is no $TEMP_DIR in
    // its shell, so the path has to be sourced from the Step 2 worker result.
    expect(indexUpdaterSkill).toContain(
      "asm eval <clonePath>/<relPath> --json",
    );
    expect(indexUpdaterSkill).toMatch(/Step 2 worker result/);
  });

  it("skill-index-updater chains the clone path through the worker contracts", () => {
    // The Step 2 clone used to live in a $TEMP_DIR the main agent owned; with
    // discovery delegated, clonePath must travel in the worker's Output.
    expect(discoveryContract).toContain('"clonePath"');
    // Cleanup deletes tempRoot verbatim rather than deriving it from
    // clonePath — a derived `rm -rf` target is one layout change away from
    // the system temp root.
    expect(discoveryContract).toContain('"tempRoot"');
    expect(indexUpdaterSkill).toContain('rm -rf "<tempRoot>"');
    // Regression guard for the bug this restructure fixed: the orchestrator no
    // longer owns the shell that made the clone, so Cleanup must not go back to
    // removing its own `$TEMP_DIR`, nor derive the target from `clonePath`.
    // Matched as the whole `rm -rf` line — the bare `$TEMP_DIR` literal still
    // appears in the Step 2 and Cleanup prose that explains its absence.
    expect(indexUpdaterSkill).not.toContain('rm -rf "$TEMP_DIR"');
    expect(indexUpdaterSkill).not.toMatch(/rm -rf "\$\(dirname/);
    // relPath is pinned to clonePath and to the skill directory, not the
    // SKILL.md file — the index entry and installUrl carry it verbatim.
    expect(discoveryContract).toMatch(
      /the parent\s+of the discovered `SKILL\.md`/,
    );
    expect(discoveryContract).toMatch(/relative to\s+`clonePath`/);
    expect(auditContract).toContain("`clonePath`");
    expect(auditContract).toMatch(/Do not re-clone/i);
    expect(indexUpdaterSkill).toMatch(
      /## Cleanup[\s\S]*`tempRoot` each worker returned verbatim/,
    );
  });

  it("skill-index-updater degrades gracefully without the Agent tool", () => {
    expect(indexUpdaterSkill).toContain(
      "**No Agent tool?** Degrade gracefully",
    );
    expect(indexUpdaterSkill).toMatch(/run Steps 2 and 3 inline, in order/);
  });
});

describe("authoring skills stay within the skill-creator standard", () => {
  it.each(authoringSkills)("%s body is under 500 lines", (_name, doc) => {
    expect(doc.split("\n").length).toBeLessThan(500);
  });
});
