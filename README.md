<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-full.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/logo-black.svg" />
    <img src="assets/logo/logo-full.svg" alt="asm" width="340" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-skill-manager"><img src="https://img.shields.io/npm/v/agent-skill-manager.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/agent-skill-manager"><img src="https://img.shields.io/npm/dm/agent-skill-manager.svg" alt="npm downloads" /></a>
  <a href="https://github.com/luongnv89/agent-skill-manager/stargazers"><img src="https://img.shields.io/github/stars/luongnv89/agent-skill-manager.svg?style=social" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License" /></a>
  <a href="https://github.com/luongnv89/agent-skill-manager/actions"><img src="https://github.com/luongnv89/agent-skill-manager/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.0-black.svg" alt="Bun" /></a>
</p>

<h1 align="center">One tool to manage every AI agent's skills</h1>

<p align="center">
  Stop juggling skill directories across Claude Code, Codex, Cursor, Windsurf, and 10+ other AI agents.<br/>
  <strong>agent-skill-manager</strong> (<code>asm</code>) gives you a single TUI and CLI to install, search, audit, and organize all your agent skills — everywhere.
</p>

<p align="center">
  <a href="#get-started-in-30-seconds"><strong>Get Started in 30 Seconds &rarr;</strong></a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://luongnv.com/asm/"><strong>Browse 2,600+ Skills Online &rarr;</strong></a>
</p>

---

### 🌐 ASM Catalog — Browse Skills in Your Browser

Don't want to install anything yet? **[Explore the full skill catalog online &rarr;](https://luongnv.com/asm/)**

Search, filter by category or repo, and copy install commands — all from a single page. No signup, no backend, no tracking. Share filtered views via URL (e.g. `?q=code-review&cat=development`).

---

<p align="center">
  <img src="assets/screenshots/tui.png" alt="agent-skill-manager TUI dashboard" width="800" />
</p>

---

## Your AI agent skills are a mess

You use Claude Code at work, Codex for side projects, and OpenClaw for experiments. Each tool keeps skills in its own hidden directory with its own conventions. Here's what that looks like in practice:

- **Skills scattered everywhere** — `~/.claude/skills/`, `~/.codex/skills/`, `~/.openclaw/skills/`, project-level `.claude/skills/`... you have the same skill installed three times and can't remember which version is where
- **No visibility** — there's no quick way to see what's installed, what's duplicated, or what's outdated across all your agents
- **Installing is manual and risky** — you clone repos, copy folders, hope the SKILL.md is valid, and pray you didn't just install something that exfiltrates your codebase

The more AI agents you use, the worse this gets. Every new tool adds another skill directory to babysit.

## `asm` brings order to the chaos

**agent-skill-manager** is a single command that manages skills across every AI coding agent you use. One TUI. One CLI. Every agent.

