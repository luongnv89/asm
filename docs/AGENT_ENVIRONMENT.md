# Agent Environment Notes

Verified install, build, and test commands for anyone — human or coding agent —
working in this repository, plus the two traps that are not obvious from
`package.json`.

Recorded on branch `chore/433-record-the-install-build-and-test`, base commit
`a46b652`, on 2026-08-19. Every result below was observed by running the command,
not copied from another document. Re-verify after any dependency or toolchain
change.

## Node and npm

`package.json` `engines` reads, literally:

```json
"engines": {
  "node": ">=18 <23",
  "npm": ">=9"
}
```

That is the authoritative range: Node **>= 18 and < 23**, npm **>= 9**. Note the
**upper bound** — Node 23+ is outside the declared range.

- CI (`.github/workflows/ci.yml`) runs unit tests and both e2e jobs on a Node
  `18, 20, 22` matrix; the `build` job pins Node `22`.
- `docs/DEVELOPMENT.md` says "Node.js >= 18.0.0" with no upper bound. It is
  out of step with `engines`; treat `engines` as correct.
- **The measurements below were taken on Node `v26.7.0` / npm `11.19.0`** — above
  the supported ceiling. They all passed, but any disagreement between these
  numbers and a supported-Node run should be attributed to that first.

## Install

```bash
npm install     # or `npm ci` for a lockfile-exact install (what CI uses)
```

`postinstall` runs `node scripts/postinstall.cjs`. It short-circuits when
`ASM_SKIP_POSTINSTALL` or `CI` is set, or when the install is not global.

## The four commands of record

| Command             | Observed result                                                                                          | Wall time |
| ------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| `npm run build`     | **PASS** (exit 0) — `Built agent-skill-manager v2.15.0 (a46b652)`, `9 output(s) in dist/`                | ~1 s      |
| `CI=true npm test`  | **PASS** (exit 0) — Test Files `60 passed (60)`, Tests **`2100 passed (2100)`**, vitest Duration 90.72 s | ~91 s     |
| `npm run typecheck` | **PASS** (exit 0) — `tsc --noEmit`, no output                                                            | ~2 s      |
| `npm run lint:site` | **PASS** (exit 0) — eslint over `website-src/src/**/*.{js,jsx}`, no findings                             | ~1 s      |

`git status` was byte-identical before and after all four: none of them modify a
tracked file. `npm run build` writes only to `dist/`, which is gitignored.

### Two things `CI=true npm test` is not

1. **`CI` does not sandbox the suite.** The only consumer of that variable in
   this repo is `scripts/postinstall.cjs:20`; nothing under `src/`, `tests/`, or
   `vitest.config.ts` reads it. `CI=true` is the command of record because it
   matches how CI installs, not because it isolates anything. See the user-config
   trap below.
2. **`npm test` is not the whole suite.** It is `vitest run src/` — unit tests
   only. The other runners: `npm run test:site` (`website-src/`), `npm run
test:e2e` (`tests/e2e/`), and `npm run test:all` (unit + site + build + e2e).

### Baseline note

The 2026-08-19 modernization audit recorded **2099/2100 locally** and 2100/2100
in CI at commit `ad961d2`. This run observed **2100/2100 locally** at `a46b652`.
The difference is not a fix — it is the non-hermeticity described below. The test
that flips (`src/skill-index.test.ts`, "indexes emilkowalski/skills with expected
skills and install URLs") pins `emilkowalski/skills` to 11 named skills and reads
the _developer's_ `~/.config/agent-skill-manager/skill-index/` merged over the
bundled `data/skill-index/`. On this machine that user copy is currently
byte-identical to the repo's `data/skill-index/emilkowalski_skills.json`, so the
assertion holds by coincidence. A machine whose ingested index has drifted will
see 2099/2100. Do not read a local 2100/2100 as evidence of hermeticity.

## Trap 1 — scripts that rewrite tracked files

Never run these as a casual probe. They are catalog-regeneration steps, not
build steps, and they overwrite files that are committed:

| Command                        | Rewrites                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run preindex`             | `data/skill-index/*.json` — **57 tracked files**                                                                                                                                                                                            |
| `npm run refresh:repo-bundles` | files under `data/skill-index/`                                                                                                                                                                                                             |
| `npm run build:website`        | `scripts/build-catalog.ts` + `vite build`. Tracked outputs: `website/repo-stats.json`, `website/author-stats.json`, `website/index-stats.json` (each carries a fresh `generatedAt`, so every run produces a diff), and `website/robots.txt` |

Everything else `build:website` emits — `catalog.json`, `skills.min.json`,
`search.idx.json`, `skills/*.json`, `bundles.json`, `llms.txt`, `sitemap.xml`,
the built React bundle and copied assets — is gitignored, so it produces no diff.
`website/robots.txt` is rendered from `website-src/robots.txt`, which contains no
`{{TOKEN}}` placeholders; the rewrite is currently byte-identical and shows no
diff, but it is still an overwrite of a tracked file.

`website/data/acknowledgements.json` is tracked but is an **input**, not an
output — no script writes it.

If you need the catalog regenerated, do it deliberately and review the resulting
diff. Do not fold it into an unrelated change.

## Trap 2 — the unit suite writes to your real user config

`src/config.ts:16` computes `CONFIG_DIR` as `join(homedir(), ".config",
"agent-skill-manager")` with no environment or dependency-injection override, so
tests operate on the real directory. This is finding `F-TEST-001`.

Observed during the `CI=true npm test` run above, in
`~/.config/agent-skill-manager/`:

```
config.json                              (rewritten)
.skill-lock.json                         (rewritten)
registry-cache.json                      (rewritten)
.tmp/                                    (touched)
bundles/__test-modify-add-bundle__.json  (created by a test)
```

Consequences for an agent working here:

- A test run mutates developer state. Back the directory up before running the
  suite on a machine where that state matters.
- Local pass/fail is machine-dependent. Reproduce a disagreement in CI, or on a
  clean `~/.config/agent-skill-manager/`, before believing a local result.
- `CI=true` does **not** prevent any of this (see above).

This holds until the hermeticity work lands — modernization plan task 0.1,
tracked as issue #436. After that, the local bar becomes 2100/2100 on a machine
with a populated `~/.config/agent-skill-manager/`, and a run must leave the
directory byte-identical.

## Pre-commit hooks

`.pre-commit-config.yaml` (install with `pre-commit install`) gates two stages:

- **pre-commit:** local security check, prettier, `tsc --noEmit`, and
  `npx vitest run src/`.
- **pre-push:** `npm run build` and `npx vitest run tests/e2e/node-e2e.test.ts`.

The `unit-tests` hook runs the same non-hermetic suite described above, so on a
machine with a drifted skill index it can block a commit for a reason unrelated
to the change. Confirm the failure is the known baseline one before working
around it.

## See also

- `docs/DEVELOPMENT.md` — setup, debugging, project layout.
- `docs/ARCHITECTURE.md` — component breakdown and data flow.
