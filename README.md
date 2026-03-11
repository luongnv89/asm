<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-full.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/logo-black.svg" />
    <img src="assets/logo/logo-full.svg" alt="agent-skill-manager" width="560" />
  </picture>
</p>

<p align="center">
  <em>The universal skill manager for AI coding agents.</em>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#usage">Usage</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a> &middot;
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.0-black.svg" alt="Bun" /></a>
</p>

---

**agent-skill-manager** is an interactive terminal UI for managing installed skills across AI coding agents — [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [OpenClaw](https://github.com/openclaw), and more. Built with [OpenTUI](https://github.com/nicholasgasior/opentui) and [Bun](https://bun.sh).

<p align="center">
  <img src="assets/screenshots/agent-skill-manager.png" alt="agent-skill-manager TUI dashboard" width="800" />
</p>

## Features

- **Multi-agent support** — Manage skills for Claude Code, Codex, OpenClaw, and custom agent tools from one TUI
- **Configurable providers** — Define which agent tool directories to scan via `~/.config/agent-skill-manager/config.json`
- **Global & project scopes** — Filter skills by global (`~/.<tool>/skills/`) or project-level (`./<tool>/skills/`)
- **Real-time search** — Filter skills by name, description, or provider
- **Sort** — By name, version, or location
- **Detailed skill view** — Metadata from SKILL.md frontmatter including provider, path, symlink info
- **Safe uninstall** — Confirmation dialog, removes skill directories, rule files, and AGENTS.md blocks
- **In-TUI config editor** — Toggle providers on/off, or open config in `$EDITOR`

## Install

**Prerequisites:** [Bun](https://bun.sh) >= 1.0.0

```bash
bun install -g agent-skill-manager
```

Or run directly from source:

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
bun install
bun run start
```

## Usage

```bash
agent-skill-manager              # Launch the interactive TUI
agent-skill-manager --help       # Show help
agent-skill-manager --version    # Show version
```

## Keyboard Shortcuts

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

You can also toggle providers on/off directly in the TUI by pressing `c`.

## Supported Agent Tools

| Tool             | Global Path           | Project Path        |
| ---------------- | --------------------- | ------------------- |
| Claude Code      | `~/.claude/skills/`   | `.claude/skills/`   |
| Codex            | `~/.codex/skills/`    | `.codex/skills/`    |
| OpenClaw         | `~/.openclaw/skills/` | `.openclaw/skills/` |
| Agents (generic) | `~/.agents/skills/`   | `.agents/skills/`   |

Additional tools can be added via the config file.

## Project Structure

```
agent-skill-manager/
├── bin/                    # CLI entry point
│   └── skill-manager.ts
├── src/
│   ├── index.ts            # App bootstrap & keyboard handling
│   ├── config.ts           # Config loading & saving
│   ├── scanner.ts          # Skill directory scanning & filtering
│   ├── uninstaller.ts      # Safe skill removal logic
│   ├── utils/
│   │   ├── types.ts        # Shared TypeScript types
│   │   ├── colors.ts       # TUI color palette
│   │   └── frontmatter.ts  # SKILL.md frontmatter parser
│   └── views/
│       ├── dashboard.ts    # Main dashboard layout
│       ├── skill-list.ts   # Scrollable skill list
│       ├── skill-detail.ts # Skill detail overlay
│       ├── confirm.ts      # Uninstall confirmation dialog
│       ├── config.ts       # In-TUI config editor
│       └── help.ts         # Help overlay
├── docs/                   # Extended documentation
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

- **Runtime:** [Bun](https://bun.sh) >= 1.0.0
- **Language:** TypeScript (ESNext, strict mode)
- **TUI Framework:** [OpenTUI](https://github.com/nicholasgasior/opentui)
- **Testing:** Bun test runner
- **CI:** GitHub Actions + pre-commit hooks

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — see the [LICENSE](LICENSE) file for details.
