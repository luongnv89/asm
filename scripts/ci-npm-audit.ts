#!/usr/bin/env npx tsx
/**
 * Fail the CI job on high/critical npm advisories, including devDependencies.
 *
 * Invokes `npm audit --audit-level=high --json` (no --omit=dev). An optional
 * time-boxed allowlist (ASM_AUDIT_ALLOWLIST + ASM_AUDIT_ALLOWLIST_EXPIRES)
 * may suppress specific GHSA ids. After the expiry date (UTC, inclusive)
 * the allowlist is ignored. An allowlist without an expiry is never honoured.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GHSA_RE = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i;
const HIGH_SEVS = new Set(["high", "critical"]);

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
  const result = spawnSync("npm", ["audit", "--audit-level=high", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    console.error(`npm audit failed to start: ${result.error.message}`);
    process.exit(2);
  }
  const stdout = result.stdout || "";
  try {
    return JSON.parse(stdout);
  } catch {
    console.error("npm audit --json produced unreadable output");
    if (result.stderr) console.error(result.stderr);
    process.exit(2);
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
