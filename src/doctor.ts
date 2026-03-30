/**
 * Environment health checks for `asm doctor`.
 *
 * Each check is a pure async function returning a CheckResult.
 * All independent checks run in parallel via Promise.allSettled.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { access, readFile, readdir, writeFile, rm, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { constants as fsConstants } from "fs";
import {
  loadConfig,
  getConfigPath,
  getLockPath,
  resolveProviderPath,
} from "./config";
import { readLock } from "./utils/lock";
import { REGISTRY_INDEX_URL } from "./registry";
import type { AppConfig, LockFile } from "./utils/types";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  passed: number;
  warnings: number;
  failures: number;
}

/** @internal — injectable exec override for testing check functions. */
export interface _DoctorExecOverrides {
  execFn?: typeof execFileAsync;
}

// ─── Individual Checks ──────────────────────────────────────────────────────

export async function checkGitAvailable(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    const { stdout } = await exec("git", ["--version"], {
      timeout: 5_000,
    });
    const version = stdout.trim().replace("git version ", "");
    return { name: "Git available", status: "pass", message: version };
  } catch {
    return {
      name: "Git available",
      status: "fail",
      message: "git not found",
      fix: "Install git: https://git-scm.com/downloads",
    };
  }
}

export async function checkGitVersion(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    const { stdout } = await exec("git", ["--version"], {
      timeout: 5_000,
    });
    const match = stdout.match(/(\d+)\.(\d+)/);
    if (!match) {
      return {
        name: "Git version",
        status: "warn",
        message: "Could not parse git version",
        fix: "Upgrade git: https://git-scm.com/downloads",
      };
    }
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    if (major > 2 || (major === 2 && minor >= 20)) {
      return {
        name: "Git version",
        status: "pass",
        message: `${major}.${minor} (>= 2.20)`,
      };
    }
    return {
      name: "Git version",
      status: "fail",
      message: `${major}.${minor} (requires >= 2.20)`,
      fix: "Upgrade git: https://git-scm.com/downloads",
    };
  } catch {
    // Gracefully skip when git is not available — checkGitAvailable
    // already reports a failure for missing git, so avoid a duplicate.
    return {
      name: "Git version",
      status: "pass",
      message: "Skipped — git not available",
    };
  }
}

export async function checkGhAvailable(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    const { stdout } = await exec("gh", ["--version"], {
      timeout: 5_000,
    });
    const firstLine = stdout.trim().split("\n")[0];
    const match = firstLine.match(/(\d+\.\d+\.\d+)/);
    const version = match ? match[1] : firstLine;
    return { name: "GitHub CLI available", status: "pass", message: version };
  } catch {
    return {
      name: "GitHub CLI available",
      status: "fail",
      message: "gh not found",
      fix: "Install GitHub CLI: https://cli.github.com",
    };
  }
}

export async function checkGhAuthenticated(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    const { stdout } = await exec("gh", ["auth", "status"], {
      timeout: 10_000,
    });
    // Extract username without leaking token.
    // NOTE: This regex is fragile — the `gh auth status` output format varies
    // across gh CLI versions (e.g. 2.x vs 3.x). If it breaks, consider using
    // `gh api user --jq .login` or `gh auth status --show-token` instead.
    const userMatch = stdout.match(/Logged in to .+ account (\S+)/);
    const user = userMatch ? userMatch[1] : "authenticated";
    return {
      name: "GitHub CLI authenticated",
      status: "pass",
      message: user,
    };
  } catch (err: any) {
    // gh auth status outputs to stderr on failure
    const stderr = err?.stderr ?? "";
    const userMatch = stderr.match(/Logged in to .+ account (\S+)/);
    if (userMatch) {
      return {
        name: "GitHub CLI authenticated",
        status: "pass",
        message: userMatch[1],
      };
    }
    return {
      name: "GitHub CLI authenticated",
      status: "fail",
      message: "Not authenticated",
      fix: "Run: gh auth login",
    };
  }
}

