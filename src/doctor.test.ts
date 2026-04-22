import { describe, expect, test } from "vitest";

import {
  checkGitAvailable,
  checkGitVersion,
  checkGhAvailable,
  checkGhAuthenticated,
  checkNodeVersion,
  checkConfigValid,
  checkLockFileIntegrity,
  checkRegistryReachable,
  checkDiskSpace,
  checkAgentDirsWritable,
  checkInstalledSkillsIntact,
  checkNoOrphanedSkills,
  checkNoPathShadowing,
  formatDoctorReport,
  formatDoctorJSON,
  formatDoctorMachine,
} from "./doctor";
import type {
  DoctorReport,
  CheckResult,
  CheckStatus,
  _DoctorExecOverrides,
} from "./doctor";
import type { AppConfig, LockFile } from "./utils/types";
import { getDefaultConfig } from "./config";

function makeReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    checks: [
      { name: "Git available", status: "pass", message: "2.43.0" },
      {
        name: "Config file valid",
        status: "warn",
        message: "missing fields",
        fix: "Run: asm init",
      },
      {
        name: "Registry reachable",
        status: "fail",
        message: "Network error",
        fix: "Check network",
      },
    ],
    passed: 1,
    warnings: 1,
    failures: 1,
    ...overrides,
  };
}

// ─── Individual checks ──────────────────────────────────────────────────────

describe("checkGitAvailable", () => {
  test("returns pass when git is installed", async () => {
    const result = await checkGitAvailable();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Git available");
    expect(result.message).toBeTruthy();
  });
});

describe("checkGitVersion", () => {
  test("returns pass for git >= 2.20", async () => {
    const result = await checkGitVersion();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Git version");
  });
});

describe("checkGhAvailable", () => {
  test("returns pass when gh is installed", async () => {
    const result = await checkGhAvailable();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("GitHub CLI available");
  });
});

