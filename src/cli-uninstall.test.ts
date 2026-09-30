import { describe, test, expect, beforeAll } from "vitest";
import { join, dirname } from "path";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { tmpdir } from "os";
import { runCLI } from "./cli-test-harness";

// `asm uninstall` CLI tests — split from cli.test.ts (issue #678).
describe("CLI integration: uninstall", () => {
  test("missing skill name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("uninstall");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("non-existent skill exits 1", async () => {
    const { stderr, exitCode } = await runCLI(
      "uninstall",
      "zzz-nonexistent-skill-xyz-99999",
      "--yes",
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ─── CLI integration: uninstall lock-entry cleanup (issue #284) ─────────────
//
// Partial uninstall via `-t <provider>` must preserve `.skill-lock.json`
// source-tracking metadata (source, commitHash, ref) when other providers
// still have the skill installed. Full uninstall (no `-t`) still drops the
// entry. The lock entry's `provider` field is repointed when a real-folder
// relocation moved the canonical home, and left as-is otherwise.

describe("CLI integration: uninstall lock-entry cleanup", () => {
  let lockPath: string;

  beforeAll(async () => {
    const { stdout } = await runCLI("config", "path");
    // config path looks like /<home>/.config/agent-skill-manager/config.json
    lockPath = join(dirname(stdout.trim()), ".skill-lock.json");
  });

  async function readLockSkill(name: string) {
    try {
      const raw = await readFile(lockPath, "utf-8");
      const lock = JSON.parse(raw);
      return lock.skills?.[name] ?? null;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  test("partial uninstall with -t preserves lock entry when other provider survives", async () => {
    const tmpDir = await mkdtemp(
      join(tmpdir(), "cli-uninstall-lock-preserve-"),
    );
    const skillDir = join(tmpDir, "lock-preserve-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: lock-preserve-skill\ndescription: A test skill\nversion: 1.0.0\n---\n# lock-preserve-skill\n`,
    );

    try {
      // Install into both providers (two separate real-folder installs)
      const r1 = await runCLI(
        "install",
        skillDir,
        "--yes",
        "--force",
        "--tool",
        "claude",
      );
      expect(r1.exitCode).toBe(0);
      const r2 = await runCLI(
        "install",
        skillDir,
        "--yes",
        "--force",
        "--tool",
        "codex",
      );
      expect(r2.exitCode).toBe(0);

      // Lock entry exists after the second install
      const before = await readLockSkill("lock-preserve-skill");
      expect(before).not.toBeNull();
      const sourceBefore = before.source;
      const installedAtBefore = before.installedAt;

      // Partial uninstall of claude only; codex still installed
      const u = await runCLI(
        "uninstall",
        "lock-preserve-skill",
        "--yes",
        "--tool",
        "claude",
      );
      expect(u.exitCode).toBe(0);

      // Lock entry must still exist and retain source-tracking metadata
      const after = await readLockSkill("lock-preserve-skill");
      expect(after).not.toBeNull();
      expect(after.source).toBe(sourceBefore);
      expect(after.installedAt).toBe(installedAtBefore);
    } finally {
      // Clean up remaining install (codex) — full uninstall drops the entry
      await runCLI("uninstall", "lock-preserve-skill", "--yes");
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("full uninstall (no -t) removes the lock entry", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-uninstall-lock-full-"));
    const skillDir = join(tmpDir, "lock-full-uninstall-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: lock-full-uninstall-skill\ndescription: A test skill\nversion: 1.0.0\n---\n# lock-full-uninstall-skill\n`,
    );

    try {
      const r = await runCLI(
        "install",
        skillDir,
        "--yes",
        "--force",
        "--tool",
        "claude",
      );
      expect(r.exitCode).toBe(0);
      expect(await readLockSkill("lock-full-uninstall-skill")).not.toBeNull();

      const u = await runCLI("uninstall", "lock-full-uninstall-skill", "--yes");
      expect(u.exitCode).toBe(0);

      expect(await readLockSkill("lock-full-uninstall-skill")).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("partial uninstall with -t removes lock entry when no other providers survive", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "cli-uninstall-lock-tonly-"));
    const skillDir = join(tmpDir, "lock-tonly-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: lock-tonly-skill\ndescription: A test skill\nversion: 1.0.0\n---\n# lock-tonly-skill\n`,
    );

    try {
      // Install only into claude
      const r = await runCLI(
        "install",
        skillDir,
        "--yes",
        "--force",
        "--tool",
        "claude",
      );
      expect(r.exitCode).toBe(0);
      expect(await readLockSkill("lock-tonly-skill")).not.toBeNull();

      // Partial uninstall via -t claude, no other providers — entry must drop
      const u = await runCLI(
        "uninstall",
        "lock-tonly-skill",
        "--yes",
        "--tool",
        "claude",
      );
      expect(u.exitCode).toBe(0);

      expect(await readLockSkill("lock-tonly-skill")).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
