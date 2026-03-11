# skill-manager

Interactive TUI for managing installed [pskills](https://github.com/luongnv89/skills) across global and project scopes.

Built with [OpenTUI](https://github.com/nicholasgasior/opentui) and [Bun](https://bun.sh).

## Install

```bash
# Requires Bun >= 1.0.0
bun install -g skill-manager
```

Or run directly from this repo:

```bash
git clone https://github.com/luongnv89/skill-manager.git
cd skill-manager
bun install
bun run start
```

## Usage

```bash
skill-manager              # Launch the interactive TUI
skill-manager --help       # Show help
skill-manager --version    # Show version
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑/↓` or `j/k` | Navigate skill list |
| `Enter` | View skill details |
| `d` | Uninstall selected skill |
| `/` | Search / filter skills |
| `Esc` | Back / clear filter / close dialog |
| `Tab` | Cycle scope: Global → Project → Both |
| `s` | Cycle sort: Name → Version → Location |
| `q` | Quit |
| `?` | Toggle help overlay |

## Features

- Scan skills across 4 locations: `~/.claude/skills/`, `~/.agents/skills/`, `.claude/skills/`, `.agents/skills/`
- Filter by scope (Global / Project / Both)
- Real-time search and filtering
- Sort by name, version, or location
- Detailed skill view with metadata from SKILL.md frontmatter
- Safe uninstall with confirmation dialog — removes skill directories, rule files, and AGENTS.md blocks

## License

MIT
