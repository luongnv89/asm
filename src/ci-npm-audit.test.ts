import { describe, expect, it } from "vitest";
import {
  AUDIT_TIMEOUT_MS,
  collectHighCriticalAdvisories,
  evaluateReport,
  isAllowlistExpired,
  isNpmAuditTimeout,
  isNpmAuditUnavailable,
  parseAllowlist,
  parseNpmAuditOutput,
  remainingAdvisories,
  resolveNpmAuditSpawn,
} from "../scripts/ci-npm-audit.ts";

const VITEST_GHSA = "GHSA-5xrq-8626-4rwp";

function reportWith(
  advisories: Array<{ id: string; severity: string; name: string }>,
) {
  const vulnerabilities: Record<string, { via: object[] }> = {};
  for (const a of advisories) {
    vulnerabilities[a.name] = {
      via: [
        {
          source: 1,
          name: a.name,
          severity: a.severity,
          title: `${a.name} advisory`,
          url: `https://github.com/advisories/${a.id}`,
        },
      ],
    };
  }
  return { vulnerabilities };
}

describe("ci-npm-audit allowlist gate", () => {
  it("collects only high and critical GHSA ids", () => {
    const report = {
      vulnerabilities: {
        vitest: {
          via: [
            {
              severity: "critical",
              title: "Vitest UI file read",
              url: `https://github.com/advisories/${VITEST_GHSA}`,
              name: "vitest",
            },
            {
              severity: "moderate",
              title: "esbuild dev server",
              url: "https://github.com/advisories/GHSA-67mh-4wv8-2f99",
              name: "esbuild",
            },
            "vite",
          ],
        },
      },
    };
    const found = collectHighCriticalAdvisories(report);
    expect(found.map((a) => a.id)).toEqual([VITEST_GHSA.toUpperCase()]);
  });

  it("passes when the only high advisory is the allowlisted GHSA", () => {
    const { remaining } = evaluateReport(
      reportWith([{ id: VITEST_GHSA, severity: "critical", name: "vitest" }]),
      {
        allowlist: [VITEST_GHSA],
        expiresOn: "2026-09-19",
        now: new Date("2026-08-19T00:00:00Z"),
      },
    );
    expect(remaining).toEqual([]);
  });

  it("fails today when the allowlist entry is removed", () => {
    const { remaining } = evaluateReport(
      reportWith([{ id: VITEST_GHSA, severity: "critical", name: "vitest" }]),
      {
        allowlist: [],
        expiresOn: "2026-09-19",
        now: new Date("2026-08-19T00:00:00Z"),
      },
    );
    expect(remaining.map((a) => a.id)).toEqual([VITEST_GHSA.toUpperCase()]);
  });

  it("still fails on a different high advisory when the vitest GHSA is allowlisted", () => {
    const remaining = remainingAdvisories(
      collectHighCriticalAdvisories(
        reportWith([
          { id: VITEST_GHSA, severity: "critical", name: "vitest" },
          { id: "GHSA-52cp-r559-cp3m", severity: "high", name: "js-yaml" },
        ]),
      ),
      [VITEST_GHSA],
      "2026-09-19",
      new Date("2026-08-19T00:00:00Z"),
    );
    expect(remaining.map((a) => a.id)).toEqual(["GHSA-52CP-R559-CP3M"]);
  });

  it("ignores the allowlist after the written expiry date", () => {
    expect(
      isAllowlistExpired("2026-09-19", new Date("2026-09-20T00:00:00Z")),
    ).toBe(true);
    const { remaining, expired } = evaluateReport(
      reportWith([{ id: VITEST_GHSA, severity: "critical", name: "vitest" }]),
      {
        allowlist: [VITEST_GHSA],
        expiresOn: "2026-09-19",
        now: new Date("2026-09-20T00:00:00Z"),
      },
    );
    expect(expired).toBe(true);
    expect(remaining.map((a) => a.id)).toEqual([VITEST_GHSA.toUpperCase()]);
  });

  it("parses a comma-separated allowlist", () => {
    expect(parseAllowlist(" GHSA-5xrq-8626-4rwp , ")).toEqual([
      VITEST_GHSA.toUpperCase(),
    ]);
  });
});

const RETIRED_STDERR = [
  "npm error audit endpoint returned an error",
  "npm error 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick",
  "npm error This endpoint is being retired",
].join("\n");

