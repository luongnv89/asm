# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