- **See everything at once** — List, search, and filter skills across all providers and scopes from one dashboard. No more `ls`-ing through hidden directories.
- **Install from GitHub in one command** — `asm install github:user/repo` handles cloning, validation, and placement. Supports single-skill repos, multi-skill collections, subfolder URLs, and private repos via SSH.
- **Catch problems before they bite** — Built-in security scanning flags dangerous patterns (shell execution, network access, credential exposure, obfuscation) before you install. Duplicate audit finds and cleans redundant skills across providers.
- **Create and test skills locally** — Scaffold new skills with `asm init`, symlink them for live development with `asm link`, audit for security issues, and verify metadata — all before publishing. [See the full local dev workflow &darr;](#build-test-and-ship-your-own-skills)
- **Works with every major agent** — 17 providers built-in: Claude Code, Codex, OpenClaw, Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot, Aider, OpenCode, Zed, Augment, Amp, Gemini CLI, Google Antigravity, and a generic Agents provider. Add custom providers in seconds via config.
- **Two interfaces, one tool** — Full interactive TUI with keyboard navigation, search, and detail views. Or use the CLI with `--json` for scripting and automation.

<p align="center">
  <img src="assets/screenshots/asm-stats.png" alt="asm stats — skill statistics across all providers" width="700" />
  <br/><em>asm stats — totals, disk usage, and per-provider breakdown at a glance</em>
</p>

## How it works

1. **Install `asm`** — one command via npm, Bun, or curl
2. **Run `asm`** — it auto-discovers skills across all configured agent directories
3. **Manage everything** — install, search, inspect, audit, and uninstall skills from the TUI or CLI
4. **Stay safe** — security scan skills before installing, detect duplicates, and clean up with confidence

<p align="center">
  <a href="#get-started-in-30-seconds"><strong>Start Managing Your Skills &rarr;</strong></a>
</p>

<p align="center">
  <img src="assets/screenshots/asm-search-code-review.png" alt="asm search — find installed and available skills" width="700" />
  <br/><em>asm search code-review — finds installed skills and suggests new ones from indexed repos</em>
</p>

---

## Build, Test, and Ship Your Own Skills

`asm` isn't just for consuming skills — it's the complete toolkit for **creating, developing, auditing, and testing skills locally** before you share them.

### 1. Scaffold a new skill

Interactive mode — pick a target tool:

```bash
asm init my-skill
```

Scaffold directly into Claude Code:

```bash
asm init my-skill -p claude
```

Scaffold in a custom directory:

```bash
asm init my-skill --path ./skills
```

This creates a `my-skill/SKILL.md` with valid YAML frontmatter and a markdown template ready to fill in.

### 2. Develop with live reload via symlink

Symlink into Claude Code's skill directory:

```bash
asm link ./my-skill -p claude
```

Or into Codex, or any other tool:

```bash
asm link ./my-skill -p codex
```

Edit the source files — changes are reflected immediately in the agent. No reinstall needed. This is the fastest iteration loop for skill development.

### 3. Audit your skill for security issues

Audit an installed skill by name:

```bash
asm audit security my-skill
```

Audit a local directory:

```bash
asm audit security ./path/to/my-skill
```

Audit every installed skill:

```bash
asm audit security --all
```

The security scanner flags dangerous patterns — shell execution, network access, credential exposure, obfuscation, and external URLs — so you can catch problems before users install your skill.

### 4. Inspect and verify metadata

Check name, version, description, file count:

```bash
asm inspect my-skill
```

Machine-readable output for CI:

```bash
asm inspect my-skill --json
```

### 5. Test the install flow locally

Once your skill is on GitHub, verify that end users can install it cleanly.

Install your own skill as a user would:

```bash
asm install github:you/awesome-skill
```

Install to a specific tool:

```bash
asm install github:you/awesome-skill -p claude
```

Install a specific skill from a multi-skill repo:

```bash
asm install github:you/skills --path skills/awesome-skill
```

Force reinstall to test upgrades:

```bash
asm install github:you/awesome-skill --force
```

Non-interactive install (useful for CI):

```bash
asm install github:you/awesome-skill -p claude --yes --json
```

This catches issues that local development misses — broken repo structure, missing files, invalid frontmatter in a clean install context.

### Typical local development workflow

1. **Scaffold** — `asm init awesome-skill -p claude`
2. Edit your `SKILL.md`
3. **Link for live testing** — `asm link ./awesome-skill -p claude`
4. Test with your AI agent
5. **Security audit** — `asm audit security awesome-skill`
6. **Verify metadata** — `asm inspect awesome-skill`
7. Push to GitHub
8. **Verify install flow** — `asm install github:you/awesome-skill`

Whether you're building skills for yourself or publishing them for the community, `asm` gives you the full create → develop → audit → ship pipeline in one tool.

---

## Skill Verification

Skills indexed by `asm` are automatically evaluated against a set of verification criteria. Skills that pass all criteria receive a **verified** badge in the catalog and `"verified": true` in the index JSON. Skills that fail any criterion are still indexed but marked as unverified.

### Verification Criteria

A skill must satisfy **all four** of the following to be verified:

1. **Valid frontmatter** -- The SKILL.md file must contain YAML frontmatter with both a `name` and a `description` field. Empty or whitespace-only values fail this check.

2. **Meaningful body content** -- The markdown body (everything after the frontmatter block) must contain at least 20 characters of instruction text. A SKILL.md that is only frontmatter with no real guidance for the agent will fail.

3. **No malicious patterns** -- The full SKILL.md content is scanned for dangerous code patterns:
   - `atob()` calls (runtime base64 decoding / obfuscation)
   - Suspicious base64-encoded strings (40+ character base64 blocks with padding)
   - Hex-escape sequences (4+ consecutive `\xNN` escapes)
   - Hardcoded credentials (`API_KEY`, `SECRET_KEY`, or `PASSWORD` assignments)

4. **Proper structure** -- The skill directory must exist and contain a `SKILL.md` file that the ingestion pipeline can read.

### How to Reproduce Locally

You can verify your skill before publishing:

```bash
# Index your repo -- verification runs automatically during ingestion
asm index ingest github:your-user/your-repo

# Check the output JSON for the verified field
asm index search "your-skill" --json
```

Each indexed skill in the output JSON includes `"verified": true` or `"verified": false`. If verification fails, the ingestion debug log (set `ASM_DEBUG=1`) prints the specific reasons.

---

## Get Started in 30 Seconds

### npm (recommended)

```bash
npm install -g agent-skill-manager
```

> Requires [Bun](https://bun.sh) >= 1.0.0 as the runtime. Install Bun: `curl -fsSL https://bun.sh/install | bash`

### One-liner install

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
```

This installs Bun (if needed) and `agent-skill-manager` globally. Then just run:

```bash
asm
```

<p align="center">
  <a href="#cli-commands"><strong>See All Commands &rarr;</strong></a>
</p>

---

## Open-Source Skill Collections

A curated list of skill repositories you can install with a single command. Over **2,600 skills** available across these collections:

> **Last updated:** 2026-03-18

| Repository                                                                          | Description                                                        |  Stars | Skills |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -----: | -----: |
| [anthropic-skills](https://github.com/anthropics/skills)                            | Official Agent Skills from Anthropic                               | 95,957 |     18 |
| [superpowers](https://github.com/obra/superpowers)                                  | Agentic skills framework & development methodology                 | 89,816 |     14 |
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code)        | Performance optimization system for Claude Code, Codex, and beyond | 81,392 |    147 |
| [agency-agents](https://github.com/msitarzewski/agency-agents)                      | Specialized expert agents with personality and proven deliverables | 50,749 |      — |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)      | Design intelligence for building professional UI/UX                | 43,112 |      7 |
| [antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | 1,000+ battle-tested skills for Claude Code, Cursor, and more      | 25,047 |  1,258 |
| [marketingskills](https://github.com/coreyhaines31/marketingskills)                 | Marketing skills — CRO, copywriting, SEO, analytics, growth        | 14,099 |     33 |
| [agentskills](https://github.com/agentskills/agentskills)                           | Specification and documentation for Agent Skills                   | 13,342 |      — |
| [taste-skill](https://github.com/Leonxlnx/taste-skill)                              | Gives your AI good taste — stops generic, boring output            |  3,389 |      5 |
| [affiliate-skills](https://github.com/Affitor/affiliate-skills)                     | Full affiliate marketing funnel: research to deploy                |     99 |     47 |
| [skills](https://github.com/luongnv89/skills)                                       | Reusable skills to supercharge your AI agents                      |      1 |     29 |

Install any collection with an interactive picker:

```bash
asm install github:anthropics/skills
```

Or install everything at once:

```bash
asm install github:anthropics/skills --all
```

<p align="center">
  <img src="assets/screenshots/asm-inspect-oss-ready.png" alt="asm inspect — detailed skill information" width="700" />
  <br/><em>asm inspect oss-ready — version, creator, and every tool installation at once</em>
</p>

---

## Supported Agent Tools

`asm` ships with **17 built-in providers**, all enabled by default. Disable any you don't need via `asm config edit`.

| Tool               | Global Path                       | Project Path            | Default |
| ------------------ | --------------------------------- | ----------------------- | :-----: |
| Claude Code        | `~/.claude/skills/`               | `.claude/skills/`       | enabled |
| Codex              | `~/.codex/skills/`                | `.codex/skills/`        | enabled |
| OpenClaw           | `~/.openclaw/skills/`             | `.openclaw/skills/`     | enabled |
| Agents (generic)   | `~/.agents/skills/`               | `.agents/skills/`       | enabled |
| Cursor             | `~/.cursor/rules/`                | `.cursor/rules/`        | enabled |
| Windsurf           | `~/.windsurf/rules/`              | `.windsurf/rules/`      | enabled |
| Cline              | `~/Documents/Cline/Rules/`        | `.clinerules/`          | enabled |
| Roo Code           | `~/.roo/rules/`                   | `.roo/rules/`           | enabled |
| Continue           | `~/.continue/rules/`              | `.continue/rules/`      | enabled |
| GitHub Copilot     | `~/.github/instructions/`         | `.github/instructions/` | enabled |
| Aider              | `~/.aider/skills/`                | `.aider/skills/`        | enabled |
| OpenCode           | `~/.config/opencode/skills/`      | `.opencode/skills/`     | enabled |
| Zed                | `~/.config/zed/prompt_overrides/` | `.zed/rules/`           | enabled |
| Augment            | `~/.augment/rules/`               | `.augment/rules/`       | enabled |
| Amp                | `~/.amp/skills/`                  | `.amp/skills/`          | enabled |
| Gemini CLI         | `~/.gemini/skills/`               | `.gemini/skills/`       | enabled |
| Google Antigravity | `~/.antigravity/skills/`          | `.antigravity/skills/`  | enabled |

Disable a provider — opens config in `$EDITOR`, set `"enabled": false` for any provider:

```bash
asm config edit
```

Need a tool not listed? Add a custom provider entry to the config.

---

## FAQ

**Is it free?**
Yes. `asm` is MIT licensed and free forever. No accounts, no telemetry, no paywalls.

**Is it actively maintained?**
v1.16.0 shipped on March 25, 2026. The project has had 25 releases. Check the [changelog](docs/CHANGELOG.md) for the full history.

**Which AI agents does it support?**
17 providers built-in: Claude Code, Codex, OpenClaw, Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot, Aider, OpenCode, Zed, Augment, Amp, Gemini CLI, Google Antigravity, and a generic Agents provider. All 17 are enabled by default; disable any you don't need via `asm config edit`. You can also add any custom agent that stores skills as directories with a `SKILL.md` file.

**How does it compare to managing skills manually?**
Manual management means remembering where each agent stores skills, cloning repos by hand, checking for duplicates yourself, and having no security scanning. `asm` automates all of that with one command.

<p align="center">
  <img src="assets/screenshots/asm-audit.png" alt="asm audit — duplicate detection across providers" width="700" />
  <br/><em>asm audit — finds duplicate groups and tells you exactly which to keep</em>
</p>

**Can I use it with private repos?**
Yes. Use `--transport ssh` or `--transport auto` to clone private repos via SSH.

**Is it safe to install skills from GitHub?**
`asm` includes built-in security scanning that flags dangerous patterns (shell execution, network access, credential exposure, obfuscation) before installation. Run `asm audit security github:user/repo` to scan any skill before installing.

<p align="center">
  <img src="assets/screenshots/asm-audit-security-oss-ready.png" alt="asm audit security — security scanning report" width="700" />
  <br/><em>asm audit security oss-ready — flags external URLs, shell execution, and credential access</em>
</p>

**What's the SKILL.md format?**
Every skill is a directory containing a `SKILL.md` file with YAML frontmatter (name, description, version) followed by markdown instructions the AI agent loads at runtime. Run `asm init my-skill` to scaffold one.

---

## Start Managing Your Skills Today

You're already using AI agents. You're already installing skills. The only question is whether you keep doing it manually — or let `asm` handle it.

MIT licensed. Free forever. One install command.

<p align="center">
  <a href="#get-started-in-30-seconds"><strong>Install agent-skill-manager &rarr;</strong></a>
</p>

---

<details>
<summary><strong>CLI Commands</strong></summary>

### Interactive TUI

```bash
asm
```

### Commands

| Command                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `asm list`                      | List all discovered skills                  |
| `asm search <query>`            | Search by name/description/provider         |
| `asm inspect <skill-name>`      | Show detailed info for a skill              |
| `asm install <source>`          | Install a skill from GitHub                 |
| `asm uninstall <skill-name>`    | Remove a skill (with confirmation)          |
| `asm init <name>`               | Scaffold a new skill with SKILL.md template |
| `asm link <path>`               | Symlink a local skill for live development  |
| `asm audit`                     | Detect duplicate skills                     |
| `asm audit security <name>`     | Run security audit on a skill               |
| `asm stats`                     | Show aggregate skill metrics dashboard      |
| `asm export`                    | Export skill inventory as JSON manifest     |
| `asm index ingest <repo>`       | Index a skill repo for searching            |
| `asm index search <query>`      | Search indexed skills                       |
| `asm index list`                | List indexed repositories                   |
| `asm index remove <owner/repo>` | Remove a repo from the index                |
| `asm config show`               | Print current config                        |
| `asm config path`               | Print config file path                      |
| `asm config reset`              | Reset config to defaults                    |
| `asm config edit`               | Open config in $EDITOR                      |

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

### Examples

List all global skills sorted by provider location:

```bash
asm list --scope global --sort location
```

Search for skills and output JSON:

```bash
asm search "code review" --json
```

Inspect a specific skill:

```bash
asm inspect my-skill
```

Remove duplicates automatically:

```bash
asm audit --yes
```

Security audit a skill before installing:

```bash
asm audit security github:user/repo
```

Audit all installed skills:

```bash
asm audit security --all
```

Scaffold a skill, link it for live testing, audit, and inspect:

```bash
asm init my-skill -p claude
```

```bash
asm link ./my-skill -p claude
```

```bash
asm audit security my-skill
```

```bash
asm inspect my-skill --json
```

Uninstall without confirmation:

```bash
asm uninstall old-skill --yes
```

Index a skill repo and search it:

```bash
asm index ingest github:anthropics/skills
```

```bash
asm index search "frontend design" --json
```

</details>

<details>
<summary><strong>Installing Skills from GitHub</strong></summary>

Install skills directly from GitHub repositories — supports both single-skill repos and multi-skill collections.

**Single-skill repo** (SKILL.md at root):

```bash
asm install github:user/my-skill
```

```bash
asm install github:user/my-skill#v1.0.0 -p claude
```

**Multi-skill repo** (skills in subdirectories):

```bash
asm install github:user/skills --path skills/code-review
```

```bash
asm install github:user/skills --all -p claude -y
```

Interactive picker:

```bash
asm install github:user/skills
```

**Subfolder URL** (auto-detects branch and path):

```bash
asm install https://github.com/user/skills/tree/main/skills/agent-config
```

```bash
asm install github:user/skills#main:skills/agent-config
```

**Private repos** (SSH transport):

```bash
asm install github:user/private-skill --transport ssh
```

Try HTTPS, fallback to SSH:

```bash
asm install github:user/private-skill -t auto
```

**Vercel skills CLI** (delegates to `npx skills add`, then registers in asm):

```bash
asm install github:user/skills --method vercel --skill my-skill
```

```bash
asm install https://github.com/user/skills -m vercel --skill my-skill -y
```

**Other options:**

```bash
asm install github:user/my-skill --name custom-name
```

```bash
asm install github:user/my-skill --force
```

```bash
asm install github:user/my-skill -p claude --yes --json
```

**Source format:** `github:owner/repo[#branch-or-tag]` or `github:owner/repo#ref:path` for subfolder installs. HTTPS GitHub URLs with `/tree/` paths are also supported — the branch and subfolder are auto-detected.

**Install flags:**

| Flag                     | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `-p, --tool <name>`      | Target tool (claude, codex, cursor, windsurf, etc.)        |
| `--name <name>`          | Override skill directory name                              |
| `--path <subdir>`        | Install a specific skill from a subdirectory               |
| `--all`                  | Install all skills found in the repo                       |
| `-m, --method <method>`  | Install method: `default` or `vercel` (default: `default`) |
| `--skill <name>`         | Alias for `--path` (Vercel skills CLI compatibility)       |
| `-t, --transport <mode>` | Transport: `https`, `ssh`, or `auto` (default: `auto`)     |
| `-f, --force`            | Overwrite if skill already exists                          |
| `-y, --yes`              | Skip confirmation prompt                                   |
| `--json`                 | Output result as JSON                                      |

**Multi-skill repo support:** When a repo doesn't have `SKILL.md` at the root, `asm` automatically scans for skills in subdirectories (up to 3 levels deep). In interactive mode, it presents a numbered picker. Use `--path` to target a specific skill or `--all` to batch-install everything.

The install command clones the repository, validates `SKILL.md` files, scans for security warnings, previews skill metadata, and installs to the selected provider's global skill directory. Requires `git` on PATH.

</details>

<details>
<summary><strong>TUI Keyboard Shortcuts</strong></summary>

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

</details>

<details>
<summary><strong>Configuration</strong></summary>

On first run, a config file is created at `~/.config/agent-skill-manager/config.json` with 17 default providers, all enabled:

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
    },
    {
      "name": "cursor",
      "label": "Cursor",
      "global": "~/.cursor/rules",
      "project": ".cursor/rules",
      "enabled": false
    },
    {
      "name": "windsurf",
      "label": "Windsurf",
      "global": "~/.windsurf/rules",
      "project": ".windsurf/rules",
      "enabled": false
    },
    {
      "name": "cline",
      "label": "Cline",
      "global": "~/Documents/Cline/Rules",
      "project": ".clinerules",
      "enabled": false
    },
    {
      "name": "roocode",
      "label": "Roo Code",
      "global": "~/.roo/rules",
      "project": ".roo/rules",
      "enabled": false
    },
    {
      "name": "continue",
      "label": "Continue",
      "global": "~/.continue/rules",
      "project": ".continue/rules",
      "enabled": false
    },
    {
      "name": "copilot",
      "label": "GitHub Copilot",
      "global": "~/.github/instructions",
      "project": ".github/instructions",
      "enabled": false
    },
    {
      "name": "aider",
      "label": "Aider",
      "global": "~/.aider/skills",
      "project": ".aider/skills",
      "enabled": false
    },
    {
      "name": "opencode",
      "label": "OpenCode",
      "global": "~/.config/opencode/skills",
      "project": ".opencode/skills",
      "enabled": false
    },
    {
      "name": "zed",
      "label": "Zed",
      "global": "~/.config/zed/prompt_overrides",
      "project": ".zed/rules",
      "enabled": false
    },
    {
      "name": "augment",
      "label": "Augment",
      "global": "~/.augment/rules",
      "project": ".augment/rules",
      "enabled": false
    },
    {
      "name": "amp",
      "label": "Amp",
      "global": "~/.amp/skills",
      "project": ".amp/skills",
      "enabled": false
    },
    {
      "name": "gemini",
      "label": "Gemini CLI",
      "global": "~/.gemini/skills",
      "project": ".gemini/skills",
      "enabled": false
    },
    {
      "name": "antigravity",
      "label": "Google Antigravity",
      "global": "~/.antigravity/skills",
      "project": ".antigravity/skills",
      "enabled": false
    }
  ],
  "customPaths": [],
  "preferences": {
    "defaultScope": "both",
    "defaultSort": "name"
  }
}
```

- **Enable providers** — Set `"enabled": true` to start scanning a provider
- **Custom paths** — Add arbitrary directories via `customPaths`
- **Disable providers** — Set `"enabled": false` to skip scanning a provider
- **Preferences** — Set default scope and sort order

Manage config from the CLI (`asm config show|path|reset|edit`) or toggle providers in the TUI by pressing `c`.

</details>

<details>
<summary><strong>SKILL.md Format</strong></summary>

Every skill is a directory containing a `SKILL.md` file. The file starts with a YAML frontmatter block followed by markdown instructions that the AI agent loads at runtime.

### Frontmatter

```yaml
---
name: my-skill
description: "A short description of what this skill does"
license: "MIT"
compatibility: "Claude Code, Codex"
allowed-tools: Bash Read Grep Glob WebFetch
effort: medium
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
| `compatibility`    |    no    | Comma-separated list of compatible AI agents        |
| `allowed-tools`    |    no    | Space or comma-delimited tool names the skill uses  |
| `effort`           |    no    | Effort level: `low`, `medium`, `high`, or `max`     |
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

