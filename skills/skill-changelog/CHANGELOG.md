# Changelog

All notable changes to this skill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this skill adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-11-16

### Changed

- `references/entry-format.md` and `references/backfill.md` no longer cap bullet counts; entries list each change a skill user would notice, merging related edits into one bullet.

## [1.0.1] - 2026-11-15

### Fixed

- The optional repo sync stashes only tracked changes and leaves untracked files in place, so files owned by other sessions are never moved into a stash.

## [1.0.0] - 2026-11-05

### Added

- Initial release: writes a skill's `CHANGELOG.md` entry from its git diff when `metadata.version` is bumped (#778).
- `scripts/skill_versions.py` with `state`, `history` and `check` subcommands.
- One-time backfill offer (or `--backfill` on request) that reconstructs missing versions from git history.
- Safe stops: blocks on shallow clones, unstaged renames and ambiguous renames instead of writing a wrong "Initial release".
