# Entry format — Keep a Changelog for one skill

Read this at Step 4. Source: Keep a Changelog 1.1.0, https://keepachangelog.com/en/1.1.0/ (fetched 2026-11-05).

## The file

`<skill-dir>/CHANGELOG.md`, newest version first. Create it with this header when it is missing:

```markdown
# Changelog

All notable changes to this skill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this skill adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
```

Insert the new entry directly above the current top version entry. With no version entry yet, insert it below the `## [Unreleased]` (or `## Unreleased`) section when there is one, otherwise below the header. An Unreleased section always stays above the new entry, unchanged: moving its bullets is the author's call. Leave older entries untouched.

## One entry

```markdown
## [1.3.0] - 2026-11-05

### Added

- Backfill mode: offers once to reconstruct missing entries from git history.

### Fixed

- The diff no longer counts edits to CHANGELOG.md itself as skill changes.
```

- Heading: `## [X.Y.Z] - YYYY-MM-DD`. The version is the bumped `metadata.version`. The date is the bump commit's date (`git -C <repo-root> log -1 --format=%cd --date=short <end>`), or today's local date (`date +%F`) for an uncommitted bump.
- Section order, using only the ones that apply: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. Never write an empty section.
- At most 8 bullets per entry. Merge related edits into one bullet.

## Mapping a diff to sections

| Change in the diff                                                                                | Section    |
| ------------------------------------------------------------------------------------------------- | ---------- |
| New step, mode, flag, script, reference, trigger phrase, supported tool                           | Added      |
| Reworded behaviour, new defaults, restructured steps, description rewrite, new output format      | Changed    |
| Step or option marked for removal but still present                                               | Deprecated |
| Step, script, option or trigger deleted                                                           | Removed    |
| Corrected wrong command, path, logic or validation; typo that changed meaning                     | Fixed      |
| Removed a credential, tightened a permission, closed an injection path, blocked an unsafe command | Security   |

Skip changes a skill user cannot notice: whitespace, prettier reflow, the version bump itself, `docs/README.md` wording, eval fixtures. When the diff holds only such changes, write one `Changed` bullet: "Maintenance only; no behaviour change."

A major bump (`X.0.0`) needs at least one bullet that says what breaks and what the user must do, prefixed `**Breaking:**`.

## Writing the bullets

- Write for someone who runs the skill, not for its author. Say what the skill now does differently.
- Start with a noun or a past-tense verb. One change per bullet. End with a period.
- Name the step, flag or file the user sees (`Step 3`, `--dry-run`, `references/x.md`).
- Add the issue or PR reference when a commit subject in the range carries one: `(#123)`.
- Never paste the git log, file lists, or diff hunks.

Good: `- Step 2 now stops when the skill folder is outside a git repository, instead of writing an empty entry.`
Bad: `- Updated SKILL.md and scripts/skill_versions.py.`
