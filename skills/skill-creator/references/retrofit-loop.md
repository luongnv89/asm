# Retrofit loop — Subpath B1 and the Path A closing check

The loop that measures a skill against `skill-standard.md` and repairs it until both hard gates pass or a loop cap stops it. It runs in two places: as **Subpath B1** (retrofit an existing skill) and as the **Path A closing check** on a skill just created.

**Selector first.** Choose the subpath before Phase 0 (`improving-existing.md`): Subpath B1 is this loop; Subpath B2 iterates on eval feedback; Subpath B3 — delegation conversion — runs outside this loop, opt-in, via `delegation-conversion.md`. Phase 0's early exit would otherwise swallow a gate-passing Subpath B3 candidate.

## When to use

Run it on **any existing skill**:

- The user asks to "improve", "level up", "fix", "polish", or "bring up to standard" a skill
- The skill was authored outside skill-creator — hand-written, imported, inherited — and must meet the current bar
- The skill has **drifted**: it predates the standard, or edits left it failing `quick_validate.py` or below the 85/8 floor
- You are preparing it for `asm publish` or a catalog
- A skill just created on Path A needs its closing check

For a numeric report only, run `asm eval` and `quick_validate.py` directly. **Do not interview the user about purpose, triggers, or output format** — they are already encoded in the target. **Review-only** request: run Phase 0, report the findings as before/after suggestions, and make no edits.

## Prerequisites

Verify all of these before touching any file. Stop and tell the user if any fails — a failed prerequisite still prints the Run stats block (SKILL.md → _Run stats (mandatory)_).

- `asm` is on PATH (`command -v asm`). Missing `asm` means Gate 2 cannot be measured, so the run never reports PASS (`skill-standard.md` → _Without `asm`_)
- Python 3 is available, and `$QV` resolves (below)
- The target path contains a `SKILL.md`
- The working tree has no unrelated uncommitted edits — dirty files get mixed into diffs
- You have write access to the skill directory

On Subpath B1 the prerequisite check is the run's first command, so it carries the epoch capture from SKILL.md → _Run stats (mandatory)_: `command -v asm; ec=$?; date +%s >&2; exit "$ec"`. On Path A and the Subpath B2 close, the epoch was captured when the run started — never re-stamp it. Skip this prerequisite list and the repo sync, but still set `$SKILL_PATH` to the skill (_Inputs_), resolve `$QV` (_Resolve the validator_), and run `command -v asm`; if `asm` is missing, follow `skill-standard.md` → _Without `asm`_ (Gate 2 not measured, never PASS). Then start at Phase 0.

## Inputs

One of: a local skill path (`skills/foo`, `/abs/path/to/skill`), a `SKILL.md` file path (folded to its parent directory — the loop takes a directory, never a file), or a GitHub shorthand (`github:owner/repo[:path/to/skill]`). For a GitHub input, ask the user to clone locally first; this loop edits **locally**, and remote editing is out of scope. Set `$SKILL_PATH` to the resolved directory.

## Resolve the validator

`$QV` is the `quick_validate.py` that ships with this skill-creator — never acquired through `asm deps`, since skill-creator does not depend on itself:

```bash
SKILL_CREATOR_DIR="<directory holding this skill-creator's SKILL.md>"
QV="$SKILL_CREATOR_DIR/scripts/quick_validate.py"
[ -f "$QV" ] || QV="$HOME/.claude/skills/skill-creator/scripts/quick_validate.py"
[ -f "$QV" ] || { echo "Error: quick_validate.py not found beside skill-creator's SKILL.md or under ~/.claude/skills/skill-creator/scripts/. Reinstall skill-creator, then re-run." >&2; exit 1; }
```

If neither path exists, stop as a failed prerequisite and print the Run stats block.

## Repo Sync Before Edits (mandatory)