export async function checkNodeVersion(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    const { stdout } = await exec("node", ["--version"], {
      timeout: 5_000,
    });
    const version = stdout.trim().replace(/^v/, "");
    const major = parseInt(version.split(".")[0], 10);
    if (major >= 18) {
      return {
        name: "Node.js version",
        status: "pass",
        message: version,
      };
    }
    return {
      name: "Node.js version",
      status: "fail",
      message: `${version} (requires >= 18.0)`,
      fix: "Upgrade Node.js: https://nodejs.org",
    };
  } catch {
    return {
      name: "Node.js version",
      status: "fail",
      message: "node not found",
      fix: "Install Node.js >= 18: https://nodejs.org",
    };
  }
}

/** Check if a directory path is writable. Non-existent dirs count as writable (can be created). */
async function isWritableDir(
  path: string,
): Promise<{ writable: boolean; exists: boolean }> {
  try {
    const testFile = join(path, ".asm-doctor-write-test");
    await writeFile(testFile, "test", "utf-8");
    await rm(testFile);
    return { writable: true, exists: true };
  } catch {
    // Could not write — check if dir exists at all
  }
  try {
    await access(path, fsConstants.W_OK);
    return { writable: true, exists: true };
  } catch {
    // Not writable via access check
  }
  try {
    await access(path, fsConstants.F_OK);
    return { writable: false, exists: true };
  } catch {
    // Doesn't exist — count as writable (can be created later)
    return { writable: true, exists: false };
  }
}

export async function checkAgentDirsWritable(
  config: AppConfig,
): Promise<CheckResult> {
  const enabledProviders = config.providers.filter((p) => p.enabled);
  let writable = 0;
  let total = 0;

  for (const provider of enabledProviders) {
    const dir = resolveProviderPath(provider.global);
    total++;
    const result = await isWritableDir(dir);
    if (result.writable) {
      writable++;
    }
  }

  if (writable === total) {
    return {
      name: "Agent directories writable",
      status: "pass",
      message: `${writable}/${total} providers`,
    };
  }

  const unwritable = total - writable;
  return {
    name: "Agent directories writable",
    status: "warn",
    message: `${writable}/${total} providers (${unwritable} not writable)`,
    fix: "Fix permissions on agent skill directories",
  };
}

export async function checkConfigValid(): Promise<CheckResult> {
  const configPath = getConfigPath();
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);

    // Check for required structure
    const missingFields: string[] = [];
    if (parsed.version === undefined) missingFields.push("version");
    if (!Array.isArray(parsed.providers)) missingFields.push("providers");

    if (missingFields.length > 0) {
      return {
        name: "Config file valid",
        status: "fail",
        message: `Missing required fields: ${missingFields.join(", ")}`,
        fix: "Run: asm init",
      };
    }

    return {
      name: "Config file valid",
      status: "pass",
      message: "OK",
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {
        name: "Config file valid",
        status: "pass",
        message: "No config file (using defaults)",
      };
    }
    return {
      name: "Config file valid",
      status: "fail",
      message: "Corrupted or unreadable config",
      fix: "Run: asm init, or delete corrupted config",
    };
  }
}

export async function checkLockFileIntegrity(): Promise<CheckResult> {
  const lockPath = getLockPath();
  try {
    const raw = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed.version !== 1 || typeof parsed.skills !== "object") {
      return {
        name: "Lock file integrity",
        status: "fail",
        message: "Invalid lock file schema",
        fix: "Run: asm install to regenerate",
      };
    }

    const skills = parsed.skills as Record<string, unknown>;
    const entries = Object.entries(skills);
    const requiredFields = ["source", "installedAt", "provider"];
    const invalid: string[] = [];

    for (const [name, entry] of entries) {
      if (typeof entry !== "object" || entry === null) {
        invalid.push(name);
        continue;
      }
      const e = entry as Record<string, unknown>;
      for (const field of requiredFields) {
        if (!e[field]) {
          invalid.push(name);
          break;
        }
      }
    }

    if (invalid.length > 0) {
      return {
        name: "Lock file integrity",
        status: "warn",
        message: `${entries.length} skills tracked, ${invalid.length} with missing fields`,
        fix: "Run: asm install to regenerate",
      };
    }

    return {
      name: "Lock file integrity",
      status: "pass",
      message: `${entries.length} skills tracked`,
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {
        name: "Lock file integrity",
        status: "pass",
        message: "No lock file (first-time user)",
      };
    }
    return {
      name: "Lock file integrity",
      status: "fail",
      message: "Corrupted lock file",
      fix: "Run: asm install to regenerate",
    };
  }
}

