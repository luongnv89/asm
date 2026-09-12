import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, lstat } from "fs/promises";
import { tmpdir } from "os";
import { runCLI, runCliInProcess, CLI_BIN } from "./cli-test-harness";

// `asm audit` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: audit", () => {
  test("audit runs and exits 0", async () => {
    const { exitCode } = await runCLI("audit");
    expect(exitCode).toBe(0);
  });

  test("audit duplicates is the default subcommand", async () => {
    const { exitCode: code1 } = await runCLI("audit");
    const { exitCode: code2 } = await runCLI("audit", "duplicates");
    expect(code1).toBe(0);
    expect(code2).toBe(0);
    // Both should produce similar output (may differ in timestamp)
  });

  test("audit --json returns valid JSON with expected shape", async () => {
    const { stdout, exitCode } = await runCLI("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("duplicateGroups");
    expect(data).toHaveProperty("totalDuplicateInstances");
    expect(Array.isArray(data.duplicateGroups)).toBe(true);
  });

  test("audit --help shows usage", async () => {
    const { stdout, exitCode } = await runCLI("audit", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("asm audit");
    expect(stdout).toContain("duplicates");
    expect(stdout).toContain("security");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--yes");
  });

  test("audit with unknown subcommand exits 2", async () => {
    const { stderr, exitCode } = await runCLI("audit", "bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Unknown audit subcommand");
    expect(stderr).toContain("security");
  });

  test("main --help includes audit command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("audit");
  });
});

describe("CLI integration: audit duplicate content + guarded auto-remove (#562/#563/#565)", () => {
  let home: string;
  let cwd: string;

  const BODY_A = "# Steps\n\nDo the thing.";
  const BODY_B = "# Steps\n\nDo the other thing.";

  const globalSkillsDir = () => join(home, ".claude", "skills");
  const projectSkillsDir = () => join(cwd, ".claude", "skills");

  const writeSkill = async (
    base: string,
    dirName: string,
    body: string,
    name = dirName,
  ) => {
    await mkdir(join(base, dirName), { recursive: true });
    await writeFile(
      join(base, dirName, "SKILL.md"),
      `---\nname: ${name}\nversion: 1.0.0\ndescription: test skill\n---\n${body}\n`,
    );
  };

  const isRealDir = async (path: string): Promise<boolean> => {
    try {
      return !(await lstat(path)).isSymbolicLink();
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "asm-audit-home-"));
    cwd = await mkdtemp(join(tmpdir(), "asm-audit-cwd-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function runAudit(...args: string[]) {
    return runCliInProcess(["npx", "tsx", CLI_BIN, ...args], {
      cwd,
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });
  }

  test("--json tags an identical same-dirName group (#562)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_A);
    const { stdout, exitCode } = await runAudit("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.duplicateGroups).toHaveLength(1);
    expect(data.duplicateGroups[0].contentClass).toBe("identical");
    expect(data.totalDuplicateInstances).toBe(2);
  });

  test("--json tags a diverged same-dirName group (#562)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_B);
    const data = JSON.parse((await runAudit("audit", "--json")).stdout);
    expect(data.duplicateGroups[0].contentClass).toBe("diverged");
  });

  test("--json surfaces renamed-identical skills as one same-content group (#562)", async () => {
    await writeSkill(globalSkillsDir(), "alpha-skill", BODY_A, "Alpha Skill");
    await writeSkill(globalSkillsDir(), "beta-skill", BODY_A, "Beta Skill");
    const { stdout, exitCode } = await runAudit("audit", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.duplicateGroups).toHaveLength(1);
    expect(data.duplicateGroups[0].reason).toBe("same-content");
    expect(data.duplicateGroups[0].contentClass).toBe("identical");
  });

  test("-y removes byte-identical duplicates (#563 keeps working)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_A);
    const { stderr, exitCode } = await runAudit("audit", "-y");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Removed 1 duplicate copy");
    // The project copy was redundant: gone or repointed at the kept global
    // install; the global real directory survives.
    expect(await isRealDir(join(projectSkillsDir(), "code-review"))).toBe(
      false,
    );
    expect(await isRealDir(join(globalSkillsDir(), "code-review"))).toBe(true);
  });

  test("-y skips diverged copies and names the kept copy (#563)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_B);
    const { stderr, exitCode } = await runAudit("audit", "-y");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Skipping");
    expect(stderr).toContain("contents differ from the kept copy");
    expect(stderr).toContain("--force");
    // Both copies survive: the diverged project skill must not be replaced.
    expect(await isRealDir(join(globalSkillsDir(), "code-review"))).toBe(true);
    expect(await isRealDir(join(projectSkillsDir(), "code-review"))).toBe(true);
  });

  test("--force overrides the diverged-copy guard (#563)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_B);
    const { stderr, exitCode } = await runAudit("audit", "-y", "--force");
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Skipping");
    expect(await isRealDir(join(projectSkillsDir(), "code-review"))).toBe(
      false,
    );
    expect(await isRealDir(join(globalSkillsDir(), "code-review"))).toBe(true);
  });

  test("--machine envelope exposes reason, content class, and totals (#565)", async () => {
    await writeSkill(globalSkillsDir(), "code-review", BODY_A);
    await writeSkill(projectSkillsDir(), "code-review", BODY_B);
    const { stdout, exitCode } = await runAudit("audit", "--machine");
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("audit duplicates");
    const group = envelope.data.duplicate_groups[0];
    expect(group.reason).toBe("same-dirName");
    expect(group.contentClass).toBe("diverged");
    expect(group.count).toBe(2);
    expect(envelope.data.totalDuplicateInstances).toBe(2);
    // Machine output reports; it must not remove anything even though
    // --machine implies --yes at the parser level.
    expect(await isRealDir(join(projectSkillsDir(), "code-review"))).toBe(true);
  });

  test("audit --help documents --force", async () => {
    const { stdout, exitCode } = await runAudit("audit", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--force");
  });
});

