---
name: skill-install-improved
description: "Install an improved variant of one named skill: resolve it by local path, repo, or name, run skill-auto-improver on a throwaway copy, then install the improved result. Don't use for improving in place, upstream PRs, or plain asm install."
license: MIT
compatibility: "Claude Code; requires `asm` and `git` on PATH"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
metadata:
  version: 1.0.0
  author: luongnv89
---

# Skill Install Improved

You install an **improved** variant of one skill instead of the skill as published: resolve the target to a local directory → run `skill-auto-improver` on it → install the improved result → report what was improved and from what. The improvement is a step inside the install, not a separate errand. One skill per run.

## When to Use

- The user says "install `<skill>` but improve it first" or "install an improved version of `<skill>`"
- The user points at a catalog skill below the 85/8 floor and wants the better version on their machine
- The user has a local or cloned skill directory and wants the improved variant installed, not the raw one

Do **not** trigger for: improving without installing (`skill-auto-improver`), contributing upstream (`skill-upstream-pr`), authoring from scratch (`skill-creator`), plain installs (`asm install <source>`), or bulk-improving many skills at once.

## Prerequisites

Verify each before resolving anything. Stop and tell the user if any fails.

- `asm` and `git` on PATH
- Python 3 and `~/.claude/skills/skill-creator/scripts/quick_validate.py` — `skill-auto-improver` requires it
- Network access to GitHub, for the repo and name forms
- Write access to the install target — the directory for the chosen tool and scope (for `claude`: `~/.claude/skills/` global, `.claude/skills/` project). Other tools install elsewhere; take the real path from `asm list --json` or the install output.

### The user's own files are never modified (design decision)

**Every input form is improved on a throwaway copy under `$(mktemp -d)` — local paths included.** Deliberate: an install that rewrites the user's working copy is a side effect they did not ask for, `skill-auto-improver` mandates `git fetch` + `git pull --rebase` before any edit (against a local path that rebases their branch), and copying makes all forms behave identically.

**Trade-off:** the improvement lands only in the installed copy, not the user's tree. The copy has no `origin` and no history, so the improver's mandatory repo sync is **inapplicable** and is skipped — nothing to clobber, nothing pushed. Say so out loud when you skip it. To persist the change, point them at `skill-auto-improver` (their path) or `skill-upstream-pr` (the source repo).

## Inputs

The user identifies **one** target skill, in any of four forms — a local path (`skills/foo`), a local `SKILL.md` file path, a repo (`https://github.com/owner/repo`, `owner/repo`), or a skill name (`code-review`). Phase 0 normalizes all of them to one local directory, `$SKILL_PATH`.

Also needed before Phase 3: the install **scope** (`global` or `project`) and the target **tool** (`-p/--tool` — `claude`, `codex`, `agents`, …). Ask for either one the user did not state; never guess. `asm install` hard-fails without `--tool` in a non-interactive run, and `-y` does not cover it.

Optional: a `--name <alt>` intent.

## Workflow

Execute phases in order. Do not skip or reorder.

### Phase 0 — Resolve the target to one local directory

Full contract in `references/target-resolution.md`. In short, with `WORK="$(mktemp -d)"`:

- **Local path** — `cp -R` into `$WORK`. A `SKILL.md` **file** path folds to its parent first; `skill-auto-improver` takes a directory, not a file.
- **Repo** — plain `git clone` into `$WORK`. **Never `gh repo fork`** — this skill performs no public GitHub action.
- **Skill name** — `asm search "<term>" --available --json`, then copy the string after `asm install ` from the chosen result's `installCommand` **verbatim**. Never hand-construct `github:owner/repo:path`. Clone what it names.

Set `$SKILL_PATH` to the directory holding the chosen `SKILL.md`. If the checkout holds several and no subpath was given, enumerate them (`find "$WORK" -maxdepth 5 -name SKILL.md -type f`) and **ask which one. Never guess.**

Record for the report: the supplied identifier, the resolved install or clone URL, and the upstream commit SHA.

### Phase 1 — Delegate to skill-auto-improver

This skill does not reimplement the improvement loop. Follow the workflow in `skills/skill-auto-improver/SKILL.md` with `$SKILL_PATH` as the target: Phase 0 (baseline), Phase 1 (`asm eval --fix` plus frontmatter normalization), Phases 2–4 (Gate 1 fixes, then the category loop against the 85/8 floor), Phases 5–7 (version bump, the 8-iteration cap, `.asm-improver/report.md`).

