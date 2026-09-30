---
name: skill-shortener
description: "Refactor a too-long SKILL.md by progressive disclosure: measure token cost, classify every section KEEP/CUT/MOVE, shorten the body into references/ and scripts/, verify nothing was lost. Don't use for authoring new skills, eval retrofits, or prose."
license: MIT
compatibility: "Claude Code; Python 3; skill-creator's quick_validate.py"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 1.0.0
  author: luongnv89
---

# Skill Shortener

Shrink an over-long `SKILL.md` by **progressive disclosure**: what the agent needs on _every_ activation stays in the body, everything else moves behind a pointer that says when to load it — or is cut outright.

Three load layers decide where a piece of content belongs:

| Layer             | Holds                                | Costs            |
| ----------------- | ------------------------------------ | ---------------- |
| **always-loaded** | frontmatter `name` + `description`   | every turn       |
| **on-trigger**    | the `SKILL.md` body                  | every activation |
| **on-demand**     | `references/`, `scripts/`, `assets/` | only when read   |

The bar is **behavior-preserving**: the shortened skill drives the same process as the long one. Line count is the score, not the goal — a run that reaches 400 lines by deleting a loop's stop condition has failed, however good the number looks.

## Two modes

Pick one before Phase 0; they diverge at Phase 2.

- **Mode 1 — shorten (default).** Phases 0–4: measure, classify, plan, apply on approval, verify. Every "shorten this", "this SKILL.md is too long", "cut its token cost", "apply progressive disclosure" request is Mode 1.
- **Mode 2 — audit only.** Phases 0–2, then stop and hand over the plan. Nothing outside the workdir is written, so the repo sync and snapshot in Phase 0 are skipped. Use when the user wants to know what _would_ move, or will apply the split themselves.

## Run variables

Every snippet below uses these four. **Bash tool calls do not share shell state**, so re-declare them at the top of each call that needs them — an empty `$SKILL_PATH` turns `cp -R "$SKILL_PATH/."` into a copy of the filesystem root. Capture `RUN_EPOCH` once and reuse the _number_; never re-stamp it.

```bash
SS="$HOME/.claude/skills/skill-shortener"                            # this skill
SKILL_PATH="$HOME/.claude/skills/<target>"                           # the target: the dir holding SKILL.md
QV="$HOME/.claude/skills/skill-creator/scripts/quick_validate.py"    # the Phase 4 gate
# RUN_EPOCH: reuse the number the preflight printed, e.g. RUN_EPOCH=1787948450
```

## Dependency Preflight (mandatory)

This skill invokes `skill-creator`: it runs that skill's `quick_validate.py` as the Phase 4 frontmatter gate. Resolve it **before the snapshot below**, the first step that changes anything:

```bash
RUN_EPOCH="$(date +%s)"; echo "run_started_epoch=$RUN_EPOCH" >&2   # anchors Run stats
QV="$HOME/.claude/skills/skill-creator/scripts/quick_validate.py"
test -f "$QV" || {
  echo "Missing required skill: skill-creator" >&2
  echo "Install it:      asm install skill-creator -p claude --yes" >&2
  echo "No asm yet:      npm install -g agent-skill-manager" >&2
  echo "Verify:          asm list -p claude --json | grep 'skill-creator'" >&2
  exit 1
}
```

`-p claude` is not decoration: `asm install` refuses to guess a provider non-interactively and `--yes` does not cover that choice, so an install command without it errors instead of installing. On a miss, stop before the first mutation and print those three commands — never continue with a partial run.

## Snapshot and Repo Sync Before Edits (mandatory)

**Always snapshot first.** The most common target — `~/.claude/skills/<name>/` — is _not_ a git repository, so git is not a guaranteed undo path, and this skill rewrites a whole directory rather than one file:

```bash
: "${SKILL_PATH:?set SKILL_PATH to the target skill directory}"
: "${RUN_EPOCH:?reuse the epoch captured in the preflight}"
case "$PWD/" in "$SKILL_PATH"/*) echo "cwd is inside $SKILL_PATH — run from outside it, or the workdir is copied into itself" >&2; exit 1;; esac
SNAP=".skill-shortener/snapshot-$RUN_EPOCH"
mkdir -p "$SNAP" && cp -R "$SKILL_PATH/." "$SNAP/"
```

Then sync **only if** the target directory itself is a git work tree root — `rev-parse --git-dir` succeeds for any nested path inside a larger repo, and must not trigger fetch/pull of that tree:

