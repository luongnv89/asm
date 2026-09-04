#!/usr/bin/env npx tsx
/**
 * Fail the CI job on high/critical npm advisories.
 *
 * Invokes `npm audit --audit-level=high --json`. Pass `--omit=dev` to audit
 * production dependencies only. Registry HTTP 400 / retired `audits/quick`
 * responses are skipped (exit 0), not treated as lockfile or advisory
 * failures. A hung `npm audit` (retired endpoint never replies — see #608)
 * is time-boxed by AUDIT_TIMEOUT_MS and skipped the same way. An optional
 * time-boxed allowlist (ASM_AUDIT_ALLOWLIST +
 * ASM_AUDIT_ALLOWLIST_EXPIRES) may suppress specific GHSA ids. After the
 * expiry date (UTC, inclusive) the allowlist is ignored. An allowlist
 * without an expiry is never honoured.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GHSA_RE = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;
const HIGH_SEVS = new Set(["high", "critical"]);

/** Tight markers for a retired / HTTP-400 npm audit registry — not every npm exit 1. */
const AUDIT_UNAVAILABLE_MARKERS = [
  "400 Bad Request",
  "audits/quick",
  "audit endpoint returned an error",
  "This endpoint is being retired",
] as const;

/** Hard ceiling for one `npm audit` spawn — the retired endpoint hangs (#608). */
export const AUDIT_TIMEOUT_MS = 90_000;

export type NpmAuditSpawnInput = {
  error?: (Error & { code?: string }) | null;
  status: number | null;
  signal?: string | null;
  stdout?: string | null;
  stderr?: string | null;
};

export type NpmAuditSpawnDecision =
  | { kind: "unavailable" }
  | { kind: "report"; report: unknown }
  | { kind: "spawn-error"; message: string }
  | { kind: "unreadable" };

export function isNpmAuditUnavailable(
  stdout: string,
  stderr: string,
  status: number | null,
): boolean {
  // npm exits 1 on real high/critical advisories — status alone is never a skip.
  if (status === 0) return false;
  const haystack = `${stdout}\n${stderr}`;
  return AUDIT_UNAVAILABLE_MARKERS.some((marker) => haystack.includes(marker));
}

export function parseNpmAuditOutput(stdout: string): unknown | null {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

export function isNpmAuditTimeout(result: NpmAuditSpawnInput): boolean {
  const code = (result.error as { code?: string } | null)?.code;
  if (code === "ETIMEDOUT") return true;
  // spawnSync with `timeout` kills via SIGTERM; a SIGTERM kill means the
  // spawn did not exit on its own, so any partial output is untrustworthy
  // and the hang skips rather than failing the job.
  if (result.signal === "SIGTERM") return true;
  return false;
}

export function resolveNpmAuditSpawn(
  result: NpmAuditSpawnInput,
): NpmAuditSpawnDecision {
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (isNpmAuditTimeout(result)) {
    return { kind: "unavailable" };
  }
  if (result.error) {
    return { kind: "spawn-error", message: result.error.message };
  }
  if (isNpmAuditUnavailable(stdout, stderr, result.status)) {
    return { kind: "unavailable" };
  }
  const report = parseNpmAuditOutput(stdout);
  if (report === null) {
    return { kind: "unreadable" };
  }
  return { kind: "report", report };
}

export function npmAuditCliArgs(argv: string[]): string[] {
  const args = ["audit", "--audit-level=high", "--json"];
  if (argv.includes("--omit=dev")) args.push("--omit=dev");
  return args;
}

export type Advisory = {
  id: string;
  severity: string;
  title: string;
  name: string;
};

type ViaObject = {
  severity?: string;
  url?: string;
  title?: string;
  name?: string;
};

type AuditReport = {
  vulnerabilities?: Record<string, { via?: Array<ViaObject | string> }>;
};

export function collectHighCriticalAdvisories(report: unknown): Advisory[] {
  const found = new Map<string, Advisory>();
  const vulns = (report as AuditReport | undefined)?.vulnerabilities ?? {};
  for (const [pkg, entry] of Object.entries(vulns)) {
    for (const item of entry?.via ?? []) {
      if (!item || typeof item !== "object") continue;
      if (!item.severity || !HIGH_SEVS.has(item.severity)) continue;
      const match = String(item.url ?? "").match(GHSA_RE);
      if (!match) continue;
      const id = match[0].toUpperCase();
      if (!found.has(id)) {
        found.set(id, {
          id,
          severity: item.severity,
          title: item.title ?? "",
          name: item.name ?? pkg,
        });
      }
    }
  }
  return [...found.values()];
}

export function parseAllowlist(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => id.toUpperCase());
}