Two adaptations, because the target is a throwaway copy:

- Its "Repo Sync Before Edits" step is **inapplicable**. Log `— repo sync skipped (throwaway copy, no origin)` and continue.
- `.asm-improver/` is written **relative to the current working directory**, so run the loop with cwd inside `$SKILL_PATH`, or Phase 2 has nothing to harvest.

If the baseline already clears both gates the improver stops without editing — a valid outcome, see Edge Cases.

### Phase 2 — Harvest artifacts, then clean up

**Harvest before any cleanup.** Everything lives under `$SKILL_PATH/.asm-improver/` and dies with the temp dir. Read `baseline.json`, the highest-numbered `iter-N.json`, and `report.md`; extract the fields listed in `references/install-and-report.md`.

Only once those values are captured, remove the two artifacts that must not ship — the `SKILL.md.bak` backup left by `asm eval --fix`, and `.asm-improver/`. `asm install` copies the source recursively, so leftovers land in the installed skill:

```bash
rm -f "$SKILL_PATH/SKILL.md.bak"
rm -rf "$SKILL_PATH/.asm-improver"
```

Both deletions are confined to the `mktemp -d` copy — confirm `$SKILL_PATH` is still inside `$WORK` first. Never point either command at a user-supplied path.

### Phase 3 — Install the improved directory

`skill-auto-improver` never renames, so the improved variant keeps the original frontmatter `name` and collides with any existing install of the original. **`asm install` never refuses on a collision** — it plans the force overwrite itself, and with `-y` it deletes and replaces the target directory with no prompt. `-f` changes nothing here. So probe **before** invoking it. Flags and the full policy are in `references/install-and-report.md`.

```bash
asm list --json    # probe: is this skill already installed for $TOOL / $SCOPE?
```

