---
name: skill-auto-improver
description: "Improve an external, legacy, or drifted SKILL.md to the skill-creator standard — hard validation gates plus an advisory predictability audit. Don't use for authoring from scratch (skill-creator output is already standard), bulk eval, or prose edits."
license: MIT
compatibility: "Claude Code; requires `asm` on PATH and Python 3 for skill-creator's quick_validate.py"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 2.1.0
  author: luongnv89
---

# Skill Auto-Improver

You run an eval-driven loop that **retrofits an existing SKILL.md to the current skill-creator standard**. It is the remediation tool for skills that did **not** go through skill-creator — external, legacy, manually-authored, or drifted. Fresh skill-creator output is publish-ready by construction and should not normally need it.

The target clears **two hard gates**, then gets one **advisory** audit:

1. **Gate 1 — skill-creator standard (must-pass floor)** — `quick_validate` clean, Frontmatter Audit passes, within the size caps.
2. **Gate 2 — asm-eval floor (supplementary)** — `overallScore > 85` AND every category `>= 8`.
3. **Advisory — predictability audit (Phase 2b)** — judgment-based findings against skill-creator's rubric, reported separately, **never** blocking.

A skill that scores 92 but fails `quick_validate.py` is not done; one that passes it but scores 70 is not done either. **Both gates must clear, or the loop reports a blocker** — open predictability findings alone never make one.

## Two modes

Pick one before Phase 0 — they do not share a workflow.

- **Mode 1 — retrofit (default).** Bring the target to the skill-creator standard via the Phase 0–7 loop below. Every "improve", "fix", "level up", or "bring up to standard" request is Mode 1.
- **Mode 2 — delegation conversion (opt-in).** Restructure the target's steps onto **per-step context delegation**: each heavy step names the slice of its own `references/` tree its worker needs and hands it over as that worker's `Input`. Runs **outside** the Phase 6 loop, on a target that already clears Gate 1, and only once the user confirms. A Phase 2b delegability finding routes here but never starts a conversion by itself. Procedure: `references/delegation-conversion.md`.

## Dependency Preflight (mandatory)

This skill invokes `skill-creator`: it runs that skill's `quick_validate.py` (required — the Gate 1 validator) and reads its `predictability-rubric.md` (**fail-soft** — a local copy may predate the rubric, and a missing one only degrades Phase 2b to a warning). Resolve both **before the repo sync below**, the first step that changes anything:

```bash
date +%s >&2                      # anchors the Run stats block below — read it off stderr
QV="$HOME/.claude/skills/skill-creator/scripts/quick_validate.py"
test -f "$QV" || {
  echo "Missing required skill: skill-creator" >&2
  echo "Install it:      asm install skill-creator -p claude --yes" >&2
  echo "No asm yet:      npm install -g agent-skill-manager" >&2
  echo "Verify:          asm list -p claude --json | grep 'skill-creator'" >&2
  exit 1
}
RUBRIC="$HOME/.claude/skills/skill-creator/references/predictability-rubric.md"
test -f "$RUBRIC" || echo "⚠ predictability rubric missing — Phase 2b degraded (gates unaffected)"
```

`-p claude` is not decoration: `asm install` refuses to guess a provider non-interactively, `--yes` does not cover that choice, and naming the same provider in the verification stops an install under a different tool from reporting success while `$QV` is still missing.

On a miss, stop before the first mutation and print those commands — never continue with a partial run. This is the gate this skill audits every target for (`references/skill-creator-checklist.md` → _Dependency preflight_).

## Repo Sync Before Edits (mandatory)

