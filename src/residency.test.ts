import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  computeResidencyAudit,
  chooseDemotionAction,
  formatResidencyReport,
  residencySignals,
  EXPENSIVE_RESIDENT_FLOOR,
} from "./residency";
import type { ResidencyInstance, SkillInfo } from "./utils/types";

const LIBRARY = "/home/u/.local/share/agent-skill-manager/library/skills";

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const dirName = overrides.dirName ?? overrides.name ?? "test-skill";
  const path = overrides.path ?? `/home/u/.claude/skills/${dirName}`;
  return {
    name: dirName,
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName,
    path,
    originalPath: path,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: path,
    tokenCount: 500,
    ...overrides,
  };
}

/** A description whose estimated cost clears the expensive-residency floor. */
function longDescription(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
}

/**
 * Expensive residency is measured *relative to the installed set*, so a heavy
 * skill only stands out next to a baseline of ordinary ones.
 */
function withBaseline(...skills: SkillInfo[]): SkillInfo[] {
  return [...skills, ...baselineSkills(8)];
}

function baselineSkills(count: number): SkillInfo[] {
  return Array.from({ length: count }, (_, i) =>
    makeSkill({ dirName: `baseline-${i}`, description: "a short one" }),
  );
}

function makeInstance(
  overrides: Partial<ResidencyInstance> = {},
): ResidencyInstance {
  return {
    provider: "claude",
    providerLabel: "Claude Code",
    scope: "global",
    path: "/home/u/.claude/skills/x",
    libraryLinked: false,
    ...overrides,
  };
}

// ─── Demotion command selection ─────────────────────────────────────────────

describe("chooseDemotionAction", () => {
  it("suggests asm deactivate only for a lone ASM-library symlink", () => {
    const action = chooseDemotionAction("my-skill", [
      makeInstance({
        libraryLinked: true,
        provider: "codex",
        scope: "project",
      }),
    ]);
    expect(action.kind).toBe("deactivate");
    expect(action.command).toBe(
      "asm deactivate my-skill --provider codex --scope project",
    );
  });

  it("always names an explicit scope, because deactivate rejects `both`", () => {
    const action = chooseDemotionAction("my-skill", [
      makeInstance({ libraryLinked: true }),
    ]);
    expect(action.command).toMatch(/--scope (global|project)$/);
  });

  it("falls back to asm disable for a non-symlink install", () => {
    // `deactivateLibrarySkill` throws on non-symlinks, so suggesting
    // `asm deactivate` here would emit a command that fails when run.
    const action = chooseDemotionAction("my-skill", [
      makeInstance({ libraryLinked: false }),
    ]);
    expect(action.kind).toBe("disable");
    expect(action.command).toBe("asm disable my-skill");
  });

  it("falls back to asm disable when the skill is resident in many tools", () => {
    // `asm deactivate` targets one provider/scope pair; a multi-instance skill
    // has no single valid target, and `asm disable` covers all of them.
    const action = chooseDemotionAction("my-skill", [
      makeInstance({ libraryLinked: true, provider: "claude" }),
      makeInstance({ libraryLinked: true, provider: "codex" }),
    ]);
    expect(action.kind).toBe("disable");
    expect(action.command).toBe("asm disable my-skill");
  });

  it("says the disable covers every place, because it has no --tool switch", () => {
    // Symlinked siblings share one canonical SKILL.md, so `asm disable` demotes
    // the whole group; promising a per-tool demotion would be a lie.
    const action = chooseDemotionAction("my-skill", [
      makeInstance({ libraryLinked: true, provider: "claude" }),
      makeInstance({ libraryLinked: true, provider: "codex" }),
      makeInstance({ libraryLinked: false, provider: "agents" }),
    ]);
    expect(action.hint).toBe(
      "reversible with asm enable; disables it in all 3 places",
    );
    expect(action.hint).not.toContain("--tool");
  });
});

// ─── Audit computation ──────────────────────────────────────────────────────