describe("CLI integration: audit residency (issue #423)", () => {
  test("audit residency exits 0 and reports without changing anything", async () => {
    const { stdout, exitCode } = await runCLI("audit", "residency");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Residency Audit");
  });

  test("--yes never triggers a removal on the residency path", async () => {
    // `asm audit -y` auto-removes duplicates; residency must stay read-only.
    // The banner is printed with console.error, so stderr is the stream that
    // can actually fail this assertion.
    const { stdout, stderr, exitCode } = await runCLI(
      "audit",
      "residency",
      "--yes",
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Auto-removing");
    expect(stdout).not.toContain("Auto-removing");
  });

  test("audit residency --json has the audit report shape", async () => {
    const { stdout, exitCode } = await runCLI("audit", "residency", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("totalResidentTokens");
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(Array.isArray(data.signals)).toBe(true);
  });

  test("unavailable signals are reported, not omitted", async () => {
    const { stdout } = await runCLI("audit", "residency", "--json");
    const { signals } = JSON.parse(stdout);
    const unavailable = signals.filter(
      (s: { available: boolean }) => !s.available,
    );
    expect(unavailable.map((s: { id: string }) => s.id).sort()).toEqual([
      "trigger-collision",
      "unused",
    ]);
  });

  test("audit residency --machine emits the v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI(
      "audit",
      "residency",
      "--machine",
    );
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("audit residency");
    expect(envelope.data).toHaveProperty("candidates");
  });

  test("audit --help lists the residency subcommand", async () => {
    const { stdout } = await runCLI("audit", "--help");
    expect(stdout).toContain("residency");
  });

  test("unknown audit subcommand names residency", async () => {
    const { stderr, exitCode } = await runCLI("audit", "bogus");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("residency");
  });
});