The loop mutates files in a git repo. Sync the branch with the remote before any edit:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin
git pull --rebase origin "$branch"
```

If the tree is dirty, `git stash`, sync, `git stash pop`. If `origin` is missing or the pull conflicts, **stop and ask the user** — never skip or force the sync.

**One exception — a caller's throwaway copy.** When a calling skill hands over a temporary (`mktemp -d`) copy or clone and declares the sync inapplicable, log the skip and continue — never fetch or pull there. `skill-install-improved` does this for every input form, including `git clone --depth 1` checkouts that do have `origin` and may sit on a detached `--ref`, where a pull could move the target off the requested ref. The exception is keyed on the caller, not on the remote: the user's own checkout never qualifies, and one that lacks `origin` or conflicts still stops and asks.

## Workflow

Follow these phases in order, except for Phase 0's early exit. **Phase 4 is a sidebar during Phase 3**, with no separate Step Completion Report. Artifacts land in `.asm-improver/` relative to the current working directory — run with cwd where you want them, and in a git repo suggest adding `.asm-improver/` to `.gitignore`.

### Phase 0 — Capture baseline against both gates

Save the starting state so the before/after diff is auditable:

```bash
mkdir -p .asm-improver
asm eval "$SKILL_PATH" --json > .asm-improver/baseline.json
python "$QV" "$SKILL_PATH" > .asm-improver/baseline-quickvalidate.txt 2>&1 || true
```

Run the Frontmatter Audit (`frontmatter-rules.md` → _Frontmatter Audit on Review/Evaluation_) and save the findings to `.asm-improver/baseline-frontmatter-audit.md`.

Read the JSON and note `overallScore`, `grade`, every `categories[].score`, and `topSuggestions`. Each category's `findings` carry the measured numbers behind its score — body word count among them. Use those; never approximate by hand.

Inspect the target with `human-review-audit.md` and save the five checks to `.asm-improver/baseline-human-review.md`. Walk the rest of Gate 1 (`skill-standard.md`). **Early exit:** if both full gates pass, run Phase 2b without edits, copy the human-review baseline as the latest state, write the report, and stop. Otherwise continue to Phase 1, even if the numeric scores pass.

### Phase 1 — Apply deterministic fixes, then normalize frontmatter

Run the evaluator's auto-fixer for free wins:

```bash
asm eval "$SKILL_PATH" --fix --dry-run   # preview the diff
asm eval "$SKILL_PATH" --fix              # write, creates SKILL.md.bak
```

It handles trailing whitespace, CRLF normalization, and a missing `effort`. A dry-run reporting **"No fixes needed"** satisfies this phase — do not apply `--fix` anyway.

**Frontmatter normalization (mandatory after `--fix`).** When it does write, `--fix` adds a top-level `author:` and/or `version: 0.1.0`, both of which `quick_validate.py` rejects. Apply `frontmatter-rules.md` → _Normalizing `asm eval --fix` output_, then re-run **both** checks:

```bash
asm eval "$SKILL_PATH" --json > .asm-improver/iter-1.json
python "$QV" "$SKILL_PATH"
```

Many skills jump 5–15 points here without touching the body.

### Phase 2 — Fix Gate 1 failures first

`quick_validate.py` and the Frontmatter Audit come first because they gate publish. Walk the Gate 1 table in `skill-standard.md` top to bottom and repair each failing item from the reference that owns its rule. Look deliberately for the one check no validator catches: **Skill invokes another skill without dependency metadata and a first-use lease lifecycle** (`skill-standard.md` → _Dependency preflight_).

Re-run `python "$QV" "$SKILL_PATH"` after every Gate 1 edit. Do not enter Phase 2b until Gate 1 is clean.

Fix each failed writing and human-review check using `human-review-audit.md`, and save the re-check to `.asm-improver/human-review-audit.md`. Fixes belong in the target skill, not just the report.

### Phase 2b — Audit predictability (advisory)

With Gate 1 clean, walk `predictability-audit.md` **before** Phase 3, so findings can steer category edits. Mark each of its 7 items `pass` or `advisory` with a specific note and save the walk to `.asm-improver/predictability-audit.md`. Item #4's delegability sub-check names which step is not delegable and why; its remediation is Subpath B3, never a Subpath B1 edit.

Act on a finding only when the fix is _targeted_ — one often lifts an asm-eval category too. Never bloat to satisfy one. Advisory — never gates, never blocks.

### Phase 3 — Fix the lowest asm-eval categories

Sort the categories ascending and work the lowest first. Stop when all are `>= 8` — never chase points a passing category does not need.

For each category below 8:

1. Read `category-playbook.md` for that category's fix patterns
2. Apply them with `Edit`, or `Write` when restructuring a whole section
3. Re-run `asm eval "$SKILL_PATH" --json` and `python "$QV" "$SKILL_PATH"`, checking **every** category's delta, not just the one you edited

**Never batch-edit categories blindly.** Fixes interact: expanding the body for `testability` can tank `context-efficiency` or breach the 500-line cap. One at a time; keep what helps, revert what regresses either gate.

### Phase 4 — Watch for cross-gate tradeoffs (sidebar — applies during Phase 3)

The gates pull in opposite directions on body length, so a fix that lifts one category can sink another or breach a Gate 1 cap. SKILL.md is loaded whole on every invocation, so each inlined paragraph is a permanent charge against the agent's context window. Read `cross-gate-tradeoffs.md` once before Phase 3, then default to **linking out, not inlining** on every edit.

### Phase 5 — Bump the target skill's `metadata.version`

This runs as the **last action inside each Phase 6 iteration**, not as a one-time pass after it. Bump exactly **once per iteration** that produced edits, never once per edit. Record each bump so the report shows baseline → final.

- **Patch** (`x.y.Z`): typo fixes, frontmatter-only normalization, wording tweaks
- **Minor** (`x.Y.0`): new sections, new references, expanded triggers, added subagents
- **Major** (`X.0.0`): restructured workflow, breaking output-format changes

A target with no `metadata.version` gets one, starting at `1.0.0`.

### Phase 6 — Loop with a cap

Re-check both full gates after every iteration, including the five human-review checks, and record the remaining failed checks in each gate summary. A reduction in failed human-review checks counts as Gate 1 movement. The loop stops when any of these is true:

| Stop condition                                               | Outcome                  |
| ------------------------------------------------------------ | ------------------------ |
| Gate 1 passes AND `overallScore > 85` AND `min(scores) >= 8` | PASS — proceed to report |
| 8 eval iterations completed                                  | BLOCKER — write report   |
| 3 consecutive iterations with no movement on either gate     | BLOCKER — write report   |
| 2 consecutive iterations with regression on either gate      | BLOCKER — revert, report |

**Mid-iteration Gate 1 regressions are not regressions.** When a Phase 3 edit breaks a Gate 1 check (see Phase 4), drop back into Phase 2, fix it inside the same iteration, then re-run both checks. Count the iteration as a regression only if both gates are still worse afterwards — otherwise ordinary churn trips the 2-regression stop.

Save every iteration to `.asm-improver/iter-N.json`, with a one-line gate summary in `.asm-improver/iter-N-gates.txt`, so the report can diff them.

### Phase 7 — Write the final report

Write `.asm-improver/report.md` using `report-template.md`, with its `Path` field set to `A (closing check)` or `B1`. Keep hard-gate status, advisory audits, and unresolved blockers distinct. Select the review format using `human-review-audit.md`; the Markdown file can be a compact audit record linking to a diagram or HTML report.

Lead with the result. Cite checks actually performed. Name uncertainty and any required approval decision. Include the skill path, version change, files changed, iterations, and fixes. Close the report and the printed summary with the Run stats block.

## Step Completion Reports

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

`√` is pass, `×` is fail, `—` is context. Emit one after each of Phase 0, 1, 2, 2b, 3, 5, 6, and 7. Phase 2b's block reports the findings count plus "advisory" — that phase never gates.

## Acceptance criteria

Walk this before writing the Phase 7 report.

**Artifacts**

- `.asm-improver/baseline.json`, `.asm-improver/baseline-quickvalidate.txt`, and `.asm-improver/baseline-frontmatter-audit.md` captured **before any edits**
- Every iteration's `asm eval --json` saved to `.asm-improver/iter-N.json`, with a one-line gate summary in `.asm-improver/iter-N-gates.txt`
- `.asm-improver/predictability-audit.md` holds the Phase 2b walk
- `.asm-improver/baseline-human-review.md` records the five checks before edits; `.asm-improver/human-review-audit.md` records target locations, repairs, and re-check results
- `.asm-improver/report.md` exists on exit with gate status, advisory findings, and hard-gate blockers kept distinct

**Process**

- On the failing-baseline path, `asm eval --fix` ran (at minimum `--dry-run`), then frontmatter was normalized so `quick_validate.py` accepts the result
- Each Gate 1 check addressed at least once **before** any Gate 2 work; each category below 8 addressed at least once
- A target that invokes another skill declares it in frontmatter and carries caller-owned first-use acquire, direct-path use, and idempotent release; a target that invokes none gains no empty dependency list or preflight
- Both gates re-evaluated after every iteration; `metadata.version` bumped exactly once per iteration that produced edits
- The loop stopped on one of the 4 conditions in Phase 6, or both full gates passed at baseline
- All applicable human-review requirements repaired in the target's instructions, templates, references, and evaluation guidance; understanding stays unconfirmed without responsive human feedback

**Outcome**

- On **PASS**: every Gate 1 requirement passes, including the five human-review checks, AND the final eval JSON shows `overallScore > 85` AND `min(categories[*].score) >= 8`
- On **BLOCKER**: the report adds an `## Unresolved blockers` section naming every Gate 1 check still failing and every category still below 8, each with a one-line reason. Open predictability findings alone never constitute a blocker
- Either way, the summary closes with the Run stats block