describe("computeResidencyAudit", () => {
  it("flags a description far above the median", () => {
    const skills = withBaseline(
      makeSkill({ dirName: "heavy", description: longDescription(120) }),
    );
    const report = computeResidencyAudit(skills);
    const heavy = report.candidates.find((c) => c.dirName === "heavy");
    expect(heavy).toBeDefined();
    expect(heavy!.reasons.map((r) => r.id)).toContain("expensive-description");
    expect(heavy!.reasons[0].detail).toContain("~");
  });

  it("does not flag a set of uniformly small descriptions", () => {
    const skills = Array.from({ length: 6 }, (_, i) =>
      makeSkill({ dirName: `s${i}`, description: "short one here" }),
    );
    const report = computeResidencyAudit(skills);
    expect(report.candidates).toEqual([]);
    expect(report.medianResidentTokens).toBeLessThan(EXPENSIVE_RESIDENT_FLOOR);
  });

  it("flags a skill resident in several tools and counts the cost per tool", () => {
    const skills = [
      makeSkill({ dirName: "spread", provider: "claude" }),
      makeSkill({
        dirName: "spread",
        provider: "codex",
        providerLabel: "Codex",
        path: "/home/u/.codex/skills/spread",
        realPath: "/home/u/.codex/skills/spread",
      }),
    ];
    const report = computeResidencyAudit(skills);
    expect(report.candidates).toHaveLength(1);
    const candidate = report.candidates[0];
    expect(candidate.reasons.map((r) => r.id)).toContain(
      "redundant-activation",
    );
    expect(candidate.instances).toHaveLength(2);
    expect(candidate.totalResidentTokens).toBe(candidate.residentTokens * 2);
  });

  it("ranks the highest total resident cost first", () => {
    const skills = withBaseline(
      makeSkill({ dirName: "cheap-spread", provider: "claude" }),
      makeSkill({
        dirName: "cheap-spread",
        provider: "codex",
        path: "/home/u/.codex/skills/cheap-spread",
        realPath: "/home/u/.codex/skills/cheap-spread",
      }),
      makeSkill({ dirName: "expensive", description: longDescription(200) }),
    );
    const report = computeResidencyAudit(skills);
    expect(report.candidates[0].dirName).toBe("expensive");
    expect(report.candidates[0].score).toBeGreaterThan(
      report.candidates[1].score,
    );
  });

  it("emits a deactivate command for a library-linked install", () => {
    const report = computeResidencyAudit(
      withBaseline(
        makeSkill({
          dirName: "linked",
          description: longDescription(200),
          isSymlink: true,
          realPath: `${LIBRARY}/linked`,
        }),
      ),
      { librarySkillsDir: LIBRARY },
    );
    expect(report.candidates[0].dirName).toBe("linked");
    expect(report.candidates[0].action.kind).toBe("deactivate");
    expect(report.candidates[0].instances[0].libraryLinked).toBe(true);
  });

  it("never emits deactivate for a symlink pointing outside the library", () => {
    // `deactivateLibrarySkill` refuses these, so the command must not appear.
    const report = computeResidencyAudit(
      withBaseline(
        makeSkill({
          dirName: "elsewhere",
          description: longDescription(200),
          isSymlink: true,
          realPath: "/home/u/other-place/elsewhere",
        }),
      ),
      { librarySkillsDir: LIBRARY },
    );
    expect(report.candidates[0].dirName).toBe("elsewhere");
    expect(report.candidates[0].action.kind).toBe("disable");
  });

  it("never emits deactivate when no library path is known", () => {
    const report = computeResidencyAudit(
      withBaseline(
        makeSkill({
          dirName: "linked",
          description: longDescription(200),
          isSymlink: true,
          realPath: `${LIBRARY}/linked`,
        }),
      ),
    );
    expect(report.candidates[0].dirName).toBe("linked");
    expect(report.candidates[0].action.kind).toBe("disable");
  });

  it("counts plugin-provided skills but never lists them as candidates", () => {
    // No ASM command demotes them: `asm disable` skips plugin providers and
    // `asm deactivate` would throw.
    const report = computeResidencyAudit([
      makeSkill({
        dirName: "from-plugin",
        provider: "plugin",
        providerLabel: "Plugin (acme)",
        description: longDescription(200),
      }),
      makeSkill({
        dirName: "from-codex-plugin",
        provider: "codex-plugin",
        description: longDescription(200),
      }),
      makeSkill({ dirName: "ordinary", description: "a short one" }),
    ]);
    expect(report.unmanagedSkills).toBe(2);
    expect(report.totalSkills).toBe(3);
    expect(report.totalResidentTokens).toBeGreaterThan(0);
    expect(report.candidates).toEqual([]);
  });

  it("caps candidates when a limit is given", () => {
    const skills = withBaseline(
      ...Array.from({ length: 6 }, (_, i) =>
        makeSkill({ dirName: `heavy-${i}`, description: longDescription(200) }),
      ),
    );
    expect(computeResidencyAudit(skills).candidates.length).toBeGreaterThan(2);
    expect(computeResidencyAudit(skills, { limit: 2 }).candidates).toHaveLength(
      2,
    );
  });

  it("degrades gracefully on an empty installed set", () => {
    const report = computeResidencyAudit([]);
    expect(report.totalSkills).toBe(0);
    expect(report.candidates).toEqual([]);
    expect(report.signals.length).toBeGreaterThan(0);
  });
});

