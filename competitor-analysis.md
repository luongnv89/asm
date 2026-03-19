# Competitor Analysis Report

**Our solution:** agent-skill-manager (`asm`) — v1.10.0
**Competitors:** [efx-ai-skills](https://github.com/electroheadfx/efx-ai-skills) (v0.2.0) | [skillshare](https://github.com/runkids/skillshare) (v0.17.4)
**Date:** 2026-03-18
**Focus:** Full solution
**Visibility:** Full source (both competitors are open-source)

---

## 1. Executive Summary

**skillshare** is the dominant competitor — 909 stars, 113 releases in 60 days, 55 supported agents, a full React web dashboard, deep security auditing with SARIF output, and cross-machine git-based sync. It is architecturally a Go monolith (~867 files) solving the sync/distribution problem at the system level. **efx-ai-skills** is early-stage (3 stars, 17 commits) with a polished Charmbracelet TUI and 9 providers, but poor repo hygiene (90MB with committed binaries) and limited testing. Our strongest advantage is npm-native distribution with zero install friction, a minimal dependency footprint (2 deps), and the deepest test coverage relative to codebase size (42% test:code ratio). Our biggest gap is supported agent count (4 vs. skillshare's 55) and the lack of cross-machine sync and web UI.

---

## 2. Comparison Table

| Dimension       |  Ours  | efx-ai-skills | skillshare |   Winner   | Key Difference                                                          |
| --------------- | :----: | :-----------: | :--------: | :--------: | ----------------------------------------------------------------------- |
| Architecture    | Strong |   Adequate    |   Strong   |    Tie     | Go binaries vs. npm package — tradeoffs in distribution vs. portability |
| Features        | Strong |   Adequate    |   Strong   | skillshare | 55 agents, web UI, git sync, backup/restore, operation log              |
| Code Quality    | Strong |     Weak      |  Adequate  |    Ours    | Strict TS, 2 deps, clean module separation; efx commits binaries to git |
| Performance     | Strong |   Adequate    |   Strong   |    Tie     | Go binary startup is faster; our Bun bundler is competitive             |
| Maintainability | Strong |     Weak      |  Adequate  |    Ours    | 42% test ratio, modular TS; skillshare has 46KB monolithic files        |
| Testing         | Strong |   Adequate    |   Strong   |    Tie     | We have 722 cases / 15 files; skillshare has 219 test files + red-team  |
| Documentation   | Strong |   Adequate    |   Strong   | skillshare | Dedicated docs site, JSON schemas, 107KB changelog                      |

**Overall:** Ours wins 2/7, skillshare wins 2/7, Tie on 3/7 — we are competitive on engineering quality but behind on feature breadth and ecosystem reach.

---

## 3. Our Advantages

- **npm-native distribution:** `npm i -g agent-skill-manager` is zero-friction for the JS/TS developer majority. Neither competitor publishes to npm. skillshare requires curl/brew; efx-ai-skills requires Go or manual binary download.
- **Minimal dependency footprint:** 2 production dependencies (`@opentui/core`, `yaml`) vs. skillshare's 7MB binary with 30+ transitive deps. Our attack surface and upgrade burden are minimal.
- **Code quality & test ratio:** Strict TypeScript, no `any` in public APIs, 722 test cases across 15 files (42% test:code ratio). efx-ai-skills has only 4 test files and committed binaries to git. skillshare has extensive tests but also 46KB monolithic command files.
- **Security scanning as first-class feature:** 26 regex-based code scan patterns with severity levels and verdict system. efx-ai-skills has no security scanning at all.
- **Pre-indexed skill data:** Bundled offline-searchable index shipped with the package — neither competitor offers this.
- **Lower contribution barrier:** TypeScript is more widely known than Go, making community contributions easier to attract.

---

## 4. Our Disadvantages

- **Agent coverage:** We support 4 agents out of the box. skillshare supports 55 (including Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot, etc.). efx-ai-skills supports 9. This is our largest gap.
- **No cross-machine sync:** skillshare offers `push`/`pull` commands for git-based skill sync across machines. We have no equivalent — users must reinstall on each machine.
- **No web dashboard:** skillshare ships a full React 19 + Vite web UI for visual skill management. We are terminal-only.
- **No update detection:** skillshare checks commit hashes against GitHub to detect outdated skills. efx-ai-skills also has update checking. We have no mechanism to notify users of available updates.
- **No backup/restore:** skillshare has a trash can with restore capability and full backup system. Our uninstall is destructive — once deleted, skills must be reinstalled.
- **No project-level team sharing:** skillshare's `.skillshare/` directory enables teams to commit skills alongside code. We scan project-level directories but don't have a team-sharing workflow.

---

## 5. Improvement Suggestions

### Quick Wins (Low effort, High impact)

1. **Expand provider targets to 15+** — Add Cursor, Windsurf, Cline, Roo Code, Continue, GitHub Copilot to `config.ts` default providers. Reference skillshare's `targets.yaml` for correct paths. Effort: Low (config-only change, ~2 hours).
2. **Add update checking** — Store install commit hash in a `.skill-lock.json` per skill. On `asm list` or `asm inspect`, compare against `git ls-remote` to flag outdated skills. Effort: Low (~1 day).
3. **Add `.skillignore` support** — Allow users to exclude files from skill scanning via gitignore-syntax file. Effort: Low (~0.5 day).

### Strategic Improvements (Medium-High effort)

1. **Cross-machine sync via git** — Add `asm push` / `asm pull` commands that use a user-configured git remote to sync the skill directory. skillshare proves this is the killer feature for multi-machine developers. Effort: Medium (~3-5 days).
2. **Web dashboard** — Add a local web UI served by Bun's built-in HTTP server. Use a lightweight framework (htmx or vanilla) rather than a full React app. Show skill inventory, search, install, audit results. Effort: High (~2 weeks).
3. **Backup/restore system** — Move uninstalled skills to `~/.config/agent-skill-manager/trash/` instead of deleting. Add `asm restore <name>` command. Effort: Medium (~2-3 days).
4. **External registry integration** — Add `asm search --registry` to query skills.sh and similar registries alongside our bundled index. Effort: Medium (~2-3 days).

---

## 6. Implementation Plan

| #   | Action                                            | Where                              | Effort  |
| --- | ------------------------------------------------- | ---------------------------------- | ------- |
| 1   | Add 10+ new providers to default config           | `src/config.ts`                    | 2 hours |
| 2   | Implement commit-hash-based update detection      | New `src/updater.ts` + `cli.ts`    | 1 day   |
| 3   | Add `.skillignore` file support to scanner        | `src/scanner.ts`                   | 0.5 day |
| 4   | Implement trash-based uninstall with restore      | `src/uninstaller.ts` + new command | 2 days  |
| 5   | Build git-based push/pull sync                    | New `src/sync.ts` + `cli.ts`       | 4 days  |
| 6   | Add external registry search (skills.sh, etc.)    | `src/skill-index.ts` + `cli.ts`    | 2 days  |
| 7   | Build lightweight web dashboard (Bun HTTP + htmx) | New `src/server/` + `ui/`          | 10 days |

**Estimated total effort:** ~20 person-days for all items. Items 1-3 can ship in the next release. Items 4-6 in the following release. Item 7 as a separate milestone.

---

_Report generated by competitor-analysis skill._
