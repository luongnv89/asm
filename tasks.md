# Development Tasks — agent-skill-manager

**Source:** [prd.md](prd.md)
**Generated:** 2026-03-19
**Strategy:** "npm for AI skills" — become the package manager standard

---

## Development Phases

| Phase  | Focus                   | Version | Tasks |
| ------ | ----------------------- | ------- | ----: |
| POC    | Universal compatibility | v1.11   |     7 |
| MVP    | The registry            | v2.0    |     8 |
| Full   | Ecosystem lock-in       | v2.x    |     6 |
| Future | Platform                | v3.0    |     5 |

---

## Dependency Graph

```
Wave 1 (no dependencies — start immediately):
  1.1  Expand providers to 15+
  1.5  Fix $EDITOR with spaces (#16)
  1.6  Rename "Provider" to "Tool" (#12)
  1.7  Add creator column to list (#11)

Wave 2 (depends on Wave 1):
  1.2  .skill-lock.json format
  1.3  Enrich skill-index metadata (#10)

Wave 3 (depends on Wave 2):
  1.4  asm outdated
  2.1  asm update

Wave 4 (depends on Wave 3):
  2.2  Pre-install security summary (#15)
  2.3  Parse full SKILL.md spec (#14)
  2.4  Interactive checkbox picker (#9)

Wave 5 (depends on Wave 4):
  2.5  Quality scoring
  2.6  Install command in index search (#8)
  2.7  Registry shorthand install
  2.8  Curated repos JSON (#13)

Wave 6 (depends on Wave 5):
  3.1  Static registry website
  3.2  asm publish

Wave 7 (future):
  3.3-3.6, 4.1-4.5
```

**Critical path:** 1.1 → 1.2 → 1.4 → 2.1 → 2.5 → 3.1 → 3.2

---

## Sprint 1 — POC: Universal Compatibility (v1.11)

### Task 1.1: Expand default providers to 15+ agents

**Description:** Add Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot, Aider, OpenCode, Zed, Augment, Amp to default config. Config-only change in `src/config.ts`.

**Acceptance Criteria:**

- [ ] Default config includes 15+ provider entries with correct global/project paths
- [ ] `asm list` discovers skills from all configured agents
- [ ] `asm install -p cursor` installs to Cursor's skill directory
- [ ] README and docs updated with full provider table
- [ ] Tests updated for new default provider count

**Dependencies:** None
**PRD Reference:** Section 5.1
**GitHub Issues:** None (internal improvement)

---

### Task 1.2: Implement `.skill-lock.json` format

**Description:** Create lock file system to track installed skill sources and commit hashes. Write on install, remove entry on uninstall. Handles corruption gracefully.

**Acceptance Criteria:**

- [ ] Lock file schema defined: `{ version, skills: { [name]: { source, commitHash, ref, installedAt, provider } } }`
- [ ] `src/utils/lock.ts` module with `readLock()`, `writeLockEntry()`, `removeLockEntry()` functions
- [ ] `asm install` writes lock entry on successful install
- [ ] `asm uninstall` removes lock entry
- [ ] Corruption handling: warn + rebuild from installed skills scan
- [ ] Schema version field for future migration
- [ ] Unit tests for read, write, remove, corruption recovery

**Dependencies:** None
**PRD Reference:** Section 5.2
**GitHub Issues:** None

---

### Task 1.3: Enrich skill-index with full metadata fields

**Description:** Expand `IndexedSkill` type to include `license` and `creator` from SKILL.md frontmatter. Surface missing metadata in search results. Add `--has` and `--missing` filter flags.

**Acceptance Criteria:**

- [ ] `IndexedSkill` interface includes `license` and `creator` fields
- [ ] `ingestRepo()` extracts and persists these fields during indexing
- [ ] `asm index search` shows missing metadata warnings per skill
- [ ] `--has license`, `--has creator`, `--missing version` filter flags work
- [ ] `--json` output includes new fields
- [ ] Pre-indexed bundled data updated with new fields
- [ ] Tests for enriched indexing and filtering

