import { describe, expect, it } from "vitest";
import {
  collectHighCriticalAdvisories,
  evaluateReport,
  isAllowlistExpired,
  parseAllowlist,
  remainingAdvisories,
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
