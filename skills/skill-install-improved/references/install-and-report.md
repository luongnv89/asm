# Install and Report

Phases 2–4 in detail: what to harvest, how to install, and what the user must be able to read off the output.

## Harvest before cleanup

`skill-auto-improver` writes `.asm-improver/` **relative to the current working directory**, so the loop must run with cwd inside `$SKILL_PATH`. Everything below lives in a temp directory and is gone the moment `$WORK` is removed — read it first.

| File                                    | What to take from it                                |
| --------------------------------------- | --------------------------------------------------- |
| `.asm-improver/baseline.json`           | `overallScore`, `grade`, all 7 `categories[].score` |
| `.asm-improver/iter-N.json` (highest N) | the same fields, after                              |
| `.asm-improver/report.md`               | files changed, key fixes, blocker list if any       |

Derived fields:

- `minCategory` before and after — the minimum of the 7 category scores
- `iterations` — N of 8
- `versionBefore` → `versionAfter` — the target's frontmatter `metadata.version`

Then clean the checkout, so nothing extraneous ships:

```bash
rm -f "$SKILL_PATH/SKILL.md.bak"     # left behind by `asm eval --fix`
rm -rf "$SKILL_PATH/.asm-improver"   # iteration artifacts
```

`asm install` copies the source directory recursively; anything still in `$SKILL_PATH` lands in the installed skill.

## Install flags

```bash
asm install "$SKILL_PATH" -p "$TOOL" --scope "$SCOPE" --json -y
```

| Flag            | Why                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"$SKILL_PATH"` | A **local directory** — the improved copy. Never the remote source.                                                                                       |
| `-p/--tool`     | `claude`, `codex`, `agents`, … **Required** — without it ASM aborts with `--tool (or --provider) is required in non-interactive mode`. Ask; do not guess. |
| `--scope`       | `global` or `project`. Ask if the user did not say; do not guess.                                                                                         |
| `--json`        | Machine-readable result, so the outcome is parsed, not scraped — including `.path`.                                                                       |
| `-y`            | The user already approved the install; the improvement was the decision point.                                                                            |
| `--name <alt>`  | Only when the user explicitly opts out of overwriting.                                                                                                    |

`-y` skips the confirmation prompt as well as the install prompt, so nothing in the command asks before replacing an existing skill. `-f` is **not** part of this flow: `asm install` sets force itself whenever the name already exists.

## Collision policy

`skill-auto-improver` never renames a skill, so the improved variant keeps the original frontmatter `name`. If the original is already installed, the names collide.

**`asm install` never refuses on a collision.** When a skill with the same frontmatter `name` is already installed for the selected tool, it plans a force overwrite on the very first invocation: the existing target directory is removed and replaced. With `-y` there is no prompt, no error, and no `Skill already exists` message — that failure only comes from the bundle/import path, never from `asm install`. So the safety gate has to run _before_ the command, not after it.

Two different names are in play and they can disagree:

- The **overwrite decision** matches the frontmatter `name` plus the selected tool. Scope is not part of that match, and `--name` does not suppress it.
- The **directory deleted** is the _target_ directory: `$SKILL_PATH`'s basename (or `alt`) under the install base for `$TOOL`/`$SCOPE`. That is not necessarily the matched entry's `path`.

1. **Probe first.** Before invoking `asm install`, list what is already installed and look for both names:

   ```bash
   asm list --json    # each entry carries name, dirName, path, provider, scope
   ```

   `asm inspect "<dirName>" --json` gives the same detail for a single entry, but it matches on the **directory** name only — use `asm list --json` when you need to match the frontmatter `name`.

2. **Neither name matches.** Nothing is touched. Install and report a clean install.
3. **Frontmatter `name` matches for the selected tool — confirm, then overwrite.** The matched entry is only the _trigger_; it may sit in a different scope. Confirm the **target** directory instead — derive its base from the `path` of probe entries sharing the same `provider` and `scope`, and state what the probe shows occupying it (`name`, `dirName`, `provider`, `scope`) or that it is free. Name the matched entry separately, as the reason force is set. Overwriting is the expected outcome (the request was to install the improved variant), but it is destructive and unconditional, so it must be an informed choice made before the command runs.
4. **Only the directory name matches.** No force is planned, so nothing is deleted — but the recursive copy still **merges into** the existing directory: colliding files are overwritten in place and the previous occupant's other files stay behind inside the installed skill. There is no clean-install guarantee anywhere in `asm install`. Confirm this case as well, and check the result for strays.
5. **Opt-out: `--name <alt>`.** Side-by-side install under directory name `alt`. `--name` does not suppress force, so when the frontmatter `name` already matches, anything occupying `<base>/<alt>` is deleted and replaced, not merged — check `alt` against the probe first. Warn before doing it: **both skills then carry the same frontmatter `name` and the same triggers**, so the runtime has two indistinguishable candidates — the duplicate-trigger hazard the ASM auditor reports. Take this path only when the user asks for it.

The report always states which of these paths was taken and what, if anything, was replaced or merged into.

## Report template

Print this to the user at the end of Phase 4, before removing `$WORK`.

```
◆ Installed an improved variant of `<skill-name>`
··································································
  Installed to:      <.path from the install --json output — never assumed>
  Tool / scope:      <tool> / <scope>
  Install path:      clean install | confirmed overwrite of <target path> | side-by-side as <alt>

  Improved from
    Supplied as:     <what the user typed>
    Resolved from:   <installUrl | clone URL | local path>
    Upstream commit: <sha | n/a>

  Improvement
    Overall score:   <before> (<grade>) → <after> (<grade>)
    Min category:    <before> → <after>
    Version:         <x.y.z> → <x.y.z>
    Iterations:      <N> of 8
    Files changed:   <list>

  Note: the installed copy is the improved one. The original source
        was not modified.
```

### When no improvement was needed

If the baseline already cleared both gates, `skill-auto-improver` stops without editing and the original is installed unchanged. Say that plainly rather than printing a zero delta:

```
◆ Installed `<skill-name>` unchanged — no improvement needed
··································································
  Baseline already clears both gates: <score> (<grade>), min category <n>.
  skill-auto-improver made no edits. The published skill was installed as-is.
```

### When the improver ended in BLOCKER

Show the blocker list from `.asm-improver/report.md` and the partial before → after numbers, then **ask** whether to install the partially-improved variant or abort. Never install a blocker result silently, and never describe it as improved-to-standard when it is not.
