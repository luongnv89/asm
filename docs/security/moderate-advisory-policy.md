# Moderate-Advisory Policy

**Decision (2026-09-12, #661):** moderate (and low) npm advisories are owned
by **Renovate `osvVulnerabilityAlerts`**, not by a dedicated CI job.
`scripts/ci-npm-audit.ts` continues to gate merges on **high/critical only**.

## Context

`scripts/ci-npm-audit.ts` invokes `npm audit --audit-level=high --json` from
the `audit` job in `.github/workflows/ci.yml`. That floor is correct — a
moderate advisory should not block a release — but before this decision no
mechanism tracked moderates at all, so they lingered unnoticed (a live
`vitest` moderate advisory was the trigger for this review, epic #656 /
F-CI-002).

## Options considered

| Option                                                              | Verdict                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Scheduled (weekly) non-gating CI job reporting moderate advisories  | Rejected — a new workflow, more CI surface, and reports nobody owns |
| Documented policy: Renovate `osvVulnerabilityAlerts` owns moderates | **Chosen** — zero new infrastructure; the mechanism already exists  |

## Why Renovate

`renovate.json` already sets:

```json
"osvVulnerabilityAlerts": true,
"vulnerabilityAlerts": {
  "minimumReleaseAge": "0 days",
  "labels": ["security"]
}
```

OSV vulnerability alerts are not severity-filtered: Renovate raises an update
PR for every advisory OSV reports — moderate and low included — bypassing the
repo's usual 7-day `minimumReleaseAge` and tagging the PR `security`. A
moderate advisory therefore already produces a visible, actionable, reviewable
PR instead of a CI line nobody reads. The weekly-report option would have
duplicated that signal at the cost of a new workflow file and its maintenance.

## Consequences

- `npm audit` below `--audit-level=high` is never run in CI; the `audit` job
  stays high/critical-only in both its `--omit=dev` and full passes.
- Moderate advisories are triaged through the Renovate `security`-labeled PR
  queue. If Renovate alerts are ever disabled, this policy must be revisited.
- The script header comment in `scripts/ci-npm-audit.ts` names the same owner
  so the two documents cannot silently disagree.
