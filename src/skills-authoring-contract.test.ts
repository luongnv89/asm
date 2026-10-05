import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

function repoPath(relPath: string): string {
  return fileURLToPath(new URL(`../${relPath}`, import.meta.url));
}

function readRepoFile(relPath: string): string {
  return readFileSync(repoPath(relPath), "utf8");
}

function frontmatterOf(doc: string): Record<string, unknown> {
  const match = doc.match(/^---\n([\s\S]*?)\n---\n/);
  expect(match).not.toBeNull();
  return parseYaml(match![1]);
}

// Body after the leading frontmatter block only — the body itself contains
// `---` horizontal rules, so splitting on `---` would measure a fragment.
function bodyOf(doc: string): string {
  return doc.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function section(doc: string, start: string, end: string): string {
  expect(doc).toContain(start);
  expect(doc).toContain(end);
  return doc.slice(doc.indexOf(start), doc.indexOf(end));
}

const creatorSkill = readRepoFile("skills/skill-creator/SKILL.md");
const creatorPreflight = readRepoFile(
  "skills/skill-creator/references/dependency-preflight.md",
);
const creatorValidator = readRepoFile(
  "skills/skill-creator/scripts/quick_validate.py",
);
const creatorStandard = readRepoFile(
  "skills/skill-creator/references/skill-standard.md",
);
const creatorRetrofit = readRepoFile(
  "skills/skill-creator/references/retrofit-loop.md",
);
const creatorReport = readRepoFile(
  "skills/skill-creator/references/report-template.md",
);
const creatorPatterns = readRepoFile(
  "skills/skill-creator/references/subagent-patterns.md",
);
const creatorRubric = readRepoFile(
  "skills/skill-creator/references/predictability-rubric.md",
);
const creatorAudit = readRepoFile(
  "skills/skill-creator/references/predictability-audit.md",
);
const creatorConversion = readRepoFile(
  "skills/skill-creator/references/delegation-conversion.md",
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
];

describe("dependency preflight rule (#571)", () => {
  it("skill-creator establishes skill dependencies during the interview", () => {
    expect(creatorSkill).toContain(
      "## Mandatory Rule for Skills That Invoke Other Skills",
    );
    expect(creatorSkill).toContain("Does this skill invoke other skills?");
    expect(creatorSkill).toContain("references/dependency-preflight.md");
  });

  it.each([["skill-creator reference", creatorPreflight]])(
    "%s documents all four preflight elements",
    (_name, doc) => {
      expect(doc).toContain("## Dependency Preflight (mandatory)");
      expect(doc).toContain("dependencies");
      expect(doc).toContain("asm deps discover");
      expect(doc).toContain("asm deps acquire");
      expect(doc).toContain("asm deps release");
    },
  );

  it("the skill standard points at the preflight rule's single home", () => {
    expect(creatorStandard).toContain("references/dependency-preflight.md");
  });

  it("the skill standard reports a missing gate as a Gate 1 finding", () => {
    expect(creatorStandard).toMatch(
      /If the target skill invokes another skill\*\*, it declares frontmatter `dependencies`/,
    );
    expect(creatorStandard).toContain(
      "Skill invokes another skill without dependency metadata and a first-use lease lifecycle",
    );
  });

  it.each([
    ["skill-creator", creatorSkill],
    ["skill-creator reference", creatorPreflight],
    ["skill-creator standard", creatorStandard],
  ])("%s leaves a skill with no dependencies untouched", (_name, doc) => {
    expect(doc).toMatch(
      /empty\s+(preflight|dependency list)|empty list|no such section|nothing is added|add nothing/i,
    );
  });

  it("skill-creator does not depend on itself, and the merged improver is gone", () => {
    const frontmatter = frontmatterOf(creatorSkill);
    const deps = frontmatter.dependencies as string[] | undefined;
    if (deps !== undefined) {
      expect(deps).not.toContain("skill-creator");
    }
    expect(creatorSkill).not.toContain("asm deps acquire skill-creator");
    expect(creatorRetrofit).not.toContain("asm deps acquire skill-creator");
    expect(existsSync(repoPath("skills/skill-auto-improver"))).toBe(false);
  });

  it("skill-creator validation accepts non-empty dependency lists", () => {
    expect(creatorValidator).toContain("'dependencies'");
    expect(creatorValidator).toContain(
      "Dependencies must be a non-empty YAML list",
    );
  });

  it("the report template marks the preflight row conditional", () => {
    expect(creatorReport).toContain("Dependency preflight");
    expect(creatorReport).toMatch(/conditional/i);
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

  it("skill-creator prints run stats on every path and at every terminal outcome", () => {
    expect(creatorSkill).toContain("## Run stats (mandatory)");
    const block = creatorSkill.slice(
      creatorSkill.indexOf("## Run stats (mandatory)"),
    );
    expect(block).toContain("Path A, Subpath B1, Subpath B2, and Subpath B3");
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

  it("the rubric points at the skill standard, not a separate improver", () => {
    expect(creatorRubric).not.toContain("skill-auto-improver");
    expect(creatorRubric).toContain("skill-standard.md");
  });

  it("the audit row demands a reason and routes remediation to Subpath B3", () => {
    expect(creatorAudit).toContain("**Delegability sub-check:**");
    expect(creatorAudit).toContain("step N is not delegable because");
    expect(creatorAudit).toContain(
      "**A delegability finding routes to Subpath B3, never a Subpath B1 edit.**",
    );
  });

  it("the audit checklist table still has exactly 7 rows", () => {
    expect(creatorAudit.match(/^\| \d+ +\|/gm)).toHaveLength(7);
  });

  it("skill-creator offers Subpath B3 as an opt-in selector, not a gate", () => {
    expect(creatorSkill).toContain(
      "**Subpath B1 — retrofit to the standard (default).**",
    );
    expect(creatorSkill).toContain(
      "**Subpath B3 — delegation conversion (opt-in).**",
    );
    expect(creatorSkill).toContain("references/delegation-conversion.md");
    // The selector must precede Phase 0, whose early exit would otherwise
    // swallow a gate-passing Subpath B3 candidate.
    expect(creatorRetrofit).toContain("Subpath B3");
    expect(creatorRetrofit).toContain("### Phase 0");
    expect(creatorRetrofit.indexOf("Subpath B3")).toBeLessThan(
      creatorRetrofit.indexOf("### Phase 0"),
    );
  });

  it("the conversion reference bumps the target MAJOR and says when to skip it", () => {
    expect(creatorConversion).toContain("## Version bump");
    expect(creatorConversion).toMatch(/\*\*MAJOR\*\* bump on the target/);
    expect(creatorConversion).toContain(
      "## When conversion does not pay for itself",
    );
    expect(creatorConversion).toMatch(/user has confirmed the restructure/i);
    expect(creatorConversion).toMatch(/outside the Phase 6 loop/i);
  });

  it("the conversion runs the loop's validator resolution and repo sync before editing", () => {
    // Subpath B3 runs outside the retrofit loop, so it must still borrow the
    // loop's $QV resolution and mandatory repo sync by their exact headings.
    for (const heading of [
      "Resolve the validator",
      "Repo Sync Before Edits (mandatory)",
    ]) {
      expect(creatorRetrofit).toContain(`## ${heading}`);
      expect(creatorConversion).toContain(heading);
    }
  });

  it.each([
    ["skill-creator patterns", creatorPatterns],
    ["skill-creator conversion", creatorConversion],
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

describe("one skill standard for create and update (#721)", () => {
  it("both entry paths end at the skill standard", () => {
    const creating = section(
      creatorSkill,
      "## Creating a skill",
      "## Running and evaluating test cases",
    );
    const improving = section(
      creatorSkill,
      "## Improving an existing skill",
      "## Description Optimization",
    );
    for (const slice of [creating, improving]) {
      expect(slice).toMatch(/skill-standard\.md|retrofit-loop\.md/);
    }
    expect(creatorRetrofit).toContain("skill-standard.md");
  });

  it("the standard defines the 85/8 floor and never passes without asm", () => {
    expect(creatorStandard).toContain("> 85");
    expect(creatorStandard).toContain(">= 8");
    expect(creatorStandard).toContain("not measured");
    expect(creatorStandard).toContain("never reports PASS");
  });
});

describe("authoring skills stay within the skill-creator standard", () => {
  it.each(authoringSkills)("%s body is under 500 lines", (_name, doc) => {
    expect(doc.split("\n").length).toBeLessThan(500);
  });

  it.each(authoringSkills)("%s body is under 3000 words", (_name, doc) => {
    const body = bodyOf(doc);
    expect(body.length).toBeLessThan(doc.length);
    expect(body.split(/\s+/).filter(Boolean).length).toBeLessThan(3000);
  });
});