- **Neither name matches** — install; nothing is touched.
- **Frontmatter `name` matches for `$TOOL`** — force is set, even if that entry sits in another scope. What gets deleted is the **target** directory (`$SKILL_PATH`'s basename, or `alt`, under the install base for `$TOOL`/`$SCOPE`), which need not be the matched entry's `path`. Name that target path and whatever the probe shows there, and get **explicit confirmation before running `asm install`**. There is no failure to fall back on once it is invoked.
- **Only the directory name matches** — no delete, but the copy still **merges into** the existing directory: colliding files are overwritten and the previous occupant's other files survive inside the installed skill. Confirm this one too.
- **Opt-out** — `--name <alt>` installs side by side, on request only. It does not suppress force, so anything already at `<base>/<alt>` is deleted and replaced; check `alt` against the probe. Warn first: both then share one frontmatter `name` and identical triggers, the duplicate-trigger hazard the ASM auditor flags.

Both names come out of the same probe: the frontmatter `name` plus `$TOOL` decides whether force is set, the target directory name decides what is destroyed.

Only once the probe is read and any collision above is confirmed:

```bash
asm install "$SKILL_PATH" -p "$TOOL" --scope "$SCOPE" --json -y
```

Install `$SKILL_PATH`, never the original source — that would install the unimproved skill. Take the installed path from the install command's own `--json` output (`.path`); never assume `~/.claude/skills/`.

### Phase 4 — Report, then clean up

Fill in the template in `references/install-and-report.md`. The output must state that an **improved variant** was installed rather than the published skill, the provenance (supplied identifier, resolved URL, upstream SHA), the before → after numbers, the collision path taken and what it replaced, and the installed path.

Remove `$WORK` only after the report is complete.

## Step Completion Reports (mandatory)

Emit a compact status block after each phase:

```
◆ Phase N — [phase name] ([N of 5])
··································································
  [check 1]:         √ pass
  [check 2]:         × fail — [reason]
  Result:            PASS | FAIL | PARTIAL
```

Use `√` for pass, `×` for fail, `—` for context. Checks per phase:

- **Phase 0** — `Form identified`, `Copied to temp`, `SKILL_PATH unambiguous`, `Provenance recorded`
- **Phase 1** — `Baseline captured`, `Improver ran`, `Repo sync skipped`, `Gates cleared or stop reason known`
- **Phase 2** — `Metrics harvested`, `.bak removed`, `.asm-improver removed`, `Deletions confined to temp`
- **Phase 3** — `Collision probed before install`, `Overwrite confirmed (if any)`, `Tool and scope supplied`, `Install succeeded`
- **Phase 4** — `Report printed`, `Provenance shown`, `Temp dir removed`

## Acceptance Criteria

- Exactly one target resolved, from a local path, a repo, or a skill name
- `$SKILL_PATH` is a directory containing `SKILL.md`, under a `mktemp -d` copy — the user's files unmodified
- Name resolution copied `installCommand` verbatim; no hand-constructed `github:` URL
- Repo resolution used plain `git clone`; no fork, no push, no public GitHub action
- Several `SKILL.md` candidates and no supplied path → the user was asked, not guessed
- `skill-auto-improver` ran on `$SKILL_PATH`; `baseline.json`, `iter-N.json`, and `report.md` read before cleanup
- `SKILL.md.bak` and `.asm-improver/` removed before the install, both deletions confined to `$WORK`
- `asm install` pointed at `$SKILL_PATH` — the improved directory — never the original source — with both `-p/--tool` and `--scope` supplied
- A collision was probed for **before** `asm install` ran; on a match the run overwrote only after explicit confirmation, or used `--name <alt>` after warning; the report says which
- The report names the installed path, says an improved variant was installed, and shows before → after plus provenance
- `$WORK` removed only after the report is complete

### Expected output

- One skill installed under the chosen scope, containing the improved `SKILL.md`
- A report per `references/install-and-report.md`, leading with "installed an improved variant of `<name>`" and the before → after numbers
- No `.asm-improver/` and no `SKILL.md.bak` inside the installed skill
- No change to the user's own skill directories, and no remote GitHub state touched

### Example

"Install code-review, improved" on a skill that starts at 71 ends like this:

```
◆ Installed an improved variant of `code-review`
  Installed to:    ~/.claude/skills/code-review   (read from install --json .path)
  Install path:    confirmed overwrite of the previous install at that path
  Tool / scope:    claude / global
  Supplied as:     code-review
  Resolved from:   github:owner/repo:skills/code-review @ a1b2c3d
  Overall score:   71 (C) → 92 (A)   Min category: 5 → 8
  Version:         1.0.0 → 1.3.0     Iterations: 3 of 8
```

## Edge Cases

- **Baseline already passes both gates** — the improver stops without editing. Phase 2's cleanup and Phase 3's probe still run: Phase 0 of the improver writes `.asm-improver/` before it decides no edits are needed, so clean up first, then probe for a collision. Install the **original, unchanged**, and report plainly that no improvement was needed, naming the baseline score. Never imply a delta that did not happen.
- **Improver ends in BLOCKER** (8 iterations, or stalled) — better than baseline but below the floor. Show the blocker list and ask whether to install the partial result or abort. Never install one silently.
- **Local-path target** — improved on a copy, so the user's tree is untouched and the repo sync is skipped. Point them at `skill-auto-improver` or `skill-upstream-pr` to persist the change.
- **Several `SKILL.md` files in a clone** — enumerate and ask. Never batch, never guess.
- **`asm search` returns nothing, or several equally-plausible matches** — show the candidates and ask; never install the first hit.
- **Target has no frontmatter** — `asm eval --fix` cannot add it. Report and stop; do not install an unimprovable skill as if it were improved.
- **Collision is a same-named skill from another source** — the install would silently replace someone else's skill, with no error and no prompt. The probe is the only chance to catch it: name the target directory and whatever the probe shows there (`name`, `dirName`, `provider`, `scope`), confirm, and offer `--name <alt>` — all before `asm install` runs.
- **Temp dir removed before harvesting** — the metrics are gone and the before/after criterion cannot be met. Harvest in Phase 2, always before cleanup.
- **Clone or disk failure mid-resolve** — stop, remove `$WORK`, report. Never install a partial checkout.

## References

- `references/target-resolution.md` — the three input forms normalized to one local `$SKILL_PATH`
- `references/install-and-report.md` — install flags, collision policy, harvested fields, report template
- `skills/skill-auto-improver/SKILL.md` — the improvement loop this skill delegates to
- `skills/skill-upstream-pr/SKILL.md` — the sibling path when the improvement should go back to the source repo
- `asm install --help` and `asm search --help` — flag references