```bash
toplevel="$(git -C "$SKILL_PATH" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$toplevel" ] && [ "$(cd "$SKILL_PATH" && pwd -P)" = "$toplevel" ]; then
  branch="$(git -C "$SKILL_PATH" rev-parse --abbrev-ref HEAD)"
  git -C "$SKILL_PATH" fetch origin && git -C "$SKILL_PATH" pull --rebase origin "$branch"
else
  echo "note: $SKILL_PATH is not a git work tree root — $SNAP is the only undo path; skip fetch/pull"
fi
```

If the tree is dirty, `git stash`, sync, `git stash pop`. If `origin` is missing or the pull conflicts, **stop and ask the user** — never skip or force the sync. In a git repo, suggest adding `.skill-shortener/` to `.gitignore`.

## The three dispositions

Every section of the body gets exactly one, and each has one reference behind it. Read the reference for the disposition you are about to assign — not all three up front.

| Disposition | Means                                                                | Read before assigning it                                       |
| ----------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| **KEEP**    | needed on every activation; stays in the body                        | read `references/behavior-preservation.md` before assigning it |
| **CUT**     | deleted; the model already knows it or it changes no behavior        | read `references/cut-list.md` before assigning it              |
| **MOVE**    | relocated to `references/`, `scripts/`, or `assets/`, with a pointer | read `references/split-patterns.md` before assigning it        |

## Workflow

### Phase 0 — Baseline

**Mode 2 — skip snapshot and git sync.** Audit-only must not reach `fetch` / `pull --rebase`. Run the preflight and the two `measure_skill.py` commands below, then continue to Phase 1. Do not create `$SNAP` and do not run the repo-sync block.

**Mode 1.** Run the preflight, take the snapshot, sync only when `$SKILL_PATH` is itself the git work tree root (see above), then measure:

```bash
python3 "$SS/scripts/measure_skill.py" "$SKILL_PATH" --json --out .skill-shortener/baseline.json
python3 "$SS/scripts/measure_skill.py" "$SKILL_PATH"   # the human-readable section table
```

The section table, largest first, is where the fat is — read it before reading the body.

**Early exit.** If the verdict is `WITHIN_CAP`, stop: print the current footprint and say no shortening is warranted — splitting a body that already fits costs a pointer hop for no saving. The one exception is an existing `references/` tree that is chained or orphaned; see _Edge cases_. The user can override.

**Done when:** `.skill-shortener/baseline.json` exists with a non-empty `sections` array, and the verdict is recorded.

### Phase 1 — Classify every section (the manifest)

Read the body, then assign every heading from `baseline.json` exactly one disposition. Write `.skill-shortener/manifest.json`:

```json
{
  "target": "<skill-path>",
  "sections": [
    { "heading": "Overview", "disposition": "KEEP" },
    {
      "heading": "API error codes",
      "disposition": "MOVE",
      "destination": "references/<topic>.md",
      "load_condition": "when the API returns a non-200"
    },
    {
      "heading": "History",
      "disposition": "CUT",
      "reason": "changelog and attribution; changes no behavior"
    }
  ]
}
```

`destination` may be a string or a list. `load_condition` is the clause that goes into the pointer, so write it as the agent will read it: "when X", "before Y", "if Z".

The manifest **is** the loss-prevention record. Nothing is verified as preserved except through it, so an unclassified section is an unaudited deletion waiting to happen.

**Done when:** every heading in `baseline.json` appears in the manifest exactly once; every `CUT` carries a `reason`; every `MOVE` carries a `destination` and a `load_condition`. `scripts/verify_shorten.py` checks all four in Phase 4 — do not defer them.

### Phase 2 — Plan and approve

Present the plan as a table — heading, disposition, destination, lines saved — plus the projected body size against both caps and the always-loaded/on-demand split. Name the biggest three savings first.

**Expected output** — the plan, before any file is touched:

```
Plan for skill-x — 812 lines / 5,140 words → projected 190 lines / 1,480 words

  heading                  disposition  destination                   lines
  -----------------------  -----------  ----------------------------  -----
  Azure deployment         MOVE         references/<branch>.md         -180
  Error code reference     MOVE         references/<codes>.txt         -140
  Release history          CUT          changelog; changes no behavior  -46
  Workflow                 KEEP         -                                 0

  always-loaded 64 tokens (unchanged) · on-trigger 12,900 → 3,700 · on-demand +9,100
```

**Mode 2 ends here.** In Mode 1, stop and wait for an explicit go-ahead. A split is a judgment call and the user is the one who has to live with the result.

**Done when:** the user has approved the plan, or asked for changes that are folded back into the manifest.

### Phase 3 — Apply