**Dependencies:** None
**PRD Reference:** Section 6.4 (quality scoring foundation)
**GitHub Issues:** [#10](https://github.com/luongnv89/agent-skill-manager/issues/10)

---

### Task 1.4: Implement `asm outdated` command

**Description:** Report which installed skills have newer versions available by comparing `.skill-lock.json` hashes against `git ls-remote` results.

**Acceptance Criteria:**

- [ ] `asm outdated` checks all tracked skills
- [ ] `asm outdated skill-name` checks one skill
- [ ] Parallel `git ls-remote` execution (max 5 concurrent)
- [ ] Report: skill name, installed hash (short), latest hash, age
- [ ] Handle deleted repos: "source unavailable"
- [ ] Handle untracked skills: "not tracked (no lock entry)"
- [ ] `--json` output with structured data
- [ ] `--verbose` shows per-skill timing and network details
- [ ] Network error handling (timeout, rate limit)
- [ ] Unit + integration tests

**Dependencies:** Task 1.2 (`.skill-lock.json`)
**PRD Reference:** Section 5.3
**GitHub Issues:** None

---

### Task 1.5: Fix `asm config edit` with `$EDITOR` containing spaces

**Description:** `asm config edit` crashes when `$EDITOR` contains spaces (e.g., `emacsclient --tty -a ""`). The spawn call treats the entire string as the executable name instead of parsing it into command + arguments.

**Acceptance Criteria:**

- [ ] `$EDITOR` with spaces is parsed into command and arguments correctly
- [ ] `EDITOR="emacsclient --tty -a \"\""` works
- [ ] `EDITOR="code --wait"` works
- [ ] Simple `EDITOR="vim"` still works
- [ ] Test for space-containing editor commands

**Dependencies:** None
**PRD Reference:** Section 4.7 (configuration)
**GitHub Issues:** [#16](https://github.com/luongnv89/agent-skill-manager/issues/16)

---

### Task 1.6: Rename "Provider" to "Tool" in user-facing output

**Description:** Replace all user-facing "Provider" labels with "Tool" in CLI output, TUI views, help text, and config display. Internal code identifiers remain unchanged. Add `--tool` as alias for `--provider` flag.

**Acceptance Criteria:**

- [ ] CLI column headers show "Tool" instead of "Provider"
- [ ] TUI dashboard and detail views show "Tool"
- [ ] `-t, --tool` flag alias added alongside existing `-p, --provider`
- [ ] `--provider` still works (backward compatible)
- [ ] Help text updated
- [ ] Tests updated for new labels

**Dependencies:** None
**PRD Reference:** Section 4.1 (dual interface)
**GitHub Issues:** [#12](https://github.com/luongnv89/agent-skill-manager/issues/12)

---

### Task 1.7: Add creator column to skill list output

**Description:** Show `metadata.creator` in `asm list`, `asm search`, and TUI skill list views. Show `—` when creator is not set.

**Acceptance Criteria:**

- [ ] `SkillInfo` type includes `creator` field
- [ ] `scanDirectory()` extracts `metadata.creator` from frontmatter
- [ ] `asm list` shows Creator column
- [ ] `asm search` shows Creator in results
- [ ] TUI skill list displays creator
- [ ] TUI detail view displays creator
- [ ] `--json` output includes `creator` field
- [ ] Tests for creator extraction and display

**Dependencies:** None
**PRD Reference:** Section 4.2 (skill discovery)
**GitHub Issues:** [#11](https://github.com/luongnv89/agent-skill-manager/issues/11)

---

## Sprint 2 — MVP: The Registry Foundation (v2.0)

### Task 2.1: Implement `asm update` command

**Description:** Pull latest version of installed skills from source repos. Re-clone, validate, replace in-place. Update lock file. Run security scan comparison.

**Acceptance Criteria:**

- [ ] `asm update` updates all outdated skills
- [ ] `asm update skill-name` updates specific skill
- [ ] Atomic updates: old skill preserved until new one validates
- [ ] Security scan comparison: warn if verdict worsens after update
- [ ] `.skill-lock.json` updated with new commit hash
- [ ] Provider assignment preserved (skill stays in same agent directory)
- [ ] Rollback on validation failure
- [ ] `--yes` for batch mode, `--json` for scripting
- [ ] Handle deleted source repos gracefully
- [ ] Tests for update, rollback, and security comparison

**Dependencies:** Task 1.4 (`asm outdated`)
**PRD Reference:** Section 5.4
**GitHub Issues:** None

---

### Task 2.2: Pre-install security summary and new/update indicator

**Description:** Show security audit summary and new/update/reinstall status before install confirmation. Color-coded risk levels. Risk-aware confirmation default.

**Acceptance Criteria:**

- [ ] Security scan runs on each discovered skill before confirmation
- [ ] Risk table displayed: skill name, risk level (Safe/Med/High), alert count
- [ ] Color coding: green=Safe, yellow=Med Risk, red=High Risk
- [ ] New vs update indicator: `[NEW]`, `[UPDATE: old→new]`, `[REINSTALL]`
- [ ] High-risk skills flip confirmation default to No
- [ ] `--skip-audit` flag to skip security scan
- [ ] `--json` output includes `riskLevel` and `installAction` per skill
- [ ] Batch summary for `--all`: "3 Safe, 2 Med Risk, 1 High Risk"
- [ ] Tests for risk display, new/update detection, confirmation behavior

**Dependencies:** Task 1.2 (lock file for version comparison)
**PRD Reference:** Section 4.5 (quality & security)
**GitHub Issues:** [#15](https://github.com/luongnv89/agent-skill-manager/issues/15)

---

### Task 2.3: Parse and display full SKILL.md frontmatter spec

**Description:** Extract `compatibility`, `allowed-tools`, `license`, `creator` from frontmatter. Display in inspect/TUI with color-coded tool risk indicators.

**Acceptance Criteria:**

- [ ] `SkillInfo` extended with `license`, `compatibility`, `allowedTools[]`, `creator`
- [ ] `parseFrontmatter()` extracts all spec fields
- [ ] `asm inspect` shows all fields with structured layout
- [ ] `allowed-tools` displayed as color-coded tags (red=Bash/Write, yellow=WebFetch, green=Read)
- [ ] Warning line for high-risk tools present
- [ ] TUI detail view shows all fields
- [ ] `--json` includes all fields
- [ ] Security audit cross-references `allowed-tools` with detected patterns
- [ ] Tests for all new field extraction and display

**Dependencies:** Task 1.7 (creator column foundation)
**PRD Reference:** Section 4.9 (SKILL.md format)
**GitHub Issues:** [#14](https://github.com/luongnv89/agent-skill-manager/issues/14)

---

### Task 2.4: Interactive checkbox picker for multi-skill install

**Description:** Replace numbered single-select picker with interactive checkbox selector for multi-skill repos. Toggle with Space, navigate with arrows, confirm with Enter.

**Acceptance Criteria:**

- [ ] `↑`/`↓` (and `j`/`k`) navigation
- [ ] `Space` toggles selection per skill
- [ ] `Enter` confirms and installs selected skills
- [ ] Visual indicator: `✔` for selected, `▸` for cursor position
- [ ] Shows skill name, version, truncated description per row
- [ ] "Select All" / "Deselect All" toggle option
- [ ] Falls back to numbered picker in non-TTY environments
- [ ] `--all` and `--path` flags still work as before
- [ ] Tests for selection logic

**Dependencies:** None (can be done in parallel but benefits from #15 risk display)
**PRD Reference:** Section 4.3 (skill installation)
**GitHub Issues:** [#9](https://github.com/luongnv89/agent-skill-manager/issues/9)

---

### Task 2.5: Implement skill quality scoring

**Description:** Compute 0-100 quality score per skill based on metadata completeness and security scan results. Display in inspect, search, and publish output.

**Acceptance Criteria:**

- [ ] Quality scoring module (`src/quality.ts`) with 8 scoring factors
- [ ] Scoring: description(15) + version(10) + license(10) + security(25) + creator(5) + size(10) + valid YAML(10) + instructions(15)
- [ ] `asm inspect` shows quality score
- [ ] `asm search` shows quality score per result
- [ ] `asm index search` shows quality score
- [ ] `--json` output includes `qualityScore` field
- [ ] Tests for each scoring factor and edge cases

**Dependencies:** Task 2.3 (full frontmatter parsing)
**PRD Reference:** Section 6.4
**GitHub Issues:** None

---

### Task 2.6: Show install command in `asm index search` results

**Description:** Add ready-to-copy `asm install` command to each search result output.

**Acceptance Criteria:**

- [ ] Each search result shows full `asm install github:owner/repo --path subdir` command
- [ ] Command is correctly constructed for root-level and subdirectory skills
- [ ] `--json` output includes `installCommand` field
- [ ] Tests for command generation

**Dependencies:** None
**PRD Reference:** Section 4.2 (skill discovery)
**GitHub Issues:** [#8](https://github.com/luongnv89/agent-skill-manager/issues/8)

---

### Task 2.7: Registry shorthand install (`asm install skill-name`)

**Description:** Resolve bare skill names (no `github:` prefix) against the local skill index before falling back to GitHub. Enables `asm install code-review` UX.

**Acceptance Criteria:**

- [ ] Bare names resolve against bundled + user-indexed skill data
- [ ] Exact name match → resolve to GitHub source and install
- [ ] Partial match → show picker with candidates
- [ ] No match → "skill not found in registry" with search suggestion
- [ ] Existing `github:` and URL syntax unchanged
- [ ] Tests for resolution order and ambiguous names

**Dependencies:** Task 1.3 (enriched index)
**PRD Reference:** Section 6.3
**GitHub Issues:** None

---

### Task 2.8: Extract curated repos into standalone JSON

**Description:** Create `data/skill-index-resources.json` as single source of truth for curated skill repos. Update `scripts/preindex.ts` to read from it. Optionally auto-generate README table.

**Acceptance Criteria:**

- [ ] `data/skill-index-resources.json` with schema: `{ updatedAt, repos: [{ source, url, owner, repo, description, maintainer, enabled }] }`
- [ ] `scripts/preindex.ts` reads from JSON instead of hardcoded array
- [ ] Filters by `enabled: true`
- [ ] `asm index list` displays curated resources with descriptions
- [ ] Optional `scripts/update-readme-table.ts` to regenerate README table
- [ ] Tests for JSON loading and filtering

**Dependencies:** None
**PRD Reference:** Section 4.2 (skill discovery)
**GitHub Issues:** [#13](https://github.com/luongnv89/agent-skill-manager/issues/13)

---

## Sprint 3 — Full: Ecosystem Lock-in (v2.x)

### Task 3.1: Build static registry website

**Description:** Auto-generate a searchable GitHub Pages site from skill index data. Home page with search, individual skill pages with install commands and quality scores.

**Acceptance Criteria:**

- [ ] Static site generator in `site/generate.ts`
- [ ] Home page: search bar, featured skills, category navigation
- [ ] Skill page: name, description, install command, quality score, security score, author, version
- [ ] URL structure: `/skills/owner/skill-name`
- [ ] GitHub Actions workflow rebuilds on index data changes
- [ ] Mobile-responsive
- [ ] Deployed to GitHub Pages (zero hosting cost)
- [ ] 50+ skills indexed at launch

**Dependencies:** Task 2.5 (quality scoring), Task 2.8 (curated repos JSON)
**PRD Reference:** Section 6.1
**GitHub Issues:** None

---

### Task 3.2: Implement `asm publish` command

**Description:** Submit a skill to the registry index via GitHub PR. Validates SKILL.md, runs security scan, computes quality score, creates PR.

**Acceptance Criteria:**

- [ ] `asm publish` publishes current directory's skill
- [ ] `asm publish ./path` publishes specific skill
- [ ] Validates SKILL.md exists and has required fields
- [ ] Security scan must pass (safe or caution verdict)
- [ ] Quality score computed and displayed
- [ ] Creates PR to registry index repo (or GitHub issue as fallback)
- [ ] PR body includes metadata, security report, quality score
- [ ] Works without `gh` CLI (issue-based fallback)
- [ ] Tests for validation, scoring, PR creation

**Dependencies:** Task 3.1 (registry exists), Task 2.5 (quality scoring)
**PRD Reference:** Section 6.2
**GitHub Issues:** None

---

### Task 3.3: Generate "Install with asm" badges

**Description:** `asm badge` command generates shields.io badge markdown linking to registry page.

**Acceptance Criteria:**

- [ ] `asm badge` generates badge for current directory's skill
- [ ] `asm badge owner/skill-name` generates for any registered skill
- [ ] Output is copyable markdown with badge image and link
- [ ] Tests for badge generation

**Dependencies:** Task 3.1 (registry URL exists)
**PRD Reference:** Section 7.1
**GitHub Issues:** None

---

### Task 3.4: Implement skill dependency resolution

**Description:** Allow SKILL.md `dependencies` field. `asm install` resolves dependency tree and installs required skills. Circular dependency detection.

**Acceptance Criteria:**

- [ ] `dependencies` field parsed from SKILL.md frontmatter
- [ ] `asm install` resolves dependency tree
- [ ] Installs all required dependencies before the skill itself
- [ ] Circular dependency detection with clear error message
- [ ] Maximum depth limit (5 levels)
- [ ] `--json` output includes dependency tree
- [ ] Tests for tree resolution, circulars, depth limit

**Dependencies:** Task 2.7 (registry shorthand for resolving dependency names)
**PRD Reference:** Section 7.2
**GitHub Issues:** None

---

### Task 3.5: Team skill sharing (`asm team`)

**Description:** Team manifest (`.asm/skills.json`) committed to project repos. `asm team sync` installs the standard skill set for new team members.

**Acceptance Criteria:**

- [ ] `asm team init` creates `.asm/skills.json` from currently installed skills
- [ ] `asm team add skill-name` adds entry to manifest
- [ ] `asm team remove skill-name` removes entry
- [ ] `asm team sync` installs all skills from manifest
- [ ] Manifest format: `{ version, skills: { [name]: source } }`
- [ ] Tests for init, add, remove, sync

**Dependencies:** Task 2.1 (update mechanism for keeping team skills current)
**PRD Reference:** Section 7.3
**GitHub Issues:** None

---

### Task 3.6: Support commands and agents management

**Description:** Extend asm to manage not just skills but also "commands" and "agents" resources within AI coding tools. Same scanning, listing, and installation UX.

**Acceptance Criteria:**

- [ ] Config supports resource types beyond skills (commands, agents)
- [ ] Scanner discovers resources in command/agent directories
- [ ] `asm list --type commands` filters by resource type
- [ ] Install supports command/agent resources
- [ ] TUI shows resource type indicator
- [ ] Tests for multi-resource scanning

**Dependencies:** Task 1.1 (expanded providers)
**PRD Reference:** Section 4 (extensibility)
**GitHub Issues:** [#17](https://github.com/luongnv89/agent-skill-manager/issues/17)

---

## Sprint 4 — Future: Platform (v3.0)

### Task 4.1: AI agent integration API (`--machine` output)

**Description:** Machine-readable output mode for AI agents to query asm as a subprocess.

**Dependencies:** Task 2.7 (registry shorthand)
**PRD Reference:** Section 7.4
**GitHub Issues:** None

---

### Task 4.2: Hosted registry API

**Description:** Migrate from static site to hosted API when demand warrants (>500 weekly installs).

**Dependencies:** Task 3.1 (static registry)
**PRD Reference:** Section 8.1
**GitHub Issues:** None

---

### Task 4.3: Skill ratings and reviews

**Description:** Community ratings (1-5 stars) and text reviews per skill.

**Dependencies:** Task 4.2 (hosted API)
**PRD Reference:** Section 8.2
**GitHub Issues:** None

---

### Task 4.4: Download stats and trending

**Description:** Track install counts, show trending skills. `asm trending` command.

**Dependencies:** Task 4.2 (hosted API)
**PRD Reference:** Section 8.3
**GitHub Issues:** None

---

### Task 4.5: Support Vercel skills CLI install format

**Description:** Accept `npx skills add` format or delegate to Vercel CLI while tracking in asm's inventory.

**Acceptance Criteria:**

- [ ] `asm install --method vercel` wraps `npx skills add`
- [ ] Installed skill registered in asm's lock file
- [ ] Fallback to standard install if Vercel CLI not available
- [ ] Tests for Vercel CLI detection and delegation

**Dependencies:** Task 1.2 (lock file)
**PRD Reference:** Section 4.3 (installation)
**GitHub Issues:** [#7](https://github.com/luongnv89/agent-skill-manager/issues/7)

---

## Issue-to-Task Mapping

|                                                             Issue | Title                                               | Task | Sprint   |
| ----------------------------------------------------------------: | --------------------------------------------------- | ---- | -------- |
|   [#7](https://github.com/luongnv89/agent-skill-manager/issues/7) | Support Vercel skills CLI install format            | 4.5  | Sprint 4 |
|   [#8](https://github.com/luongnv89/agent-skill-manager/issues/8) | Show install command in index search results        | 2.6  | Sprint 2 |
|   [#9](https://github.com/luongnv89/agent-skill-manager/issues/9) | Interactive checkbox picker for multi-skill install | 2.4  | Sprint 2 |
| [#10](https://github.com/luongnv89/agent-skill-manager/issues/10) | Enrich skill-index with full metadata fields        | 1.3  | Sprint 1 |
| [#11](https://github.com/luongnv89/agent-skill-manager/issues/11) | Add creator column to list output                   | 1.7  | Sprint 1 |
| [#12](https://github.com/luongnv89/agent-skill-manager/issues/12) | Rename "Provider" to "Tool"                         | 1.6  | Sprint 1 |
| [#13](https://github.com/luongnv89/agent-skill-manager/issues/13) | Extract curated repos into JSON                     | 2.8  | Sprint 2 |
| [#14](https://github.com/luongnv89/agent-skill-manager/issues/14) | Parse full SKILL.md frontmatter spec                | 2.3  | Sprint 2 |
| [#15](https://github.com/luongnv89/agent-skill-manager/issues/15) | Pre-install security summary                        | 2.2  | Sprint 2 |
| [#16](https://github.com/luongnv89/agent-skill-manager/issues/16) | Fix $EDITOR with spaces                             | 1.5  | Sprint 1 |
| [#17](https://github.com/luongnv89/agent-skill-manager/issues/17) | Incorporate commands and agents                     | 3.6  | Sprint 3 |

---

## Summary

- **Total tasks:** 26 (7 Sprint 1 + 8 Sprint 2 + 6 Sprint 3 + 5 Sprint 4)
- **Open issues mapped:** 11/11 (100%)
- **Critical path:** 7 tasks (1.1 → 1.2 → 1.4 → 2.1 → 2.5 → 3.1 → 3.2)
- **Wave 1 parallelism:** 4 tasks can start immediately (1.1, 1.5, 1.6, 1.7)
- **MVP scope:** Sprint 1 + Sprint 2 = 15 tasks
- **Ambiguous requirements:** None — all issues have detailed specs from contributors
