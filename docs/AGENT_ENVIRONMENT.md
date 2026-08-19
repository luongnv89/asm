# Agent Environment Notes

Verified install, build, and test commands for anyone — human or coding agent —
working in this repository, plus the two traps that are not obvious from
`package.json`.

Recorded on branch `chore/433-record-the-install-build-and-test`, base commit
`a46b652`, on 2026-08-19. Every result in the table below was observed by running the command,
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

## Commands of record

| Command             | Observed result                                                                                          | Wall time |
| ------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| `npm run build`     | **PASS** (exit 0) — `Built agent-skill-manager v2.15.0 (a46b652)`, `9 output(s) in dist/`                | ~1 s      |
| `CI=true npm test`  | **PASS** (exit 0) — Test Files `60 passed (60)`, Tests **`2100 passed (2100)`**, vitest Duration 90.72 s | ~91 s     |
| `npm run typecheck` | **PASS** (exit 0) — `tsc --noEmit`, no output                                                            | ~2 s      |
| `npm run lint:site` | **PASS** (exit 0) — eslint over `website-src/src/**/*.{js,jsx}`, no findings                             | ~1 s      |
| `npm run lint`      | **PASS** (exit 0) — eslint over `src/` via the root flat config (#439)                                   | ~3 s      |

`git status --porcelain` was unchanged before and after these commands — no tracked
modifications, and the same set of untracked scratch files either side.
`npm run build` writes only to `dist/`, which is gitignored.

### Two things `CI=true npm test` is not

1. **`CI` does not sandbox the suite.** The only consumer of that variable in
   this repo is `scripts/postinstall.cjs:20`; nothing under `src/`, `tests/`, or
   `vitest.config.ts` reads it. `CI=true` is the command of record because it
   matches how CI installs, not because it isolates anything. See the user-config
   trap below.
2. **`npm test` is not the whole suite — but it is wider than it looks.** It is
   `vitest run src/`, and that argument is a **substring filter on the relative
   test path**, not a directory. `website-src/src/__tests__/…` contains `src/`,
   so the site tests match too. The observed `60 passed (60)` is the 49 test
   files under `src/` (47 `*.test.ts` plus 2 `*.test.tsx`) and the 11 under
   `website-src/src/__tests__/` (`*.test.js` / `*.test.jsx`). Only the 6 files
   in `tests/e2e/` are excluded. Consequently `npm run test:site`
   (`vitest run website-src/`, those same 11 files) is a **subset** of
   `npm test`, not a separate leg — and CI needs no site-test job, since
   `npx vitest run src/` in the `unit-tests` job already covers those files. The genuinely
   separate runners are `npm run test:e2e` (`tests/e2e/`) and `npm run test:all`
   (unit + site + build + e2e).

### Baseline note

The 2026-08-19 modernization audit recorded **2099/2100 locally** and 2100/2100
in CI at commit `ad961d2`. This run observed **2100/2100 locally** at `a46b652`.
The difference is not a fix — it is the non-hermeticity described below. The test
that flips (`src/skill-index.test.ts`, "indexes emilkowalski/skills with expected
skills and install URLs") pins `emilkowalski/skills` to 11 named skills and reads
the _developer's_ `~/.config/agent-skill-manager/skill-index/` merged over the
bundled `data/skill-index/`. At `ad961d2` both the bundled file and the pin said
8 skills while this machine's ingested copy said 11, so the assertion failed; the
base commit `a46b652` (`chore(index): refresh indexed skill sources`) raised both
to 11, which happens to match what this machine has ingested — `cmp` reports the
user copy and `data/skill-index/emilkowalski_skills.json` byte-identical. The
assertion passes by coincidence of state, not because the test stopped reading
your home directory. A machine whose ingested index has drifted from the bundled
one will see 2099/2100. Do not read a local 2100/2100 as evidence of
hermeticity.

## Trap 1 — scripts that rewrite tracked files

Never run these as a casual probe. They are catalog-regeneration steps, not
build steps, and they overwrite files that are committed:

| Command                        | Rewrites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run preindex`             | the per-repo JSONs under `data/skill-index/` — up to **56 of the 57 tracked files**: it iterates only repos marked `enabled` in `data/skill-index-resources.json` (`scripts/preindex.ts:24-28`), and `github:luongnv89/asm` is disabled, so `luongnv89_asm.json` is never rewritten. **Also rewrites your real `~/.config/agent-skill-manager/skill-index/`**: `ingestRepo()` writes there first and `preindex` copies the result into `data/` (`scripts/preindex.ts:42-54`). That mutation shows in no git diff — see Trap 2 |
| `npm run refresh:repo-bundles` | the same directory: it walks **every** `*.json` in `data/skill-index/`, recomputes the `bundles` field, and writes back only the files whose serialization changed (`scripts/refresh-repo-bundles.ts:18-45`)                                                                                                                                                                                                                                                                                                                  |
| `npm run build:website`        | `scripts/build-catalog.ts` + `vite build`. Tracked outputs: `website/repo-stats.json`, `website/author-stats.json`, `website/index-stats.json` (all three carry a `generatedAt` timestamp, so every run produces a diff), and `website/robots.txt`                                                                                                                                                                                                                                                                            |

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

## Trap 2 — do not remove the unit-suite sandbox

F-TEST-001 (#436) is closed: in-process tests must not read or write the real
`~/.config/agent-skill-manager/`. Two pieces keep that true:

- `getConfigDir()` in `src/config.ts` reads `process.env.ASM_CONFIG_DIR`, falling
  back to `join(homedir(), ".config", "agent-skill-manager")`. Bundles and the
  registry cache default under that directory (or `ASM_REGISTRY_CACHE`).
- Vitest `setupFiles`: `src/test-setup.ts` points `HOME`, `USERPROFILE`, and
  `ASM_CONFIG_DIR` at a per-file temp dir _before_ any `src/` import. That also
  covers leftover `homedir()` sites (scanner, uninstaller, `~` expansion).

`src/utils/test-spawn.ts` still mirrors a redirected `HOME` onto `USERPROFILE`
for spawned CLI processes on Windows. `CI=true` still does not isolate anything
by itself — the env override does.

A regression looks like a test (or a removed `setupFiles` entry) resolving
config paths from the host `homedir()` again. Audit with
`getConfigDir() === process.env.ASM_CONFIG_DIR` and by hashing
`~/.config/agent-skill-manager` before and after `CI=true npm test`.

## Pre-commit hooks

`.pre-commit-config.yaml` defines hooks for two stages, but sets neither
`default_install_hook_types` nor `default_stages`. A plain `pre-commit install`
therefore installs the **commit stage only** — the pre-push hooks silently never
fire. To get both:

```bash
pre-commit install --hook-type pre-commit --hook-type pre-push
```

- **Commit stage:** the upstream `pre-commit-hooks` set (trailing-whitespace,
  end-of-file-fixer, check-yaml, check-json, check-added-large-files), the local
  security check, prettier, `tsc --noEmit`, and `npx vitest run src/`.
- **Push stage:** `npm run build`,
  `npx vitest run tests/e2e/node-e2e.test.ts` — plus everything above that is
  not pinned to the commit stage, which is most of it. Only `security-check` and
  `unit-tests` carry an explicit `stages: [pre-commit]`. prettier and
  `tsc --noEmit` declare no `stages:` here, and all five upstream hooks also run
  at push (trailing-whitespace, end-of-file-fixer and check-added-large-files
  declare `stages: [pre-commit, pre-push, manual]` in the upstream manifest;
  check-yaml and check-json declare none, which likewise means every stage).

The `unit-tests` hook runs the same non-hermetic suite described above, so on a
machine with a drifted skill index it can block a commit for a reason unrelated
to the change. Confirm the failure is the known baseline one before working
around it.

## See also

- `docs/DEVELOPMENT.md` — setup, debugging, project layout.
- `docs/ARCHITECTURE.md` — component breakdown and data flow.