describe("CLI integration: audit overlap (issue #566)", () => {
  test("audit overlap exits 0 and reports without changing anything", async () => {
    const { stdout, exitCode } = await runCLI("audit", "overlap");
    expect(exitCode).toBe(0);
    // The sandboxed home has no installed skills, so the report takes its
    // empty-set branch — same contract as the residency sibling above.
    expect(stdout).toContain("Semantic Overlap Audit");
  });

  test("--yes never triggers a removal on the overlap path", async () => {
    // The overlap report is advisory; only `audit -y` (duplicates) removes.
    const { stdout, stderr, exitCode } = await runCLI(
      "audit",
      "overlap",
      "--yes",
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Auto-removing");
    expect(stdout).not.toContain("Auto-removing");
  });

  test("audit overlap --json has the overlap report shape", async () => {
    const { stdout, exitCode } = await runCLI("audit", "overlap", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("scannedAt");
    expect(data).toHaveProperty("totalSkills");
    expect(data).toHaveProperty("comparedSkills");
    expect(Array.isArray(data.pairs)).toBe(true);
    expect(data).toHaveProperty("highConfidenceCount");
    for (const pair of data.pairs) {
      expect(typeof pair.score).toBe("number");
      expect(pair.a).toHaveProperty("name");
      expect(pair.b).toHaveProperty("path");
    }
  });

  test("audit overlap --machine emits the v1 envelope", async () => {
    const { stdout, exitCode } = await runCLI("audit", "overlap", "--machine");
    expect(exitCode).toBe(0);
    const envelope = JSON.parse(stdout);
    expect(envelope.version).toBe(1);
    expect(envelope.command).toBe("audit overlap");
    expect(envelope.data).toHaveProperty("pairs");
    expect(envelope.data).toHaveProperty("total_overlaps");
    expect(envelope.data).toHaveProperty("compared_skills");
  });

  test("audit --help lists the overlap subcommand", async () => {
    const { stdout } = await runCLI("audit", "--help");
    expect(stdout).toContain("overlap");
  });

  test("unknown audit subcommand names overlap too", async () => {
    const { stderr } = await runCLI("audit", "bogus");
    expect(stderr).toContain("overlap");
  });
});

// ─── CLI integration: audit security ────────────────────────────────────────

describe("CLI integration: audit security", () => {
  test("audit security with no target exits 2", async () => {
    const { stderr, exitCode } = await runCLI("audit", "security");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing target");
  });

  test("audit security refuses a `..` hidden in the ref before clone", async () => {
    const { stderr, exitCode } = await runCLI(
      "audit",
      "security",
      "github:acme/skills#main/../../x",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("escapes the repository");
    expect(stderr).not.toContain("Cloning");
  });

  test("audit security refuses a subpath that climbs out of the clone", async () => {
    const { stderr, exitCode } = await runCLI(
      "audit",
      "security",
      "github:acme/skills:../../../etc",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("escapes the repository");
    expect(stderr).not.toContain("Cloning");
  });

  test("audit security --all exits 0", async () => {
    const { exitCode } = await runCLI("audit", "security", "--all");
    expect(exitCode).toBe(0);
  });

  test("audit security --all --json returns valid JSON", async () => {
    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      "--all",
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
  });

  test("audit security non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "audit",
      "security",
      "zzz-nonexistent-skill-xyz-99999",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("audit security on installed skill returns verdict", async () => {
    // Get a skill name from list
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return; // skip if no skills installed

    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      skills[0].dirName,
    );
    expect(exitCode).toBe(0);
    // Output should contain verdict information
    expect(stdout.toLowerCase()).toMatch(/safe|caution|warning|dangerous/);
  });

  test("audit security on installed skill --json returns valid report", async () => {
    const listResult = await runCLI("list", "--json");
    const skills = JSON.parse(listResult.stdout);
    if (skills.length === 0) return;

    const { stdout, exitCode } = await runCLI(
      "audit",
      "security",
      skills[0].dirName,
      "--json",
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toHaveProperty("verdict");
    expect(data).toHaveProperty("skillName");
  });
});