This skill mutates files in a git repo. Sync the branch with the remote before any edit:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --rebase origin "$branch"
```

If the tree is dirty, `git stash`, sync, `git stash pop`. If `origin` is missing or the pull conflicts, **stop and ask the user** — never skip or force the sync.

## When to Use

Reach for this on an **existing, external, legacy, manually-authored, or drifted** skill:

- The user asks to "improve", "level up", "fix", "polish", or "bring up to standard" an existing skill
- A skill was authored outside skill-creator — hand-written, imported, inherited — and must meet the current bar
- A skill has **drifted**: it predates the standard, or edits left it failing `quick_validate.py` or below the 85/8 floor
- You are preparing such a skill for `asm publish` or a catalog

**Not** for fresh skill-creator output (author with `/skill-creator`), and not for a report only (`asm eval` plus `quick_validate.py`, run directly). Assumes a SKILL.md exists.

## Prerequisites

Verify all of these before touching any files. Stop and tell the user if any fails.

- `asm` is on PATH (`command -v asm`)
- Python 3 is available — `quick_validate.py` itself is resolved by _Dependency Preflight (mandatory)_, the only place that handles a miss
- The target skill path contains a `SKILL.md`
- The working tree has no unrelated uncommitted edits — dirty files get mixed into diffs
- You have write access to the skill directory

## Inputs

One of: a local skill path (`skills/foo`, `/abs/path/to/skill`), a `SKILL.md` file path (treated as its parent directory), or a GitHub shorthand (`github:owner/repo[:path/to/skill]`).

For a GitHub input, ask the user to clone locally first. This skill edits **locally**; remote editing is out of scope for v1.

## The Gates

**Hard gates** (Gate 1, Gate 2) are mechanical and pass/fail — they alone decide PASS vs BLOCKER. **Predictability findings** (Phase 2b) are judgment-based and advisory: both gates green with open findings is still a PASS. Green gates do not guarantee the skill drives the same _process_ each run — that is what Phase 2b catches, and `references/predictability-audit.md` holds its checklist and finding classes.

### Gate 1 — Skill-creator standard (must-pass floor)

A skill passes when **all** of these hold:

- `python "$QV" "$SKILL_PATH"` exits 0
- The Frontmatter Audit passes — checklist in `references/frontmatter-audit.md`
- The body is under 500 lines **and** under 3000 words
- The description carries a negative-trigger clause naming adjacent domains that should not trigger the skill
- `metadata.version` is `MAJOR.MINOR.PATCH`; `metadata.author` is present
- A `docs/README.md`, if present, opens with the AI-skip HTML comment
- Any bundled script under `scripts/` prints a descriptive error on stderr before exiting
- **If the target skill invokes another skill**, it carries a dependency preflight naming each dependency, its install command, the command that installs the installer itself, and a verification step (`references/skill-creator-checklist.md` → _Dependency preflight_). A target that invokes none needs no such section — never add an empty one

This gate is **non-negotiable**: `asm publish` and the catalog rely on it.

### Gate 2 — asm-eval 85/8 quality floor (supplementary)

```
overallScore > 85   AND   min(categories[*].score) >= 8
```

Stricter than overall alone — 86 with a 5 in `testability` still fails — so one strong area cannot hide a weak one.

## Workflow

Do these phases in order; never skip one or reorder them. **Phase 4 is a continuous sidebar running throughout Phase 3, not a standalone step**, which is why it has no Step Completion Report of its own.

### Phase 0 — Capture baseline against both gates

Save the starting state so the before/after diff is auditable:

```bash
mkdir -p .asm-improver
asm eval "$SKILL_PATH" --json > .asm-improver/baseline.json
python "$QV" "$SKILL_PATH" > .asm-improver/baseline-quickvalidate.txt 2>&1 || true
```

Then run the **Frontmatter Audit** from `references/frontmatter-audit.md`, saving findings to `.asm-improver/baseline-frontmatter-audit.md`. In a git repo, suggest adding `.asm-improver/` to `.gitignore`.

Read the JSON and note `overallScore`, `grade`, all 7 `categories[].score`, and `topSuggestions`. Each category's `findings` carry the measured numbers behind its score — body word count among them. Use those; never approximate by hand.

If the baseline passes **both** gates, stop: print a one-line summary and skip to the final report. A delegability finding is not a reason to keep going in Mode 1 — offer Mode 2 instead.

### Phase 1 — Apply deterministic fixes, then normalize frontmatter

Run the evaluator's auto-fixer for free wins:

```bash
asm eval "$SKILL_PATH" --fix --dry-run   # preview the diff
asm eval "$SKILL_PATH" --fix              # write, creates SKILL.md.bak
```

It handles trailing whitespace, CRLF normalization, and a missing `effort`. A dry-run reporting **"No fixes needed"** satisfies this phase — do not apply `--fix` anyway.

#### Frontmatter normalization (mandatory after `--fix`)

When it does write, `--fix` adds a top-level `author:` (from `git config user.name`) and/or `version: 0.1.0`, both of which `quick_validate.py` rejects as unexpected keys. Apply `references/frontmatter-audit.md` → _Normalizing `asm eval --fix` output_. Then re-run **both** checks:

```bash
asm eval "$SKILL_PATH" --json > .asm-improver/iter-1.json
python "$QV" "$SKILL_PATH"
```

Many skills jump 5–15 points here without touching the body, and `quick_validate.py` typically goes from fail to pass.

### Phase 2 — Fix Gate 1 failures first

`quick_validate.py` and the Frontmatter Audit come first because they gate publish. `references/skill-creator-checklist.md` carries the fix for each failing check — frontmatter, description, body size, the `docs/README.md` AI-skip notice, script stderr, version, and preflight. Work it top to bottom.

One check has no mechanical validator behind it, so look for it deliberately: **Skill invokes another skill with no preflight gate**, or one that never explains installation. Detect it by scanning for `/skill-name` invocations, reads under `~/.claude/skills/` or `~/.agents/skills/`, and phases handed to a named skill; remediate with the checklist's _Dependency preflight_ section.

Re-run `python "$QV" "$SKILL_PATH"` after every Gate 1 edit. Do not enter Phase 2b until Gate 1 is clean.

### Phase 2b — Audit against the predictability rubric (advisory)

With Gate 1 clean, audit against skill-creator's rubric **before** Phase 3, so findings can steer your category edits. Advisory — never gates, never blocks.

1. Confirm `$RUBRIC` resolved (_Dependency Preflight (mandatory)_). If missing, **skip fail-soft**: log `⚠ predictability audit skipped (rubric unavailable)` and go to Phase 3.
2. Walk `references/predictability-audit.md`, marking each of its 7 items `pass` or `advisory` with a specific note, and save the walk to `.asm-improver/predictability-audit.md`. Item #4's **delegability sub-check** names which step is not delegable and why; its remediation is Mode 2, never a Mode 1 edit.

Act on a finding only when the fix is _targeted_ — one often lifts an asm-eval category too. Never bloat to satisfy one; that rule is in the same reference.

### Phase 3 — Fix the lowest asm-eval categories

Sort the 7 categories ascending and work the lowest first. Stop when all are `>= 8` — never chase points a passing category does not need.

For each category below 8:

1. Read `references/category-playbook.md` for that category's fix patterns
2. Apply them with `Edit`, or `Write` when restructuring a whole section
3. Re-run `asm eval "$SKILL_PATH" --json` and `python "$QV" "$SKILL_PATH"`, checking **every** category's delta, not just the one you edited

**Never batch-edit categories blindly.** Fixes interact: expanding the body for `testability` can tank `context-efficiency` or breach the 500-line cap. One at a time; keep what helps, revert what regresses either gate.

### Phase 4 — Watch for cross-gate tradeoffs (sidebar — applies during Phase 3)

A continuous sidebar, not a sequential phase: the gates pull in opposite directions on body length, so a fix that lifts one category can sink another or breach a Gate 1 cap. SKILL.md is loaded whole on every invocation, so each inlined paragraph is a permanent charge against the agent's context window — a budget the `context-efficiency` score is measuring. Read `references/cross-gate-tradeoffs.md` once before Phase 3, then default to **linking out, not inlining** on every edit.

### Phase 5 — Bump the target skill's `metadata.version`

This runs as the **last action inside each Phase 6 iteration**, not as a one-time pass after it — the number is sequential for narrative only. Bump exactly **once per iteration**, never once per edit, or the version churns ahead of meaningful change. Record each bump so the report shows baseline → final.

- **Patch** (`x.y.Z`): typo fixes, frontmatter-only normalization, wording tweaks
- **Minor** (`x.Y.0`): new sections, new references, expanded triggers, added subagents
- **Major** (`X.0.0`): restructured workflow, breaking output-format changes

A target with no `metadata.version` gets one, starting at `1.0.0`.

### Phase 6 — Loop with a cap

Re-run **both** checks after every iteration. The loop stops when any of these is true:

| Stop condition                                               | Outcome                  |
| ------------------------------------------------------------ | ------------------------ |
| Gate 1 passes AND `overallScore > 85` AND `min(scores) >= 8` | PASS — proceed to report |
| 8 eval iterations completed                                  | BLOCKER — write report   |
| 3 consecutive iterations with no movement on either gate     | BLOCKER — write report   |
| 2 consecutive iterations with regression on either gate      | BLOCKER — revert, report |

**Mid-iteration Gate 1 regressions are not regressions.** When a Phase 3 edit breaks a Gate 1 check (see Phase 4), drop back into Phase 2, fix it inside the same iteration, then re-run both checks. Count the iteration as a regression only if both gates are still worse afterwards — otherwise ordinary churn trips the 2-regression stop.

Save every iteration to `.asm-improver/iter-N.json`, with a one-line gate summary in `.asm-improver/iter-N-gates.txt`, so the report can diff them.

### Phase 7 — Write the final report

Write `.asm-improver/report.md` (layout: `references/report-template.md`) with **three visually distinct sections**:

1. **Gate status** — baseline vs final for both hard gates: `quick_validate.py`, Frontmatter Audit, `overallScore`, `grade`, per-category before/after. This decides PASS vs BLOCKER.
2. **Predictability findings** (advisory) — Phase 2b per item, each open one with a one-line note; say so if it was skipped fail-soft. Never a gate failure.
3. **Unresolved blockers** — BLOCKER only, each naming the failed **hard gate**, the specific check, and what was unresolvable. Predictability findings are never promoted here.

Add the skill path, `metadata.version` baseline → final, files changed, iterations (N of 8), and key fixes. Never pretend a blocker is a pass. Close the report — and the printed summary — with the **Run stats** block below.

## Run stats (mandatory)

Every run closes its summary with a run-stats block — the last thing printed, after the Phase 7 report. It reports what the run **cost** and never repeats a metric the report already carries.

`elapsed` is `now - run_started_epoch`, where the epoch is the `date +%s >&2` in _Dependency Preflight (mandatory)_ — read it off that block's stderr, not a shell variable that need not survive. A stop before that block ran has no anchor, so `elapsed` prints `n/a`.

```
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 4m 12s · tokens 128,400 · cost $0.42
              agents 0 · skills 1 · tool calls 63
