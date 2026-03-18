<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-full.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/logo-black.svg" />
    <img src="assets/logo/logo-full.svg" alt="agent-skill-manager" width="560" />
  </picture>
</p>

<p align="center">
  <em>The universal skill manager for AI agents.</em>
</p>

<p align="center">
  <a href="#features">Features</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#skillmd-format">SKILL.md Format</a> &middot;
  <a href="docs/">Docs</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a> &middot;
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <a href="https://www.npmjs.com/package/agent-skill-manager"><img src="https://img.shields.io/npm/v/agent-skill-manager.svg" alt="npm version" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.0-black.svg" alt="Bun" /></a>
  <a href="https://github.com/luongnv89/agent-skill-manager/actions"><img src="https://github.com/luongnv89/agent-skill-manager/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

---

**agent-skill-manager** (`asm`) is an interactive TUI and CLI for managing installed skills across AI coding agents — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [OpenClaw](https://github.com/openclaw), and more. Built with [OpenTUI](https://github.com/nicholasgasior/opentui) and [Bun](https://bun.sh).

<p align="center">
  <img src="assets/screenshots/tui.png" alt="agent-skill-manager TUI dashboard" width="800" />
</p>

## Features

- **Dual interface** — Full interactive TUI and non-interactive CLI (`asm list`, `asm search`, etc.)
- **Multi-agent support** — Manage skills for Claude Code, Codex, OpenClaw, and custom agent tools from a single tool
- **Configurable providers** — Define which agent tool directories to scan via `~/.config/agent-skill-manager/config.json`
- **Global & project scopes** — Filter skills by global (`~/.<tool>/skills/`) or project-level (`./<tool>/skills/`)
- **Real-time search** — Filter skills by name, description, or provider
- **Sort** — By name, version, or location
- **Detailed skill view** — Metadata from SKILL.md frontmatter including provider, path, symlink info
- **Duplicate audit** — Detect and remove duplicate skills across providers and scopes
- **Install from GitHub** — Install skills from any public/private GitHub repo with `asm install github:user/repo`
- **Security scanning** — Automatic pattern-based security warnings before installing skills
- **Safe uninstall** — Confirmation dialog, removes skill directories, rule files, and AGENTS.md blocks
- **In-TUI config editor** — Toggle providers on/off, or open config in `$EDITOR`
- **JSON output** — Machine-readable output for scripting (`--json`)

## Install

### npm (recommended)

The npm package ships as a pre-built bundle — **no build step required** on install.

**Prerequisites:** [Bun](https://bun.sh) >= 1.0.0 (used as the runtime)

```bash
# Install globally via npm
npm install -g agent-skill-manager

# Or via Bun
bun install -g agent-skill-manager
```

> **Note:** While the package is installed through npm, it requires the [Bun](https://bun.sh) runtime to execute. Install Bun with: `curl -fsSL https://bun.sh/install | bash`

### Quick Install (one command)

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
```

Or with wget:

```bash
wget -qO- https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
```

This will automatically install [Bun](https://bun.sh) (if not already installed) and then install `agent-skill-manager` globally.

### From Source

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
bun install
bun run build    # bundle to dist/
bun run start    # run from source (development)
```

### Advanced Options

```bash
# Download and inspect the install script before running
curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh -o install.sh
less install.sh  # review the script
bash install.sh
```

## Usage

### Interactive TUI

Launch without arguments to open the interactive terminal UI:

```bash
asm                    # or: agent-skill-manager
```

### CLI Commands

<p align="center">
  <img src="assets/screenshots/asm-list.png" alt="agent-skill-manager CLI output" width="800" />
</p>

```bash
asm list                       # List all discovered skills
asm search <query>             # Search by name/description/provider
asm inspect <skill-name>       # Show detailed info for a skill
asm install <source>           # Install a skill from GitHub
asm uninstall <skill-name>     # Remove a skill (with confirmation)
asm audit                      # Detect duplicate skills
asm audit security <name>     # Run security audit on a skill
asm index ingest <repo>        # Index a skill repo for searching
asm index search <query>       # Search indexed skills
asm index list                 # List indexed repositories
asm index remove <owner/repo>  # Remove a repo from the index
asm config show                # Print current config
asm config path                # Print config file path
asm config reset               # Reset config to defaults
asm config edit                # Open config in $EDITOR
```

### Global Options

```text
-h, --help             Show help for any command
-v, --version          Print version and exit
--json                 Output as JSON (list, search, inspect, audit)
-s, --scope <scope>    Filter: global, project, or both (default: both)
--sort <field>         Sort by: name, version, or location (default: name)
-y, --yes              Skip confirmation prompts
--no-color             Disable ANSI colors
```

### Installing Skills from GitHub

Install skills directly from GitHub repositories — supports both single-skill repos and multi-skill collections:

```bash
# Single-skill repo (SKILL.md at root)
asm install github:user/my-skill
asm install github:user/my-skill#v1.0.0 -p claude

# Multi-skill repo (skills in subdirectories)
asm install github:user/skills --path skills/code-review
asm install github:user/skills --all -p claude -y
asm install github:user/skills              # interactive picker

# Subfolder URL (auto-detects branch and path)
asm install https://github.com/user/skills/tree/main/skills/agent-config
asm install github:user/skills#main:skills/agent-config

# Private repos (SSH transport)
asm install github:user/private-skill --transport ssh
asm install github:user/private-skill -t auto  # try HTTPS, fallback to SSH

# Other options
asm install github:user/my-skill --name custom-name
asm install github:user/my-skill --force
asm install github:user/my-skill -p claude --yes --json
```

**Source format:** `github:owner/repo[#branch-or-tag]` or `github:owner/repo#ref:path` for subfolder installs. HTTPS GitHub URLs with `/tree/` paths (e.g., `https://github.com/user/skills/tree/main/skills/agent-config`) are also supported — the branch and subfolder are auto-detected.

**Install flags:**

| Flag                     | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| `-p, --provider <name>`  | Target provider (claude, codex, openclaw, agents)      |
| `--name <name>`          | Override skill directory name                          |
| `--path <subdir>`        | Install a specific skill from a subdirectory           |
| `--all`                  | Install all skills found in the repo                   |
| `-t, --transport <mode>` | Transport: `https`, `ssh`, or `auto` (default: `auto`) |
| `-f, --force`            | Overwrite if skill already exists                      |
| `-y, --yes`              | Skip confirmation prompt                               |
| `--json`                 | Output result as JSON                                  |

**Multi-skill repo support:** When a repo doesn't have `SKILL.md` at the root, `asm` automatically scans for skills in subdirectories (up to 3 levels deep). In interactive mode, it presents a numbered picker. Use `--path` to target a specific skill or `--all` to batch-install everything.

The install command clones the repository, validates `SKILL.md` files, scans for security warnings, previews skill metadata, and installs to the selected provider's global skill directory. Requires `git` on PATH.

### Examples

```bash
# List all global skills sorted by provider location
asm list --scope global --sort location

# Search for skills and output JSON
asm search "code review" --json

# Inspect a specific skill
asm inspect my-skill

# Remove duplicates automatically
asm audit --yes

# Security audit a skill before installing
asm audit security github:user/repo

# Audit all installed skills
asm audit security --all

# Uninstall without confirmation
asm uninstall old-skill --yes

# Index a skill repo and search it
asm index ingest github:anthropics/skills
asm index search "frontend design" --json
```

## TUI Keyboard Shortcuts

| Key            | Action                                |
| -------------- | ------------------------------------- |
| `↑/↓` or `j/k` | Navigate skill list                   |
| `Enter`        | View skill details                    |
| `d`            | Uninstall selected skill              |
| `/`            | Search / filter skills                |
| `Esc`          | Back / clear filter / close dialog    |
| `Tab`          | Cycle scope: Global → Project → Both  |
| `s`            | Cycle sort: Name → Version → Location |
| `r`            | Refresh / rescan skills               |
| `c`            | Open configuration                    |
| `a`            | Audit duplicates                      |
| `q`            | Quit                                  |
| `?`            | Toggle help overlay                   |

## Configuration

On first run, a config file is created at `~/.config/agent-skill-manager/config.json` with default providers:

```json
{
  "version": 1,
  "providers": [
    {
      "name": "claude",
      "label": "Claude Code",
      "global": "~/.claude/skills",
      "project": ".claude/skills",
      "enabled": true
    },
    {
      "name": "codex",
      "label": "Codex",
      "global": "~/.codex/skills",
      "project": ".codex/skills",
      "enabled": true
    },
    {
      "name": "openclaw",
      "label": "OpenClaw",
      "global": "~/.openclaw/skills",
      "project": ".openclaw/skills",
      "enabled": true
    },
    {
      "name": "agents",
      "label": "Agents",
      "global": "~/.agents/skills",
      "project": ".agents/skills",
      "enabled": true
    }
  ],
  "customPaths": [],
  "preferences": {
    "defaultScope": "both",
    "defaultSort": "name"
  }
}
```

- **Add providers** — Add new entries to the `providers` array for any agent tool
- **Custom paths** — Add arbitrary directories via `customPaths`
- **Disable providers** — Set `enabled: false` to skip scanning a provider
- **Preferences** — Set default scope and sort order

You can also manage config from the CLI (`asm config show|path|reset|edit`) or toggle providers in the TUI by pressing `c`.

## Supported Agent Tools

| Tool             | Global Path           | Project Path        |
| ---------------- | --------------------- | ------------------- |
| Claude Code      | `~/.claude/skills/`   | `.claude/skills/`   |
| Codex            | `~/.codex/skills/`    | `.codex/skills/`    |
| OpenClaw         | `~/.openclaw/skills/` | `.openclaw/skills/` |
| Agents (generic) | `~/.agents/skills/`   | `.agents/skills/`   |

Additional tools can be added via the config file.

## SKILL.md Format

Every skill is a directory containing a `SKILL.md` file. The file starts with a YAML frontmatter block followed by markdown instructions that the AI agent loads at runtime.

### Frontmatter

```yaml
---
name: my-skill
description: "A short description of what this skill does"
license: "MIT"
metadata:
  version: 1.0.0
  creator: "Your Name <you@example.com>"
---
```

| Field              | Required | Description                                         |
| ------------------ | :------: | --------------------------------------------------- |
| `name`             |   yes    | Unique skill identifier (used in list/search)       |
| `description`      |   yes    | One-line summary shown in listings                  |
| `license`          |    no    | SPDX license identifier (e.g., `MIT`, `Apache-2.0`) |
| `metadata.version` |    no    | Semver version string (defaults to `0.0.0`)         |
| `metadata.creator` |    no    | Author name and optional email                      |

> **Version resolution:** `asm` prefers `metadata.version` over a top-level `version` field. If neither is present, the version defaults to `0.0.0`. Both formats are supported for backward compatibility.

### Body

The markdown body after the frontmatter is loaded by the AI agent as the skill's instructions. A typical structure:

```markdown
# my-skill

Describe what this skill does here.

## When to Use

- Trigger conditions for this skill

## Instructions

- Step-by-step instructions for the agent
```

### Scaffold a new skill

Use `asm init` to generate a SKILL.md with the correct structure:

```bash
asm init my-skill              # creates my-skill/SKILL.md in the default provider
asm init my-skill -p claude    # creates in Claude Code's skill directory
```

## Project Structure

```text
agent-skill-manager/
├── bin/                       # CLI entry point (source)
│   └── agent-skill-manager.ts
├── dist/                      # Built bundle (npm package ships this)
│   └── agent-skill-manager.js
├── scripts/
│   └── build.ts               # Build script with version injection
├── src/
│   ├── index.ts               # TUI app bootstrap & keyboard handling
│   ├── cli.ts                 # CLI command parser & dispatcher
│   ├── config.ts              # Config loading & saving
│   ├── scanner.ts             # Skill directory scanning & filtering
│   ├── auditor.ts             # Duplicate detection & reporting
│   ├── installer.ts           # GitHub skill installation pipeline
│   ├── uninstaller.ts         # Safe skill removal logic
│   ├── formatter.ts           # Output formatting (tables, detail, JSON)
│   ├── utils/
│   │   ├── types.ts           # Shared TypeScript types
│   │   ├── colors.ts          # TUI color palette
│   │   ├── version.ts         # Version constant
│   │   └── frontmatter.ts     # SKILL.md frontmatter parser
│   └── views/
│       ├── dashboard.ts       # Main dashboard layout
│       ├── skill-list.ts      # Scrollable skill list
│       ├── skill-detail.ts    # Skill detail overlay
│       ├── confirm.ts         # Uninstall confirmation dialog
│       ├── duplicates.ts      # Duplicate audit overlay
│       ├── config.ts          # In-TUI config editor
│       └── help.ts            # Help overlay
├── docs/                      # Extended documentation
│   ├── ARCHITECTURE.md        # System design & data flow
│   ├── DEVELOPMENT.md         # Local setup & debugging
│   ├── DEPLOYMENT.md          # Publishing & CI pipeline
│   ├── CHANGELOG.md           # Version history
│   └── brand_kit.md           # Logo, colors, typography
├── assets/
│   ├── logo/                  # SVG logos (full, mark, wordmark, icon, favicon)
│   └── screenshots/           # TUI screenshots
├── install.sh                 # One-command installer (curl | bash)
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) >= 1.0.0
- **Language:** TypeScript (ESNext, strict mode)
- **Build:** Bun bundler (ships pre-built via npm)
- **TUI Framework:** [OpenTUI](https://github.com/nicholasgasior/opentui)
- **Testing:** Bun test runner
- **CI:** GitHub Actions + pre-commit hooks

## Documentation

| Document                              | Description                              |
| ------------------------------------- | ---------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)  | System design, components, and data flow |
| [Development](docs/DEVELOPMENT.md)    | Local setup, testing, and debugging      |
| [Deployment](docs/DEPLOYMENT.md)      | Publishing and CI pipeline               |
| [Changelog](docs/CHANGELOG.md)        | Version history                          |
| [Brand Kit](docs/brand_kit.md)        | Logo, colors, and typography             |
| [Contributing](CONTRIBUTING.md)       | How to contribute                        |
| [Security](SECURITY.md)               | Vulnerability reporting                  |
| [Code of Conduct](CODE_OF_CONDUCT.md) | Community guidelines                     |

## Open-Source Skill Collections

A curated list of open-source repositories that offer collections of skills for AI agents. Install any of them with `asm install github:<owner>/<repo>`.

> **Last updated:** 2026-03-18 | **Previous update:** 2026-03-17

| Repository                                                                          | Description                                                                                                                                                                 | Maintainer                                               |  Stars | Trending | Skills |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -----: | :------: | -----: |
| [anthropic-skills](https://github.com/anthropics/skills)                            | Public repository for Agent Skills.                                                                                                                                         | [@anthropics](https://github.com/anthropics)             | 95,957 |    —     |     18 |
| [superpowers](https://github.com/obra/superpowers)                                  | An agentic skills framework & software development methodology that works.                                                                                                  | [@obra](https://github.com/obra)                         | 89,816 |    —     |     14 |
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code)        | The agent harness performance optimization system. Skills, instincts, memory, security, and research-first development for Claude Code, Codex, Opencode, Cursor and beyond. | [@affaan-m](https://github.com/affaan-m)                 | 81,392 |    ↑     |    147 |
| [agency-agents](https://github.com/msitarzewski/agency-agents)                      | A complete AI agency at your fingertips — specialized expert agents with personality, processes, and proven deliverables.                                                   | [@msitarzewski](https://github.com/msitarzewski)         | 50,749 |    —     |      0 |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)      | An AI skill that provides design intelligence for building professional UI/UX across multiple platforms.                                                                    | [@nextlevelbuilder](https://github.com/nextlevelbuilder) | 43,112 |    —     |      7 |
| [antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | The Ultimate Collection of 1000+ Agentic Skills for Claude Code/Antigravity/Cursor. Battle-tested, high-performance skills for AI agents.                                   | [@sickn33](https://github.com/sickn33)                   | 25,047 |    ↑     |   1258 |
| [marketingskills](https://github.com/coreyhaines31/marketingskills)                 | Marketing skills for Claude Code and AI agents. CRO, copywriting, SEO, analytics, and growth engineering.                                                                   | [@coreyhaines31](https://github.com/coreyhaines31)       | 14,099 |    —     |     33 |
| [agentskills](https://github.com/agentskills/agentskills)                           | Specification and documentation for Agent Skills.                                                                                                                           | [@agentskills](https://github.com/agentskills)           | 13,342 |    —     |      0 |
| [taste-skill](https://github.com/Leonxlnx/taste-skill)                              | Taste-Skill (High-Agency Frontend) — gives your AI good taste. Stops the AI from generating boring, generic, "slop".                                                        | [@Leonxlnx](https://github.com/Leonxlnx)                 |  3,389 |    ↑     |      5 |
| [affiliate-skills](https://github.com/Affitor/affiliate-skills)                     | AI-powered Claude Skills for affiliate marketers. Full funnel: research → content → blog → landing → deploy.                                                                | [@Affitor](https://github.com/Affitor)                   |     99 |    —     |     47 |
| [skills](https://github.com/luongnv89/skills)                                       | Supercharge your AI agents/bots with reusable skills.                                                                                                                       | [@luongnv89](https://github.com/luongnv89)               |      1 |    —     |     29 |

> **Note:** The _Trending_ column compares star counts with the previous update. Arrows indicate growth (↑), decline (↓), or no prior data (—).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — see the [LICENSE](LICENSE) file for details.
