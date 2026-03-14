# Changelog

## v1.8.1 — 2026-03-14

### Bug Fixes

- Fix duplicate skill removal to create symlinks to the kept instance instead of just deleting the folder, so skills remain accessible from all provider locations

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.8.0...v1.8.1

## v1.8.0 — 2026-03-14

### Features

- Add `--transport <https|ssh|auto>` flag for `asm install` to support private GitHub repos via SSH with automatic fallback (Issue #6)
- Add `asm audit security` subcommand for scanning skills for dangerous patterns (shell execution, network access, credential exposure, obfuscation)
- Add `--all` flag for `asm audit security` to audit all installed skills at once
- Support auditing remote GitHub skills before installing via `asm audit security github:owner/repo`

### Improvements

- Extract shared file utilities (`BINARY_EXTENSIONS`, `readFilesRecursive`) into `src/utils/fs.ts` to eliminate duplication
- Consolidate ANSI color helpers into `formatter.ts` with new `bg*` variants
- Split `cmdAuditSecurity` into focused sub-functions for readability

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.7.0...v1.8.0

## v1.7.0 — 2026-03-13

### Features

- Add YAML frontmatter validation for SKILL.md files using the `yaml` library
- Detect and report `invalid-yaml` warnings in `asm inspect` and `asm list` health checks

### Dependencies

- Add `yaml` (^2.8.2) as a runtime dependency for strict YAML parsing

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.2...v1.7.0

## v1.6.2 — 2026-03-13

### Bug Fixes

- Suppress "fatal: not a git repository" stderr noise when running outside a git repo
- Fix 7 failing tests to match the new grouped CLI output format from v1.6.0

### Other Changes

- Update README screenshot

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.1...v1.6.2

## v1.6.1 — 2026-03-13

### Bug Fixes

- Replace Unicode bar chart characters with ASCII-safe chars in `asm stats` output

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.0...v1.6.1

## v1.6.0 — 2026-03-13

### Features

- Overhaul CLI output with grouped views, provider colors, and visual stats
- Improve inspect output with grouped multi-provider view

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.5.1...v1.6.0

## v1.5.1 — 2026-03-12

### Bug Fixes

- Improve batch install UX and replace Unicode with ASCII-safe chars

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.5.0...v1.5.1
