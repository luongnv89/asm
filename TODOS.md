# TODOS

Strategic roadmap for **agent-skill-manager** — the npm for AI skills.

Mode: SCOPE EXPANSION (CEO Review, 2026-03-19).
North star: become the package manager standard that every skill README links to.

---

## Phase 1 — Universal Compatibility (v1.11)

Goal: asm works with every major AI agent. Users can install, track, and update skills.

### 1. Expand default providers to 15+ [S] — P1

Add Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot, Aider, OpenCode, Zed, and others to the default config in `src/config.ts`. Reference skillshare's `targets.yaml` for correct directory paths. Config-only change.
- **Why:** 4 agents vs. competitors' 55 is our biggest gap. Universal compatibility is table stakes.
- **Effort:** CC: ~1 hour / human: ~2 hours

### 2. `asm outdated` — detect stale skills [M] — P1

Store install commit hash and source URL in `.skill-lock.json` next to each installed SKILL.md. `asm outdated` runs `git ls-remote` (parallel, concurrency limit 5) against each source to compare hashes. Report: skill name, installed hash, latest hash, age.
- **Where:** New `src/updater.ts` + `src/utils/lock.ts` + `cli.ts` integration
- **Why:** npm has `npm outdated`. This is the equivalent. Users need to know when skills are stale.
- **Effort:** CC: ~2 hours / human: ~1 day

### 3. `asm update [name]` — pull latest version [M] — P1

Update one or all skills from their source repos. Re-clone, validate, replace. Preserve `.skill-lock.json`. Respect `--yes` for batch mode. Handle deleted source repos gracefully ("source unavailable").
- **Where:** `src/updater.ts` + `cli.ts`
- **Why:** `npm update` is the companion to `npm outdated`. Install without update is incomplete.
- **Effort:** CC: ~2 hours / human: ~1.5 days

### 4. `.skill-lock.json` format [S] — P1

Define the lock file schema: `{ version: 1, skills: { [name]: { source, commitHash, installedAt, provider } } }`. Write parser with validation in `src/utils/lock.ts`. Tests for schema, corruption, migration.
- **Why:** Version pinning is how package managers ensure reproducibility. This is the `package-lock.json` equivalent.
- **Effort:** CC: ~1 hour / human: ~0.5 day

---

## Phase 2 — The Registry (v2.0)

Goal: a searchable skill directory that makes `asm` the discovery tool for AI skills.

### 5. Static registry website on GitHub Pages [L] — P1

Auto-generate a searchable static site from `asm index` data. Stack: Bun to generate HTML + JS, GitHub Actions to rebuild on push. Each skill gets a page with: name, description, install command, security score, provider compatibility. Search by keyword. URL structure: `asm.dev/skills/owner/skill-name` (future-proof for hosted migration).
- **Where:** New `site/` directory, GitHub Actions workflow
- **Why:** npm without npmjs.com is just a local tool. The registry is the moat. Static = zero cost, zero ops.
- **Effort:** CC: ~4 hours / human: ~1 week

### 6. `asm publish` — push skill to registry [M] — P2

Submit a skill to the registry index. Validates SKILL.md, runs security scan, creates a PR to the registry repo (or opens a GitHub issue). No hosted API needed — the "publish" action is a PR.
- **Where:** New `src/publisher.ts` + `cli.ts`
- **Why:** npm publish is what makes npm a two-sided marketplace. Skill authors need a way in.
- **Effort:** CC: ~2 hours / human: ~1 day

### 7. `asm install skill-name` — registry shorthand [S] — P2

Resolve bare skill names (no `github:` prefix) against the registry index before falling back to GitHub. Like `npm install lodash` vs `npm install github:lodash/lodash`.
- **Where:** `src/installer.ts` — add registry lookup before GitHub source parsing
- **Why:** This is the UX that makes asm feel like a real package manager. One name, one command.
- **Effort:** CC: ~1 hour / human: ~0.5 day

### 8. Skill quality scoring [M] — P2

Compute a quality score per skill: has tests? has description? passes security scan? has license? has version? Display in `asm inspect`, registry site, and `asm search` results. Score: 0-100.
- **Where:** New `src/quality.ts` + integration in formatter, site generator
- **Why:** npm has quality scores. This signals trust and encourages best practices.
- **Effort:** CC: ~2 hours / human: ~1 day

---

## Phase 3 — Ecosystem Lock-in (v2.x)

Goal: asm becomes the standard that skill authors target and agents integrate with.

### 9. "Install with asm" badges [S] — P2

Generate shields.io badge markdown for skill READMEs: `[![Install with asm](https://img.shields.io/badge/install%20with-asm-brightgreen)](https://asm.dev/skills/owner/name)`. Add `asm badge` command.
- **Why:** Every skill README showing this badge is free advertising. Network effect.

### 10. Skill dependency resolution [L] — P3

Allow SKILL.md frontmatter to declare dependencies on other skills. `asm install` resolves the dependency tree and installs all required skills. Circular dependency detection.
- **Why:** npm's dependency resolution is what makes the ecosystem self-reinforcing. Skills that build on other skills create lock-in.

### 11. Organization/team skill sharing [M] — P3

`asm team init` creates a shared skill config. `asm team sync` pulls the team's skill set. Stored as a JSON manifest in the project repo (like `.nvmrc` for skills).
- **Why:** Enterprise adoption requires team-level management. This is the B2B path.

### 12. AI agent integration [L] — P3

Work with Claude Code, Codex, etc. to make `asm` the default skill manager. Provide an API that agents can query: "what skills are available?" "install skill X." Start with a `--machine` output mode.
- **Why:** Being the default skill manager inside the agents themselves is the ultimate lock-in.

---

## Phase 4 — Platform (v3.0)

### 13. Hosted registry API (if demand warrants)
### 14. Skill ratings and reviews
### 15. Download stats and trending
### 16. Verified publishers
### 17. Monetization for skill authors (premium skills)

---

## NOT in scope (explicitly deferred)

- **Cross-machine sync (push/pull):** npm doesn't have this. Install from registry instead. Revisit only if user research shows demand.
- **Web dashboard:** CLI-first strategy. The registry website IS the web UI for discovery. In-terminal management stays in the TUI.
- **Backup/restore (trash can):** Users can reinstall. Not on the critical path to standard-setting.
- **.skillignore:** Nice-to-have, not blocking adoption. Revisit in Phase 2.
- **Homebrew formula:** Defer until >500 stars. npm distribution is sufficient.
- **Docker image:** Same — defer until demand.

---

## Completed (archived from v1.0–v1.10)

All P1/P2 items from the original plan are done:
- `asm install github:user/repo` (v1.5.0)
- `--verbose` / `-V` flag (v1.5.0)
- Pin `@opentui/core` to exact version (v1.5.0)
- Node.js runtime compatibility (v1.5.0)
- Config backup + warn on corruption (v1.5.0)
- Fix semver sorting (v1.5.0)
- Fix `readLine()` stdin hang (v1.5.0)
- Lazy-load file counts (v1.5.0)
- `asm export` (v1.6.0)
- `asm init` (v1.6.0)
- `asm stats` (v1.6.0)
- Skill health warnings (v1.7.0)
- `asm link <path>` (v1.6.0)
- `asm audit security` (v1.8.0)
- SSH transport for private repos (v1.8.0)
- GitHub subfolder URL support (v1.9.0)
- `asm index` with pre-indexed data (v1.10.0)
- Nested SKILL.md metadata parsing (v1.10.0)