export async function checkRegistryReachable(): Promise<CheckResult> {
  try {
    const response = await fetch(REGISTRY_INDEX_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      return {
        name: "Registry reachable",
        status: "pass",
        message: "OK",
      };
    }
    return {
      name: "Registry reachable",
      status: "fail",
      message: `HTTP ${response.status}`,
      fix: "Check network connection or proxy settings",
    };
  } catch {
    return {
      name: "Registry reachable",
      status: "fail",
      message: "Network error",
      fix: "Check network connection or proxy settings",
    };
  }
}

export async function checkInstalledSkillsIntact(
  config: AppConfig,
  lock: LockFile,
): Promise<CheckResult> {
  const entries = Object.entries(lock.skills);
  if (entries.length === 0) {
    return {
      name: "Installed skills intact",
      status: "pass",
      message: "No skills in lock file",
    };
  }

  const missing: string[] = [];

  for (const [name, entry] of entries) {
    // Find the provider config
    const provider = config.providers.find((p) => p.name === entry.provider);
    if (!provider) {
      missing.push(name);
      continue;
    }

    const dir = resolveProviderPath(provider.global);
    const skillDir = join(dir, name);

    try {
      const s = await stat(skillDir);
      if (!s.isDirectory()) {
        missing.push(name);
      }
    } catch {
      missing.push(name);
    }
  }

  if (missing.length === 0) {
    return {
      name: "Installed skills intact",
      status: "pass",
      message: `${entries.length} skills verified`,
    };
  }

  const first = missing[0];
  const extra = missing.length > 1 ? ` (+${missing.length - 1} more)` : "";
  return {
    name: "Installed skills intact",
    status: "fail",
    message: `Missing: ${first}${extra}`,
    fix: `Run: asm update ${first}`,
  };
}

export async function checkNoOrphanedSkills(
  config: AppConfig,
  lock: LockFile,
): Promise<CheckResult> {
  const lockedNames = new Set(Object.keys(lock.skills));
  const orphaned: string[] = [];

  for (const provider of config.providers.filter((p) => p.enabled)) {
    const dir = resolveProviderPath(provider.global);
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        // Only count directories (skills)
        try {
          const s = await stat(join(dir, entry));
          if (s.isDirectory() && !lockedNames.has(entry)) {
            orphaned.push(entry);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // Directory doesn't exist — no orphans possible
    }
  }

  if (orphaned.length === 0) {
    return {
      name: "No orphaned skills",
      status: "pass",
      message: "OK",
    };
  }

  return {
    name: "No orphaned skills",
    status: "warn",
    message: `${orphaned.length} skill(s) without lock entries`,
    fix: "Run: asm list to review",
  };
}

export async function checkDiskSpace(
  _overrides?: _DoctorExecOverrides,
): Promise<CheckResult> {
  const exec = _overrides?.execFn ?? execFileAsync;
  try {
    // Use df -Pk (POSIX mode) to standardize output across Linux distros.
    // -P forces single-line-per-filesystem and a consistent column layout:
    //   Filesystem 1024-blocks Used Available Capacity Mounted-on
    // This avoids issues with varying column indices or wrapped lines.
    const { stdout } = await exec("df", ["-Pk", homedir()], {
      timeout: 5_000,
    });
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) {
      return {
        name: "Disk space",
        status: "warn",
        message: "Could not parse df output",
      };
    }
    // POSIX df -Pk: available is always the 4th column (index 3)
    const parts = lines[1].split(/\s+/);
    const availableKB = parseInt(parts[3], 10);

    if (isNaN(availableKB)) {
      return {
        name: "Disk space",
        status: "warn",
        message: "Could not parse available space",
      };
    }

    const availableMB = availableKB / 1024;
    const availableGB = availableMB / 1024;

    if (availableMB > 100) {
      const display =
        availableGB >= 1
          ? `${availableGB.toFixed(1)} GB free`
          : `${Math.round(availableMB)} MB free`;
      return {
        name: "Disk space",
        status: "pass",
        message: `OK (${display})`,
      };
    }

    return {
      name: "Disk space",
      status: "fail",
      message: `${Math.round(availableMB)} MB free (requires > 100 MB)`,
      fix: "Free disk space in home directory",
    };
  } catch {
    return {
      name: "Disk space",
      status: "warn",
      message: "Could not check disk space",
    };
  }
}

