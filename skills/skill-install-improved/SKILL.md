---
name: skill-install-improved
description: "Install an improved variant of one named skill: resolve it by local path, repo, or name, run skill-creator's retrofit on a throwaway copy, then install the improved result. Don't use for improving in place, upstream PRs, or plain asm install."
license: MIT
compatibility: "Claude Code; requires `asm` and `git` on PATH"
allowed-tools: Bash Read Write Edit Grep Glob
effort: high
dependencies:
  - skill-creator
metadata:
  version: 1.3.0
  author: luongnv89
---

# Skill Install Improved

You install an **improved** variant of one skill instead of the skill as published: resolve the target to a local directory → run `skill-creator`'s Subpath B1 retrofit loop on it → install the improved result → report what was improved and from what. The improvement is a step inside the install, not a separate errand. One skill per run.

## When to Use

- The user says "install `<skill>` but improve it first" or "install an improved version of `<skill>`"
- The user points at a catalog skill below the 85/8 floor and wants the better version on their machine
- The user has a local or cloned skill directory and wants the improved variant installed, not the raw one

Do **not** trigger for: improving without installing (`skill-creator`), contributing upstream (`skill-upstream-pr`), authoring from scratch (`skill-creator`), plain installs (`asm install <source>`), or bulk-improving many skills at once.

## Prerequisites

Verify each before resolving anything. If one fails, stop and tell the user which one.