Creates `my-skill/SKILL.md` in the default provider:

```bash
asm init my-skill
```

Creates in Claude Code's skill directory:

```bash
asm init my-skill -p claude
```

</details>

<details>
<summary><strong>From Source</strong></summary>

```bash
git clone https://github.com/luongnv89/agent-skill-manager.git
cd agent-skill-manager
bun install
```

Bundle to `dist/`:

```bash
bun run build
```

Run from source (development):

```bash
bun run start
```

### Advanced Install

Download and inspect the install script before running:

```bash
curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh -o install.sh
```

```bash
less install.sh
```

```bash
bash install.sh
```

</details>

<details>
<summary><strong>Project Structure</strong></summary>

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
│   │   ├── frontmatter.ts     # SKILL.md frontmatter parser
│   │   └── editor.ts          # $EDITOR command parser
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

</details>

<details>
<summary><strong>Tech Stack</strong></summary>

- **Runtime:** [Bun](https://bun.sh) >= 1.0.0
- **Language:** TypeScript (ESNext, strict mode)
- **Build:** Bun bundler (ships pre-built via npm)
- **TUI Framework:** [OpenTUI](https://github.com/nicholasgasior/opentui)
- **Testing:** Bun test runner
- **CI:** GitHub Actions + pre-commit hooks

</details>

<details>
<summary><strong>Documentation</strong></summary>

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

</details>

---

## Roadmap

Track our progress and upcoming features on the [project kanban board](https://github.com/users/luongnv89/projects/6). See [prd.md](prd.md) for the full product requirements and [tasks.md](tasks.md) for the sprint-based development plan.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — free to use, modify, and distribute. See the [LICENSE](LICENSE) file for details.
