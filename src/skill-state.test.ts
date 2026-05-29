import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyState,
  loadSkillState,
  saveSkillState,
  isDisabled,
  setDisabled,
  clearDisabled,
  compileTarget,
  matchSkills,
  disableSkillInstance,
  enableSkillInstance,
  skillFilePath,
  disabledFilePath,
} from "./skill-state";
import type { SkillStateFile } from "./utils/types";

type NameDir = { name: string; dirName: string };

function s(name: string, dirName = name): NameDir {
  return { name, dirName };
}

const sample: NameDir[] = [
  s("code-review"),
  s("workflow-init"),
  s("workflow-run"),
  s("plan-review"),
  s("design-review"),
  s("openspec:apply", "openspec_apply"),
  s("openspec:archive", "openspec_archive"),
  s("asc-cli-usage"),
  s("asc-release-flow"),
  s("unrelated"),
];

describe("compileTarget", () => {
  it("classifies '*' and 'all' as kind all", () => {
    expect(compileTarget("*").kind).toBe("all");
    expect(compileTarget("all").kind).toBe("all");
    expect(compileTarget("*").test("anything")).toBe(true);
  });

  it("classifies a glob containing * as wildcard", () => {
    expect(compileTarget("workflow*").kind).toBe("wildcard");
    expect(compileTarget("*-review").kind).toBe("wildcard");
    expect(compileTarget("a*b").kind).toBe("wildcard");
  });

  it("classifies trailing : or - as prefix", () => {
    expect(compileTarget("openspec:").kind).toBe("prefix");
    expect(compileTarget("asc-").kind).toBe("prefix");
  });

  it("classifies a bare token as exact", () => {
    expect(compileTarget("code-review").kind).toBe("exact");
  });

  it("does not treat an internal hyphen as a prefix", () => {
    // "code-review" ends in 'w', not '-' or ':' -> exact, not prefix
    const c = compileTarget("code-review");
    expect(c.kind).toBe("exact");
    expect(c.test("code-review-extra")).toBe(false);
  });

  it("escapes regex metacharacters in globs", () => {
    // The '.' must be literal, not "any char".
    const c = compileTarget("a.b*");
    expect(c.test("a.bcd")).toBe(true);
    expect(c.test("axbcd")).toBe(false);
  });
});

describe("matchSkills", () => {
  it("matches exactly", () => {
    expect(matchSkills(sample, "code-review").map((x) => x.name)).toEqual([
      "code-review",
    ]);
  });

  it("matches a glob with * at the end", () => {
    expect(matchSkills(sample, "workflow*").map((x) => x.name)).toEqual([
      "workflow-init",
      "workflow-run",
    ]);
  });

  it("matches a glob with * at the start", () => {
    expect(matchSkills(sample, "*-review").map((x) => x.name)).toEqual([
      "code-review",
      "plan-review",
      "design-review",
    ]);
  });

  it("matches a glob with * in the middle", () => {
    expect(matchSkills(sample, "asc*flow").map((x) => x.name)).toEqual([
      "asc-release-flow",
    ]);
  });

  it("matches a ':' prefix including the trailing colon", () => {
    expect(matchSkills(sample, "openspec:").map((x) => x.name)).toEqual([
      "openspec:apply",
      "openspec:archive",
    ]);
  });

  it("matches a '-' prefix including the trailing hyphen", () => {
    expect(matchSkills(sample, "asc-").map((x) => x.name)).toEqual([
      "asc-cli-usage",
      "asc-release-flow",
    ]);
  });

  it("matches everything for '*' and 'all'", () => {
    expect(matchSkills(sample, "*").length).toBe(sample.length);
    expect(matchSkills(sample, "all").length).toBe(sample.length);
  });

  it("returns empty for no match", () => {
    expect(matchSkills(sample, "does-not-exist")).toEqual([]);
  });

  it("matches against dirName as well as name", () => {
    // openspec:apply has dirName openspec_apply
    expect(matchSkills(sample, "openspec_apply").map((x) => x.name)).toEqual([
      "openspec:apply",
    ]);
    expect(matchSkills(sample, "openspec_*").map((x) => x.name)).toEqual([
      "openspec:apply",
      "openspec:archive",
    ]);
  });
});

describe("state mutators", () => {
  it("sets, reads, and clears disabled records", () => {
    const st = emptyState();
    expect(isDisabled(st, "code-review", "claude", "global")).toBe(false);

    setDisabled(st, "code-review", "claude", "global");
    expect(isDisabled(st, "code-review", "claude", "global")).toBe(true);
    // Different scope/provider remain false.
    expect(isDisabled(st, "code-review", "claude", "project")).toBe(false);
    expect(isDisabled(st, "code-review", "codex", "global")).toBe(false);

    // Same skill disabled in a second tool — independent.
    setDisabled(st, "code-review", "codex", "global");
    expect(isDisabled(st, "code-review", "codex", "global")).toBe(true);

    clearDisabled(st, "code-review", "claude", "global");
    expect(isDisabled(st, "code-review", "claude", "global")).toBe(false);
    // codex entry survives.
    expect(isDisabled(st, "code-review", "codex", "global")).toBe(true);

    // Clearing the last leaf prunes empty objects.
    clearDisabled(st, "code-review", "codex", "global");
    expect(st.disabled).toEqual({});
  });

  it("clearDisabled on a missing record is a no-op", () => {
    const st = emptyState();
    expect(() => clearDisabled(st, "x", "claude", "global")).not.toThrow();
    expect(st.disabled).toEqual({});
  });
});

