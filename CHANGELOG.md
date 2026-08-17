# Changelog

## Unreleased

### Features

- Add the `skill-install-improved` bundled skill — installs an improved variant of one skill instead of the published one: resolves the target by local path, repo, or skill name, runs `skill-auto-improver` on a throwaway `mktemp -d` copy so the user's own files are never modified, installs the improved directory, and reports the before/after scores and the provenance it was improved from ([#418](https://github.com/luongnv89/asm/issues/418)) — @luongnv89

## v2.15.0 — 2026-07-22

### Features

- Add landing page scroll reveals and hero terminal motion ([#363](https://github.com/luongnv89/asm/pull/363)) — @luongnv89
- Detect conflicts, show diffs, and make overwrites safe on `asm import` ([#355](https://github.com/luongnv89/asm/issues/355)) — @yunusemre
- Index emilkowalski/skills in the ASM catalog ([#356](https://github.com/luongnv89/asm/issues/356), [#357](https://github.com/luongnv89/asm/issues/357)) — @luongnv89

### Bug Fixes

- Reject `--force` on import when there are diffs and test conflicts ([#359](https://github.com/luongnv89/asm/issues/359), [#362](https://github.com/luongnv89/asm/issues/362)) — @luongnv89
- Guard file collection against symlink cycles on import ([#358](https://github.com/luongnv89/asm/issues/358), [#361](https://github.com/luongnv89/asm/issues/361)) — @luongnv89
- Use a directory junction on Windows so `link`/`activate` work without admin ([#347](https://github.com/luongnv89/asm/issues/347)) — @yunusemre

### New Contributors

- @yunusemre made their first contribution in [#347](https://github.com/luongnv89/asm/issues/347)

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.14.0...v2.15.0

## v2.14.0 — 2026-07-07

### Features

- Add cross-tool skill linking on install — when `asm install <skill>` finds the skill already installed for another provider, ASM now offers **Reinstall** (fresh download) or **Link** (symlink from the existing install, no duplication); local-folder installs always reinstall and skip the Link path ([#322](https://github.com/luongnv89/asm/issues/322), [#323](https://github.com/luongnv89/asm/issues/323)) — @luongnv89
- Add a neutral local skill library with explicit activation lifecycle — skills install once under the ASM config root via `asm install --library`, then link into provider scopes with `asm activate` / `asm deactivate`; `asm library list`, `asm library update <skill>`, and `asm library update --all` manage and refresh centrally stored skills from recorded source metadata ([#320](https://github.com/luongnv89/asm/issues/320)) — @ngaurav
- Add per-repo and per-author skill stats with visualization — new `asm stats repo`, `asm stats author`, and `asm stats index` CLI commands; build-time `repo-stats.json` / `author-stats.json` artifacts; website `/stats` overview and shareable `/profile/:owner` author pages with CSS bar charts ([#344](https://github.com/luongnv89/asm/issues/344), [#349](https://github.com/luongnv89/asm/issues/349)) — @luongnv89
- Improve the stats and author profile website — Top Authors rows link to profile pages, skill detail pages link to the author's stats, and Category Distribution adds a pie chart on author profiles ([#351](https://github.com/luongnv89/asm/issues/351), [#352](https://github.com/luongnv89/asm/issues/352)) — @luongnv89
- Raise the `skill-creator` authoring bar — exemplar library, adversarial review pass, eval floor, and misfire log so new skills are publish-ready by construction; adds a predictability rubric reference and creation hooks, and clarifies `skill-auto-improver` as the retrofit path for legacy skills ([#332](https://github.com/luongnv89/asm/issues/332), [#333](https://github.com/luongnv89/asm/issues/333), [#335](https://github.com/luongnv89/asm/issues/335), [#336](https://github.com/luongnv89/asm/issues/336), [#340](https://github.com/luongnv89/asm/issues/340)) — @luongnv89
- Improve the `find-me-skills` skill — align frontmatter and structure with the skill-creator standard, move catalog/bundle detail into references, and add checkable acceptance criteria (v1.2.0) ([#337](https://github.com/luongnv89/asm/issues/337)) — @luongnv89
- Publish `find-me-skills` and `skill-creator` from `asm/skills` in the curated index alongside featured `skill-auto-improver` ([#325](https://github.com/luongnv89/asm/issues/325)) — @luongnv89
- Add `luongnv89/idd` to the curated skill index — 7 skills for turning GitHub issues into structured, agent-ready work orders ([#324](https://github.com/luongnv89/asm/issues/324)) — @luongnv89
- Add `davidondrej/skills` to the curated skill index — 29 skills from the public MIT-licensed repository ([#345](https://github.com/luongnv89/asm/issues/345), [#348](https://github.com/luongnv89/asm/issues/348)) — @luongnv89

### Bug Fixes

- Fix `crossToolLink is not defined` crash in `inspectSkillForInstall` that caused every `asm install` on a new skill to exit 1 ([#326](https://github.com/luongnv89/asm/issues/326), [#330](https://github.com/luongnv89/asm/issues/330)) — @luongnv89
- Harden library activation and updates — `asm activate --force` removes only symlinks and refuses real directories; `asm library update` skips unchanged skills and propagates permission errors instead of treating them as missing ([#327](https://github.com/luongnv89/asm/issues/327), [#328](https://github.com/luongnv89/asm/issues/328), [#329](https://github.com/luongnv89/asm/issues/329), [#338](https://github.com/luongnv89/asm/issues/338)) — @luongnv89
- Fix `asm install --method vercel` on Windows — resolve npm's bundled `npx-cli.js` and launch it via the current Node binary so `execFile("npx")` no longer fails on `.cmd` shims ([#342](https://github.com/luongnv89/asm/issues/342), [#343](https://github.com/luongnv89/asm/issues/343)) — @Mordris
- Fix `skill-creator` follow-ups — update a stale validator pointer, remove `SKILL.md.bak`, and bump to v1.13.1 ([#341](https://github.com/luongnv89/asm/issues/341)) — @luongnv89

### Chores

- Align the skill authoring toolchain with great-skills predictability principles across `refresh-index`, `skill-index-updater`, `skill-creator`, and `skill-auto-improver` ([#339](https://github.com/luongnv89/asm/issues/339)) — @luongnv89
- Refresh indexed skill sources — re-ingested all enabled repos in `data/skill-index-resources.json` ([#331](https://github.com/luongnv89/asm/issues/331), [#350](https://github.com/luongnv89/asm/issues/350)) — @luongnv89

### New Contributors

- @ngaurav made their first contribution in [#320](https://github.com/luongnv89/asm/issues/320)

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.13.0...v2.14.0

## v2.13.0 — 2026-06-18

### Features

- Add a marketing landing page at `/` and move the skill catalog to `/skills` — new hero, problem/solution narrative, and install CTAs on the site ([#313](https://github.com/luongnv89/asm/issues/313)) — @luongnv89
- Add iOS Swift skill packs to the curated index and bundled skill-index data ([#315](https://github.com/luongnv89/asm/issues/315)) — @luongnv89
- Add the missing top-starred agent skill repositories to the ASM catalog — five new indexed collections plus a README section listing all ten requested repos ([#316](https://github.com/luongnv89/asm/issues/316)) — @luongnv89

### Bug Fixes

- Use a raster OG image, trim the meta description, and add a noscript hero fallback for the marketing site ([#314](https://github.com/luongnv89/asm/issues/314)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.12.0...v2.13.0

## v2.12.0 — 2026-06-17

### Features

- Inject live catalog counts into SEO surfaces at build time — skill, repo, and category counts were hardcoded and drifted stale across the SEO files (`index.html` meta, `llms.txt`, `og-image.svg`). They are now derived from `catalog.json` at build time via `website-src/` templates carrying `{{SKILL_COUNT}}`/`{{REPO_COUNT}}`/`{{CATEGORY_COUNT}}`/`{{LASTMOD}}` placeholders, a Vite `transformIndexHtml` plugin injects the counts into `index.html`, the sitemap `lastmod` is stamped from the build date, and `WebApplication` JSON-LD was added. The build fails loud on any unresolved placeholder, and the build-generated SEO files are no longer tracked (gitignored) ([#309](https://github.com/luongnv89/asm/issues/309)) — @luongnv89
- Fetch the live GitHub star count in the catalog header — the header previously showed the build-time star count, which could drift between releases. It now fetches the live count from the GitHub API on mount and falls back to the static catalog value on error or rate-limit; the fetch is non-blocking with `AbortController` cleanup ([#308](https://github.com/luongnv89/asm/issues/308)) — @luongnv89

### Bug Fixes

- Index both root-level and nested skills — the skill index now correctly picks up skills declared at the repo root as well as those nested under supported install paths. Also fixes `asm install --all` duplicate detection to key on the install-dir basename (via `getInstallNameFromPath`) instead of the frontmatter `name`, which previously both missed real collisions and raised false collisions that blocked valid installs; the root `relPath` case is special-cased ([#305](https://github.com/luongnv89/asm/issues/305)) — @luongnv89

### Chores

- Bump the transitive `ws` dependency 8.20.0 → 8.21.0 — clears the high-severity GHSA-58qx-3vcg-4xpx / CVE-2026-45736 advisory via `npm audit fix` ([#305](https://github.com/luongnv89/asm/issues/305)) — @luongnv89
- Refresh indexed skill sources — re-ingested all enabled repos in `data/skill-index-resources.json` (34 updated, 0 unchanged, 0 failed, 1 skipped) ([#312](https://github.com/luongnv89/asm/issues/312)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.11.0...v2.12.0

## v2.11.0 — 2026-06-09

### Features

- Support root skill index entries — skill index now accepts entries at the root level of indexed repositories, allowing a single repo to contribute skills without nested directories ([#304](https://github.com/luongnv89/asm/issues/304)) — @luongnv89
- Add briiirussell cybersecurity-skills source to the curated skill index — 1 new skill source for cybersecurity-focused agent skills ([#303](https://github.com/luongnv89/asm/issues/303)) — @luongnv89
- Add badlogic/pi-skills source to the curated skill index — 1 new skill source from the pi-skills repository ([#302](https://github.com/luongnv89/asm/issues/302)) — @luongnv89

### Chores

- Refresh indexed skill sources — re-ingested all enabled repos in `data/skill-index-resources.json` ([#306](https://github.com/luongnv89/asm/issues/306)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.10.0...v2.11.0

## v2.10.0 — 2026-06-03

### Features

- New `find-me-skills` skill — a conversational skill for users who have a goal but don't know which Agent Skills they need. It collects intent, confirms the user's situation, queries the live `asm` catalog (`asm search --available --json`), dedupes and explains the matches, lays out a step-by-step path with per-step inputs/outputs, and on approval emits an installable BundleManifest the user runs with `asm bundle install ./file.json`. Uses the CLI as the runtime discovery surface, so it works on any machine — not just the asm repo ([#281](https://github.com/luongnv89/asm/issues/281)) — @luongnv89

### Documentation

- Fix the stale landing docs page — correct the Node/npm prerequisite, add the `pi` provider (19), document `asm disable`/`asm enable`, and align on the canonical `author` field — @luongnv89
- Backfill v2.7.0–v2.9.0 in `docs/CHANGELOG.md` and refresh the README maintained line — @luongnv89

### Chores

- Refresh indexed skill sources — re-ingested all enabled repos in `data/skill-index-resources.json` (31 updated, 0 unchanged, 0 failed, 1 skipped) ([#299](https://github.com/luongnv89/asm/issues/299)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.9.0...v2.10.0

## v2.9.0 — 2026-05-29

### Features

- `asm disable <target>` / `asm enable <target>` — curate the active skill set without uninstalling, so agents stop accidentally invoking unintended or conflicting skills (e.g. two code-review skills, or the word "workflow" in conversation triggering a workflow skill). Disabling renames an instance's `SKILL.md` → `SKILL.md.disabled` so both asm's scanner and external agents stop discovering it; enabling reverses the rename. Targeting supports individual names, wildcards (`'workflow*'`, `'*-review'`), prefixes (`openspec:`, `asc-`), bulk (`--all`), and `--tool` / `--scope` filters. State persists in `~/.config/agent-skill-manager/skill-state.json` keyed by (skill × tool × scope). `asm list` reconstructs disabled instances and renders them dimmed with a `[disabled]` tag; JSON output carries a `disabled` flag. Symlinked multi-provider installs share one `SKILL.md`, so a toggle honestly affects every tool sharing that source and warns accordingly ([#91](https://github.com/luongnv89/asm/issues/91)) — @luongnv89

### Documentation

- Bump landing-page skill count to 3,400+ in the page, og, and twitter meta descriptions (catalog now holds 3,493 skills) — @luongnv89

### Chores

- Remove residual Bun references across the project — `install.sh` rewritten from Bun to npm (checks Node ≥ 18 / npm ≥ 9 and instructs on failure rather than auto-installing a runtime); `docs/DEPLOYMENT.md`, `docs/DEVELOPMENT.md`, `CONTRIBUTING.md`, `prd.md`, and the bug-report template corrected to Node/npm; skill/agent docs point `bun run preindex` → `npm run preindex`; vestigial Bun-absence test guards removed and argv fixtures switched from `bun` to `node`. The `Bun.spawn`/`Bun.env` patterns in `src/security-auditor.ts` and `src/installer.ts` are intentionally kept as detection vocabulary for auditing third-party skills. Also corrected stale `@opentui/core` references left by the ink migration and restored dropped eval/publish and `bun:ffi` build-leak test coverage ([#293](https://github.com/luongnv89/asm/issues/293)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.8.0...v2.9.0

## v2.8.0 — 2026-05-20

### Features

- `asm uninstall <name>` — new command with full reverse-installation logic. Supports `-s <scope>` and `-t, --tool <provider>` filters, automatically relocates the real folder to another surviving provider when the canonical host is being removed, cleans up empty parent dirs, and shows scope/tool/relocation info in the confirmation prompt ([#279](https://github.com/luongnv89/asm/issues/279)) — @luongnv89
- New `refresh-index` skill — re-ingests every already-enabled repo in `data/skill-index-resources.json` in one guided workflow (sync, classify into updated/unchanged/failed/skipped, verify catalog, then a confirmation-gated commit + PR). Inverse of `skill-index-updater` ([#290](https://github.com/luongnv89/asm/issues/290)) — @luongnv89
- Reorder install tool list by user preference — `DEFAULT_PROVIDERS` now leads with claude, codex, opencode, pi, hermes, openclaw; added the `pi` provider; `mergeWithDefaults` now inserts newly-introduced default providers in their canonical priority slot (anchored to the nearest preceding default), so existing users see the new order on upgrade ([#291](https://github.com/luongnv89/asm/issues/291)) — @luongnv89
- Repo-derived bundles — repo indexing now emits zero/one/multiple bundle records per repository, with explicit bundle metadata merged with best-effort inference. Bundles are exposed via CLI bundle load/list and the website bundle catalog; provenance to source repo and skill paths is preserved. 196 inferred bundles refreshed across 28 repos ([#275](https://github.com/luongnv89/asm/issues/275)) — @luongnv89

### Bug Fixes

- `asm uninstall <name> -t <provider>` now preserves the `.skill-lock.json` entry (source-tracking metadata: `source`, `commitHash`, `ref`) when other providers still have the skill installed, so subsequent `asm list`/`asm update` keep working on the survivors. When a real-folder relocation moves the canonical home to a kept provider the lock entry's `provider` field is repointed; when no relocation happened the entry is left intact. The full-uninstall path (no `-t`) still drops the entry as before ([#284](https://github.com/luongnv89/asm/issues/284)) — @luongnv89
- Uninstaller now cleans up partial state on EXDEV cp fallback failure — when cross-device move fails mid-copy, the partial destination is removed instead of being left as half-written content ([#283](https://github.com/luongnv89/asm/issues/283)) — @luongnv89
- Uninstaller surfaces relocation failures via non-zero exit code — relocation errors are no longer swallowed, so CI and scripted callers see the failure ([#282](https://github.com/luongnv89/asm/issues/282)) — @luongnv89
- `fix(test):` Bundle modify/export tests no longer leak installed skill copies into the user's real `~/.claude/skills/`. Each test creates its source dir as `<tmpRoot>/<frontmatter-name>/` so the installer's destination basename matches the cleanup lookup; a per-test `assertSkillUninstalled` guard fails the test if the install survives, plus a one-shot `beforeAll` sweep removes any `cli-skill-for-*` leftovers from prior runs ([#288](https://github.com/luongnv89/asm/issues/288)) — @luongnv89
- `fix(ci):` Replace apt-based trivy install with a binary download to avoid Azure mirror timeouts in the security workflow

### Documentation

- Document `asm bundle` command and the predefined bundles in the README ([#202](https://github.com/luongnv89/asm/issues/202)) — @luongnv89

### Chores

- Supply-chain hardening across npm and GitHub Actions — pinned versions, ignore-scripts hardening, lockfile checks, dependency cooldown declaration ([#277](https://github.com/luongnv89/asm/issues/277)) — @luongnv89
- Refresh indexed skill sources across all 30 curated repos — net skill count updated across the catalog ([#295](https://github.com/luongnv89/asm/issues/295)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.7.0...v2.8.0

## v2.7.0 — 2026-05-10

### Features

- Add Quick Start section to the catalog skill detail page — guided three-step workflow (Security Check, Quality Evaluation, Install) with copy-to-clipboard buttons ([#273](https://github.com/luongnv89/asm/issues/273)) — @luongnv89
- Add `romainsimon/paperasse` to the curated skill index — 6 French bureaucracy skills (commissaire-aux-comptes, comptable, controleur-fiscal, fiscaliste, notaire, syndic) covering administrative procedures and document handling ([#267](https://github.com/luongnv89/asm/issues/267), [#271](https://github.com/luongnv89/asm/issues/271)) — @luongnv89
- Re-sync `coreyhaines31/marketingskills` — 1 new co-marketing skill added ([#268](https://github.com/luongnv89/asm/issues/268)) — @luongnv89

### Bug Fixes

- `fix(test):` Update skill-detail tests for UI changes
- `fix(test-spawn):` Kill children on parent disconnect

### Documentation

- `docs(security):` Skill audit for issue #269 — security scan of 284 installed skills against prompt injection and credential theft risks, zero strict-risk hits found ([#270](https://github.com/luongnv89/asm/issues/270)) — @luongnv89

### Chores

- Re-sync all 30 curated skill sources — net skill count updated across the catalog
- Clean up repository and expand `.gitignore` — removed tracked backup files, added dev tool directories (`.cursor`, `.aider`, `.continue`, `.windsurf`, `.zed`, `.fleet`) and build/cache log patterns

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.6.2...v2.7.0

## v2.6.2 — 2026-05-07

### Chores

- Index 2 new curated skill sources — `warpdotdev/oz-skills` (15 skills for Warp AI agents) and `entireio/skills` (5 cross-agent skills for context and session handoff); regenerated catalog totals 7036 skills across 31 repos ([#264](https://github.com/luongnv89/asm/issues/264)) — @luongnv89
- Dedupe same-name skills within a single repo by directory priority — when one repo ships a skill at multiple supported install paths, keep exactly one entry using a deterministic order (`skills/` > `.claude/skills/` > `.agent/skills/` and `.agents/skills/` > first occurrence); cross-repo duplicates remain independent and dropped paths are logged via `--verbose` ([#265](https://github.com/luongnv89/asm/issues/265), [#266](https://github.com/luongnv89/asm/issues/266)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.6.1...v2.6.2

## v2.6.1 — 2026-05-03

### Bug Fixes

- `asm link` now handles non-existent paths and directory symlinks gracefully — bare registry-style names (e.g. `asm link code-review`) and missing paths exit 1 with a polished error and an `asm install <name>` suggestion instead of crashing with a Node stack trace; the top-level path probe now uses `stat` instead of `lstat` so directory symlinks are followed (re-linking an already-linked skill works), while inner-loop entry classification still uses `lstat` to avoid traversing nested symlinks ([#262](https://github.com/luongnv89/asm/issues/262)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.6.0...v2.6.1

## v2.6.0 — 2026-05-01

### Features

- Add `skill-upstream-pr` built-in skill — forks a target repo via `gh`, delegates the improvement loop to `skill-auto-improver`, and opens a friendly suggestion PR upstream with an `asm eval` before/after metrics table; mandatory preview/approval before any public action and a minimum-delta check skip trivial PRs ([#244](https://github.com/luongnv89/asm/issues/244)) — @luongnv89
- `asm eval` now accepts `author` as the canonical frontmatter field, with `creator` retained as a legacy alias — autofixer writes `author:` going forward, and legacy skills declaring `creator:` keep their score with no migration required ([#243](https://github.com/luongnv89/asm/issues/243)) — @luongnv89
- `asm eval` `skill-best-practice` provider (v1.0.0 → v1.1.0) — align with the latest `skill-creator` standard (v1.7.1): add `xhigh` to the effort enum, warn when descriptions exceed the 250-char runtime budget (truncation chops the negative-trigger clause), require `metadata.version` (semver-formatted), warn when `metadata.author` is missing, and require frontmatter `name` to match the parent directory ([#246](https://github.com/luongnv89/asm/issues/246)) — @luongnv89
- `skill-auto-improver` (v0.2.0 → v1.0.2) — adapt the skill itself and its workflow to the `skill-creator` standard, restructured around two gates: Gate 1 (skill-creator must-pass floor) and Gate 2 (asm-eval 85/8 quality floor); adds a Phase 1 frontmatter-normalization step after `asm eval --fix`, new `references/skill-creator-checklist.md` and `references/frontmatter-audit.md` playbooks, dual-gate report layout, and per-loop `metadata.version` bump for the target skill ([#253](https://github.com/luongnv89/asm/issues/253)) — @luongnv89
- Add `Paramchoudhary/ResumeSkills` as a curated source in the skill-index — 20 resume optimization and job-search skills (76 `SKILL.md` entries including cross-platform mirrors) covering ATS optimization, bullet writing, cover letters, LinkedIn profiles, interview prep, salary negotiation, and executive/academic/creative resumes ([#256](https://github.com/luongnv89/asm/issues/256)) — @luongnv89

### Bug Fixes

- Website list now surfaces a muted `relPath` sub-label on rows whose `owner/repo::name` collides — plugin-bundle repos ship the same skill name at multiple install paths, and identical-looking cards (matching name, owner/repo, description, badges) made the duplicates indistinguishable; non-colliding rows are unchanged ([#241](https://github.com/luongnv89/asm/issues/241)) — @luongnv89
- `asm install` now treats `skills/x-skill` and `./skills/x-skill` identically — when the input contains a path separator and resolves to an existing directory in the current working directory, it is treated as a local path rather than dispatched to the registry as a scoped name ([#249](https://github.com/luongnv89/asm/issues/249)) — @luongnv89
- `asm install --path` and `--all` now compose correctly — when `--all` is set and the resolved path contains skill subdirectories, ASM scans subdirectories instead of failing on missing `SKILL.md`; when a subpath is supplied with `--all`, duplicate detection is scoped to that prefix so unrelated dupes don't abort the install; the zero-skills error message is also scope-aware ([#251](https://github.com/luongnv89/asm/issues/251), [#252](https://github.com/luongnv89/asm/issues/252)) — @luongnv89

### Chores

- Refresh the bundled `skills/skill-creator/` skill to the upstream version — pulls in updated references, scripts, and templates used by `skill-auto-improver` and `skill-upstream-pr` — @luongnv89
- Add a local-first security baseline plus CI mirror — pre-commit hook runs `gitleaks` (secrets), `trivy` (dependencies), and `semgrep` (static analysis) offline, exits non-zero on HIGH/CRITICAL, and writes JSON + Markdown reports under `security/`; `.github/workflows/security.yml` mirrors the same runner on push to `main` and pull requests, with the trivy DB cache keyed on a weekly stamp ([#257](https://github.com/luongnv89/asm/issues/257)) — @luongnv89
- Bring `skill-index-updater` up to the `skill-creator` standard — move `README.md` under `docs/`, normalize frontmatter (`metadata.version` + `metadata.author`, drop top-level `version`), rewrite the description under the 250-char runtime budget with a negative-trigger clause, and add `When to Use` / `Example` / `Expected Output` / `Edge Cases` sections; `asm eval` 76 (C) → 97 (A) with every category >= 8 ([#258](https://github.com/luongnv89/asm/issues/258)) — @luongnv89
- Re-sync all 27 enabled skill sources via `bun run preindex` — picks up upstream additions, removals, version/description bumps, and refreshed `evalSummary` + `tokenCount` for every skill; net delta +51 skills (6797 → 6848) ([#260](https://github.com/luongnv89/asm/issues/260)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.5.0...v2.6.0

## v2.5.0 — 2026-04-24

### Features

- Add a bundle builder UI to the catalog website — interactive cart flow lets users browse skills, add any to a persistent (localStorage) cart visible from the header across all routes, fill bundle metadata (name/description/author/tags), then either export a `BundleManifest`-conforming `.json` or publish a pre-filled feature request issue to promote the bundle. Validation mirrors the CLI's `validateBundle()` rules and truncation keeps the issue URL under GitHub's ~8KB pre-fill limit ([#238](https://github.com/luongnv89/asm/pull/238), [#240](https://github.com/luongnv89/asm/pull/240)) — @luongnv89
- Add `google/skills` and `antonbabenko/terraform-skill` as curated sources in the skill-index — 13 Google product/technology skills plus a Terraform/OpenTofu skill for AI agents ([#237](https://github.com/luongnv89/asm/pull/237)) — @luongnv89
- `asm eval` now warns when `README.md` sits at the skill root — flags a common packaging mistake that previously slipped through scoring ([#227](https://github.com/luongnv89/asm/issues/227), [#234](https://github.com/luongnv89/asm/pull/234)) — @luongnv89
- Redesign the website `/changelog` page with an editorial release-log aesthetic — two-column layout with a Fraunces + Instrument Serif masthead, a JetBrains Mono sticky version index, monospace metadata strip, outlined tag pills, and numbered receipt-style entries separated by dashed rules; self-scoped `.cl-*` styles preserve existing `ENTRIES` data verbatim and work in both light and dark themes — @luongnv89

### Bug Fixes

- Deploy Skill Catalog workflow now also triggers on changes to `website-src/**` and `package.json` — previously release commits that bumped only those paths would not fire the workflow, leaving the live site stale (e.g. the v2.4.0 release left the nav pill showing 2.3.0 because `skills.min.json` was never regenerated on CI) — @luongnv89

### Chores

- Remove the `eu-project-ops` predefined website bundle and update bundle tests and the website changelog bundle count to match the reduced set — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.4.0...v2.5.0

## v2.4.0 — 2026-04-23

### Features

- Drop Bun from the toolchain — replace `@opentui/core` with `ink` for the TUI so CLI and TUI both run on Node >=18 alone, removing the `bun:ffi` native dependency ([#224](https://github.com/luongnv89/asm/pull/224), [#226](https://github.com/luongnv89/asm/pull/226)) — @luongnv89
- Make `bun` optional at install time — CLI runs on Node, Bun is only required for interactive TUI mode ([#221](https://github.com/luongnv89/asm/pull/221), [#223](https://github.com/luongnv89/asm/pull/223)) — @luongnv89
- Add `skill-auto-improver` built-in skill — eval-driven improvement loop that runs `asm eval`, applies deterministic `--fix`, then iterates per-category playbook edits until a skill clears the 85/8 quality floor (overallScore > 85 AND every category >= 8) or stops with a blocker report. Self-dogfooded: scores 100/100 with every category at 10/10 ([#209](https://github.com/luongnv89/asm/issues/209), [#218](https://github.com/luongnv89/asm/pull/218)) — @luongnv89
- Ship 5 curated pre-defined bundles with ASM for popular workflows (`frontend-dev`, `devops`, `ios-release`, `content-writing`, `eu-project-ops`) — add `--predefined` flag on `asm bundle list` to show shipped bundles ([#206](https://github.com/luongnv89/asm/issues/206), [#211](https://github.com/luongnv89/asm/pull/211)) — @luongnv89
- Add `asm bundle modify` and `asm bundle export` subcommands — non-interactive editing via `--add`, `--remove`, `--description`, `--author`, `--tags`, plus an interactive prompt mode and JSON export with `--force` / `--json` ([#204](https://github.com/luongnv89/asm/issues/204), [#205](https://github.com/luongnv89/asm/issues/205), [#208](https://github.com/luongnv89/asm/pull/208)) — @luongnv89
- Rewrite the ASM catalog website on React + Vite + Tailwind + shadcn/ui — replaces the 4.4k-line single-file `index.html`, retains full feature parity (catalog list, category tabs, facets, repo/sort selects, MiniSearch prefix + fuzzy search, pagination, bundle list, skill detail), and introduces a NeuronWiz-style sidebar + detail two-pane layout for catalog and bundles ([#228](https://github.com/luongnv89/asm/issues/228), [#229](https://github.com/luongnv89/asm/issues/229), [#230](https://github.com/luongnv89/asm/pull/230), [#231](https://github.com/luongnv89/asm/pull/231)) — @luongnv89
- Add `/bundles` page to the ASM catalog website — each bundle card shows name, description, tags, included skills, and a copy-paste install command; deploy pipeline triggers on `data/bundles/**` changes ([#207](https://github.com/luongnv89/asm/issues/207), [#215](https://github.com/luongnv89/asm/pull/215)) — @luongnv89
- Add `/docs` and `/changelog` SPA pages to the React website so header nav stays internal instead of bouncing to GitHub — @luongnv89
- Consolidate mobile header actions (theme toggle, GitHub link, nav items) into a single burger menu at `<=768px` with aria-expanded, aria-controls, Escape-to-close, and outside-click dismissal ([#216](https://github.com/luongnv89/asm/pull/216), [#217](https://github.com/luongnv89/asm/pull/217)) — @luongnv89
- Pin `skill-auto-improver` to the top of the catalog as a featured skill, with a distinct visual treatment ([#219](https://github.com/luongnv89/asm/pull/219)) — @luongnv89
- Restore full website nav (Docs, Changelog, version pill, GitHub star count) and switch the catalog sidebar to `react-window` virtualization — cuts click latency on the 6,783-skill catalog from ~10s to instant ([#232](https://github.com/luongnv89/asm/pull/232)) — @luongnv89
- Use the real ASM nexus logo in the website header — @luongnv89

### Performance

- Split `catalog.json` into a compact list + a MiniSearch index — faster initial load and smaller per-request payloads on the website ([#214](https://github.com/luongnv89/asm/issues/214), [#220](https://github.com/luongnv89/asm/pull/220)) — @luongnv89

### Bug Fixes

- Include `relPath` in the catalog dedup key so plugin-bundle variants aren't dropped — recovers ~3k installable targets that the `owner/repo::name` key had silently collapsed; adds regression tests asserting `totalSkills === skills.length` and unique `installUrl` per entry ([#201](https://github.com/luongnv89/asm/issues/201), [#203](https://github.com/luongnv89/asm/pull/203)) — @luongnv89
- Opt into React Router v7 future flags (`v7_startTransition`, `v7_relativeSplatPath`) to silence v6 deprecation warnings — @luongnv89
- Import test accounts for missing providers so the test suite runs cleanly when optional providers aren't installed — @luongnv89

### Changed

- Rename eval provider ID `skill-creator` → `skill-best-practice` to avoid collision with the real Anthropic `skill-creator` skill; include warning-severity checks in the score denominator; add per-check `√`/`×`/`⚠` breakdown under each extra provider's score line — @luongnv89

### Testing

- Isolate publisher and import tests from host `gh` CLI and skill-provider state via a `fakeGhCli()` helper — removes five flaky tests that depended on the developer's local environment ([#167](https://github.com/luongnv89/asm/issues/167), [#200](https://github.com/luongnv89/asm/pull/200)) — @luongnv89
- Deflake runner timing assertions by bumping sleeps to 20ms and assertions to `>=10ms` for headroom against `Math.round` jitter — @luongnv89
- Stub `ResizeObserver` in jsdom smoke tests so `react-window` v2 renders under Vitest — @luongnv89

### Chores

- Ignore `.agents/` directory in git — @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.3.0...v2.4.0

## v2.3.0 — 2026-04-21

### Features

- Add skill-best-practice deterministic provider (#197, #198) @luongnv89
- asm eval accepts GitHub refs and batch-evaluates collections (#196) @luongnv89
- scannable asm list output for large inventories (#192, #195) @luongnv89
- Multi-axis filtering and search highlighting on catalog page (#186) @luongnv89

### Bug Fixes

- Preserve escaped entities in highlights @luongnv89
- Fix keyboard activation on install CTA and sort safety on unknown grades (#186) @luongnv89

### Documentation

- Fold asm eval into skill-index-updater step 3 @luongnv89

**Full Changelog**: https://github.com/luongnv89/asm/compare/v2.2.0...v2.3.0

## v2.2.0 — 2026-04-20

### Features

- Show estimated token count and `asm eval` scores on every consumer surface — website cards/modal, TUI list/detail, and CLI inspect. Token count uses a `words + spaces` heuristic labelled with `~`; eval scores include overall score, letter grade, per-category breakdown, and an explicit empty state pointing to `asm eval <skill>` when data is missing. Catalog payload is the single source of truth, so all 3,140 indexed skills carry both signals ([#191](https://github.com/luongnv89/agent-skill-manager/pull/191), closes [#187](https://github.com/luongnv89/agent-skill-manager/issues/187), [#188](https://github.com/luongnv89/agent-skill-manager/issues/188)) — @luongnv89

### Documentation

- Refresh the website Documentation page with the full `asm` command reference — adds 6 missing commands (`import`, `outdated`, `update`, `doctor`, `bundle`, `config path`), expands global-options and install-flags tables, and adds per-command sections with flags and runnable examples for `list`, `search`, `inspect`, `audit`, `uninstall`, `stats`, `doctor`, `bundle`, `index`, `outdated`/`update`, `export`/`import`, and `config` ([#190](https://github.com/luongnv89/agent-skill-manager/pull/190), closes [#189](https://github.com/luongnv89/agent-skill-manager/issues/189)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v2.1.0...v2.2.0

## v2.1.0 — 2026-04-20

### Features

- Add `heygen-com/hyperframes` to the curated skill index — 5 new skills for HTML-based video composition, CLI tooling, registry blocks, website-to-video capture, and GSAP animation reference ([#184](https://github.com/luongnv89/agent-skill-manager/pull/184)) — @luongnv89
- Re-index `mattpocock/skills` (18 → 21 skills) ([#183](https://github.com/luongnv89/agent-skill-manager/pull/183)) — @luongnv89

### Bug Fixes

- Scan 5 levels deep when discovering skills — previously capped at 3, which missed skills nested under `plugins/<group>/skills/<skill>/SKILL.md`. Re-indexed all curated repos: catalog grew from ~1,700 to 3,135 skills across 24 repos ([#185](https://github.com/luongnv89/agent-skill-manager/pull/185)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v2.0.0...v2.1.0

## v2.0.0 — 2026-04-19

### Breaking Changes

- Drop the `skillgrade` runtime provider and its bundled binary — `asm eval <skill>` is now zero-config (no external binary, API key, Docker, or `eval.yaml`). The built-in `quality` provider scores every skill out of the box ([#180](https://github.com/luongnv89/agent-skill-manager/issues/180), [#182](https://github.com/luongnv89/agent-skill-manager/pull/182)) — @luongnv89
- Remove CLI flags `--runtime`, `--runtime init`, `--preset`, `--provider`, `--compare`, `--threshold`, and the `ASM_SKILLGRADE_BIN` env var. CI pipelines using these flags will fail on upgrade — drop the flags and rely on the default quality provider — @luongnv89
- Remove `docs/skillgrade-integration.md` — @luongnv89

### Changed

- Cut ~5–10 MB from the npm tarball by dropping `skillgrade` from `dependencies` and `bundledDependencies` — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.22.0...v2.0.0

## v1.22.0 — 2026-04-19

### Refactors

- Detect PATH shadowing from npm and bun globals during install — warn when a stale global binary shadows the locally installed `asm` ([#177](https://github.com/luongnv89/agent-skill-manager/pull/177), [#178](https://github.com/luongnv89/agent-skill-manager/pull/178)) — @luongnv89
- Expand `skillgrade-missing` error with a manual fallback message — guide users through installing Skillgrade by hand when automatic install fails ([#173](https://github.com/luongnv89/agent-skill-manager/pull/173), [#176](https://github.com/luongnv89/agent-skill-manager/pull/176)) — @luongnv89

### Bug Fixes

- Bundle `skillgrade` via `bundledDependencies` so it ships inside the `asm` package and is always available without a separate install step ([#172](https://github.com/luongnv89/agent-skill-manager/pull/172), [#175](https://github.com/luongnv89/agent-skill-manager/pull/175)) — @luongnv89
- Auto-initialise `eval.yaml` when missing and fix a misleading init hint that pointed to the wrong command ([#171](https://github.com/luongnv89/agent-skill-manager/issues/171), [#170](https://github.com/luongnv89/agent-skill-manager/issues/170), [#174](https://github.com/luongnv89/agent-skill-manager/pull/174)) — @luongnv89

### Testing

- Resolve macOS symlink path inconsistency in test suite and exclude the plugin provider from the public export to prevent test noise — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.21.0...v1.22.0

## v1.21.0 — 2026-04-19

### Features

- Add `asm eval` skill quality evaluator — score installed skills against a structured rubric ([#154](https://github.com/luongnv89/agent-skill-manager/pull/154), closes [#119](https://github.com/luongnv89/agent-skill-manager/issues/119)) — @luongnv89
- Add eval provider contract, registry, and runner skeleton — pluggable architecture for skill quality evaluation ([#160](https://github.com/luongnv89/agent-skill-manager/pull/160), closes [#155](https://github.com/luongnv89/agent-skill-manager/issues/155)) — @luongnv89
- Add quality provider adapter that wraps the built-in evaluator behind the new provider interface ([#161](https://github.com/luongnv89/agent-skill-manager/pull/161), closes [#156](https://github.com/luongnv89/agent-skill-manager/issues/156)) — @luongnv89
- Wire `asm eval` through the provider framework and add `asm eval-providers` list command ([#162](https://github.com/luongnv89/agent-skill-manager/pull/162), closes [#157](https://github.com/luongnv89/agent-skill-manager/issues/157)) — @luongnv89
- Add Skillgrade runtime provider for `asm eval` ([#163](https://github.com/luongnv89/agent-skill-manager/pull/163), closes [#158](https://github.com/luongnv89/agent-skill-manager/issues/158)) — @luongnv89
- Add `--compare` mode to `asm eval` for side-by-side multi-provider scoring, plus integration docs ([#164](https://github.com/luongnv89/agent-skill-manager/pull/164), closes [#159](https://github.com/luongnv89/agent-skill-manager/issues/159)) — @luongnv89
- Bundle Skillgrade for transparent runtime-eval install — no separate setup required ([#165](https://github.com/luongnv89/agent-skill-manager/pull/165)) — @luongnv89
- Add Hermes agent as a built-in provider, including supported-tools listing on README and website ([#166](https://github.com/luongnv89/agent-skill-manager/pull/166), [#168](https://github.com/luongnv89/agent-skill-manager/pull/168)) — @luongnv89

### Bug Fixes

- Recognize Windows drive paths (e.g. `C:\…`) as local sources in the installer ([#153](https://github.com/luongnv89/agent-skill-manager/pull/153), closes [#138](https://github.com/luongnv89/agent-skill-manager/issues/138)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.20.0...v1.21.0

## v1.20.0 — 2026-04-12

### Features

- Add `asm publish` command for publishing skills to the ASM Registry with manifest validation and CI pipeline ([#132](https://github.com/luongnv89/agent-skill-manager/pull/132), closes [#105](https://github.com/luongnv89/agent-skill-manager/issues/105)) — @luongnv89
- Add registry-based skill resolution — install skills by bare name via the ASM Registry without full GitHub URLs ([#133](https://github.com/luongnv89/agent-skill-manager/pull/133), closes [#106](https://github.com/luongnv89/agent-skill-manager/issues/106)) — @luongnv89
- Add `asm outdated` and `asm update` commands for checking and upgrading installed skills to their latest versions ([#134](https://github.com/luongnv89/agent-skill-manager/pull/134), closes [#107](https://github.com/luongnv89/agent-skill-manager/issues/107)) — @luongnv89
- Add `asm doctor` environment health check command — diagnoses configuration, provider availability, and connectivity issues ([#135](https://github.com/luongnv89/agent-skill-manager/pull/135), closes [#108](https://github.com/luongnv89/agent-skill-manager/issues/108)) — @luongnv89
- Add `--machine` flag to all CLI commands with stable v1 JSON envelope for programmatic consumption ([#136](https://github.com/luongnv89/agent-skill-manager/pull/136), closes [#109](https://github.com/luongnv89/agent-skill-manager/issues/109)) — @luongnv89
- Support multiple skill paths in `asm link` — link several skills in a single invocation ([#144](https://github.com/luongnv89/agent-skill-manager/pull/144)) — @luongnv89
- Add `skill_path` to registry manifest for multi-skill repository support ([#145](https://github.com/luongnv89/agent-skill-manager/pull/145)) — @luongnv89
- Add plugin marketplace skill discovery — scan installed editor plugins for bundled skills ([#149](https://github.com/luongnv89/agent-skill-manager/pull/149), closes [#80](https://github.com/luongnv89/agent-skill-manager/issues/80)) — @luongnv89
- Add Codex plugin marketplace discovery ([#151](https://github.com/luongnv89/agent-skill-manager/pull/151), closes [#124](https://github.com/luongnv89/agent-skill-manager/issues/124)) — @luongnv89
- Add dedicated Registry page to the ASM website with publish and install guides ([#148](https://github.com/luongnv89/agent-skill-manager/pull/148)) — @luongnv89

### Bug Fixes

- Support commit SHA refs in skill clone for pinned installs ([#145](https://github.com/luongnv89/agent-skill-manager/pull/145)) — @luongnv89
- Create provider directory before symlinking in `asm link` — @luongnv89
- Separate unit-tests CI job to avoid config file race condition — @luongnv89

### Testing

- Add E2E tests for registry publish/install workflow — @luongnv89

### Documentation

- Add ASM Registry publish/install section to README and website — @luongnv89
- Improve `asm link` usage examples for local skill development ([#145](https://github.com/luongnv89/agent-skill-manager/pull/145)) — @luongnv89

### Chores

- Migrate registry to dedicated `asm-registry` repo ([#137](https://github.com/luongnv89/agent-skill-manager/pull/137)) — @luongnv89
- Add asm-registry scaffold with manifest schema, CI, and validation ([#131](https://github.com/luongnv89/agent-skill-manager/pull/131), closes [#104](https://github.com/luongnv89/agent-skill-manager/issues/104)) — @luongnv89
- Shift-left — unit tests and E2E in pre-commit, slim CI — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.19.0...v1.20.0

## v1.19.0 — 2026-03-28

### Features

- Add `asm bundle` command with five subcommands (`create`, `install`, `list`, `show`, `remove`) for reusable skill collections across workflows, domain agents, and project setups ([#130](https://github.com/luongnv89/agent-skill-manager/pull/130), closes [#115](https://github.com/luongnv89/agent-skill-manager/issues/115)) — @luongnv89
- Remember user tool selection across runs — `selectedTools` persisted to ASM config as pre-checked defaults on subsequent interactive prompts; explicit `--tool` / `-p` flag continues to override ([#129](https://github.com/luongnv89/agent-skill-manager/pull/129), closes [#123](https://github.com/luongnv89/agent-skill-manager/issues/123)) — @luongnv89
- Support linking multiple skills from the same folder — `asm link <path>` now scans immediate subdirectories for `SKILL.md` files when no root `SKILL.md` exists, linking all discovered skills in a single invocation ([#127](https://github.com/luongnv89/agent-skill-manager/pull/127), closes [#122](https://github.com/luongnv89/agent-skill-manager/issues/122)) — @luongnv89
- Add `Imbad0202/academic-research-skills` to curated skill index — 4 new skills (`academic-paper-reviewer`, `academic-paper`, `academic-pipeline`, `deep-research`) for academic and research workflows ([#128](https://github.com/luongnv89/agent-skill-manager/pull/128), closes [#112](https://github.com/luongnv89/agent-skill-manager/issues/112), [#117](https://github.com/luongnv89/agent-skill-manager/issues/117)) — @luongnv89

### Documentation

- Add **Best Practices** page to the ASM catalog website with curated official Anthropic resources and community guides for skill authors, accessible via `#best-practices` ([#128](https://github.com/luongnv89/agent-skill-manager/pull/128)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.18.0...v1.19.0

## v1.18.0 — 2026-03-28

### Features

- Add `alirezarezvani/claude-skills` to curated skill index — 451 new skills across engineering, marketing, product, compliance, C-level advisory, project management, finance, and business growth ([#126](https://github.com/luongnv89/agent-skill-manager/pull/126)) — @luongnv89

### Documentation

- Update skill count from 2,600+ to 2,800+ across README, website meta tags, and OG image
- Update Open-Source Skill Collections table with refreshed skill counts
- Update OG image repo count from 17 to 23

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.17.0...v1.18.0

## v1.17.0 — 2026-03-26

### Features

- Add Acknowledgements section to README and landing page with contributor cards, avatars, PR counts, and dependency cards ([#121](https://github.com/luongnv89/agent-skill-manager/pull/121), closes [#120](https://github.com/luongnv89/agent-skill-manager/issues/120)) — @luongnv89

### Bug Fixes

- Handle Windows backslash path separators in skill name extraction ([#111](https://github.com/luongnv89/agent-skill-manager/pull/111), closes [#110](https://github.com/luongnv89/agent-skill-manager/issues/110)) — @Mordris
- Load acknowledgements from JSON source of truth ([#121](https://github.com/luongnv89/agent-skill-manager/pull/121)) — @luongnv89
- Fix PR count mismatch and improve data sync ([#121](https://github.com/luongnv89/agent-skill-manager/pull/121)) — @luongnv89

### Testing

- Expand E2E coverage for all CLI commands and flags — 87 to 139 E2E tests across Node and Bun runners ([#99](https://github.com/luongnv89/agent-skill-manager/pull/99)) — @luongnv89

### Documentation

- Add v1.16.0 changelog entry to landing page — @luongnv89

### New Contributors

- @Mordris made their first contribution in [#111](https://github.com/luongnv89/agent-skill-manager/pull/111)

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.16.0...v1.17.0

## v1.16.0 — 2026-03-25

### Features

- Add `asm import` command for restoring skills from exported JSON manifests with validation, `--force`, and `--scope` flags ([#98](https://github.com/luongnv89/agent-skill-manager/pull/98), closes [#59](https://github.com/luongnv89/agent-skill-manager/issues/59)) — @luongnv89
- Add match count and install hints to `asm search` available skills output ([#97](https://github.com/luongnv89/agent-skill-manager/pull/97), closes [#93](https://github.com/luongnv89/agent-skill-manager/issues/93)) — @luongnv89

### Bug Fixes

- Handle `--json` flag on empty manifest import ([#98](https://github.com/luongnv89/agent-skill-manager/pull/98)) — @luongnv89

### Other Changes

- Reorder provider list by priority and default-check agents ([#96](https://github.com/luongnv89/agent-skill-manager/pull/96), closes [#95](https://github.com/luongnv89/agent-skill-manager/issues/95)) — @luongnv89

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.15.1...v1.16.0

## v1.15.1 — 2026-03-25

### Features

- Add Gemini CLI and Google Antigravity as built-in providers (#94, closes #33, #34)

### Documentation

- Update skill count from 1,700+ to 2,600+

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.15.0...v1.15.1

## v1.15.0 — 2026-03-24

### Features

- Add 4 new skill sources to curated index
- Add verified badge to skills during ingestion
- Add light/dark theme toggle to skill catalog
- Add docs page, changelog page, and version display
- Add copy buttons to docs page code blocks
- Add 'Installing Skills from Local Files' docs section
- Add Master-cai/Research-Paper-Writing-Skills to curated skill index

### Bug Fixes

- Fix website: enforce 44px touch targets and 12px min font sizes (#72)
- Fix website: improve touch targets, font sizes, and overflow handling (#72)
- Fix website: make catalog page fully responsive on mobile (#72)
- Fix website: theme remaining hardcoded colors and improve contrast (#75)
- Fix website: address theme review feedback (#75)
- Fix verified-badge: address review feedback (#76)
- Fix: add trailing newline to .gitignore
- Fix skill: remove hardcoded path and fix maxdepth in skill-index-updater
- Fix website: rebuild changelog from GitHub releases as source of truth
- Fix website: add missing versions to changelog page
- Fix website: address review feedback for docs/changelog pages
- Fix installer: update picker test for deselected defaults (#50)

### Other Changes

- Refactor: address review feedback in skill index PR
- Refactor installer: default tool selection to none (#50)

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.14.0...v1.15.0

## v1.14.0 — 2026-03-24

### Features

- Add skill catalog website with search, category filters, and one-click install commands (#38)
- Add SEO optimization, AI bot indexing (llms.txt, robots.txt), and Google Analytics to catalog website
- Redesign logo as The Nexus — hub-and-spoke skill graph brand identity
- Show GitHub star count next to GitHub button on catalog website
- Add SKILL.md link to skill detail modal on catalog website
- Address all 10 usability review issues and update catalog to Nexus logo
- Implement `.skill-lock.json` to track installed skills with integrity hashes (#24)
- Re-index existing repos with `compatibility` and `allowedTools` fields
- Add 6 new skill sources to index (#53, #55, #56, #58, #60, #61)
- Add slavingia/skills repo to curated skill index (#62)
- Add scope selection step for global/project install (#49)

### Bug Fixes

- Fix null-skills validation bug in lock module, remove dead export, add missing tests
- Set git identity in `getCommitHash` test for CI compatibility
- Correct step counter in install flow

### Testing

- Add unit and E2E tests for scope selection feature (#64)
- Add scope selection tests for install flow

### Documentation

- Add ASM Catalog section to README and move to top for visibility

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.13.1...v1.14.0

## v1.13.1 — 2026-03-23

### Fixed

- Node.js v25 compatibility: resolve `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` caused by `@opentui/core` shipping `.ts` entry points in node_modules
- Cross-runtime TUI support: `bun:ffi` shim now uses real FFI on Bun (native rendering) and no-op stubs on Node.js (CLI-only)
- Auto re-exec with Bun for interactive TUI mode when running on Node.js, with helpful error if Bun is not installed
- Clean `dist/` before build to prevent stale chunks from previous builds

## v1.13.0 — 2026-03-23

### Added

- Parse and display all 6 SKILL.md frontmatter fields: `name`, `description`, `license`, `compatibility`, `allowed-tools`, and `metadata` (#14)
- `allowed-tools` risk coloring in CLI and TUI: red for Bash/Write/Edit, yellow for WebFetch/WebSearch, green for Read/Grep/Glob
- Warning line for skills with high-risk tools (e.g., "This skill can execute shell commands and modify files")
- `license`, `compatibility`, and `allowedTools` included in `--json` output for `asm inspect`, `asm list`, and `asm index search`
- Backfill for legacy skill indices missing `compatibility` and `allowedTools` fields

### Fixed

- `asm index search --json` now includes `compatibility` and `allowedTools` fields
- TUI detail overlay height calculation accounts for warning row when high-risk tools are present

## v1.12.0 — 2026-03-23

### Features

- Add MiniMax-AI/skills repo to curated skill index — 10 new skills discoverable via `asm search` (#43, #47)
- Enrich skill-index with license/creator metadata and filter flags (#10, #46)
- Extract curated skill repos into `data/skill-index-resources.json` for maintainability (#13, #45)
- Add `effort` field to SKILL.md frontmatter (#36, #37)

### Bug Fixes

- Stub `bun:ffi` at build time for Node.js compatibility (#35, #44)
- Scope unit-tests CI job to `src/` to exclude E2E tests

### Testing

- Add E2E tests for skill index search via both Bun and Node runtimes
- Add multi-job CI pipeline with E2E validation for Node 18/20/22

### Documentation

- Add effort field documentation to README

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.11.0...v1.12.0

## v1.11.0 — 2026-03-21

### Features

- Interactive checkbox picker for multi-skill install — navigate with ↑/↓, toggle with Space, select all with `a`, confirm with Enter (#32)
- Search/filter support in checkbox picker for quickly finding skills in long lists (#9)
- Interactive checkbox picker for provider selection during config (#9)
- Support Vercel skills CLI install format (#29)
- Support installing skills from local folder paths (#22)
- Wave 1 provider expansion — add 8 new providers, fix `$EDITOR` config, add creator column (#12)
- Rename user-facing "Provider" to "Tool" in CLI and TUI (#12)
- Reorder install flow and improve CLI colors

### Bug Fixes

- Change shebang to `node` for npm global install compatibility (#30)
- Fix skill detail TUI description overflow (#28)
- Guard ingester/audit against local paths and restrict tilde expansion (#27)
- Fix checkbox picker re-render cursor positioning
- Update README for all-enabled providers, remove dead code
- Address test reliability issues across 7 test files

### Testing

- Add 71 CLI integration tests for all commands and flags
- Expand unit test coverage from 71.8% to 88.2%

### Documentation

- Add screenshots to README for visual feature showcase
- Update README with full 15-provider table and Wave 1 changes
- Transform README into landing-page structure
- Add PRD, tasks, and competitor analysis for v2.0 roadmap

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.10.0...v1.11.0

## v1.10.0 — 2026-03-18

### Features

- Add `asm index` command with bundled pre-indexed skill data for fast offline skill discovery
- Support nested metadata blocks in SKILL.md frontmatter — parser now handles one-level YAML nesting with dot notation (e.g., `metadata.version`, `metadata.creator`)
- Add `resolveVersion()` helper that prefers `metadata.version` over top-level `version` for consistent version resolution across all commands
- Update `asm init` scaffold template to use new metadata block format with `license` and `creator` fields

### Bug Fixes

- Fix duplicate install names in multi-skill installs
- Fix valid JSON output for `asm audit security --all --json` when no skills are found
- Upgrade `actions/checkout` to v5 to resolve Node.js 20 deprecation warning in CI
- Format `installer.test.ts` to pass CI prettier check
- Fix CLI integration test to use proper semver comparison instead of string comparison

### Documentation

- Add open-source skill collections section to README with 5 new collections
- Add TUI dashboard screenshot

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.9.0...v1.10.0

## v1.9.0 — 2026-03-14

### Features

- Support GitHub subfolder URLs for `asm install` and `asm audit security` — URLs like `https://github.com/user/skills/tree/main/skills/agent-config` are now automatically parsed to detect the branch and subfolder path
- Add `github:owner/repo#ref:path` shorthand syntax for installing skills from a specific subfolder on a specific branch
- Add `resolveSubpath()` function that uses `git ls-remote` to disambiguate branch names from subfolder paths in `/tree/` URLs
- Subfolder URL support works across all operations: install, security audit, and multi-skill discovery

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.8.3...v1.9.0

## v1.8.3 — 2026-03-14

### Bug Fixes

- Replace Unicode box-drawing characters with ASCII equivalents for terminal compatibility

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.8.2...v1.8.3

## v1.8.2 — 2026-03-14

### Improvements

- Redesign security audit report with compact 4-zone layout (header box, threat summary, findings, footer)
- Deduplicate matches so the same file:line appears once per category
- Group matches by file for compact rendering (e.g., `:10, :25, :41`)
- Merge Permission Analysis into Findings section, eliminating redundant file references
- Add aggregate critical/warning/info counts and inline permission labels in threat summary
- Truncate match text to 50 chars for clean terminal display
- Use box-drawing characters for stronger visual hierarchy

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.8.1...v1.8.2

## v1.8.1 — 2026-03-14

### Bug Fixes

- Fix duplicate skill removal to create symlinks to the kept instance instead of just deleting the folder, so skills remain accessible from all provider locations

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.8.0...v1.8.1

## v1.8.0 — 2026-03-14

### Features

- Add `--transport <https|ssh|auto>` flag for `asm install` to support private GitHub repos via SSH with automatic fallback (Issue #6)
- Add `asm audit security` subcommand for scanning skills for dangerous patterns (shell execution, network access, credential exposure, obfuscation)
- Add `--all` flag for `asm audit security` to audit all installed skills at once
- Support auditing remote GitHub skills before installing via `asm audit security github:owner/repo`

### Improvements

- Extract shared file utilities (`BINARY_EXTENSIONS`, `readFilesRecursive`) into `src/utils/fs.ts` to eliminate duplication
- Consolidate ANSI color helpers into `formatter.ts` with new `bg*` variants
- Split `cmdAuditSecurity` into focused sub-functions for readability

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.7.0...v1.8.0

## v1.7.0 — 2026-03-13

### Features

- Add YAML frontmatter validation for SKILL.md files using the `yaml` library
- Detect and report `invalid-yaml` warnings in `asm inspect` and `asm list` health checks

### Dependencies

- Add `yaml` (^2.8.2) as a runtime dependency for strict YAML parsing

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.2...v1.7.0

## v1.6.2 — 2026-03-13

### Bug Fixes

- Suppress "fatal: not a git repository" stderr noise when running outside a git repo
- Fix 7 failing tests to match the new grouped CLI output format from v1.6.0

### Other Changes

- Update README screenshot

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.1...v1.6.2

## v1.6.1 — 2026-03-13

### Bug Fixes

- Replace Unicode bar chart characters with ASCII-safe chars in `asm stats` output

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.6.0...v1.6.1

## v1.6.0 — 2026-03-13

### Features

- Overhaul CLI output with grouped views, provider colors, and visual stats
- Improve inspect output with grouped multi-provider view

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.5.1...v1.6.0

## v1.5.1 — 2026-03-12

### Bug Fixes

- Improve batch install UX and replace Unicode with ASCII-safe chars

**Full Changelog**: https://github.com/luongnv89/agent-skill-manager/compare/v1.5.0...v1.5.1