1. Write each `MOVE` destination. The moved material must be **self-contained** — a reader arriving with only the pointer's context can act on it. Add a one-line contents map at the top of any reference over 300 lines.
2. Rewrite the body: delete `CUT` sections, replace each `MOVE` section with a pointer carrying its `load_condition` ("Read `references/<topic>.md` when the API returns a non-200"). A bare "see `references/<topic>.md`" is relocation, not disclosure, and Phase 4 fails it.
3. Keep references **one level deep**. A reference that points to another reference is a chain — inline it or promote it to a sibling.
4. Bump `metadata.version`: **minor** for pure relocation, **major** if any `CUT` removed an instruction or the step sequence changed.

When the plan extracts three or more reference files and the Agent tool is available, hand each one to its own worker: the worker's `Input` is `references/split-patterns.md` plus that section's text, and it returns the finished file. The body rewrite stays with the main agent, which is the only step that needs the whole picture.

**Done when:** every `MOVE` destination exists and is non-empty, the body contains a conditional pointer to each, and the version is bumped.

### Phase 4 — Verify

```bash
python3 "$SS/scripts/verify_shorten.py" "$SKILL_PATH" \
  --manifest .skill-shortener/manifest.json \
  --baseline .skill-shortener/baseline.json
python3 "$QV" "$SKILL_PATH"
```

Then do the **read-back**, which no script can do for you: open every file the plan created and confirm the material arrived complete and reads as instructions rather than as an excerpt. The script proves the manifest is exhaustive and the wiring is sound; only the read-back proves the content survived the move.

On a failure, fix and re-run — up to 3 rounds, then report what still fails instead of looping. If the result is worse than the original, restore — guarding both variables, because an empty `$SNAP` leaves a deleted skill and nothing to put back:

```bash
: "${SKILL_PATH:?}"; : "${SNAP:?}"; test -d "$SNAP" || { echo "no snapshot at $SNAP" >&2; exit 1; }
rm -rf "$SKILL_PATH" && cp -R "$SNAP" "$SKILL_PATH"
```

**Done when:** `verify_shorten.py` exits 0, `quick_validate.py` exits 0, and every created file has been read back.

## Edge cases

Only the ones where judgment reliably goes wrong — everything else, handle on the merits.

- **Already within both caps** → take the Phase 0 early exit. Splitting a body that fits adds a pointer hop and saves nothing.
- **The target already has `references/`** → measure it too. A chained or orphaned existing tree is in scope even when the body fits, and it is the one case where a `WITHIN_CAP` verdict still warrants work.
- **The path is a collection** (no `SKILL.md` at the root, children have one) → ask which skill. Never span two skills in one manifest.
- **The user asks to cut a never-cut block** → say in one sentence why it stays, then pursue the size target through the other dispositions. Do not silently comply, and do not refuse the whole task.
- **A section too big for one destination** → `destination` takes a list. Split it by sub-topic, never by line range: half a procedure is not self-contained.
- **Under one cap, over the other** → both gate. 480 lines at 4,200 words has not been shortened enough.

## Step Completion Reports

After each phase, print:

```
◆ [Phase Name] (phase N of 4 — [context])
··································································
  [Check 1]:          √ pass
  [Check 2]:          × fail — [reason]
  [Criteria]:         √ N/M met
  ____________________________
  Result:             PASS | FAIL | PARTIAL
```

Per-phase checks: Phase 0 `Preflight`, `Snapshot`, `Baseline measured`, `Cap verdict`. Phase 1 `Every section classified`, `Reasons given`, `Load conditions written`. Phase 2 `Plan presented`, `Approval received`. Phase 3 `Destinations written`, `Pointers conditional`, `Version bumped`. Phase 4 `verify_shorten`, `quick_validate`, `Read-back`.

## Run stats (mandatory)

Close every run — including an early exit, a refused gate, or a failed phase — with this block as the last thing printed:

```
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  Run stats   elapsed 4m 12s · tokens 96,300 · cost $0.31
              agents 0 · skills 1 · tool calls 22
```

Fields are fixed and in this order: `elapsed`, `tokens`, `cost`, `agents`, `skills`, `tool calls`. `tokens` and `cost` are omitted entirely when the host reported no figure — never estimated. The other four always print; an undeterminable value prints `n/a`, and `0` is a determined value. `elapsed` comes from `RUN_EPOCH`, captured once in the preflight.

## Reference files

| File                                  | Read it when                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `references/behavior-preservation.md` | you are assigning `KEEP` — it names the blocks that may never be cut, whatever they cost |
| `references/cut-list.md`              | you are assigning `CUT` — what is safe to delete and how to word the reason              |
| `references/split-patterns.md`        | you are assigning `MOVE` — choosing the destination, writing the pointer, flattening     |
