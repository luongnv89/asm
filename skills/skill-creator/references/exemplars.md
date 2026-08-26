# Annotated Exemplars

Three compact, annotated exemplar skills — one per archetype. Imitation beats rules: before drafting, find the archetype closest to the skill you're building and pattern-match against it. Annotations (`> ✎`) explain _why_ each section earns its place; everything unannotated is deliberately ordinary.

Contents:

1. [Workflow skill — `release-cut`](#exemplar-1--workflow-skill-release-cut) — sequential process with gates and checkable bars
2. [Knowledge skill — `postgres-migrations`](#exemplar-2--knowledge-skill-postgres-migrations) — conventions and judgment, no fake step list
3. [Orchestrator skill — `dependency-audit`](#exemplar-3--orchestrator-skill-dependency-audit) — subagent fan-out with fresh-context review
4. [What all three share](#what-all-three-share)

---

## Exemplar 1 — Workflow skill: `release-cut`

The archetype for skills that drive a **repeatable multi-step process** where order matters and steps can fail.

```yaml
---
name: release-cut
description: "Cut a release: bump the version, update the changelog, tag, and push. Use when asked to release, ship a version, or tag a build. Don't use for deploying to environments, publishing to npm/PyPI, or hotfix backports."
license: MIT
effort: medium
metadata:
  version: 1.2.0
  author: "Jane Doe <jane@example.com>"
---
```

> ✎ The description leads with verbs and names each distinct trigger **once** (release / ship a version / tag a build are one branch said three ways a user might say it — acceptable because users genuinely vary here; don't add a fourth). The negative half names _adjacent domains that share keywords_: "deploy", "publish", and "hotfix" all co-occur with "release" in real requests but are different jobs. Under 250 chars, so nothing truncates in the `/skills` listing.

```markdown
# Release Cut

Cut a version release: preflight → bump → changelog → tag → push. Stop at any
failed gate and report — never tag a broken tree.

## Repo Sync Before Edits (mandatory)

branch="$(git rev-parse --abbrev-ref HEAD)"; git fetch origin && git pull --rebase origin "$branch"

If the tree is dirty: stash, sync, pop. If origin is missing or the rebase
conflicts, stop and ask the user.
```

> ✎ The opening line is the whole skill in one sentence — an agent that reads nothing else still knows the shape and the prime directive ("never tag a broken tree"). Repo-mutating skill → repo-sync section near the top, as the standard requires.

```markdown
## Step 1 — Preflight (all must pass)

Run each gate; a non-zero exit fails the release:

1. Working tree clean: `git status --porcelain` prints nothing
2. Tests pass: project test command exits 0
3. On a releasable branch: `main` or `release/*` — anything else, ask the user

## Step 2 — Decide the bump

| Change since last tag            | Bump  |
| -------------------------------- | ----- |
| Breaking API change              | major |
| New feature, backward compatible | minor |
| Fixes, docs, internal only       | patch |

Read `git log <last-tag>..HEAD --oneline` and classify. If mixed, the highest
class wins. State your classification and the evidence before bumping.
```

> ✎ Every gate is **checkable** — tied to a command exit or output, not "make sure things look good". The bump decision gives _criteria plus a tiebreak rule_ ("highest class wins"), so two runs on the same history make the same call — that's predictability. "State your classification and the evidence" makes the judgment auditable instead of silent.

```markdown
## Step 3 — Execute

1. Bump the version file; update CHANGELOG.md from the commit log (group by type)
2. Commit: `release: v<X.Y.Z>` — this commit contains ONLY the bump + changelog
3. Tag `v<X.Y.Z>` and push branch + tag. Push only after the user confirms,
   unless they asked for the full cut up front.

## Step 4 — Report

◆ Release cut (v1.2.0 → v1.3.0)
··································································
Preflight gates: √ 3/3
Changelog updated: √ 14 commits grouped
Tag pushed: √ v1.3.0
Result: PASS
```

> ✎ The push — the one irreversible step — is gated on user confirmation _unless already authorized_, matching how approval actually flows in a session. The Step Completion Report names checks specific to this skill, not boilerplate rows.

**Why this skill is great:** a fixed spine with explicit gates; every completion bar checkable; judgment points (bump class) constrained by criteria and a tiebreak; the irreversible action confirmed; ~60 lines total with nothing to move to `references/` — small skills should stay one file.

---

## Exemplar 2 — Knowledge skill: `postgres-migrations`

The archetype for skills that encode **conventions and judgment**, not a process. The most common authoring mistake here is cosplaying as a workflow ("Step 1: think about the schema…") — a knowledge skill should read like a senior colleague's rules of thumb, organized so the right rule is findable at the moment it's needed.

```yaml
---
name: postgres-migrations
description: "Postgres schema-migration conventions: safe DDL, lock awareness, expand-contract rollouts. Use when writing or reviewing migration files. Don't use for query tuning, ORM model design, or ad-hoc data backfills."
license: MIT
effort: low
metadata:
  version: 2.0.1
  author: "Jane Doe <jane@example.com>"
---
```

> ✎ `effort: low` — applying known conventions doesn't need deep reasoning; picking the right effort level is part of authoring. The negative triggers fence off the neighbors that share vocabulary (queries, models, backfills).

```markdown
# Postgres Migrations

Two leading words used throughout:

- **expand-contract** — never change in place: add the new thing (expand), migrate
  readers/writers, then remove the old (contract) in a later migration.
- **lock-hostile** — any DDL that takes ACCESS EXCLUSIVE on a hot table long
  enough to queue traffic behind it.

## The one rule that outranks the others

A migration must be safe to run while the previous app version is still serving
traffic. Every convention below is a consequence of that.
```

> ✎ **Leading words defined once, at the top,** then reused — every later rule can say "that's lock-hostile" instead of re-explaining. The "one rule that outranks the others" gives the agent a tiebreaker for situations the conventions don't cover: derive from the principle instead of guessing.

```markdown
## Safe / unsafe DDL

| Operation                               | Verdict      | Instead                                |
| --------------------------------------- | ------------ | -------------------------------------- |
| ADD COLUMN (nullable, no default)       | safe         | —                                      |
| ADD COLUMN ... DEFAULT (v11+)           | safe         | —                                      |
| CREATE INDEX                            | lock-hostile | CREATE INDEX CONCURRENTLY, outside txn |
| ALTER COLUMN TYPE                       | lock-hostile | expand-contract: new column + backfill |
| ADD CONSTRAINT ... NOT VALID + VALIDATE | safe         | always split into these two steps      |

**Bad** (rewrites the table under ACCESS EXCLUSIVE):
`ALTER TABLE orders ALTER COLUMN total TYPE numeric(12,2);`

**Good** (expand-contract):
`ALTER TABLE orders ADD COLUMN total_v2 numeric(12,2);` → backfill in batches →
swap readers → drop old column in a later migration.

For batched backfill mechanics read `references/backfills.md`; for lock/timeout
settings read `references/locking.md`.
```

> ✎ The table is scannable at the moment of need — verdict _and_ the replacement, co-located. One good/bad pair beats three paragraphs of prose; the agent pattern-matches examples better than descriptions. Depth (backfill batch sizes, `lock_timeout` values) lives one level down in `references/`, each behind a pointer that says **when** to read it, not just that it exists.

**Why this skill is great:** no fake step list; leading words compress every rule that follows; a ranked principle resolves novel cases; examples and verdict tables over prose; per-topic references keep the always-loaded body small.

---

## Exemplar 3 — Orchestrator skill: `dependency-audit`

The archetype for skills where the **main agent coordinates and subagents do the heavy reading** — the main context never fills with raw file dumps.

```yaml
---
name: dependency-audit
description: "Audit dependencies for license and maintenance risk using parallel subagents. Use when asked to audit, vet, or inventory project dependencies. Don't use for CVE/vulnerability scanning, version upgrades, or lockfile conflicts."
license: MIT
effort: high
metadata:
  version: 1.0.3
  author: "Jane Doe <jane@example.com>"
---
```

```markdown
# Dependency Audit

You are the orchestrator. You inventory, delegate, merge, and report — you do
NOT read package metadata files yourself, and you do NOT open the `references/`
or `agents/` files a phase needs. Each phase names the slice its worker gets;
you hold the step list and the workers' returns, never the tree.

## Phase 1 — Inventory (you)

List manifests (package.json, pyproject.toml, go.mod, …) and split dependencies
into one batch per ecosystem. This is cheap; do it inline.

## Phase 2 — Fan out (workers, parallel)

Spawn one worker per ecosystem IN THE SAME TURN so they run concurrently.
Each worker gets the contract in `agents/worker.md`:

- Input (slice): `agents/worker.md` + `references/license-policy.md` — the only
  two files this phase reads; plus the ecosystem name and dependency list
- Output: JSON array — {name, license, last_release, maintainers, risk, why}
- A worker that can't resolve a package returns it with risk: "unknown" — it
  never silently drops one.
```

> ✎ Line one draws the boundary that keeps the orchestrator lean — "you do NOT read the files yourself." The worker contract pins **input and output shape** (and the no-silent-drop rule), so the merge step can be dumb and reliable. The full worker prompt lives in `agents/worker.md`, keeping SKILL.md orchestration-only.

```markdown
## Phase 3 — Merge and flag (you)

Merge worker JSON, sort by risk, and draft the report table.

## Phase 4 — Fresh-context review (reviewer, mandatory)

Spawn a NEW subagent — never one that produced findings — with
`agents/reviewer.md`, the merged table, and the raw worker outputs. It checks:
coverage (every manifest dependency appears), consistency (risk labels match
the stated criteria), and unsupported claims. Fix what it finds, then report.

- Input (slice): `agents/reviewer.md` + `references/risk-criteria.md`, the
  merged table, the raw worker outputs
- Output: {coverage_gaps[], inconsistent[], unsupported[]} — empty arrays on a
  clean pass

If the Agent tool is unavailable, degrade gracefully: read the named slices
yourself, do the phases inline, in order, and say so in the report.
```

**Delegation trace — what the main agent actually holds:**

| Phase | Worker slice (its `Input`)                           | Main agent keeps            |
| ----- | ---------------------------------------------------- | --------------------------- |
| 1     | — inline; listing manifests is cheap                 | the manifest list           |
| 2     | `agents/worker.md` + `references/license-policy.md`  | the returned JSON arrays    |
| 3     | — inline merge over returned JSON                    | the merged table            |
| 4     | `agents/reviewer.md` + `references/risk-criteria.md` | the reviewer's three arrays |

Four bundled files exist; the main agent opens **none** of them. Phases 1 and 3
stay inline because a slice buys nothing there — `subagent-patterns.md` →
_When the slice isn't worth it_.

> ✎ The reviewer is **fresh context by construction** — the author of the findings never grades them (self-review blindness is the failure mode this prevents). Its checklist is concrete: coverage, consistency, unsupported claims — not "review the quality". The degradation clause means the skill still works on Claude.ai, single-context.

**Why this skill is great:** clean role boundary held by per-step slices — the
orchestrator's context is the step list plus the workers' returns, never the
`references/` tree; contracts make parallelism safe; the mandatory fresh reviewer catches what the producer can't see; graceful degradation is spelled out instead of assumed.

---

## What all three share

- **Description discipline** — verbs first, one clause per real branch, negative triggers naming keyword-sharing neighbors, ≤250 chars.
- **Checkable bars** — every "done" is a command exit, file state, count, or table verdict; judgment points come with criteria and a tiebreak.
- **Right-sized structure** — small skill stays one file; conventions split per-topic; orchestration splits per-role into `agents/`. Structure follows the archetype, not habit.
- **Version + author under `metadata:`**, quoted values where YAML needs it, and an `effort` chosen deliberately.
- **Nothing decorative** — no section exists to look complete; each survives the pruning pass because removing it would change agent behavior.
