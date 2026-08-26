---
name: skill-auto-improver
description: "Improve an external, legacy, or drifted SKILL.md to the skill-creator standard — hard validation gates plus an advisory predictability audit. Don't use for authoring from scratch (skill-creator output is already standard), bulk eval, or prose edits."
license: MIT
compatibility: "Claude Code; requires `asm` on PATH and Python 3 for skill-creator's quick_validate.py"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 2.0.0
  author: luongnv89
---

# Skill Auto-Improver

You run an eval-driven loop that **retrofits an existing SKILL.md to the current skill-creator standard**. This is the remediation tool for skills that did **not** go through skill-creator — external, legacy, manually-authored, or drifted. Fresh skill-creator output is publish-ready by construction (see skill-creator's `predictability-rubric.md` → _Publish-ready — no auto-improver dependency_) and should **not** normally need this skill.

The target must clear **two hard gates**, then gets one **advisory** audit:

1. **Gate 1 — skill-creator standard (must-pass floor)** — `quick_validate` clean, Frontmatter Audit passes, ≤500 lines (detail below).
2. **Gate 2 — asm-eval floor (supplementary)** — `overallScore > 85` AND every category `>= 8`.
3. **Advisory — predictability audit (Phase 2b, not a gate)** — judgment-based findings against skill-creator's rubric, reported separately, **never** blocking.

A skill that scores 92 but fails `quick_validate.py` is not done; one that passes `quick_validate.py` but scores 70 is not done. **Both gates must clear, or the loop reports a blocker** — open predictability findings alone never make one.

## Two modes

Pick one before Phase 0 — they do not share a workflow.

- **Mode 1 — retrofit (default).** Bring the target to the skill-creator standard: the Phase 0–7 loop below, unchanged. Every "improve", "fix", "level up", or "bring up to standard" request is Mode 1.
- **Mode 2 — delegation conversion (opt-in).** Restructure the target's steps onto **per-step context delegation** — each heavy step names the slice of its own `references/` tree its worker needs and hands it over as the worker's `Input` (skill-creator's `subagent-patterns.md` → _Per-Step Context Delegation_). Runs **outside** the Phase 6 loop, on a target that already clears Gate 1, and only after the user confirms the restructure. A Phase 2b delegability finding routes here — it never starts a conversion by itself. Read `references/delegation-conversion.md` for the whole procedure, including the target's MAJOR bump and when a conversion does not pay for itself.

## Dependency Preflight (mandatory)

This skill invokes `skill-creator`: it runs that skill's `quick_validate.py` (required — the Gate 1 validator) and reads its `predictability-rubric.md` (fail-soft — Phase 2b). Resolve both once and reuse them **before the repo sync below**, which is the first step that changes anything. The rubric is **fail-soft** — a locally-installed skill-creator may predate the repo and not ship it; a missing file only degrades Phase 2b to a warning and never aborts the run:

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

`-p claude` is required, not decoration: `asm install` refuses to guess a provider in a non-interactive shell and `--yes` does not cover that choice, so a gate that omits it hands the user a command that errors instead of installing. The verification names the same provider the detection path belongs to, so an install landing under a different tool cannot report success while `$QV` is still missing.

On a miss, stop before the first mutation and print the three commands above — do not continue with a partial run. This is the same gate this skill audits every target for (`references/skill-creator-checklist.md` → _Dependency preflight_).

## Repo Sync Before Edits (mandatory)

This skill mutates files in a git repo. Before any edit, sync the local branch with the remote:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --rebase origin "$branch"
```

If the working tree is dirty, `git stash`, sync, then `git stash pop`. If `origin` is missing or `git pull` hits conflicts, **stop and ask the user** before continuing — do not skip or force the sync.

## When to Use

Reach for this on an **existing, external, legacy, manually-authored, or drifted** skill:

- The user asks to "improve", "level up", "fix", "polish", or "bring up to standard" an existing skill
- A skill was authored outside skill-creator (hand-written, imported, inherited) and must meet the current bar
- A skill has **drifted** — predates the standard, or edits left it failing `quick_validate.py` or below the 85/8 floor
- You are preparing such a skill for `asm publish` or a catalog

**Not** for routine cleanup of fresh skill-creator output (publish-ready by construction — use `/skill-creator` to author). Assumes a SKILL.md exists. For a report only, run `asm eval` and `quick_validate.py` directly — not this skill.

## Prerequisites

Verify all of the following before touching any files. Stop and tell the user if any fails.

- `asm` is available on PATH (`command -v asm` or `which asm`)
- Python 3 is available; skill-creator's `quick_validate.py` is resolved by _Dependency Preflight (mandatory)_ above, which is the only place that handles a miss
- The target skill path contains a `SKILL.md` file
- The working tree has no unrelated uncommitted edits (dirty files get mixed into diffs)
- You have write access to the skill directory

## Inputs

The user provides one of:

- A local skill path: `skills/foo` or `/abs/path/to/skill`
- A direct `SKILL.md` file path (treated as its parent directory)
- A GitHub shorthand: `github:owner/repo` or `github:owner/repo:path/to/skill`

For GitHub inputs, ask the user to clone locally first or whether you should open a PR back to that repo. This skill's default path is **local editing** — remote editing is out of scope for v1.

## The Gates

Keep two decision classes separate: **hard gates** (Gate 1, Gate 2) are mechanical and pass/fail — they alone decide PASS vs BLOCKER. **Predictability findings** (Phase 2b) are judgment-based and advisory — both gates green with open findings is still a PASS.

### Gate 1 — Skill-creator standard (must-pass floor)

A skill passes this gate when **all** of these are true:

- `python "$QV" "$SKILL_PATH"` exits 0 (no unexpected keys, name is kebab-case ≤64 chars, description is single-line ≤1024 chars, etc.)
- The Frontmatter Audit (full checklist in `references/frontmatter-audit.md`) passes
- `SKILL.md` body is under 500 lines (split to `references/` if not)
- Description includes a negative-trigger clause naming adjacent domains that should not trigger the skill (`quick_validate.py` warns when missing)
- `metadata.version` follows `MAJOR.MINOR.PATCH`; `metadata.author` is present
- If `docs/README.md` exists, it carries the AI-skip HTML comment at the top
- Any bundled scripts under `scripts/` print descriptive errors on stderr before exiting
- **If the target skill invokes another skill**, it carries a dependency preflight that names each dependency, its install command, the command that installs the installer itself, and a verification step (`references/skill-creator-checklist.md` → _Dependency preflight_). A skill that invokes no other skill needs no such section — its absence is not a finding, and never add an empty one

This gate is **non-negotiable** — `asm publish` and the catalog rely on it.

### Gate 2 — asm-eval 85/8 quality floor (supplementary)

```
overallScore > 85   AND   min(categories[*].score) >= 8
```

Stricter than overall alone — 86 with a 5 in `testability` still fails. Forces balanced quality instead of letting one strong area hide a weak one.

### Advisory — predictability audit (not a gate)

Both gates green does not guarantee the skill drives the same _process_ each run. The Phase 2b audit catches that — see `references/predictability-audit.md` for the checklist and finding classes.

## Workflow

Do these phases in order. Do not skip phases or change the order. **Phase 4 is a continuous sidebar that runs throughout Phase 3 — not a standalone step**, which is why it does not appear in the per-phase Step Completion Reports.

### Phase 0 — Capture baseline against both gates

Save the starting state so the before/after diff is auditable:

```bash
mkdir -p .asm-improver
asm eval "$SKILL_PATH" --json > .asm-improver/baseline.json
python "$QV" "$SKILL_PATH" > .asm-improver/baseline-quickvalidate.txt 2>&1 || true
```

Then perform the **Frontmatter Audit** described in `references/frontmatter-audit.md` and save findings to `.asm-improver/baseline-frontmatter-audit.md`.

If the target skill lives inside a git repo, suggest adding `.asm-improver/` to `.gitignore` so iteration artifacts stay out of version control.

Read the JSON and note:

- `overallScore`, `grade`
- Every `categories[].score` (7 categories, each out of 10)
- `topSuggestions` (the evaluator's own priorities)

If the baseline already passes **both** gates, stop immediately — print a one-line summary and skip to the final report. Do not "improve" a skill that already passes (a delegability finding is not a reason to keep going in Mode 1 — offer Mode 2 instead).

### Phase 1 — Apply deterministic fixes, then normalize frontmatter

Run the evaluator's auto-fixer for free wins:

```bash
asm eval "$SKILL_PATH" --fix --dry-run   # preview the diff
asm eval "$SKILL_PATH" --fix              # write, creates SKILL.md.bak
```

This handles trailing whitespace, CRLF normalization, missing `effort`, and other mechanical issues. **However, when authorship or version is missing, `asm eval --fix` writes a top-level `author:` (from `git config user.name`) and/or top-level `version: 0.1.0` — both of which `quick_validate.py` rejects as unexpected keys.** Immediately follow with the normalization step below.

#### Frontmatter normalization (mandatory after `--fix`)

Read `references/frontmatter-audit.md` — section "Normalizing `asm eval --fix` output" — for the exact migration. In short:

- Move top-level `author: <name>` → `metadata.author: <name>` (keep the value). The current fixer writes `author:`; older skills may carry a top-level `creator:` instead — treat it the same way and migrate to `metadata.author:`.
- Move top-level `version: <semver>` → `metadata.version: <semver>` (keep the value)
- Drop any other top-level keys that aren't in the allowed set (`name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`, `effort`) — e.g., legacy `tags:`. Surface non-trivial drops to the user before deleting.
- Quote any string value containing `:`, `#`, `-`, `<`, `>`, `|`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `?`, `=`, `!`, `%`, `@`, or `` ` `` per the YAML safety rule

After normalization, re-run **both** checks:

```bash
asm eval "$SKILL_PATH" --json > .asm-improver/iter-1.json
python "$QV" "$SKILL_PATH"
```

Many skills jump 5–15 points on `asm eval` here without touching the body, and `quick_validate.py` typically goes from fail to pass.

### Phase 2 — Fix Gate 1 failures first

`quick_validate.py` and the Frontmatter Audit findings come first because they gate publish. Read `references/skill-creator-checklist.md` for the full retrofit playbook. Common fixes:

- Description missing a negative-trigger clause → append "Don't use for X, Y, Z." naming 2–3 adjacent domains
- Description over 250 chars → trim hedge words, collapse synonyms (1024 is the hard ceiling, 250 is the runtime-budget target)
- Body over 500 lines → split dense sections into `references/<topic>.md` and replace inline content with a one-line pointer
- Missing AI-skip notice in `docs/README.md` → prepend the HTML comment from `references/skill-creator-checklist.md`
- Bundled script exits silently → add `echo "Error: ..." >&2` lines before each `exit 1` / `sys.exit(1)`
- Skill invokes another skill with no preflight gate, or with one that never explains installation → report the finding and add the gate from `references/skill-creator-checklist.md` → _Dependency preflight_. Detect it by scanning the target for `/skill-name` invocations, reads under `~/.claude/skills/` or `~/.agents/skills/`, and phases handed to a named skill

Re-run `python "$QV" "$SKILL_PATH"` after every Gate 1 edit. Do not move to Phase 2b until Gate 1 is clean.

### Phase 2b — Audit against the predictability rubric (advisory)

With Gate 1 clean, audit against skill-creator's rubric **before** Phase 3 so the findings can steer your category edits. Advisory — never gates, never blocks.

1. Confirm `$RUBRIC` resolved (_Dependency Preflight (mandatory)_). If missing, **skip fail-soft** — log `⚠ predictability audit skipped (rubric unavailable)` and move to Phase 3.
2. Walk `references/predictability-audit.md` — record each of the 7 items as `pass` / `advisory` with a specific note, save to `.asm-improver/predictability-audit.md`. Item #4 carries the **delegability sub-check**: a heavy step that names no `references/` slice is an advisory finding naming which step and why it is not delegable, and its remediation is Mode 2 — never a Mode 1 edit.

Act on findings only when _targeted_ (a predictability fix often also lifts an asm-eval category); never bloat to satisfy one. Finding-handling detail and the no-bloat rule live in `references/predictability-audit.md`.

### Phase 3 — Fix the lowest asm-eval categories

Sort the 7 categories by score ascending. Work on the lowest one first. Stop when all of them are `>= 8`.

For each category below 8:

1. Read `references/category-playbook.md` to find the fix patterns for that category
2. Apply them with `Edit` (small targeted changes) or `Write` (when restructuring a whole section)
3. Re-run `asm eval "$SKILL_PATH" --json` and `python "$QV" "$SKILL_PATH"` and check the deltas

**Do not batch-edit multiple categories blindly.** Fixes can interact — expanding the body for `testability` can tank `context-efficiency` or push the body over 500 lines (which fails Gate 1). One category at a time, re-eval after each change, keep the ones that help, revert the ones that regress either gate.

### Phase 4 — Watch for cross-gate tradeoffs (sidebar — applies during Phase 3)

A continuous sidebar, not a sequential phase: the two gates pull in opposite directions on body length, so a fix that lifts one asm-eval category can sink another or breach the 500-line cap. Read `references/cross-gate-tradeoffs.md` once before Phase 3 and default to **linking out, not inlining** on every edit.

### Phase 5 — Bump the target skill's `metadata.version`

This phase **runs as the last action inside each iteration of Phase 6's loop**, not as a separate one-time pass after Phase 6. The number is sequential for narrative flow; the actual execution is per-iteration.

Per skill-creator's Version Management rule, every edit to a SKILL.md must bump `metadata.version` before saving:

- **Patch** (`x.y.Z`): typo fixes, frontmatter-only normalization, minor wording tweaks
- **Minor** (`x.Y.0`): new sections, new references, expanded triggers, added subagents
- **Major** (`X.0.0`): restructured workflow, breaking output-format changes

If the target SKILL.md has no `metadata.version`, add one starting at `1.0.0`. Bump exactly **once per loop iteration**, not once per edit within an iteration — otherwise the version churns ahead of meaningful change.

Record the bump in the loop log so the final report can show baseline → final version.

### Phase 6 — Loop with a cap

Re-run **both** checks after every iteration. The loop stops when any of these is true:

| Stop condition                                               | Outcome                  |
| ------------------------------------------------------------ | ------------------------ |
| Gate 1 passes AND `overallScore > 85` AND `min(scores) >= 8` | PASS — proceed to report |
| 8 eval iterations completed                                  | BLOCKER — write report   |
| 3 consecutive iterations with no movement on either gate     | BLOCKER — write report   |
| 2 consecutive iterations with regression on either gate      | BLOCKER — revert, report |

**Mid-iteration Gate 1 regressions** — a Phase 3 edit can push SKILL.md over the 500-line cap or otherwise break a Gate 1 check (the two gates pull in opposite directions on body length; see Phase 4). When this happens within an iteration, do not let it close the iteration as a regression: drop back into Phase 2, fix the Gate 1 break in the same iteration, then re-run both checks. Only count the iteration as a regression if both gates are still worse than the previous iteration after that fix lands. This prevents the loop from tripping the "2 consecutive regressions" stop condition on a churn that the agent could resolve in-place.

Save every iteration's JSON to `.asm-improver/iter-N.json` and a one-line gate summary to `.asm-improver/iter-N-gates.txt` so the final report can diff them.

### Phase 7 — Write the final report

Write `.asm-improver/report.md` (full layout in `references/report-template.md`) keeping **three report sections visually distinct**:

1. **Gate status** — baseline vs final for both hard gates (`quick_validate.py`, Frontmatter Audit, `overallScore`, `grade`, per-category before/after). Decides PASS vs BLOCKER.
2. **Predictability findings** (advisory) — Phase 2b findings per item, open ones with a one-line note; say so if it was skipped fail-soft. Never a gate failure.
3. **Unresolved blockers** — BLOCKER only; each names the failed **hard gate** (Gate 1 or Gate 2), the specific check, and what was unresolvable. Predictability findings are never promoted here.

Also include: skill path, `metadata.version` baseline → final, files changed, iterations (N of 8), key fixes applied. Do not pretend a blocker is a pass. Close the report — and the printed summary — with the **Run stats** block below.

## Run stats (mandatory)

Every run that updates a skill closes its summary with a run-stats block — the last thing printed, after the Phase 7 report. It reports what the run **cost**, and never repeats a metric the report already carries (iterations, scores, files changed).

`run_started_epoch` is captured once, by the `date +%s >&2` in the _Dependency Preflight (mandatory)_ block above; read the value off that block's stderr rather than from a shell variable, which need not survive to a later command. `elapsed` is `now - run_started_epoch`. A stop before that block ran has no anchor, so `elapsed` prints `n/a`.

```
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 4m 12s · tokens 128,400 · cost $0.42
              agents 0 · skills 1 · tool calls 63
```

Fields are fixed and in this order — never reordered, renamed, or added to:

| Field        | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `elapsed`    | wall-clock duration, `{H}h {M}m {S}s`; drop zero-valued leading units only (`4m 12s`, `48s`)     |
| `tokens`     | **conditional** — printed only where the host reported a usage figure, with thousands separators |
| `cost`       | **conditional** — printed only where the host reported a run cost, as `$0.42`                    |
| `agents`     | subagents this run spawned                                                                       |
| `skills`     | other skills this run invoked (`skill-creator`'s validator counts as one)                        |
| `tool calls` | tool invocations this run made                                                                   |

- **`tokens` and `cost` are omitted entirely when the host reported no figure** — no dangling `·`, no placeholder. Never estimate one from output length, file sizes, or iteration counts, and never reconstruct one from host transcripts or logs.
- **`elapsed`, `agents`, `skills`, and `tool calls` always print.** A value that cannot be determined prints the literal `n/a`; `0` is a determined value and is correct where it is true.
- A missing optional figure never suppresses the rest of the block.

Print it at **every** terminal outcome, not only a PASS: a completed loop, a BLOCKER report, the Phase 0 early exit when the baseline already passes both gates, a failed prerequisite, and an aborted run. Only a run that produced no output at all has no block. One epoch read at start, one at the end, two lines of output — never a timing call per phase or a summarization pass.

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

Use `√` for pass, `×` for fail, `—` for context. Report per phase: Phase 0 (baseline captured), Phase 1 (deterministic + normalization), Phase 2 (Gate 1 fixes), Phase 2b (predictability audit — report findings count and "advisory" / "skipped fail-soft"; this phase never gates), Phase 3 (asm-eval category fixes), Phase 5 (version bump applied), Phase 6 (loop stop condition), Phase 7 (final report written, run stats printed).

## Acceptance Criteria

- `.asm-improver/baseline.json`, `.asm-improver/baseline-quickvalidate.txt`, and `.asm-improver/baseline-frontmatter-audit.md` captured before any edits
- `asm eval --fix` applied, then frontmatter normalized so `quick_validate.py` accepts the result
- Each Gate 1 check addressed at least once before any Gate 2 work
- A target that invokes another skill ends the run with a dependency preflight naming each dependency, its install command, the command that installs the installer itself, and a verification step; a target that invokes none gains no such section
- Predictability audit (Phase 2b) run after Gate 1 is clean — findings captured to `.asm-improver/predictability-audit.md`, or the skip logged when the rubric is unavailable. Findings are advisory and never gate the loop
- Each `asm eval` category below 8 addressed at least once
- Re-eval against **both** gates after every iteration, captured to `.asm-improver/iter-N.json` and `.asm-improver/iter-N-gates.txt`
- Target skill's `metadata.version` bumped exactly once per iteration that produced edits
- Loop stops on one of the 4 conditions in Phase 6 — never unbounded
- `.asm-improver/report.md` exists on exit, pass or blocker, with gate status, advisory predictability findings, and unresolved blockers as three visually distinct sections
- Every terminal outcome closes with the Run stats block — `elapsed`, `agents`, `skills`, and `tool calls` always present (`n/a` when undetermined), `tokens` and `cost` printed only where the host reported them and never invented
- On PASS: `python "$QV" "$SKILL_PATH"` exits 0 AND final eval JSON shows `overallScore > 85` AND `min(categories[*].score) >= 8`
- On BLOCKER: report names every Gate 1 check still failing and every category still below 8 with a one-line reason. Open predictability findings alone never constitute a blocker

### Expected output

See `references/report-template.md` for the full PASS and BLOCKER report templates. On BLOCKER, include an `## Unresolved blockers` section naming each failing **hard gate** check with a one-line reason.

## Edge Cases

- **Skill already passes both gates**: do not edit it. Still run the Phase 2b predictability audit read-only and report any advisory findings, then stop — passing gates does not guarantee a predictable process, but open findings here never force an edit. A gate-passing skill with heavy non-delegable steps is a **Mode 2** candidate: offer the conversion, do not edit under Mode 1.
- **SKILL.md has no frontmatter**: `asm eval --fix` cannot add it. Ask the user whether to scaffold one (using the skill-creator template) or abort.
- **Iterating regresses either gate**: revert the last edit (`cp SKILL.md.bak SKILL.md` if available, or undo via git) and try a different fix pattern from the playbook.
- **`asm eval --fix` writes a key `quick_validate.py` rejects**: this is expected — Phase 1's normalization step handles it. Do not skip the normalization.
- **Description over 250 chars after edits**: trim. The 250-char target prevents tail-first truncation in Claude Code's `/skills` listing, which would chop your negative-trigger clause.
- **SKILL.md body over 500 lines**: split into `references/` per the progressive-disclosure rule. SKILL.md must drop below 500 before exit.
- **Loop caps out at 8 iterations**: the skill has structural issues auto-improvement cannot solve. Write the blocker report and hand back to the user.
- **GitHub shorthand input**: for v1, ask the user to clone locally first. Remote editing is out of scope.
- **Destructive action**: never `rm -rf` the skill directory. `asm eval --fix` creates `SKILL.md.bak` — leave it in place until the user explicitly cleans up.

## References

- `references/skill-creator-checklist.md` — Gate 1 retrofit playbook (frontmatter, README, scripts, body length)
- `references/frontmatter-audit.md` — full audit checklist plus the `asm eval --fix` normalization migration
- `references/category-playbook.md` — per-category fix patterns for `asm eval` Gate 2
- `references/predictability-audit.md` — Phase 2b advisory audit checklist (the rubric's operational checklist, applied to the target skill)
- `references/cross-gate-tradeoffs.md` — Phase 4 sidebar: the body-length tradeoff between the two gates and the link-out rule
- `references/delegation-conversion.md` — Mode 2: converting an existing skill onto per-step context delegation (opt-in, user-confirmed, outside the Phase 6 loop)
- `references/report-template.md` — PASS, BLOCKER, and Mode 2 conversion report layouts
- `~/.claude/skills/skill-creator/scripts/quick_validate.py` — the Gate 1 mechanical validator
- `~/.claude/skills/skill-creator/references/frontmatter-rules.md` — upstream source of the audit rules
- `~/.claude/skills/skill-creator/references/predictability-rubric.md` — upstream source of the Phase 2b audit (fail-soft if absent)
- `~/.claude/skills/skill-creator/references/dependency-preflight.md` — upstream source of the dependency-preflight rule (the checklist above carries everything needed to audit and fix without it)
- `asm eval --help` — flag reference for the evaluator
- `src/evaluator.ts` in the ASM repo — source of truth for how each Gate 2 category is scored
