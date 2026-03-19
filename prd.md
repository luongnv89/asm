# Product Requirements Document — agent-skill-manager

**Product:** agent-skill-manager (`asm`)
**Version:** 1.10.0 (current) → 3.0 (vision)
**Author:** luongnv89
**Date:** 2026-03-19
**Status:** Active development
**License:** MIT

---

## 1. Product Vision

**agent-skill-manager** is the **npm for AI agent skills** — a universal package manager that lets developers install, discover, audit, update, and share reusable skills across every AI coding agent from a single tool.

### One-line pitch

> One command to manage every AI agent's skills.

### North star metric

Become the install command that every skill README links to: `asm install skill-name`.

### Target audience

- **Primary:** Developers who use 2+ AI coding agents (Claude Code, Codex, Cursor, Windsurf, etc.) and accumulate skills across them.
- **Secondary:** Skill authors who want distribution and discoverability for their skills.
- **Tertiary:** Teams and organizations that need standardized skill sets across developers.

---

## 2. Problem Statement

AI coding agents (Claude Code, Codex, Cursor, Windsurf, OpenClaw, Cline, Roo Code, etc.) each store skills in their own hidden directories with their own conventions. Developers face:

1. **Scattered skills** — each agent has its own skill directory (`~/.claude/skills/`, `~/.codex/skills/`, `.cursor/skills/`, etc.). The same skill ends up installed multiple times in different places.
2. **No visibility** — no quick way to see what's installed, what's duplicated, or what's outdated across all agents.
3. **Manual installation** — cloning repos, copying folders, hoping SKILL.md is valid, with no security scanning.
4. **No discovery** — no central place to find and compare skills. Discovery happens through word-of-mouth and GitHub searches.
5. **No update mechanism** — once installed, skills go stale with no notification of available updates.

The problem worsens with every new AI agent adopted.

---

## 3. Strategic Position

We are building the **npm analog for AI agent skills** — a lightweight, npm-native package manager that becomes the standard through distribution and ecosystem, not through feature breadth.

**Key advantages we double down on:**

- Zero-friction npm install (`npm i -g agent-skill-manager`)
- Minimal dependencies (2 production deps)
- Strict TypeScript, 42% test:code ratio
- Built-in security scanning (26 pattern rules)
- Pre-indexed offline skill search
- Lower contribution barrier (TypeScript ecosystem)

---

## 4. Existing Features (v1.10.0 — Shipped)

### 4.1 Dual Interface

| Interface           | Description                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interactive TUI** | Full terminal UI built on OpenTUI. Dashboard with scope tabs, live search, skill detail overlays, duplicate audit, config editor, help overlay. Keyboard-driven (j/k navigation, `/` search, `Tab` scope cycle). |
| **CLI**             | Non-interactive commands for scripting and automation. All commands support `--json` output, `--scope`, `--sort`, `--no-color`, `--verbose`, `--yes`.                                                            |

### 4.2 Skill Discovery & Browsing

| Feature         | Command                    | Description                                                                                                                  |
| --------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| List all skills | `asm list`                 | Scan all configured agent directories, display skills grouped by provider. Supports `--scope`, `--sort`, `--flat`, `--json`. |
| Search          | `asm search <query>`       | Full-text search across name, description, and provider with match highlighting.                                             |
| Inspect         | `asm inspect <name>`       | Detailed skill metadata: name, version, description, path, symlink info, file count, health warnings.                        |
| Stats           | `asm stats`                | Aggregate metrics: total skills, per-provider breakdown, scope distribution, disk usage, duplicate count.                    |
| Skill index     | `asm index ingest <repo>`  | Index a GitHub skill repo for local searching. Ships with pre-indexed data from popular collections.                         |
| Index search    | `asm index search <query>` | Search indexed skills offline. Supports `--json`.                                                                            |

### 4.3 Skill Installation

