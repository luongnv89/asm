# Threat model — agent-skill-manager (`asm`)

## What this project does and where untrusted input enters

`asm` is a Node.js/TypeScript CLI (`dist/agent-skill-manager.js`, bin `asm`) plus an ink/React TUI that discovers, installs, updates, audits, exports and removes "Agent Skills" — directories containing a `SKILL.md` (YAML frontmatter + markdown) and optional `scripts/` — for Claude Code, Codex, Gemini and OpenClaw. It runs locally as the invoking user; there is no server component.

Treat the following as attacker-controlled:

- **Skill sources** passed to `asm install`, `asm get` and `asm index ingest` (`src/installer-core.ts`): `https://github.com/<o>/<r>[/tree/<ref>/<path>]`, `github:<o>/<r>[#ref][:subpath]`, local paths, and bare names resolved through the registry. The entire content of the fetched repository (file names, symlinks, `SKILL.md` frontmatter, `scripts/`, nested directories) is untrusted.
- **Registry index** fetched from `raw.githubusercontent.com/luongnv89/asm-registry` (`src/registry.ts`) and GitHub API responses (`src/repo-stars.ts`, `src/security-auditor-scan.ts`).
- **Files a user is handed by someone else**: import manifests (`asm import`, `src/importer.ts`), bundle files (`src/bundler.ts`), skill-index and repo-bundle JSON (`src/skill-index.ts`, `src/repo-bundles.ts`), lock-file entries (`src/library-core.ts`, `src/updater-updates.ts`).
- **YAML frontmatter** parsed with the `yaml` package (`src/utils/frontmatter.ts`, `src/health.ts`, `src/eval/`).

Trusted: the invoking user's CLI arguments other than the source/manifest values above, environment variables (including `$EDITOR`), and `~/.config/agent-skill-manager/config.json`.

## Security goals

1. **Installing, inspecting, auditing, evaluating, exporting or importing a skill must not execute code from that skill.** Skill content is executed only when an agent later chooses to run it.
2. **No writes, deletes, renames or symlinks outside the intended skill directory** (provider skill dirs, `~/.config/agent-skill-manager/`, temp dirs) as a result of untrusted names, refs, subpaths, manifest fields, archive/repo entries or symlinks.
3. **No reads outside the skill directory** whose content is then displayed, exported, or written elsewhere (e.g. via symlinks followed during scanning or copying).
4. **No argument or option injection** into `git`, `npm`, `npx` or other spawned processes from untrusted refs, URLs or paths. (All spawns are argv-style; there is no `shell: true`.)
5. **The security auditor (`asm audit security`, `src/security-auditor-scan.ts`) should not be trivially bypassable** in ways that make a malicious skill report as clean — lower priority than 1–4.

## Components that matter most / least

- Most: `src/installer-core.ts`, `src/installer-link.ts`, `src/installer.ts`, `src/commands/install-*.ts`, `src/importer.ts`, `src/uninstaller.ts`, `src/library-core.ts`, `src/updater-*.ts`, `src/registry.ts`, `src/bundler.ts`, `src/utils/fs.ts`, `src/utils/spawn.ts`, `src/utils/frontmatter.ts`.
- Medium: `src/security-auditor-scan.ts`, `src/evaluator-*.ts` and `src/eval/` (they read skill content and run linters such as `shellcheck` / `python3 -m py_compile` on skill files), `src/linker.ts`, `src/exporter.ts`.
- Least: TUI rendering in `src/views/` and `src/index.tsx`, formatting (`src/formatter*.ts`).
- Out of scope: `website-src/`, `website/`, `scripts/` (build/catalog/maintenance tooling), `security/`, `skills/` (first-party example skills, not shipped), `data/skill-index/` (generated static data), `tests/`, `*.test.ts(x)`, and test helpers (`src/test-setup.ts`, `src/cli-test-harness.ts`, `src/utils/test-spawn.ts`, `src/*-test-fixtures.ts`).

## How to exercise it

- The image has `asm` on `PATH` (built to `/src/dist/`, `npm link`ed) plus `git`, `node`, `npm` and `python3`.
- No network during the scan: build a malicious skill as a **local directory or local git repo** and pass its path (`asm install ./evil-skill --yes`, `asm import manifest.json`, `asm bundle install bundle.json`). Set `HOME` / `ASM_CONFIG_DIR` to a temp dir to keep runs isolated.
- Unit tests: `cd /src && npm test` (vitest; sandboxes `HOME` and `ASM_CONFIG_DIR` via `src/test-setup.ts`). Narrow runs: `npx vitest run src/<module>.test.ts`. Do not run `npm run test:e2e`, `npm run preindex`, `npm run build:website` or `npm run refresh:repo-bundles` (network / rewrite tracked data).

## How you rate severity

- **Critical**: code execution, or arbitrary file write/delete outside the skill directory, triggered by installing/importing/updating a skill or manifest with default flags and no prompt beyond the normal install confirmation.
- **High**: the same, but requiring a non-default flag (e.g. `--force`) or an extra user step that a reasonable user would take; arbitrary file read with exfiltration into exported/displayed output; option injection into `git`/`npm`.
- **Medium**: writes/deletes confined to the user's own skill directories but to the wrong skill; symlink loops or inputs causing unbounded recursion/hangs (DoS of the CLI); auditor bypasses.
- **Low**: crashes on malformed input with no further impact, information disclosure of non-sensitive local paths, terminal escape sequences in displayed skill metadata.

## Reports and patches

- Include a minimal malicious skill (directory tree or script that creates it) and the exact `asm` command.
- Patches should follow existing style, include a vitest test beside the module (`src/<name>.test.ts`), and pass `npm run typecheck` and `npm test`.

## Anything to leave alone

- Behaviour that only happens when the user explicitly runs skill code themselves, or when the user deliberately points `asm` at a trusted local path they control.
- `$EDITOR`/`$VISUAL` being executed by `asm config edit` — that is intended.
- Dependency CVEs in devDependencies that are not reachable from the shipped CLI.