// ─── Signal availability ────────────────────────────────────────────────────

describe("residencySignals", () => {
  it("marks signals with no data source as unavailable instead of failing", () => {
    const byId = new Map(residencySignals().map((s) => [s.id, s]));
    expect(byId.get("expensive-description")!.available).toBe(true);
    expect(byId.get("redundant-activation")!.available).toBe(true);
    expect(byId.get("trigger-collision")!.available).toBe(false);
    expect(byId.get("trigger-collision")!.reason).toContain("#18");
    expect(byId.get("unused")!.available).toBe(false);
    expect(byId.get("unused")!.reason).toContain("#354");
  });

  it("still produces a report when only the available signals fire", () => {
    const report = computeResidencyAudit(
      withBaseline(
        makeSkill({ dirName: "heavy", description: longDescription(200) }),
      ),
    );
    expect(report.candidates).toHaveLength(1);
    expect(report.signals.filter((s) => !s.available)).toHaveLength(2);
  });
});

// ─── Rendering ──────────────────────────────────────────────────────────────

describe("formatResidencyReport", () => {
  beforeEach(() => {
    (globalThis as any).__CLI_NO_COLOR = true;
  });

  afterEach(() => {
    delete (globalThis as any).__CLI_NO_COLOR;
  });

  it("prints each candidate with a reason and a command", () => {
    const report = computeResidencyAudit(
      withBaseline(
        makeSkill({ dirName: "heavy", description: longDescription(200) }),
      ),
    );
    const output = formatResidencyReport(report);
    expect(output).toContain("Demotion candidates (1)");
    expect(output).toContain("heavy");
    expect(output).toContain("the median description");
    expect(output).toContain("asm disable heavy");
  });

  it("renders every token figure with the `~` prefix, never as bytes", () => {
    const output = formatResidencyReport(
      computeResidencyAudit(
        withBaseline(
          makeSkill({ dirName: "heavy", description: longDescription(200) }),
        ),
      ),
    );
    expect(output).toMatch(/~\d/);
    expect(output).not.toMatch(/\d\s?(KB|MB|GB)/);
  });

  it("reports an empty installed set instead of an empty table", () => {
    const output = formatResidencyReport(computeResidencyAudit([]));
    expect(output).toContain("No installed skills");
  });

  it("lists unavailable signals when there is data to report", () => {
    const output = formatResidencyReport(
      computeResidencyAudit([makeSkill({ description: "short" })]),
    );
    expect(output).toContain("Signals not yet available");
    expect(output).toContain("Trigger collision");
    expect(output).toContain("Unused");
  });

  it("states that nothing was changed", () => {
    const output = formatResidencyReport(
      computeResidencyAudit([makeSkill({ description: "short" })]),
    );
    expect(output).toContain("Nothing was changed");
  });

  it("truncates a long candidate list and says how many are hidden", () => {
    const skills = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeSkill({
          dirName: `heavy-${i}`,
          description: longDescription(200 + i),
        }),
      ),
      ...baselineSkills(60),
    ];
    const output = formatResidencyReport(computeResidencyAudit(skills), 5);
    expect(output).toContain("Demotion candidates (20)");
    expect(output).toContain("… 15 more not shown");
  });

  it("reports a clean set as having no candidates", () => {
    const output = formatResidencyReport(
      computeResidencyAudit([makeSkill({ description: "short one" })]),
    );
    expect(output).toContain("No demotion candidates");
  });
});