| Feature              | Command                                                         | Description                                                             |
| -------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Install from GitHub  | `asm install github:user/repo`                                  | Clone, validate SKILL.md, security scan, install to provider directory. |
| Branch/tag targeting | `asm install github:user/repo#v1.0.0`                           | Pin to specific ref.                                                    |
| Subfolder install    | `asm install github:user/repo --path skills/foo`                | Install from subdirectory.                                              |
| Subfolder URL        | `asm install https://github.com/user/repo/tree/main/skills/foo` | Auto-detect branch and path.                                            |
| Batch install        | `asm install github:user/repo --all`                            | Install all skills found in repo.                                       |
| Interactive picker   | `asm install github:user/repo` (multi-skill)                    | Numbered picker when repo has multiple skills.                          |
| Private repos        | `--transport ssh` or `--transport auto`                         | SSH transport with HTTPS fallback.                                      |
| Provider targeting   | `-p claude`                                                     | Install to specific agent's directory.                                  |
| Force overwrite      | `--force`                                                       | Overwrite existing skill.                                               |

### 4.4 Skill Removal

| Feature           | Command                | Description                                                                    |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------ |
| Uninstall         | `asm uninstall <name>` | Confirmation dialog, removes skill directory + rule files + AGENTS.md blocks.  |
| Skip confirmation | `--yes`                | Non-interactive removal.                                                       |
| Rule file cleanup | Automatic              | Removes `.cursor/rules/`, `.windsurf/rules/`, `.github/instructions/` entries. |

### 4.5 Quality & Security

| Feature         | Command                               | Description                                                                                                                                                                            |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate audit | `asm audit`                           | Detect duplicate skills across providers by directory name and frontmatter name. Optional auto-removal.                                                                                |
| Security audit  | `asm audit security <name>`           | 26-pattern code scan: network requests, shell execution, dynamic code, credentials, obfuscation. Severity levels (critical/warning/info) and verdict (safe/caution/warning/dangerous). |
| Remote audit    | `asm audit security github:user/repo` | Scan before installing.                                                                                                                                                                |
| Audit all       | `asm audit security --all`            | Audit every installed skill.                                                                                                                                                           |
| Health warnings | Automatic                             | Flag missing descriptions, invalid YAML frontmatter, missing versions during scan.                                                                                                     |
| YAML validation | Automatic                             | Strict YAML frontmatter parsing via `yaml` library.                                                                                                                                    |

### 4.6 Skill Authoring

| Feature     | Command           | Description                                                                                  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Scaffold    | `asm init <name>` | Generate SKILL.md with correct frontmatter structure.                                        |
| Dev symlink | `asm link <path>` | Symlink local skill directory into agent's skill folder. Edit-in-place development workflow. |
| Export      | `asm export`      | Dump skill inventory as JSON manifest.                                                       |

### 4.7 Configuration

| Feature          | Command            | Description                                    |
| ---------------- | ------------------ | ---------------------------------------------- |
| Show config      | `asm config show`  | Print current configuration.                   |
| Config path      | `asm config path`  | Print config file location.                    |
| Reset            | `asm config reset` | Reset to defaults.                             |
| Edit             | `asm config edit`  | Open in `$EDITOR`.                             |
| TUI config       | `c` key in TUI     | Toggle providers on/off visually.              |
| Custom providers | Config file        | Add any agent tool by adding a provider entry. |
| Custom paths     | Config file        | Add arbitrary directories via `customPaths`.   |

### 4.8 Supported Agents (Current)

| Agent            | Global Path           | Project Path        |
| ---------------- | --------------------- | ------------------- |
| Claude Code      | `~/.claude/skills/`   | `.claude/skills/`   |
| Codex            | `~/.codex/skills/`    | `.codex/skills/`    |
| OpenClaw         | `~/.openclaw/skills/` | `.openclaw/skills/` |
| Agents (generic) | `~/.agents/skills/`   | `.agents/skills/`   |

### 4.9 SKILL.md Format

Universal skill definition format:

```yaml
---
name: my-skill
description: "A short description"
license: "MIT"
metadata:
  version: 1.0.0
  creator: "Author <email>"
---
```

- YAML frontmatter with nested metadata block support
- Version resolution: `metadata.version` > `version` > `0.0.0`
- Markdown body loaded by the AI agent as instructions

