import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createDirSymlink } from "./utils/fs";
import { join } from "path";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  lstat,
  readlink,
} from "fs/promises";
import { tmpdir, homedir } from "os";
import { runCLI } from "./cli-test-harness";

// `asm init`/`asm link` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: init ──────────────────────────────────────────────────

describe("CLI integration: init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("init missing name exits 2", async () => {
    const { stderr, exitCode } = await runCLI("init");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("init with --path scaffolds skill directory", async () => {
    const skillDir = join(tempDir, "test-skill");
    const { stderr, exitCode } = await runCLI(
      "init",
      "test-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Done!");

    // Verify SKILL.md was created
    const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: test-skill");
  });

  test("init creates SKILL.md with correct content", async () => {
    const skillDir = join(tempDir, "my-skill");
    await runCLI("init", "my-skill", "--path", skillDir);
    const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: my-skill");
    expect(skillMd).toContain("version: 0.1.0");
    expect(skillMd).toContain("# my-skill");
  });

  test("init with --path --force overwrites existing", async () => {
    const skillDir = join(tempDir, "force-skill");
    // First init
    const { exitCode: code1 } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
    );
    expect(code1).toBe(0);

    // Second init with --force
    const { exitCode: code2 } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
      "--force",
    );
    expect(code2).toBe(0);
  });

  test("init existing dir without --force in non-TTY exits 2", async () => {
    const skillDir = join(tempDir, "existing-skill");
    // First init to create the directory
    await runCLI("init", "my-skill", "--path", skillDir);

    // Second init without --force
    const { stderr, exitCode } = await runCLI(
      "init",
      "my-skill",
      "--path",
      skillDir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain("already exists");
  });

  test("main --help includes init command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("init");
  });
});

// ─── CLI integration: link ──────────────────────────────────────────────────