```

Fields are fixed and in this order — never reordered, renamed, or added to: `elapsed`, `tokens`, `cost`, `agents`, `skills`, `tool calls`. Per-field formatting: `references/run-stats.md`.

- **`tokens` and `cost` are omitted entirely when the host reported no figure** — no dangling `·`, no placeholder. Never estimate one, and never reconstruct one from host transcripts or logs.
- **`elapsed`, `agents`, `skills`, and `tool calls` always print.** A value that cannot be determined prints the literal `n/a`; `0` is a determined value, correct where true.
- A missing optional figure never suppresses the rest of the block.
- Print the block at **every** terminal outcome — a completed loop, a BLOCKER, the Phase 0 early exit, a failed prerequisite, an aborted run. Only a run with no output at all has none.

## Step Completion Reports (mandatory)

After each phase, emit a compact status block so pass/fail is scannable:

```
◆ Phase N — [phase name]
··································································
  Frontmatter valid:   √ pass
  quick_validate:      √ pass
  asm overall:         86 → 91
  Min category:        7 → 8
  Target version:      1.2.0 → 1.3.0
  Result:              PASS | FAIL | PARTIAL
```

`√` is pass, `×` is fail, `—` is context. Emit one after each of Phase 0, 1, 2, 2b, 3, 5, 6, and 7. Phase 2b's block reports the findings count plus "advisory" or "skipped fail-soft" — that phase never gates.

## Acceptance Criteria

The bars that decide the outcome. The full run checklist — every artifact and process obligation — is `references/acceptance-criteria.md`; walk it before writing the report.

- Baselines captured to `.asm-improver/` **before any edits**, and every iteration re-evaluated against **both** gates and saved there
- Each Gate 1 check addressed before any Gate 2 work; each category below 8 addressed at least once
- Phase 2b run once Gate 1 is clean, or its fail-soft skip logged — findings never gate the loop
- `metadata.version` bumped once per iteration that produced edits; the loop stopped on one of Phase 6's 4 conditions
- `.asm-improver/report.md` exists on exit either way, and the summary closes with the Run stats block
- On PASS: `python "$QV" "$SKILL_PATH"` exits 0 AND `overallScore > 85` AND `min(categories[*].score) >= 8`
- On BLOCKER: the report names every failing Gate 1 check and every category still below 8 with a one-line reason each

### Expected output

See `references/report-template.md` for the full PASS and BLOCKER layouts. On BLOCKER, add an `## Unresolved blockers` section naming each failing **hard gate** check with a one-line reason.