### 4.10 Technical Foundation

| Aspect       | Detail                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| Runtime      | Bun >= 1.0 (also runs on Node.js >= 18)                                   |
| Language     | TypeScript (ESNext, strict mode)                                          |
| Build        | Bun bundler, pre-built for npm distribution                               |
| Dependencies | 2 production: `@opentui/core` 0.1.87, `yaml` ^2.8.2                       |
| Testing      | Bun test runner, 722 test cases across 15 files                           |
| CI           | GitHub Actions (format, typecheck, test)                                  |
| Pre-commit   | Prettier + trailing whitespace + YAML/JSON checks + typecheck             |
| Distribution | npm (`agent-skill-manager`), binary aliases: `asm`, `agent-skill-manager` |

---

## 5. Planned Features — Phase 1: Universal Compatibility (v1.11)

**Goal:** asm works with every major AI agent. Users can track and update skills.

### 5.1 Expanded Provider Support (15+ agents)

Add all major AI coding agents to the default configuration:

| Agent          | Global Path                 | Project Path              | Status  |
| -------------- | --------------------------- | ------------------------- | ------- |
| Cursor         | `~/.cursor/skills/`         | `.cursor/skills/`         | Planned |
| Windsurf       | `~/.windsurf/skills/`       | `.windsurf/skills/`       | Planned |
| Cline          | `~/.cline/skills/`          | `.cline/skills/`          | Planned |
| Roo Code       | `~/.roo-code/skills/`       | `.roo-code/skills/`       | Planned |
| Continue       | `~/.continue/skills/`       | `.continue/skills/`       | Planned |
| GitHub Copilot | `~/.github-copilot/skills/` | `.github-copilot/skills/` | Planned |
| Aider          | `~/.aider/skills/`          | `.aider/skills/`          | Planned |
| OpenCode       | `~/.opencode/skills/`       | `.opencode/skills/`       | Planned |
| Zed            | `~/.zed/skills/`            | `.zed/skills/`            | Planned |
| Augment        | `~/.augment/skills/`        | `.augment/skills/`        | Planned |
| Amp            | `~/.amp/skills/`            | `.amp/skills/`            | Planned |

**Acceptance criteria:**

- Default config includes 15+ providers
- `asm list` discovers skills from all configured agents
- `asm install -p cursor` installs to Cursor's directory
- Documentation updated with full provider table
- Config-only change — no new modules

### 5.2 Version Lock File (`.skill-lock.json`)

Track installed skill versions for reproducibility and update detection.

**Schema:**

```json
{
  "version": 1,
  "skills": {
    "skill-name": {
      "source": "github:user/repo",
      "commitHash": "abc123",
      "ref": "main",
      "installedAt": "2026-03-19T10:00:00Z",
      "provider": "claude"
    }
  }
}
```

**Acceptance criteria:**

- `asm install` writes lock entry on successful install
- `asm uninstall` removes lock entry
- Lock file stored at `~/.config/agent-skill-manager/skill-lock.json`
- Parser handles corruption gracefully (warn + rebuild)
- Schema version field for future migration

### 5.3 Outdated Detection (`asm outdated`)

Report which installed skills have newer versions available.

```bash
asm outdated              # Check all skills
asm outdated skill-name   # Check one skill
asm outdated --json       # Machine-readable output
```

**Behavior:**

- Read `.skill-lock.json` for source URLs and commit hashes
- Run `git ls-remote` against each source (parallel, max 5 concurrent)
- Compare installed hash vs. latest remote hash
- Report: skill name, installed hash (short), latest hash, age since install
- Handle deleted source repos: report "source unavailable"
- Handle skills without lock entries: report "not tracked"

**Acceptance criteria:**

- Parallel execution with configurable concurrency
- Graceful handling of network errors, deleted repos, rate limiting
- `--json` output with structured data
- Works with `--verbose` for debugging

### 5.4 Skill Update (`asm update`)

Pull latest version of installed skills from their source repositories.