describe("CLI integration: link", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-test-link-"));
    // Create a valid skill source
    await mkdir(join(tempDir, "source-skill"), { recursive: true });
    await writeFile(
      join(tempDir, "source-skill", "SKILL.md"),
      `---
name: test-link-skill
metadata:
  version: 1.0.0
---
# Test Link Skill
`,
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("link missing path exits 2", async () => {
    const { stderr, exitCode } = await runCLI("link");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Missing required argument");
  });

  test("link non-existent path exits 1 with a polished error (not a Node crash)", async () => {
    const { stderr, exitCode } = await runCLI(
      "link",
      "/tmp/asm-nonexistent-path-999999",
    );
    expect(exitCode).toBe(1);
    // Polished error from `error()` — must not include a Node stack trace.
    expect(stderr).toMatch(/Error: No such skill or path/);
    expect(stderr).not.toMatch(/at discoverLinkableSkills/);
    expect(stderr).not.toMatch(/at async cmdLink/);
  });

  test("link with bare registry-style name suggests `asm install` (issue #261)", async () => {
    // A bare name that does not exist as a local path is the user-reported
    // failure mode in #261. The previous behavior crashed with a Node stack
    // trace; the fix prints an actionable suggestion.
    const { stderr, exitCode } = await runCLI("link", "code-review");
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/No such skill or path: code-review/);
    expect(stderr).toMatch(/looks like a registry name/);
    expect(stderr).toMatch(/asm install code-review/);
    expect(stderr).not.toMatch(/at discoverLinkableSkills/);
  });

  test("link with scoped registry name (author/name) suggests `asm install`", async () => {
    const { stderr, exitCode } = await runCLI("link", "luongnv89/code-review");
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/No such skill or path: luongnv89\/code-review/);
    expect(stderr).toMatch(/looks like a registry name/);
    expect(stderr).toMatch(/asm install luongnv89\/code-review/);
  });

  test("link follows directory symlinks at the source path (issue #261)", async () => {
    // Linking via a path that is itself a symlink-to-directory used to crash
    // because `lstat` on the symlink reports `isDirectory()=false`.
    const realDir = join(tempDir, "real-skill");
    await mkdir(realDir);
    await writeFile(
      join(realDir, "SKILL.md"),
      `---\nname: link-via-symlink\nversion: 1.0.0\n---\n# Body\n`,
    );
    const linkedSrc = join(tempDir, "linked-src");
    await createDirSymlink(realDir, linkedSrc);
    // The link name comes from the source directory basename, not the SKILL.md
    // name field, so the resulting symlink lives under "linked-src".
    const providerLink = join(homedir(), ".claude", "skills", "linked-src");
    try {
      const { exitCode, stdout } = await runCLI(
        "link",
        linkedSrc,
        "--force",
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.name).toBe("linked-src");
    } finally {
      await rm(providerLink, { force: true }).catch(() => {});
    }
  });

  test("link path without any SKILL.md exits 1", async () => {
    // Create a directory with no SKILL.md at root or in subdirectories
    const emptyDir = join(tempDir, "empty-dir");
    await mkdir(emptyDir, { recursive: true });
    await mkdir(join(emptyDir, "subdir"), { recursive: true });
    const { stderr, exitCode } = await runCLI("link", emptyDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error");
  });

  test("link --name with multi-skill folder exits 2", async () => {
    // Create a folder with multiple skill subdirectories
    const multiDir = join(tempDir, "multi");
    await mkdir(join(multiDir, "skill-a"), { recursive: true });
    await mkdir(join(multiDir, "skill-b"), { recursive: true });
    await writeFile(
      join(multiDir, "skill-a", "SKILL.md"),
      `---\nname: skill-a\nversion: 1.0.0\n---\n# Skill A\n`,
    );
    await writeFile(
      join(multiDir, "skill-b", "SKILL.md"),
      `---\nname: skill-b\nversion: 1.0.0\n---\n# Skill B\n`,
    );
    const { stderr, exitCode } = await runCLI(
      "link",
      multiDir,
      "--name",
      "custom",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      "--name cannot be used when linking multiple skills",
    );
  });

  test("link --name with single discovered skill in multi-skill mode applies the custom name", async () => {
    // Create a folder with a single skill subdirectory (no root SKILL.md)
    const multiDir = join(tempDir, "multi-single");
    await mkdir(join(multiDir, "only-skill"), { recursive: true });
    await writeFile(
      join(multiDir, "only-skill", "SKILL.md"),
      `---\nname: only-skill\nversion: 1.0.0\n---\n# Only Skill\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const customLink = join(providerDir, "custom");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        multiDir,
        "--name",
        "custom",
        "--force",
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("custom");
    } finally {
      await rm(customLink, { force: true }).catch(() => {});
    }
  });

  test("link multi-skill folder with --force creates symlinks for all skills", async () => {
    // Create a folder with two skill subdirectories
    const multiDir = join(tempDir, "multi-happy");
    await mkdir(join(multiDir, "test-link-skill-a"), { recursive: true });
    await mkdir(join(multiDir, "test-link-skill-b"), { recursive: true });
    await writeFile(
      join(multiDir, "test-link-skill-a", "SKILL.md"),
      `---\nname: test-link-skill-a\nversion: 1.0.0\n---\n# Test Link Skill A\n`,
    );
    await writeFile(
      join(multiDir, "test-link-skill-b", "SKILL.md"),
      `---\nname: test-link-skill-b\nversion: 2.0.0\n---\n# Test Link Skill B\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "test-link-skill-a");
    const linkB = join(providerDir, "test-link-skill-b");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        multiDir,
        "--force",
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(2);
      expect(result.linked.map((l: any) => l.name).sort()).toEqual([
        "test-link-skill-a",
        "test-link-skill-b",
      ]);

      // Verify symlinks actually exist
      const statsA = await lstat(linkA);
      expect(statsA.isSymbolicLink()).toBe(true);
      const targetA = await readlink(linkA);
      expect(targetA).toBe(join(multiDir, "test-link-skill-a"));

      const statsB = await lstat(linkB);
      expect(statsB.isSymbolicLink()).toBe(true);
      const targetB = await readlink(linkB);
      expect(targetB).toBe(join(multiDir, "test-link-skill-b"));
    } finally {
      // Clean up created symlinks
      await rm(linkA, { force: true }).catch(() => {});
      await rm(linkB, { force: true }).catch(() => {});
    }
  });

  test("link multi-skill partial failure returns JSON with results and failures and exits 1", async () => {
    // Create a folder with two skill subdirectories
    const multiDir = join(tempDir, "multi-partial");
    await mkdir(join(multiDir, "partial-skill-ok"), { recursive: true });
    await mkdir(join(multiDir, "partial-skill-fail"), { recursive: true });
    await writeFile(
      join(multiDir, "partial-skill-ok", "SKILL.md"),
      `---\nname: partial-skill-ok\nversion: 1.0.0\n---\n# Partial OK\n`,
    );
    await writeFile(
      join(multiDir, "partial-skill-fail", "SKILL.md"),
      `---\nname: partial-skill-fail\nversion: 1.0.0\n---\n# Partial Fail\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkOk = join(providerDir, "partial-skill-ok");
    const linkFail = join(providerDir, "partial-skill-fail");

    // Pre-create the target for partial-skill-fail as a regular directory so
    // linking it without --force will fail (non-TTY, no --force).
    await mkdir(linkFail, { recursive: true });

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        multiDir,
        "--tool",
        "claude",
        "--json",
      );
      expect(exitCode).toBe(1);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);

      // One skill should have linked successfully
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("partial-skill-ok");

      // One skill should have failed
      expect(result.failures.length).toBe(1);
      expect(result.failures[0].name).toBe("partial-skill-fail");
      expect(result.failures[0].error).toContain("already exists");
    } finally {
      await rm(linkOk, { force: true }).catch(() => {});
      await rm(linkFail, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("link two explicit skill paths links both --json", async () => {
    // Create two individual skill directories
    const skillA = join(tempDir, "explicit-skill-a");
    const skillB = join(tempDir, "explicit-skill-b");
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: explicit-skill-a\nversion: 1.0.0\n---\n# Explicit Skill A\n`,
    );
    await writeFile(
      join(skillB, "SKILL.md"),
      `---\nname: explicit-skill-b\nversion: 1.0.0\n---\n# Explicit Skill B\n`,
    );

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "explicit-skill-a");
    const linkB = join(providerDir, "explicit-skill-b");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        skillA,
        skillB,
        "--tool",
        "claude",
        "--force",
        "--json",
      );
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.linked.length).toBe(2);
      const names = result.linked.map((r: { name: string }) => r.name).sort();
      expect(names).toEqual(["explicit-skill-a", "explicit-skill-b"]);
      expect(result.failures.length).toBe(0);
    } finally {
      await rm(linkA, { force: true }).catch(() => {});
      await rm(linkB, { force: true }).catch(() => {});
    }
  });

  test("link multiple explicit paths with --name exits 2", async () => {
    const skillA = join(tempDir, "name-guard-skill-a");
    const skillB = join(tempDir, "name-guard-skill-b");
    await mkdir(skillA, { recursive: true });
    await mkdir(skillB, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: name-guard-skill-a\nversion: 1.0.0\n---\n# Guard A\n`,
    );
    await writeFile(
      join(skillB, "SKILL.md"),
      `---\nname: name-guard-skill-b\nversion: 1.0.0\n---\n# Guard B\n`,
    );

    const { stderr, exitCode } = await runCLI(
      "link",
      skillA,
      skillB,
      "--name",
      "custom",
      "--tool",
      "claude",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain(
      "--name cannot be used when linking multiple paths",
    );
  });

  test("link multiple explicit paths one invalid continues and reports failure --json", async () => {
    const skillA = join(tempDir, "partial-explicit-ok");
    await mkdir(skillA, { recursive: true });
    await writeFile(
      join(skillA, "SKILL.md"),
      `---\nname: partial-explicit-ok\nversion: 1.0.0\n---\n# Partial Explicit OK\n`,
    );
    const badPath = join(tempDir, "nonexistent-skill");

    const providerDir = join(homedir(), ".claude", "skills");
    const linkA = join(providerDir, "partial-explicit-ok");

    try {
      const { stdout, exitCode } = await runCLI(
        "link",
        skillA,
        badPath,
        "--tool",
        "claude",
        "--force",
        "--json",
      );
      expect(exitCode).toBe(1);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.linked.length).toBe(1);
      expect(result.linked[0].name).toBe("partial-explicit-ok");
      expect(result.failures.length).toBe(1);
    } finally {
      await rm(linkA, { force: true }).catch(() => {});
    }
  });

  test("main --help includes link command", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("link");
  });
});