/** True when expiresOn is missing, unparsable, or now is after that UTC day. */
export function isAllowlistExpired(
  expiresOn: string | undefined,
  now = new Date(),
): boolean {
  if (!expiresOn) return true;
  const end = Date.parse(`${expiresOn}T23:59:59.999Z`);
  if (Number.isNaN(end)) return true;
  return now.getTime() > end;
}

export function remainingAdvisories(
  advisories: Advisory[],
  allowlist: string[],
  expiresOn: string | undefined,
  now = new Date(),
): Advisory[] {
  const expired = isAllowlistExpired(expiresOn, now);
  const allowed = new Set(
    expired ? [] : allowlist.map((id) => id.toUpperCase()),
  );
  return advisories.filter((a) => !allowed.has(a.id.toUpperCase()));
}

export function evaluateReport(
  report: unknown,
  options: { allowlist?: string[]; expiresOn?: string; now?: Date } = {},
): { advisories: Advisory[]; remaining: Advisory[]; expired: boolean } {
  const { allowlist = [], expiresOn, now } = options;
  const advisories = collectHighCriticalAdvisories(report);
  const remaining = remainingAdvisories(advisories, allowlist, expiresOn, now);
  return { advisories, remaining, expired: isAllowlistExpired(expiresOn, now) };
}

function runNpmAudit(): unknown {
  const result = spawnSync("npm", npmAuditCliArgs(process.argv.slice(2)), {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: AUDIT_TIMEOUT_MS,
  });
  const decision = resolveNpmAuditSpawn(result);
  switch (decision.kind) {
    case "spawn-error":
      console.error(`npm audit failed to start: ${decision.message}`);
      process.exit(2);
      break;
    case "unavailable":
      if (isNpmAuditTimeout(result)) {
        console.log(
          `npm audit skipped: timed out after ${AUDIT_TIMEOUT_MS / 1000}s (retired endpoint hang)`,
        );
      } else {
        console.log(
          "npm audit skipped: registry audit endpoint unavailable (HTTP 400 / retired)",
        );
      }
      process.exit(0);
      break;
    case "unreadable":
      console.error("npm audit --json produced unreadable output");
      if (result.stderr) console.error(result.stderr);
      process.exit(2);
      break;
    case "report":
      return decision.report;
  }
}

function main(): void {
  const allowlist = parseAllowlist(process.env.ASM_AUDIT_ALLOWLIST);
  const expiresOn = process.env.ASM_AUDIT_ALLOWLIST_EXPIRES || "";
  if (allowlist.length > 0 && !expiresOn) {
    console.error(
      "ASM_AUDIT_ALLOWLIST_EXPIRES is required when ASM_AUDIT_ALLOWLIST is set",
    );
    process.exit(2);
  }

  const { advisories, remaining, expired } = evaluateReport(runNpmAudit(), {
    allowlist,
    expiresOn,
  });

  if (allowlist.length > 0) {
    console.log(
      `Allowlist: ${allowlist.join(", ")} (expires ${expiresOn} UTC` +
        `${expired ? "; EXPIRED — not applied" : ""})`,
    );
  }

  if (remaining.length === 0) {
    const suppressed = advisories.length - remaining.length;
    console.log(
      `npm audit --audit-level=high: no blocking advisories` +
        (suppressed ? ` (${suppressed} allowlisted)` : ""),
    );
    process.exit(0);
  }

  console.error("npm audit --audit-level=high failed:");
  for (const a of remaining) {
    console.error(`  ${a.severity} ${a.id} ${a.name}: ${a.title}`);
  }
  process.exit(1);
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main();
}