describe("checkGhAuthenticated", () => {
  test("returns pass or fail (environment-dependent)", async () => {
    const result = await checkGhAuthenticated();
    expect(["pass", "fail"]).toContain(result.status);
    expect(result.name).toBe("GitHub CLI authenticated");
  });

  test("includes fix suggestion on failure", async () => {
    const result = await checkGhAuthenticated();
    if (result.status === "fail") {
      expect(result.fix).toBeDefined();
      expect(result.fix).toContain("gh auth login");
    }
  });

  test("returns a non-empty message", async () => {
    const result = await checkGhAuthenticated();
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("checkNodeVersion", () => {
  test("returns pass for node >= 18", async () => {
    const result = await checkNodeVersion();
    expect(result.status).toBe("pass");
    expect(result.name).toBe("Node.js version");
  });
});

describe("checkDiskSpace", () => {
  test("returns pass or warn (never throws)", async () => {
    const result = await checkDiskSpace();
    expect(["pass", "warn", "fail"]).toContain(result.status);
    expect(result.name).toBe("Disk space");
  });
});

describe("checkNoPathShadowing", () => {
  test("returns pass or warn (environment-dependent)", async () => {
    const result = await checkNoPathShadowing();
    expect(["pass", "warn"]).toContain(result.status);
    expect(result.name).toBe("No PATH shadowing");
    expect(typeof result.message).toBe("string");
  });

  test("includes fix suggestion when shadowing detected", async () => {
    const result = await checkNoPathShadowing();
    if (result.status === "warn" && result.message.includes("shadowed")) {
      expect(result.fix).toBeDefined();
      expect(result.fix!.length).toBeGreaterThan(0);
    }
  });
});

describe("checkConfigValid", () => {
  test("returns pass or fail for current environment", async () => {
    const result = await checkConfigValid();
    expect(["pass", "fail"]).toContain(result.status);
    expect(result.name).toBe("Config file valid");
  });
});

describe("checkLockFileIntegrity", () => {
  test("returns pass or warn for current environment", async () => {
    const result = await checkLockFileIntegrity();
    expect(["pass", "warn"]).toContain(result.status);
    expect(result.name).toBe("Lock file integrity");
  });
});

describe("checkRegistryReachable", () => {
  test("returns pass or fail (network-dependent)", async () => {
    const result = await checkRegistryReachable();
    expect(["pass", "fail"]).toContain(result.status);
    expect(result.name).toBe("Registry reachable");
  });
});

describe("checkAgentDirsWritable", () => {
  test("returns pass for default config", async () => {
    const config = getDefaultConfig();
    const result = await checkAgentDirsWritable(config);
    expect(["pass", "warn"]).toContain(result.status);
    expect(result.name).toBe("Agent directories writable");
  });
});

describe("checkInstalledSkillsIntact", () => {
  test("returns pass when lock is empty", async () => {
    const config = getDefaultConfig();
    const lock: LockFile = { version: 1, skills: {} };
    const result = await checkInstalledSkillsIntact(config, lock);
    expect(result.status).toBe("pass");
    expect(result.message).toBe("No skills in lock file");
  });

  test("returns fail when locked skill directory is missing", async () => {
    const config = getDefaultConfig();
    const lock: LockFile = {
      version: 1,
      skills: {
        "nonexistent-skill": {
          source: "https://github.com/test/test",
          commitHash: "abc123",
          ref: null,
          installedAt: new Date().toISOString(),
          provider: "claude",
        },
      },
    };
    const result = await checkInstalledSkillsIntact(config, lock);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("nonexistent-skill");
  });
});

describe("checkNoOrphanedSkills", () => {
  test("returns pass when no orphaned skills", async () => {
    const config = getDefaultConfig();
    const lock: LockFile = { version: 1, skills: {} };
    const result = await checkNoOrphanedSkills(config, lock);
    // Could be pass or warn depending on what's on disk
    expect(["pass", "warn"]).toContain(result.status);
    expect(result.name).toBe("No orphaned skills");
  });
});

// ─── CheckResult shape ──────────────────────────────────────────────────────

describe("CheckResult shape", () => {
  test("all checks return required fields", async () => {
    const checks: CheckResult[] = [
      await checkGitAvailable(),
      await checkGitVersion(),
      await checkNodeVersion(),
      await checkDiskSpace(),
      await checkConfigValid(),
      await checkLockFileIntegrity(),
    ];

    for (const check of checks) {
      expect(typeof check.name).toBe("string");
      expect(check.name.length).toBeGreaterThan(0);
      expect(["pass", "warn", "fail"]).toContain(check.status);
      expect(typeof check.message).toBe("string");
      if (check.status !== "pass" && check.fix) {
        expect(typeof check.fix).toBe("string");
      }
    }
  });
});

// ─── Formatters ─────────────────────────────────────────────────────────────

describe("formatDoctorReport", () => {
  test("includes header and summary line", () => {
    const report = makeReport();
    const output = formatDoctorReport(report);
    expect(output).toContain("Checking your environment...");
    expect(output).toContain("1 passed");
    expect(output).toContain("1 warning");
    expect(output).toContain("1 error");
  });

  test("includes fix suggestions for non-pass checks", () => {
    const report = makeReport();
    const output = formatDoctorReport(report);
    expect(output).toContain("Run: asm init");
    expect(output).toContain("Fix: Check network");
  });

  test("does not double-prefix 'Run: ' when fix already starts with it", () => {
    const report = makeReport({
      checks: [
        {
          name: "Config file valid",
          status: "warn",
          message: "missing fields",
          fix: "Run: asm init",
        },
      ],
      passed: 0,
      warnings: 1,
      failures: 0,
    });
    const output = formatDoctorReport(report);
    expect(output).toContain("Run: asm init");
    expect(output).not.toContain("Run: Run:");
  });

  test("prepends 'Fix: ' for non-command fix suggestions", () => {
    const report = makeReport({
      checks: [
        {
          name: "Registry reachable",
          status: "fail",
          message: "Network error",
          fix: "Check network",
        },
      ],
      passed: 0,
      warnings: 0,
      failures: 1,
    });
    const output = formatDoctorReport(report);
    expect(output).toContain("Fix: Check network");
    expect(output).not.toContain("Run: Check network");
  });

  test("prepends 'Run: ' when fix starts with a command (lowercase)", () => {
    const report = makeReport({
      checks: [
        {
          name: "GitHub CLI authenticated",
          status: "fail",
          message: "Not authenticated",
          fix: "gh auth login",
        },
      ],
      passed: 0,
      warnings: 0,
      failures: 1,
    });
    const output = formatDoctorReport(report);
    expect(output).toContain("Run: gh auth login");
  });

  test("prepends 'Run: ' when fix starts with a path (/ or ~)", () => {
    const report = makeReport({
      checks: [
        {
          name: "Test",
          status: "fail",
          message: "broken",
          fix: "/usr/local/bin/fixme",
        },
      ],
      passed: 0,
      warnings: 0,
      failures: 1,
    });
    const output = formatDoctorReport(report);
    expect(output).toContain("Run: /usr/local/bin/fixme");
  });

  test("does not include fix for passing checks", () => {
    const report = makeReport({
      checks: [{ name: "Test", status: "pass", message: "OK", fix: "nope" }],
      passed: 1,
      warnings: 0,
      failures: 0,
    });
    const output = formatDoctorReport(report);
    expect(output).not.toContain("nope");
  });
});

describe("formatDoctorJSON", () => {
  test("produces valid JSON with checks and summary", () => {
    const report = makeReport();
    const parsed = JSON.parse(formatDoctorJSON(report));
    expect(parsed.checks).toHaveLength(3);
    expect(parsed.summary.passed).toBe(1);
    expect(parsed.summary.warnings).toBe(1);
    expect(parsed.summary.failures).toBe(1);
  });

  test("includes fix only when present", () => {
    const report = makeReport();
    const parsed = JSON.parse(formatDoctorJSON(report));
    // First check (pass) has no fix field
    expect(parsed.checks[0].fix).toBeUndefined();
    // Second check (warn) has a fix
    expect(parsed.checks[1].fix).toBe("Run: asm init");
  });
});

describe("formatDoctorMachine", () => {
  test("produces v1 envelope format", () => {
    const report = makeReport();
    const parsed = JSON.parse(formatDoctorMachine(report));
    expect(parsed.v).toBe(1);
    expect(parsed.type).toBe("doctor");
    expect(parsed.data.checks).toHaveLength(3);
    expect(parsed.data.passed).toBe(1);
    expect(parsed.data.warnings).toBe(1);
    expect(parsed.data.failures).toBe(1);
  });

  test("is single-line JSON (no pretty print)", () => {
    const report = makeReport();
    const output = formatDoctorMachine(report);
    expect(output.includes("\n")).toBe(false);
  });
});

// ─── Unit tests for failure/warning paths (with injectable _overrides) ─────
//
// These tests use the injectable `_overrides.execFn` pattern so the actual
// check functions are called (not tautological inline constructions).

/** Helper: create a mock execFn that resolves with given stdout. */
function mockExec(stdout: string): any {
  return async () => ({ stdout, stderr: "" });
}

/** Helper: create a mock execFn that rejects with given error. */
function mockExecFail(message = "command not found", stderr = ""): any {
  return async () => {
    const err: any = new Error(message);
    err.stderr = stderr;
    throw err;
  };
}

describe("checkGitAvailable — failure path (mocked)", () => {
  test("returns fail when git is not found", async () => {
    const result = await checkGitAvailable({
      execFn: mockExecFail("ENOENT"),
    });
    expect(result.status).toBe("fail");
    expect(result.message).toBe("git not found");
    expect(result.fix).toContain("git-scm.com");
  });

  test("returns pass with version string when git is available", async () => {
    const result = await checkGitAvailable({
      execFn: mockExec("git version 2.43.0\n"),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toBe("2.43.0");
  });
});

describe("checkGitVersion — mocked paths", () => {
  test("returns pass with skip message when git is absent", async () => {
    const result = await checkGitVersion({
      execFn: mockExecFail("ENOENT"),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toContain("Skipped");
    expect(result.fix).toBeUndefined();
  });

  test("returns fail when git version is too old", async () => {
    const result = await checkGitVersion({
      execFn: mockExec("git version 2.10.3\n"),
    });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("2.10");
    expect(result.message).toContain("requires");
  });

  test("returns warn when version string is unparseable", async () => {
    const result = await checkGitVersion({
      execFn: mockExec("git version unknown\n"),
    });
    expect(result.status).toBe("warn");
    expect(result.message).toContain("Could not parse");
  });

  test("returns pass for git >= 2.20", async () => {
    const result = await checkGitVersion({
      execFn: mockExec("git version 2.40.1\n"),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toContain("2.40");
  });
});

describe("checkNodeVersion — mocked paths", () => {
  test("returns fail when node is not found", async () => {
    const result = await checkNodeVersion({
      execFn: mockExecFail("ENOENT"),
    });
    expect(result.status).toBe("fail");
    expect(result.message).toBe("node not found");
    expect(result.fix).toContain("nodejs.org");
  });

  test("returns fail when node version is too old", async () => {
    const result = await checkNodeVersion({
      execFn: mockExec("v16.20.0\n"),
    });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("16.20.0");
    expect(result.message).toContain("requires");
  });

  test("returns pass for node >= 18", async () => {
    const result = await checkNodeVersion({
      execFn: mockExec("v20.11.1\n"),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toBe("20.11.1");
  });
});

describe("checkDiskSpace — mocked paths", () => {
  test("returns fail when disk space is low", async () => {
    const dfOutput = [
      "Filesystem 1024-blocks Used Available Capacity Mounted",
      "/dev/sda1 100000000 99948800 51200 100% /home",
    ].join("\n");
    const result = await checkDiskSpace({ execFn: mockExec(dfOutput) });
    expect(result.status).toBe("fail");
    expect(result.message).toContain("50 MB free");
    expect(result.fix).toBeDefined();
  });

  test("returns pass with GB display when space is sufficient", async () => {
    const dfOutput = [
      "Filesystem 1024-blocks Used Available Capacity Mounted",
      "/dev/sda1 100000000 89524224 10485760 90% /home",
    ].join("\n");
    const result = await checkDiskSpace({ execFn: mockExec(dfOutput) });
    expect(result.status).toBe("pass");
    expect(result.message).toContain("10.0 GB free");
  });

  test("returns pass with MB display for 100MB-1GB range", async () => {
    // 500 MB = 512000 KB
    const dfOutput = [
      "Filesystem 1024-blocks Used Available Capacity Mounted",
      "/dev/sda1 100000000 99488000 512000 99% /home",
    ].join("\n");
    const result = await checkDiskSpace({ execFn: mockExec(dfOutput) });
    expect(result.status).toBe("pass");
    expect(result.message).toContain("500 MB free");
  });

  test("returns warn when df output is unparseable", async () => {
    const result = await checkDiskSpace({
      execFn: mockExec("unexpected output"),
    });
    expect(result.status).toBe("warn");
  });

  test("returns warn when df command fails", async () => {
    const result = await checkDiskSpace({
      execFn: mockExecFail("df not found"),
    });
    expect(result.status).toBe("warn");
    expect(result.message).toContain("Could not check");
  });
});

describe("checkGhAuthenticated — mocked paths", () => {
  test("returns pass when gh auth status succeeds", async () => {
    const result = await checkGhAuthenticated({
      execFn: mockExec(
        "github.com\n  Logged in to github.com account testuser (keyring)\n",
      ),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toBe("testuser");
  });

  test("returns pass when auth info is in stderr", async () => {
    const result = await checkGhAuthenticated({
      execFn: mockExecFail(
        "exit status 1",
        "github.com\n  Logged in to github.com account ghuser (token)\n",
      ),
    });
    expect(result.status).toBe("pass");
    expect(result.message).toBe("ghuser");
  });

  test("returns fail when not authenticated", async () => {
    const result = await checkGhAuthenticated({
      execFn: mockExecFail("not logged in", "You are not logged in"),
    });
    expect(result.status).toBe("fail");
    expect(result.message).toBe("Not authenticated");
    expect(result.fix).toContain("gh auth login");
  });
});