## Edge Cases

Two rules the phases above do not carry. Every other edge case — no frontmatter, a rejected `--fix` key, an over-250-char description, a content-pinning test, an over-length body, the 8-iteration cap, GitHub shorthand — is in `references/edge-cases.md`, read when it arises.

- **Destructive action**: never `rm -rf` the skill directory. `asm eval --fix` creates `SKILL.md.bak` — leave it until the user explicitly cleans up.
- **Gate-passing skill with heavy non-delegable steps**: a **Mode 2** candidate. Offer the conversion; never edit it under Mode 1.

## References

- `references/skill-creator-checklist.md` — Gate 1 retrofit playbook
- `references/frontmatter-audit.md` — audit checklist and the `asm eval --fix` normalization migration
- `references/category-playbook.md` — per-category fix patterns for Gate 2
- `references/predictability-audit.md` — Phase 2b advisory checklist
- `references/cross-gate-tradeoffs.md` — Phase 4 sidebar: body length and the link-out rule
- `references/delegation-conversion.md` — the Mode 2 procedure
- `references/report-template.md` — PASS, BLOCKER, and Mode 2 report layouts
- `references/acceptance-criteria.md` — the full run checklist
- `references/run-stats.md` — run-stats field definitions
- `references/edge-cases.md` — the full edge-case list
- Under `~/.claude/skills/skill-creator/`: `scripts/quick_validate.py` (the Gate 1 validator), plus `references/frontmatter-rules.md`, `predictability-rubric.md`, and `dependency-preflight.md` — upstream sources the local references restate self-sufficiently
- `asm eval --help`, and `src/evaluator-core.ts` in the ASM repo — how each Gate 2 category is scored
