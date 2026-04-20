# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.1.0] - 2026-04-20

### Added

- `heygen-com/hyperframes` curated-index entry — 5 new skills (hyperframes, hyperframes-cli, hyperframes-registry, website-to-hyperframes, gsap) for HTML-based video composition (#184)
- Re-indexed `mattpocock/skills` (18 → 21 skills) (#183)

### Fixed

- Skill discovery now scans 5 levels deep (was 3), catching skills nested under `plugins/<group>/skills/<skill>/SKILL.md`. All curated repos re-indexed — catalog grew from ~1,700 to 3,135 skills across 24 repos (#185)

## [2.0.0] - 2026-04-19

### Removed (BREAKING)

- Drop the `skillgrade` runtime provider and its bundled binary. `asm eval <skill>` is now zero-config — no external binary, API key, Docker, or `eval.yaml` needed; the built-in `quality` provider scores every skill out of the box (#180, #182)
- Remove CLI flags: `--runtime`, `--runtime init`, `--preset`, `--provider`, `--compare`, `--threshold`. CI pipelines using these flags will fail on upgrade — drop the flags and rely on the default quality provider
- Remove `ASM_SKILLGRADE_BIN` environment variable
- Remove `docs/skillgrade-integration.md`

### Changed

- Cuts ~5–10 MB from the npm tarball by dropping `skillgrade` from `dependencies` and `bundledDependencies`

## [1.22.0] - 2026-04-19

### Added

- PATH shadowing detection: `asm --version` warns when multiple `asm` binaries are found on `PATH`; `asm doctor` gains a new `checkNoPathShadowing` check; npm postinstall emits a warning at install time; `install.sh` adds a bash-side warning in `verify_installation`
- Expanded `skillgrade-missing` error in `asm eval` with a manual fallback — guides users through installing Skillgrade by hand when automatic install fails (#176)

### Fixed

- Bundle `skillgrade` via `bundledDependencies` so it ships inside the `asm` package and is always available without a separate install step (#175)
- Auto-initialise `eval.yaml` when missing and fix a misleading init hint in `asm eval --runtime init` output (#174)

## [1.21.0] - 2026-04-19

### Added

- `asm eval <skill>` static quality lint through a new pluggable evaluator framework (`quality@1.0.0` provider wraps the existing SKILL.md linter)
- `asm eval <skill> --runtime` runtime evaluation via [skillgrade](https://github.com/mgechev/skillgrade) — deterministic + LLM-judge graders in a Docker sandbox with CI-ready exit codes
- **Skillgrade now ships bundled with `agent-skill-manager`.** `npm install -g agent-skill-manager` installs everything needed; no separate `npm i -g skillgrade` step. Binary is resolved from asm's own `node_modules` at runtime so there's no PATH pollution or conflict with a system-wide skillgrade
- `ASM_SKILLGRADE_BIN` environment variable to override the bundled binary (useful for developing skillgrade locally, pinning a specific release, or CI containers with a system-provided skillgrade)
- `asm eval <skill> --runtime init` scaffolds an `eval.yaml` for the skill via `skillgrade init`
- `asm eval` flags: `--preset smoke|reliable|regression`, `--threshold <n>`, `--provider docker|local`, `--machine` JSON output
- `asm eval <skill> --compare <id>@<v1>,<id>@<v2>` renders a diff between two provider versions on the same skill — score delta, pass/fail flips, added/removed findings, category deltas
- `asm eval-providers list` subcommand — prints a table of registered providers with version, schema version, description, and external requirements
- Pluggable `EvalProvider` contract with semver-range resolution and a versioned `EvalResult` schema (new `src/eval/` module: `types.ts`, `registry.ts`, `runner.ts`, `config.ts`, `compare.ts`)
- Config section `eval.providers.*` in `~/.asm/config.yml` for pinning provider versions and configuring runtime options (preset, threshold, Docker vs local, external version range)
- Hermes agent as a built-in provider (18 providers total) — supports `~/.hermes/skills/` and `.hermes/skills/`, listed in `asm tools` and on the website's supported-tools section

### Fixed

- Recognize Windows drive paths (e.g. `C:\…`) as local sources in `asm install` (#138)

### Docs

- Add `docs/eval-providers.md` — provider model, version pinning, `--compare` before upgrade, 5-step checklist for adding a new provider
- Add `docs/skillgrade-integration.md` — install skillgrade, write your first `eval.yaml`, presets (smoke/reliable/regression), CI usage, troubleshooting
- Document the `src/eval/` module in `docs/ARCHITECTURE.md`
- README: expanded Runtime Evaluation section, added `eval`/`eval-providers` to the CLI commands table, added eval step to the local-dev workflow

## [1.6.0] - 2026-03-13

### Added

- Default grouped list view: skills installed across multiple providers are collapsed into a single row with colored `[Provider]` badges
- `--flat` flag for `list` and `search` to show one row per provider instance (previous default behavior)
- `-p/--provider` filter on `list` and `search` commands to filter by provider
- Search results display match count header and highlight matching terms in bold/yellow
- Stats dashboard with ASCII bar charts for provider distribution and scope breakdown
- Provider-specific colors throughout CLI output (Claude=blue, Codex=cyan, OpenClaw=yellow, Agents=green)
- Summary footer on `list` output showing total, unique count, provider count, and scope breakdown
- Practical examples section added to all subcommand `--help` texts
- Actionable error hints: "not found" errors now suggest `asm list` or `asm search`
- Audit report now shows actionable hint: "Run `asm audit -y` to auto-remove duplicates"

### Changed

- Paths shortened with `~` prefix throughout all CLI output (list, inspect, audit, uninstall)
- Inspect output uses lighter header style with provider badges instead of numbered list
- Audit output leads with provider-colored labels instead of long paths
- `stats --json` omits `perSkillDiskBytes` by default (use `--verbose` to include)

## [1.5.1] - 2026-03-13

### Fixed

- Compact batch install output: shared settings shown once, one line per skill with progress counter and warning summary
- Replace Unicode characters (checkmarks, arrows, box-drawing, em-dashes) with ASCII-safe equivalents to prevent garbled terminal output
- Fix process hang after interactive provider selection by pausing stdin after read

## [1.5.0] - 2026-03-13

### Added

- `asm install -p all` option to install skills across all enabled providers simultaneously
- Primary provider receives the skill files; other providers get relative symlinks
- Safe symlink handling: existing symlinks are replaced, real directories are skipped (no data loss)
- Interactive provider picker now includes an "All providers" option
- Comprehensive tests for `executeInstallAllProviders`

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