describe("load/save round-trip and recovery", () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "asm-state-"));
    statePath = join(dir, "skill-state.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns empty state when the file is missing", async () => {
    const st = await loadSkillState(statePath);
    expect(st).toEqual({ version: 1, disabled: {} });
  });

  it("round-trips a saved state", async () => {
    const st = emptyState();
    setDisabled(st, "code-review", "claude", "global");
    setDisabled(st, "workflow-run", "codex", "project");
    await saveSkillState(st, statePath);

    const reloaded = await loadSkillState(statePath);
    expect(reloaded).toEqual(st);
    expect(isDisabled(reloaded, "code-review", "claude", "global")).toBe(true);
    expect(isDisabled(reloaded, "workflow-run", "codex", "project")).toBe(true);
  });

  it("recovers from a corrupted file by backing it up and returning empty", async () => {
    await writeFile(statePath, "{ this is not json ", "utf-8");
    const st = await loadSkillState(statePath);
    expect(st).toEqual({ version: 1, disabled: {} });
    // The corrupted file was moved aside.
    await expect(access(`${statePath}.bak`)).resolves.toBeUndefined();
  });

  it("normalizes a structurally invalid (but parseable) file to empty", async () => {
    await writeFile(statePath, JSON.stringify({ version: 2 }), "utf-8");
    const st = await loadSkillState(statePath);
    expect(st).toEqual({ version: 1, disabled: {} });
  });
});

describe("disableSkillInstance / enableSkillInstance", () => {
  let dir: string;
  let skillDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "asm-skill-"));
    skillDir = join(dir, "code-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFilePath(skillDir), "---\nname: code-review\n---\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("renames SKILL.md to SKILL.md.disabled and back", async () => {
    expect(await disableSkillInstance(skillDir)).toBe(true);
    await expect(access(disabledFilePath(skillDir))).resolves.toBeUndefined();
    await expect(access(skillFilePath(skillDir))).rejects.toThrow();

    expect(await enableSkillInstance(skillDir)).toBe(true);
    await expect(access(skillFilePath(skillDir))).resolves.toBeUndefined();
    await expect(access(disabledFilePath(skillDir))).rejects.toThrow();
    // Content preserved through the round-trip.
    expect(await readFile(skillFilePath(skillDir), "utf-8")).toContain(
      "name: code-review",
    );
  });

  it("disable is a no-op when already disabled", async () => {
    await disableSkillInstance(skillDir);
    expect(await disableSkillInstance(skillDir)).toBe(false);
    await expect(access(disabledFilePath(skillDir))).resolves.toBeUndefined();
  });

  it("enable is a no-op when already enabled", async () => {
    expect(await enableSkillInstance(skillDir)).toBe(false);
    await expect(access(skillFilePath(skillDir))).resolves.toBeUndefined();
  });
});

describe("disable/enable + state contract (integration)", () => {
  let root: string;
  let skillDir: string;
  let statePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "asm-contract-"));
    skillDir = join(root, "skills", "code-review");
    statePath = join(root, "skill-state.json");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      skillFilePath(skillDir),
      "---\nname: code-review\nversion: 1.0.0\n---\nbody\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("disabling renames the marker AND records state; enabling reverses both", async () => {
    // Disable: rename + record, persisted together (mirrors cmdDisable).
    const st = await loadSkillState(statePath);
    expect(await disableSkillInstance(skillDir)).toBe(true);
    setDisabled(st, "code-review", "claude", "global");
    await saveSkillState(st, statePath);

    // On-disk enforcement.
    await expect(access(disabledFilePath(skillDir))).resolves.toBeUndefined();
    await expect(access(skillFilePath(skillDir))).rejects.toThrow();
    // Source-of-truth state survives a reload.
    const reloaded = await loadSkillState(statePath);
    expect(isDisabled(reloaded, "code-review", "claude", "global")).toBe(true);

    // Enable: reverse rename + clear, persisted together (mirrors cmdEnable).
    expect(await enableSkillInstance(skillDir)).toBe(true);
    clearDisabled(reloaded, "code-review", "claude", "global");
    await saveSkillState(reloaded, statePath);

    await expect(access(skillFilePath(skillDir))).resolves.toBeUndefined();
    const finalState = await loadSkillState(statePath);
    expect(isDisabled(finalState, "code-review", "claude", "global")).toBe(
      false,
    );
    expect(finalState.disabled).toEqual({});
  });

  it("the same skill can be disabled in one tool and active in another", async () => {
    // Two independent provider instances on disk.
    const claudeDir = join(root, "claude", "code-review");
    const codexDir = join(root, "codex", "code-review");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await writeFile(skillFilePath(claudeDir), "---\nname: code-review\n---\n");
    await writeFile(skillFilePath(codexDir), "---\nname: code-review\n---\n");

    const st = await loadSkillState(statePath);
    await disableSkillInstance(claudeDir);
    setDisabled(st, "code-review", "claude", "global");
    await saveSkillState(st, statePath);

    // claude marker renamed, codex untouched.
    await expect(access(disabledFilePath(claudeDir))).resolves.toBeUndefined();
    await expect(access(skillFilePath(codexDir))).resolves.toBeUndefined();
    const reloaded = await loadSkillState(statePath);
    expect(isDisabled(reloaded, "code-review", "claude", "global")).toBe(true);
    expect(isDisabled(reloaded, "code-review", "codex", "global")).toBe(false);
  });
});