```bash
asm update                # Update all outdated skills
asm update skill-name     # Update specific skill
asm update --yes          # Skip confirmation
asm update --json         # Machine-readable output
```

**Behavior:**

- Run `asm outdated` logic first to determine what needs updating
- For each outdated skill: re-clone from source, validate SKILL.md, replace in-place
- Update `.skill-lock.json` with new commit hash
- Preserve provider assignment (don't change which agent the skill is installed for)
- Run security scan on updated skill (warn if verdict worsens)

**Acceptance criteria:**

- Atomic updates (old skill preserved until new one validates)
- Security scan comparison (before vs. after update)
- Batch mode with `--yes`
- Rollback on validation failure

---

## 6. Planned Features — Phase 2: The Registry (v2.0)

**Goal:** A searchable skill directory that makes asm the discovery hub for AI skills.

### 6.1 Static Registry Website

A GitHub Pages-hosted, auto-generated skill directory.

**Stack:** Bun static site generator + GitHub Actions rebuild on push.

**Pages:**

- **Home:** Search bar, featured skills, category navigation
- **Skill page:** Name, description, install command, security score, provider compatibility, author, version, source link
- **Author page:** List of published skills
- **Category browsing:** By agent, by use case (code review, testing, docs, etc.)

**URL structure:** `asm.dev/skills/owner/skill-name` (future-proof for hosted migration)

**Data source:** `asm index` data + pre-indexed skill repos

**Acceptance criteria:**

- Searchable by keyword
- Each skill has a copyable `asm install` command
- Security score displayed per skill
- GitHub Actions rebuilds on index data changes
- Mobile-responsive
- Zero hosting cost (GitHub Pages)

### 6.2 Skill Publishing (`asm publish`)

Submit a skill to the registry index via GitHub PR.

```bash
asm publish                   # Publish current directory's skill
asm publish ./path/to/skill   # Publish specific skill
```

**Behavior:**

- Validate SKILL.md exists and has required fields
- Run security scan (must pass with "safe" or "caution" verdict)
- Compute quality score
- Create a PR to the registry index repo (or open a GitHub issue as fallback)
- Include skill metadata, security report, and quality score in PR body

**Acceptance criteria:**

- Validation prevents publishing broken or dangerous skills
- Quality score computed and displayed
- Works without GitHub CLI (issue-based fallback)

### 6.3 Registry Shorthand Install

Resolve bare skill names against the registry.

```bash
asm install code-review       # Registry lookup → github:user/code-review
asm install github:user/repo  # Direct GitHub install (existing behavior)
```

**Resolution order:**

1. Check if input matches `github:` or URL pattern → direct install
2. Query local index for exact name match → resolve to GitHub source
3. Query local index for partial match → show candidates
4. Fall back to "skill not found in registry"

**Acceptance criteria:**

- Existing `github:` syntax continues to work unchanged
- Bare names resolve against bundled + user-indexed data
- Ambiguous names show a picker

### 6.4 Skill Quality Scoring

Compute a 0-100 quality score per skill.

**Scoring criteria:**

| Factor               | Weight | Measurement                                 |
| -------------------- | -----: | ------------------------------------------- |
| Has description      |     15 | Non-empty `description` in frontmatter      |
| Has version          |     10 | `metadata.version` present and valid semver |
| Has license          |     10 | `license` field present                     |
| Passes security scan |     25 | Verdict is "safe" or "caution"              |
| Has creator          |      5 | `metadata.creator` present                  |
| Reasonable size      |     10 | < 50 files, < 100KB total                   |
| Valid YAML           |     10 | No frontmatter parse warnings               |
| Has instructions     |     15 | Markdown body > 100 characters              |

**Display:** In `asm inspect`, `asm search`, registry website, and `asm publish` output.

---

## 7. Future Features — Phase 3: Ecosystem Lock-in (v2.x)

### 7.1 Install Badges

Generate "Install with asm" badges for skill READMEs.

```bash
asm badge                     # Generate badge markdown for current skill
asm badge owner/skill-name    # Generate for any registered skill
```

Output: `[![Install with asm](https://img.shields.io/badge/install%20with-asm-brightgreen)](https://asm.dev/skills/owner/name)`

### 7.2 Skill Dependencies

Allow SKILL.md frontmatter to declare dependencies:

```yaml
---
name: advanced-review
dependencies:
  - code-review
  - test-coverage
---
```

`asm install` resolves the dependency tree and installs all required skills. Circular dependency detection and maximum depth limit.

### 7.3 Team Skill Sharing

```bash
asm team init                 # Create .asm/skills.json in project
asm team sync                 # Install all skills from team manifest
asm team add skill-name       # Add skill to team manifest
asm team remove skill-name    # Remove from manifest
```

Team manifest (`.asm/skills.json`):

```json
{
  "version": 1,
  "skills": {
    "code-review": "github:user/code-review#v1.0.0",
    "test-coverage": "github:user/test-coverage"
  }
}
```

Committed to the project repo. New team members run `asm team sync` to get the standard skill set.

### 7.4 AI Agent Integration API

Machine-readable output mode for AI agents to query asm programmatically:

```bash
asm list --machine            # Structured output for agent consumption
asm search "testing" --machine
asm install skill-name --machine --yes
```

Goal: AI agents can call asm as a subprocess to manage their own skills. Long-term: become the default skill manager shipped inside agent CLIs.

---

## 8. Future Features — Phase 4: Platform (v3.0)

### 8.1 Hosted Registry API

Migrate from static GitHub Pages to a hosted API when demand warrants (trigger: >500 weekly installs or >100 indexed skills).

- REST API: `GET /api/skills`, `GET /api/skills/:owner/:name`, `POST /api/publish`
- User accounts via GitHub OAuth
- Download tracking and install counts
- Webhook notifications for skill updates

### 8.2 Ratings & Reviews

Community ratings (1-5 stars) and text reviews per skill. Displayed on registry and in `asm inspect`.

### 8.3 Download Stats & Trending

Track install counts. Show trending skills on the registry homepage. `asm trending` command.

### 8.4 Verified Publishers

Verified badge for trusted skill authors (e.g., `@anthropics`, `@obra`). Manual verification process initially.

### 8.5 Premium Skills (Monetization)

Optional paid skills with license key validation. Revenue split with skill authors. Enables sustainable ecosystem.

---

## 9. Explicitly Deferred

| Feature                             | Rationale                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cross-machine sync (push/pull)      | npm doesn't have this. Install from registry instead. Revisit if user research shows demand.        |
| Web dashboard (local)               | CLI-first strategy. The registry website is the web UI for discovery. TUI handles local management. |
| Backup/restore (trash can)          | Users can reinstall. Not on the critical path to becoming a standard.                               |
| .skillignore                        | Nice-to-have, not blocking adoption. Revisit in Phase 2.                                            |
| Homebrew formula                    | Defer until >500 stars. npm distribution is sufficient.                                             |
| Docker image                        | Defer until demand.                                                                                 |
| Cross-agent skill format conversion | Different agents' skill formats are converging toward SKILL.md. Let the market settle first.        |

---

## 10. Technical Architecture

### Current Architecture

```
  ┌────────────────────────────────────────────────────────────┐
  │                    bin/agent-skill-manager.ts               │
  │                    (entry point: CLI or TUI?)               │
  └─────────────────┬─────────────────────┬────────────────────┘
                    │                     │
        ┌───────────▼──────────┐  ┌───────▼──────────┐
        │  cli.ts (dispatcher) │  │  index.ts (TUI)  │
        │  13 commands         │  │  OpenTUI views   │
        └───────────┬──────────┘  └───────┬──────────┘
                    │                     │
        ┌───────────▼─────────────────────▼────────────────────┐
        │                   Core Modules                        │
        │  config.ts    scanner.ts    installer.ts              │
        │  auditor.ts   security-auditor.ts   uninstaller.ts    │
        │  formatter.ts   stats.ts   health.ts   linker.ts     │
        │  initializer.ts   exporter.ts   skill-index.ts       │
        │  ingester.ts   logger.ts                              │
        └───────────┬──────────────────────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────────────────┐
        │                   Utils                               │
        │  types.ts   colors.ts   version.ts   frontmatter.ts  │
        │  fs.ts                                                │
        └──────────────────────────────────────────────────────┘
```

### Phase 1 Additions

```
  New modules:
  ├── src/updater.ts          # asm outdated + asm update logic
  └── src/utils/lock.ts       # .skill-lock.json read/write/validate
```

### Phase 2 Additions

```
  New modules:
  ├── src/publisher.ts        # asm publish logic
  ├── src/quality.ts          # Skill quality scoring
  └── site/                   # Static registry site generator
      ├── generate.ts         # Build HTML from index data
      ├── templates/          # Page templates
      └── dist/               # Generated output (gitignored)
```

---

## 11. Non-functional Requirements

| Requirement                | Target                                  |
| -------------------------- | --------------------------------------- |
| Install time               | `npm i -g` completes in < 10 seconds    |
| CLI startup                | < 200ms to first output                 |
| TUI startup                | < 500ms to interactive                  |
| `asm list` (50 skills)     | < 1 second                              |
| `asm outdated` (50 skills) | < 10 seconds (parallel git ls-remote)   |
| `asm install`              | < 30 seconds for typical skill repo     |
| Bundle size (dist/)        | < 30 MB                                 |
| Production dependencies    | Stay at 2 (or reduce)                   |
| Test coverage              | > 700 test cases, 40%+ test:code ratio  |
| CI pipeline                | < 2 minutes (format + typecheck + test) |
| Node.js compatibility      | >= 18 (Bun optional runtime)            |

---

## 12. Success Metrics

### Phase 1 (v1.11)

- [ ] 15+ agents supported in default config
- [ ] `asm outdated` and `asm update` shipped with tests
- [ ] `.skill-lock.json` written on every install

### Phase 2 (v2.0)

- [ ] Static registry live at asm.dev (or GitHub Pages)
- [ ] 50+ skills indexed in registry
- [ ] `asm publish` workflow functional
- [ ] `asm install skill-name` (bare name) resolves from registry

### Phase 3 (v2.x)

- [ ] 500+ GitHub stars
- [ ] 10+ "Install with asm" badges in the wild
- [ ] Team manifest support shipped
- [ ] 1,000+ weekly npm installs

### Phase 4 (v3.0)

- [ ] Hosted registry API (if demand warrants)
- [ ] Community ratings on 20%+ of indexed skills
- [ ] At least one AI agent integrates asm as default skill manager

---

## 13. Risks & Mitigations

| Risk                                                   | Likelihood | Impact | Mitigation                                                                                              |
| ------------------------------------------------------ | :--------: | :----: | ------------------------------------------------------------------------------------------------------- |
| Another tool becomes the de facto standard first       |    High    |  High  | Move fast on Phase 1-2. Our npm distribution advantage is time-limited.                                 |
| AI agents converge on built-in skill management        |   Medium   |  High  | Provide integration API (Phase 3.4) so agents use asm rather than building their own.                   |
| Skill format fragmentation (SKILL.md vs. alternatives) |   Medium   | Medium | Support multiple formats via adapters. SKILL.md is the default, not the only format.                    |
| Registry spam/quality problems                         |    Low     | Medium | Quality scoring + security scanning gate publishing. Manual review for initial wave.                    |
| Single-maintainer bus factor                           |   Medium   | Medium | TypeScript (widely known) lowers contribution barrier. Focus on documentation and modular architecture. |

---

## 14. Open Questions

1. **Domain name:** Is `asm.dev` available, or should we use `agent-skill-manager.dev` or a GitHub Pages subdomain?
2. **Registry data format:** Should the registry index be a single JSON file or a directory of per-skill JSON files?
3. **Agent path discovery:** Should asm auto-detect installed agents (by scanning for their config directories) rather than relying on a static provider list?
4. **Skill format evolution:** Should we propose a SKILL.md v2 spec that includes dependency declarations, or keep it minimal and put dependencies in a separate file?

---

_This PRD is a living document. Updated as features ship and strategy evolves._