// ─── Run All Checks ─────────────────────────────────────────────────────────

export async function runAllChecks(): Promise<DoctorReport> {
  const config = await loadConfig();
  const lock = await readLock();

  // Run independent checks in parallel
  const results = await Promise.allSettled([
    checkGitAvailable(),
    checkGitVersion(),
    checkGhAvailable(),
    checkGhAuthenticated(),
    checkNodeVersion(),
    checkAgentDirsWritable(config),
    checkConfigValid(),
    checkLockFileIntegrity(),
    checkRegistryReachable(),
    checkInstalledSkillsIntact(config, lock),
    checkNoOrphanedSkills(config, lock),
    checkDiskSpace(),
  ]);

  const checks: CheckResult[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // If a check itself threw, report it as a failure
    const names = [
      "Git available",
      "Git version",
      "GitHub CLI available",
      "GitHub CLI authenticated",
      "Node.js version",
      "Agent directories writable",
      "Config file valid",
      "Lock file integrity",
      "Registry reachable",
      "Installed skills intact",
      "No orphaned skills",
      "Disk space",
    ];
    return {
      name: names[i],
      status: "fail" as CheckStatus,
      message: `Check threw: ${r.reason}`,
    };
  });

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  return { checks, passed, warnings, failures };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: "\u2705",
  warn: "\u26A0\uFE0F ",
  fail: "\u274C",
};

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ["Checking your environment...", ""];

  for (const check of report.checks) {
    const icon = STATUS_ICONS[check.status];
    const line = `  ${icon} ${check.name}${check.message ? ` (${check.message})` : ""}`;
    lines.push(line);
    if (check.fix && check.status !== "pass") {
      let fixText: string;
      if (check.fix.startsWith("Run: ")) {
        fixText = check.fix;
      } else if (/^[a-z/~]/.test(check.fix)) {
        fixText = `Run: ${check.fix}`;
      } else {
        fixText = `Fix: ${check.fix}`;
      }
      lines.push(`      \u2192 ${fixText}`);
    }
  }

  lines.push("");
  lines.push(
    `${report.passed} passed, ${report.warnings} warning${report.warnings !== 1 ? "s" : ""}, ${report.failures} error${report.failures !== 1 ? "s" : ""}`,
  );

  return lines.join("\n");
}

export function formatDoctorJSON(report: DoctorReport): string {
  return JSON.stringify(
    {
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
      summary: {
        passed: report.passed,
        warnings: report.warnings,
        failures: report.failures,
      },
    },
    null,
    2,
  );
}

/**
 * @deprecated Superseded by the centralized machine envelope in utils/machine.ts.
 * Retained for backward compatibility with external consumers. Use formatMachineOutput() instead.
 */
export function formatDoctorMachine(report: DoctorReport): string {
  return JSON.stringify({
    v: 1,
    type: "doctor",
    data: {
      checks: report.checks.map((c) => ({
        name: c.name,
        status: c.status,
        message: c.message,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
      passed: report.passed,
      warnings: report.warnings,
      failures: report.failures,
    },
  });
}
