# CLAUDE.md

`agent-skill-manager` (`asm`) — a TypeScript CLI plus ink/React TUI that manages
Agent Skills installed for Claude Code, Codex, Gemini, and OpenClaw.

## Critical commands

```bash
npm install          # postinstall no-ops when CI or ASM_SKIP_POSTINSTALL is set
npm run build        # tsx scripts/build.ts -> dist/ (gitignored)
CI=true npm test     # unit suite — the command of record
npm run test:coverage  # v8 coverage for src/ — measurement only, no fail gate
npm run typecheck    # tsc --noEmit
npm run lint:site    # eslint over website-src/src
npm run test:e2e     # tests/e2e/ — NOT covered by `npm test`
npm start            # run the TUI from source
```

`npm test` is `vitest run src/`, and that argument is a **substring filter on the
test path**, not a directory — `website-src/src/__tests__/` matches it too, so
`npm run test:site` is a subset of `npm test`, not a separate leg. Only
`tests/e2e/` is excluded. Measured timings and evidence: `docs/AGENT_ENVIRONMENT.md`.

`npm run test:coverage` is `vitest run --coverage src/` with
`@vitest/coverage-v8` (2.x, matching current vitest). It reports line and
branch percentages for `src/` product files only (test files excluded). There
is **no coverage threshold and no CI fail gate** — measurement before
improvement (F-TEST-003 / #438).

**Coverage baseline** (2026-08-19, `src/`, v8, `CI=true npm run test:coverage`,
2113 tests):

- Lines: **60.61%** (12598/20783)
- Branches: **82.52%** (3406/4127)

M3's coverage target is bound to **`max(60%, baseline + 20pp)`**:

- Lines: `max(60%, 80.61%)` = **80.61%**
- Branches: `max(60%, 102.52%)` = **100%** (formula saturates at 100)

Node and npm must satisfy `package.json` `engines` — node `">=18 <23"`, npm
`">=9"`. Mind the upper bound: `CONTRIBUTING.md` and `docs/DEVELOPMENT.md` still
state a floor with no ceiling, and `engines` is the one that is correct.

## Architecture map

- `bin/agent-skill-manager.ts` — entry point: args go to `src/cli.ts`, none to the TUI.
- `src/cli.ts` — ~30 `cmd*` handlers, all output through `src/formatter.ts`.
- `src/index.tsx` + `src/views/` — the ink/React TUI.
- `src/*.ts` — one module per domain (scanner, installer, auditor, skill-index, …),
  each with its `*.test.ts` beside it.
- `data/skill-index/` — committed per-repo index JSON; generated, never hand-edited.
- `website-src/` — site source; `website/` — its published output.
- `scripts/` — build, preindex, catalog generation.
- Detail: `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`.

## Hard rules

- **YOU MUST NOT run `npm run preindex`, `npm run build:website`, or
  `npm run refresh:repo-bundles` as a probe.** They rewrite tracked files under
  `data/skill-index/` and `website/`. Run them only when regenerating the catalog
  is the point of the change, then review the diff.
- **IMPORTANT: `npm run preindex` also rewrites the developer's real
  `~/.config/agent-skill-manager/skill-index/`** — a mutation no git diff shows.
- **Unit tests sandbox user state.** `src/test-setup.ts` (vitest `setupFiles`)
  sets `HOME`, `USERPROFILE`, and `ASM_CONFIG_DIR` to a temp dir. `getConfigDir()`
  in `src/config.ts` reads `ASM_CONFIG_DIR` (fallback `~/.config/agent-skill-manager`).
  Do not remove that setup — without it the suite writes the real user config.
- **IMPORTANT: `CI=true` does not itself isolate the suite**; hermeticity is the
  env override + lazy `getConfigDir()`, not the `CI` flag.
- Never commit `dist/` or `node_modules/`. Most of `website/` is gitignored, but its
  `*-stats.json` and `robots.txt` are tracked — commit those only on a deliberate regeneration.
- Never delete or rewrite untracked scratch files at the repo root; other sessions
  own them.
- Conventional Commits; branch from `main` as `<type>/<issue>-<description>`; PR
  into `main`.

## Workflow preferences

- Iterate with the narrowest runner — `npx vitest run src/<module>.test.ts` — and
  run `CI=true npm test` only before pushing.
- Run `npm run typecheck` after a series of edits; do not wait for the commit hook.
- Change `src/<name>.ts` and its `src/<name>.test.ts` together.
- Install both hook stages; a plain `pre-commit install` silently skips pre-push:
  `pre-commit install --hook-type pre-commit --hook-type pre-push`.
- Prettier runs on commit — do not hand-format markdown, TS, or JSON to match it.
- Keep changes minimal and scoped to the task; do not opportunistically refactor.

## Token Efficiency

- Never re-read files you just wrote or edited. You know the contents.
- Never re-run commands to "verify" unless the outcome was uncertain.
- Don't echo back large blocks of code or file contents unless asked.
- Batch related edits into single operations. Don't make 5 edits when 1 handles it.
- Skip confirmations like "I'll continue..." Just do it.
- If a task needs 1 tool call, don't use 3. Plan before acting.
- Do not summarize what you just did unless the result is ambiguous or you need additional input.
