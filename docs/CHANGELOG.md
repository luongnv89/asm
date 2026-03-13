# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.1] - 2026-03-13

### Added

- `asm install` now accepts plain HTTPS GitHub URLs (e.g., `https://github.com/owner/repo`) in addition to the `github:owner/repo` format (#5)
- Support for `.git` suffix, `/tree/branch` paths, and trailing slashes in HTTPS URLs

### Fixed

- Add type annotations to fix implicit `any` typecheck errors in tests

## [1.4.0] - 2026-03-13

### Added

- `asm install github:user/repo` command for installing skills directly from GitHub repositories
- `--verbose` / `-V` flag for debug output across all commands
- Node.js compatibility layer, config backup, semver sort, readline safety, lazy file counts
- `export`, `init`, `stats`, `link` commands and skill health warnings

### Fixed

- Pin @opentui/core to exact version 0.1.87 for stability
- Make list table test resilient to environments without skills

## [1.3.0] - 2026-03-11

### Added

- Symlink-aware duplicate detection — skills that are symlinks pointing to the same real directory are no longer flagged as duplicates
- `realPath` field on scanned skills via `fs.realpath()` for accurate identity resolution

### Changed

- Audit deduplicates by resolved real path before grouping, preferring the non-symlink (real directory) entry

## [1.2.0] - 2026-03-11

### Added

- Build step (`bun run build`) to bundle the project into a single JS file for npm distribution
- `prepublishOnly` script to auto-build before `npm publish`
- Build script (`scripts/build.ts`) with version and commit hash injection at build time
- `files` field in package.json for clean npm package (only `dist/`, `README.md`, `LICENSE`)

### Changed

- Bin entry points now reference bundled `dist/agent-skill-manager.js` instead of raw TypeScript source
- Version resolution falls back to build-time injected values when running as bundled binary

### Fixed

- Version display works correctly in both development (source) and production (bundled) modes

## [1.1.0] - 2026-03-11

### Added

- Non-interactive CLI mode with full command suite: `list`, `search`, `inspect`, `uninstall`, `audit`, `config`
- `asm` shorthand command alias
- Duplicate skill audit — detect and remove duplicates across providers and scopes (`asm audit`)
- TUI audit overlay with two-phase workflow (groups → instance picker, key: `a`)
- JSON output support (`--json`) for CLI commands
- Output formatter module for consistent table, detail, and JSON output
- One-command install script (`curl | bash`) with automatic Bun installation
- .npmignore to exclude unnecessary files from npm package
- TUI screenshot in README

### Fixed

- Bun global bin PATH handling and asm/agent-skill-manager alias creation in installer
- External font import in SVGs for GitHub rendering

### Changed

- Rebranded project to agent-skill-manager across all files
- Renamed bin entry point to `agent-skill-manager.ts` to match package name
- Renamed package to agent-skill-manager with version info in help output

### Removed

- Obsolete CLI_PLAN.md

## [1.0.0] - 2025-03-11

### Added

- Interactive TUI dashboard with OpenTUI
- Multi-agent support: Claude Code, Codex, OpenClaw, and generic Agents
- Configurable providers via `~/.config/agent-skill-manager/config.json`
- Global and project scope filtering
- Real-time search and sort (by name, version, location)
- Detailed skill view with SKILL.md frontmatter metadata
- Safe uninstall with confirmation dialog
- In-TUI config editor with provider toggle
- CLI entry point with `--help` and `--version` flags
- Pre-commit hooks (Prettier, TypeScript type-checking)
- GitHub Actions CI pipeline
- Unit tests for config, scanner, uninstaller, and frontmatter modules