describe("ci-npm-audit registry-unavailable skip", () => {
  it("classifies HTTP 400 Bad Request as unavailable", () => {
    expect(
      isNpmAuditUnavailable(
        "",
        "400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick",
        1,
      ),
    ).toBe(true);
    expect(
      resolveNpmAuditSpawn({
        error: null,
        status: 1,
        stdout: "",
        stderr: "400 Bad Request",
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("classifies the retired audits/quick endpoint as unavailable", () => {
    expect(isNpmAuditUnavailable("", RETIRED_STDERR, 1)).toBe(true);
  });

  it("skips non-JSON output when retirement markers are present", () => {
    expect(parseNpmAuditOutput("not json")).toBeNull();
    expect(
      resolveNpmAuditSpawn({
        error: null,
        status: 1,
        stdout: "Invalid package tree",
        stderr: RETIRED_STDERR,
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("does not classify a remaining-GHSA JSON report as unavailable", () => {
    const stdout = JSON.stringify(
      reportWith([{ id: VITEST_GHSA, severity: "critical", name: "vitest" }]),
    );
    expect(isNpmAuditUnavailable(stdout, "", 1)).toBe(false);
    const decision = resolveNpmAuditSpawn({
      error: null,
      status: 1,
      stdout,
      stderr: "",
    });
    expect(decision.kind).toBe("report");
    if (decision.kind !== "report") return;
    expect(evaluateReport(decision.report).remaining.map((a) => a.id)).toEqual([
      VITEST_GHSA.toUpperCase(),
    ]);
  });

  it("keeps local spawn failures as spawn-error (exit 2)", () => {
    expect(
      resolveNpmAuditSpawn({
        error: new Error("spawn npm ENOENT"),
        status: null,
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ kind: "spawn-error", message: "spawn npm ENOENT" });
  });

  it("treats generic unreadable JSON without retirement markers as unreadable", () => {
    expect(
      resolveNpmAuditSpawn({
        error: null,
        status: 1,
        stdout: "not json at all",
        stderr: "something went wrong",
      }),
    ).toEqual({ kind: "unreadable" });
  });

  it("does not skip on npm exit 1 without registry-unavailable markers", () => {
    expect(isNpmAuditUnavailable("{}", "", 1)).toBe(false);
    expect(isNpmAuditUnavailable("{}", "", 0)).toBe(false);
  });
});

describe("ci-npm-audit timeout skip (#608)", () => {
  it("exposes a 90s hard ceiling well under the 10-minute job timeout", () => {
    expect(AUDIT_TIMEOUT_MS).toBe(90_000);
    expect(AUDIT_TIMEOUT_MS).toBeLessThan(10 * 60 * 1000);
  });

  it("classifies a spawnSync ETIMEDOUT as a timeout", () => {
    const err = new Error("spawnSync npm ETIMEDOUT") as Error & {
      code?: string;
    };
    err.code = "ETIMEDOUT";
    expect(isNpmAuditTimeout({ error: err, status: null })).toBe(true);
  });

  it("classifies a SIGTERM kill with no output as a timeout", () => {
    expect(
      isNpmAuditTimeout({ error: null, status: null, signal: "SIGTERM" }),
    ).toBe(true);
  });

  it("does not classify ordinary failures as timeouts", () => {
    expect(isNpmAuditTimeout({ error: null, status: 1 })).toBe(false);
    expect(
      isNpmAuditTimeout({
        error: new Error("spawn npm ENOENT"),
        status: null,
      }),
    ).toBe(false);
  });

  it("resolves a timed-out spawn to unavailable (skip exit 0)", () => {
    const err = new Error("spawnSync npm ETIMEDOUT") as Error & {
      code?: string;
    };
    err.code = "ETIMEDOUT";
    expect(
      resolveNpmAuditSpawn({ error: err, status: null, signal: "SIGTERM" }),
    ).toEqual({ kind: "unavailable" });
  });

  it("keeps a real ENOENT spawn failure as spawn-error", () => {
    expect(
      resolveNpmAuditSpawn({
        error: new Error("spawn npm ENOENT"),
        status: null,
      }),
    ).toEqual({ kind: "spawn-error", message: "spawn npm ENOENT" });
  });
});