- `asm` and `git` on PATH, and Python 3 (skill-creator's validator needs it)
- Network access to GitHub, for the repo and name forms
- Write access to the install target for the chosen tool and scope (see `asm list --json` for existing install paths)

### The user's own files are never modified (design decision)

**Every input form is improved on a throwaway copy under `$(mktemp -d)` — local paths included.** An install that rewrites the user's working copy is a side effect they did not ask for, and the retrofit loop's `git pull --rebase` would rebase their branch.

**Repo sync is skipped for every form.** A local-path copy has no `origin`. A repo or name clone does have `origin`, but it is a throwaway `--depth 1` checkout that may sit on a detached `--ref`, and a pull could move it off the requested ref. The retrofit loop allows this skip for a caller's throwaway copy. Say so when you skip it.

**Trade-off:** the improvement lands only in the installed copy. To persist it, point the user at `skill-creator` (their own path) or `skill-upstream-pr` (the source repo).

## Dependency Preflight (mandatory)

This skill invokes `skill-creator`, declared in frontmatter `dependencies`. Before Phase 0, verify `asm` is available:

```bash
command -v asm >/dev/null || {
  echo "Missing installer: npm install -g agent-skill-manager" >&2
  exit 1
}
asm deps discover skill-install-improved --json
```

When execution reaches Phase 1, the main agent runs:

```bash
asm deps acquire skill-creator --session <caller-session-id> --json
```

`<caller-session-id>` is a unique id the main agent picks once per run, e.g. `skill-install-improved-<epoch-seconds>`; reuse it for the release.

Set `SKILL_CREATOR_DIR` to the directory holding the returned `skillMdPath`, and use it immediately; do not wait for a provider catalog rescan. The retrofit loop is `$SKILL_CREATOR_DIR/references/retrofit-loop.md`; its validator is `$SKILL_CREATOR_DIR/scripts/quick_validate.py`. If the acquire fails, stop before Phase 1 and report the error — this skill cannot improve anything without it.

The main agent releases the lease from its own `finally`/shutdown handling — after Phase 4, or at any earlier stop:

```bash
asm deps release --session <caller-session-id> --json
```

If Phase 0 stops before Phase 1, do not acquire.

## Inputs

The user identifies **one** target skill, in any of four forms — a local path (`skills/foo`), a local `SKILL.md` file path, a repo (`https://github.com/owner/repo`, `owner/repo`), or a skill name (`code-review`). Phase 0 normalizes all of them to one local directory, `$SKILL_PATH`.

Also needed before Phase 3: the install **scope** (`global` or `project`) and the target **tool** (`-p/--tool` — `claude`, `codex`, `agents`, …). If the user did not state one, ask; never guess. `asm install` hard-fails without `--tool` in a non-interactive run, and `-y` does not cover it.

Optional: a `--name <alt>` intent.

Before Phase 0, record the directory the user invoked you from as `CALLER_DIR` (`pwd`). Project-scope paths resolve from the current directory, so Phase 3 must run there, not inside `$WORK`.

## Workflow

Execute phases in order. Do not skip or reorder.

### Phase 0 — Resolve the target to one local directory

Full contract in `references/target-resolution.md`. In short, with `WORK="$(mktemp -d)"`:

- **Local path** — `cp -R` into `$WORK`. A `SKILL.md` **file** path folds to its parent first; the retrofit loop takes a directory, not a file.
- **Repo** — plain `git clone` into `$WORK`. **Never `gh repo fork`** — this skill performs no public GitHub action.
- **Skill name** — `asm search "<term>" --available --json`, then copy the string after `asm install ` from the chosen result's `installCommand` **verbatim**. Never hand-construct `github:owner/repo:path`. Clone what it names.

Set `$SKILL_PATH` to the directory holding the chosen `SKILL.md`. If the checkout holds several and no subpath was given, list them (`find "$WORK" -maxdepth 5 -name SKILL.md -type f`) and **ask which one. Never guess.**

Record for the report: the supplied identifier, the resolved install or clone URL, and the upstream commit SHA.

### Phase 1 — Delegate to skill-creator's retrofit loop

This skill does not reimplement the improvement loop, and it reads that loop only now, so the loop's references stay out of the context budget until Phase 1. Acquire `skill-creator` (Dependency Preflight), then follow `$SKILL_CREATOR_DIR/references/retrofit-loop.md` (Subpath B1) with `$SKILL_PATH` as the target, through its Phase 7 report.

Two adaptations, because the target is a throwaway copy:

- Skip its "Repo Sync Before Edits" step. Log `— repo sync skipped (throwaway copy)` and continue.
- `.asm-improver/` is written **relative to the current working directory**. Run the loop with cwd inside `$SKILL_PATH`, or Phase 2 has nothing to harvest.
- If the loop asks how to handle a target with no frontmatter, answer "abort" (see Edge Cases). If it offers a Subpath B3 delegation conversion, decline: this run installs, it does not restructure.

If the baseline already clears both gates, the retrofit loop stops without editing — a valid outcome, see Edge Cases.

### Phase 2 — Harvest artifacts, then clean up

**Harvest before any cleanup.** Read the files under `$SKILL_PATH/.asm-improver/` that `references/install-and-report.md` lists, and extract its fields. An early-exit baseline writes no `iter-N.json`; then the baseline is also the final state.

Then confirm `$SKILL_PATH` is still inside `$WORK`, and remove the two artifacts that must not ship (`asm install` copies the source recursively):

```bash
rm -f "$SKILL_PATH/SKILL.md.bak"
rm -rf "$SKILL_PATH/.asm-improver" "$SKILL_PATH/.git"
```

Never point either command at a user-supplied path.

### Phase 3 — Install the improved directory

The retrofit loop never renames, so the improved variant keeps the original frontmatter `name`. **`asm install` never refuses on a collision**: with `-y` it deletes and replaces the target directory without a prompt. So probe **before** invoking it:

Run this phase from `CALLER_DIR`:

```bash
cd "$CALLER_DIR"
asm list --json    # is this skill's name or directory already installed for $TOOL / $SCOPE?
```

Read `references/install-and-report.md` → _Collision policy_ and take the path it gives for the probe result. The rule that never changes: if the probe shows any match — frontmatter `name` or directory name — name the target path and what occupies it, and get **explicit confirmation before running `asm install`**. Use `--name <alt>` only when the user asks for it, after the duplicate-trigger warning.

Only after the probe is read and any collision is confirmed:

```bash
asm install "$SKILL_PATH" -p "$TOOL" --scope "$SCOPE" --json -y
```

Install `$SKILL_PATH`, never the original source. Take the installed path from the command's `--json` output (`.path`); never assume `~/.claude/skills/`.

### Phase 4 — Report, then clean up

Fill in the report template in `references/install-and-report.md`. It covers the four items the user needs: the result, the evidence, what stays untested, and the next decision.

Remove `$WORK` only after the report is printed, then release the dependency lease.

## Step Completion Reports (mandatory)

After each phase, print a compact status block: `√` pass, `×` fail, `—` context.

```
◆ Phase N — [phase name] ([N of 5])
··································································
  [check 1]:         √ pass
  [check 2]:         × fail — [reason]
  Result:            PASS | FAIL | PARTIAL
```

Checks per phase:

- **Phase 0** — `Form identified`, `Copied to temp`, `SKILL_PATH unambiguous`, `Provenance recorded`
- **Phase 1** — `skill-creator acquired`, `Baseline captured`, `Repo sync skipped`, `Gates cleared or stop reason known`
- **Phase 2** — `Metrics harvested`, `.bak removed`, `.asm-improver removed`, `Deletions confined to temp`
- **Phase 3** — `Collision probed before install`, `Overwrite confirmed (if any)`, `Tool and scope supplied`, `Install succeeded`
- **Phase 4** — `Report printed`, `Temp dir removed`, `Lease released`

## Acceptance Criteria

The expected output of a successful run, each item checkable:

- Exactly one target resolved; `$SKILL_PATH` is a directory with a `SKILL.md`, under `$WORK`; the user's files are unmodified
- Name resolution copied `installCommand` verbatim; repo resolution used plain `git clone` — no fork, no push
- The retrofit loop ran from the acquired `skill-creator`; `baseline.json`, `iter-N.json`, and `report.md` were read before cleanup
- The installed skill contains no `.asm-improver/` and no `SKILL.md.bak`
- `asm install` targeted `$SKILL_PATH` with both `-p/--tool` and `--scope`, after a collision probe; any overwrite was confirmed first
- The report states the installed path, provenance, and before → after numbers
- `$WORK` was removed after the report, and the dependency lease was released

When reviewing a run's output (by eval or by a human), also check that a reader can:

- **Find the main result** — the first line says an improved variant was installed, the original was installed unchanged, or the run stopped.
- **Separate facts from assumptions** — measured scores are distinct from the untested runtime behavior of the improved skill.
- **Trace claims** — before → after numbers map to `baseline.json` and the last `iter-N.json`; the install path maps to install `--json` `.path`.
- **See the next decision** — the report names any action left (restart the agent, persist the change upstream) or states that none is needed.

An agent's own review cannot confirm human understanding. A reviewer who received no human feedback records understanding as unconfirmed.

## Edge Cases

- **Baseline already passes both gates** — the retrofit loop stops without editing, but it has already written `.asm-improver/`. Still run Phase 2's cleanup and Phase 3's probe. Install the original, unchanged, and report that no improvement was needed, naming the baseline score. Never imply a delta that did not happen.
- **Retrofit loop ends in BLOCKER** — show the blocker list and ask whether to install the partial result or abort. Never install one silently.
- **`skill-creator` cannot be acquired** — stop before Phase 1, remove `$WORK`, and report the `asm deps acquire` error.
- **Several `SKILL.md` files in a clone** — list them and ask. Never batch, never guess.
- **`asm search` returns nothing, or several equally-plausible matches** — show the candidates and ask; never install the first hit.
- **Target has no frontmatter** — `asm eval --fix` cannot add it, and this skill does not scaffold one. Answer "abort" to the retrofit loop, report, and stop; do not install an unimprovable skill as if it were improved.
- **Collision with a same-named skill from another source** — the install would replace someone else's skill with no prompt. Name the target directory and what the probe shows there (`name`, `dirName`, `provider`, `scope`), confirm, and offer `--name <alt>` — all before `asm install` runs.
- **Clone or disk failure mid-resolve** — stop, remove `$WORK`, report. Never install a partial checkout.

## References

- `references/target-resolution.md` — the input forms normalized to one local `$SKILL_PATH`
- `references/install-and-report.md` — harvested fields, install flags, collision policy, report template
- `$SKILL_CREATOR_DIR/references/retrofit-loop.md` — the improvement loop this skill delegates to (acquired at run time)
- `asm install --help` and `asm search --help` — flag references
