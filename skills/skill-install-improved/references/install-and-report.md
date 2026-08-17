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
asm install "$SKILL_PATH" --scope "$SCOPE" --json -y
```

| Flag            | Why                                                                            |
| --------------- | ------------------------------------------------------------------------------ |
| `"$SKILL_PATH"` | A **local directory** — the improved copy. Never the remote source.            |
| `--scope`       | `global` or `project`. Ask if the user did not say; do not guess.              |
| `--json`        | Machine-readable result, so the outcome is parsed, not scraped.                |
| `-y`            | The user already approved the install; the improvement was the decision point. |
| `-f`            | Only on a conflict, per the policy below.                                      |
| `--name <alt>`  | Only when the user explicitly opts out of overwriting.                         |

## Collision policy

`skill-auto-improver` never renames a skill, so the improved variant keeps the original frontmatter `name`. If the original is already installed, the names collide.

1. **Probe.** Run the install without `-f`. No conflict → it succeeds and you are done.
2. **Conflict.** ASM fails with `Skill already exists at: <path>` / `Use --force to overwrite.` Name that path, and the source the existing install came from, in the output.
3. **Default: overwrite.** Re-run with `-f`. This is the default because the request was to install the improved variant — leaving the original in place would not satisfy it.

   ```bash
   asm install "$SKILL_PATH" --scope "$SCOPE" --json -y -f
   ```

4. **Opt-out: `--name <alt>`.** Side-by-side install under a different directory name. Warn before doing it: **both skills then carry the same frontmatter `name` and the same triggers**, so the runtime has two indistinguishable candidates — the duplicate-trigger hazard the ASM auditor reports. Take this path only when the user asks for it.

The report always states which of the three paths was taken and what, if anything, was replaced.

## Report template

Print this to the user at the end of Phase 4, before removing `$WORK`.

```
◆ Installed an improved variant of `<skill-name>`
··································································
  Installed to:      ~/.claude/skills/<dir>
  Install path:      clean install | forced overwrite of <path> | side-by-side as <alt>

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