## Edge cases

- **Skill already passes both gates**: do not edit it. Run Phase 2b read-only, report any advisory findings, then stop. A gate-passing skill with heavy non-delegable steps is a **Subpath B3** candidate: offer the conversion, never edit it under Subpath B1.
- **SKILL.md has no frontmatter**: `asm eval --fix` cannot add it. Ask the user whether to scaffold one (`scripts/init_skill.py` template) or abort.
- **Iterating regresses either gate**: revert the last edit (`cp SKILL.md.bak SKILL.md` if available, or undo via git) and try a different pattern from `category-playbook.md`.
- **`asm eval --fix` writes a key `quick_validate.py` rejects**: expected — Phase 1's normalization handles it. Do not skip it.
- **`asm eval --fix` reports "No fixes needed"**: the dry-run satisfies Phase 1. Applying `--fix` anyway can write top-level keys the normalization then has to undo, plus a stray `SKILL.md.bak`.
- **Description over 250 chars after edits**: trim — the `/skills` listing truncates tail-first and chops the negative-trigger clause.
- **Body over 500 lines or 3000 words**: split into `references/` until it clears both with margin. Over 3000 words, `context-efficiency` caps at 6 and fails Gate 2 on its own; the evaluator's count is in `baseline.json` under the Context efficiency findings.
- **The target's content is pinned by a test**: grep the repo for the skill name before editing. Keep pinned phrasing verbatim or update the test in the same commit.
- **Loop caps out at 8 iterations**: the skill has structural issues the loop cannot solve. Write the blocker report and hand back to the user.
- **Destructive action**: never `rm -rf` the skill directory. `asm eval --fix` creates `SKILL.md.bak` — leave it until the user explicitly cleans up.
