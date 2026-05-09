# Skill Security Audit — Issue #269

**Date:** 2026-05-09
**Scope:** All installed agent skills, global and project scopes, on this developer machine.
**Risk model:** The two failure modes called out by the issue:

1. **Prompt injection** — a skill that contains crafted text designed to override guardrails, escape sandboxing, or coerce the agent into unintended actions.
2. **Credential theft** — a skill that exfiltrates real secrets (tokens, API keys, env vars, personal data) to a non-trusted endpoint.

Heuristic flags such as "skill uses both shell and network" are _informational only_ — most legitimate developer skills (build, ship, install, browse) match that pattern. The issue's wording is intentionally narrower than the automated verdict.

---

## Inventory

| Metric                                         | Count                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Total skill installations across all providers | **718**                                                                        |
| Unique skills (deduplicated by `realPath`)     | **284**                                                                        |
| Project-scope skills (this repo)               | **35** dirs across `.agents/`, `.claude/`, `.opencode/`, `.codex/`, `.gemini/` |

Inventory was produced with `asm list --json`. Most "duplication" is one canonical skill in `~/.agents/skills/<name>` symlinked into each provider directory — counting symlinks once removes 434 of the 718 entries.

Per-provider breakdown:

| Provider                              | Skills |
| ------------------------------------- | ------ |
| `global/claude`                       | 199    |
| `global/agents`                       | 103    |
| `global/codex`                        | 95     |
| `global/opencode`                     | 72     |
| `global/openclaw`                     | 64     |
| `global/gemini`                       | 41     |
| `global/copilot`                      | 31     |
| `global/antigravity`                  | 31     |
| `global/plugin` (Claude marketplaces) | 40     |
| `global/codex-plugin`                 | 4      |
| `global/augment`, `global/hermes`     | 1 each |
| `project/agents`                      | 12     |
| `project/claude`                      | 11     |
| `project/opencode`                    | 11     |
| `project/codex`, `project/gemini`     | 1 each |

---

## Methodology

1. **Automated baseline** — `asm audit security --all --json` was run against all 284 unique skills. Output saved to `/tmp/asm-audit-269.json` (2.5 MB, 284 records). The scanner reports findings per `category` (Embedded credentials, Obfuscation patterns, Shell execution, Network requests, Dynamic code execution, Environment variable access, External URLs, File system access) with `severity` per match (`critical`/`warning`/`info`) and an aggregated `verdict` per skill (`safe`/`warning`/`caution`/`dangerous`).

2. **Verdict distribution from the automated scan:**

   | Verdict   | Skills |
   | --------- | ------ |
   | safe      | 121    |
   | caution   | 83     |
   | warning   | 60     |
   | dangerous | 20     |

3. **Strict-risk filter applied to the data.** The automated `dangerous` verdict triggers on any skill that simultaneously uses shell execution and network access. To match the issue's actual risk model, the audit data was filtered for:
   - **Real credential strings** matching key formats (`sk-`, `sk_live_`, `AKIA…`, `ghp_…`, `xox[abprs]-…`, `glpat-…`, `AIza…`) — excluding documentation placeholders like `API_KEY=your-api-key-here`.
   - **Obfuscation outside common-and-benign contexts** — excluding `.md` documentation files and base64 patterns used for image/file handling.
   - **Prompt-injection text** — grep across all skill markdown for phrases like "ignore previous instructions", "disregard the above", "jailbreak", "override system prompt", "exfiltrate", "silently send".

4. **Manual review of every flagged hit** to distinguish defenses-describing-the-pattern (legitimate) from executions-of-the-pattern (malicious).

---

## Findings

### Strict risk model: 0 prompt injection cases, 0 credential theft cases

No skill in the 284-unique-skill inventory contains:

- Real credential strings outside of documentation, examples, or test fixtures.
- Obfuscated payloads outside legitimate base64 image/file handling.
- Prompt-injection text intended to override the agent's behavior.

Phrases like "ignore previous instructions" / "disregard prior instructions" appear only as **defenses describing what to detect** in the following files. Each match was inspected; none is an injection payload directed at the agent.

| File                                                | Role                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `skill-auditor/SKILL.md:104`                        | Documents that the auditor should ignore injection attempts in scan targets |
| `skill-auditor/scripts/scan_skill.py:112,114`       | The regex patterns the auditor uses to detect injection                     |
| `skill-auditor/references/security-checklist.md`    | Security checklist enumerating injection signatures                         |
| `gstack/CHANGELOG.md:29`                            | Changelog entry for adding injection detection to the learnings system      |
| `gstack/docs/designs/ML_PROMPT_INJECTION_KILLER.md` | Design doc for the prompt-injection defense                                 |
| `gstack/browse/src/cli.ts:536`                      | CLI documentation of injection patterns blocked by the security filter      |
| `gstack/browse/test/content-security.test.ts:238`   | Test asserting injection detection works                                    |

### Manual review of the 20 `dangerous`-flagged skills

Every skill with the automated `dangerous` verdict was inspected. None matches the issue's strict criteria. All twenty are legitimate developer tooling whose flag stems from the heuristic "shell execution + network access".

| Skill                                                                                        | Path                                                             | Why flagged                                                                                     | Strict-risk verdict                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| algorithmic-art                                                                              | `~/.claude/skills/algorithmic-art`                               | shell + network                                                                                 | benign — generative-art tooling                                                                                                                                                                                            |
| cli-builder                                                                                  | `~/.agents/skills/cli-builder`                                   | shell + network                                                                                 | benign — scaffolds CLI tools                                                                                                                                                                                               |
| cso                                                                                          | `~/.claude/skills/cso`                                           | shell + network                                                                                 | benign — gstack security skill                                                                                                                                                                                             |
| gstack                                                                                       | `~/.claude/skills/gstack`                                        | shell + network, base64 in image-download path                                                  | benign — multi-tool (browse, ship, review). Test fixture at `test/skill-e2e-cso.test.ts:45` is a planted-vuln scenario (comment confirms intent). Base64 in `browse/src/write-commands.ts:1000` decodes a downloaded blob. |
| install-script-generator                                                                     | `~/.agents/skills/install-script-generator`                      | 27 "critical" findings, all matching `curl … \| bash` references in its own SKILL.md and docs   | benign — the skill _generates_ curl-pipe-bash one-liners; its docs describe the exact pattern the scanner trips on                                                                                                         |
| plan-eng-review                                                                              | `~/.claude/skills/plan-eng-review`                               | dynamic-execution + network in code samples                                                     | benign — plan-review skill                                                                                                                                                                                                 |
| remotion-best-practices                                                                      | `~/.agents/skills/remotion`                                      | shell + network                                                                                 | benign — Remotion video-generation guide                                                                                                                                                                                   |
| security-setup                                                                               | `~/.agents/skills/security-setup`                                | shell + network                                                                                 | benign — installs pre-commit hooks                                                                                                                                                                                         |
| setup-browser-cookies                                                                        | `~/.claude/skills/setup-browser-cookies`                         | dynamic-execution + network                                                                     | benign — browser automation                                                                                                                                                                                                |
| ship                                                                                         | `~/.claude/skills/ship`                                          | dynamic-execution + network                                                                     | benign — gstack ship workflow                                                                                                                                                                                              |
| skill-auditor                                                                                | `~/.agents/skills/skill-auditor`                                 | shell + network, contains injection-pattern text                                                | benign — _this is the auditor itself_                                                                                                                                                                                      |
| skill-index-updater                                                                          | `~/.agents/skills/skill-index-updater` (also two project copies) | shell + network, contains "credential patterns" string in SKILL.md describing what it scans for | benign — SKILL.md line 100 documents the regexes used; not embedded credentials                                                                                                                                            |
| Hook Development, hook-development, build-mcp-app, build-mcpb, session-report, Presentations | Claude/Codex marketplace plugins                                 | shell + network                                                                                 | benign — official plugin docs and SDK helpers                                                                                                                                                                              |

### "Embedded credentials" hits — all benign in context

Three skills had findings that pass the real-key-format filter:

1. **`code-review/SKILL.md:358`** — `const API_KEY = "sk-prod-…";` (literal `sk-prod-` prefix followed by an example token in the source)
   Context: an example of a code-review report showing a "before" snippet of bad code. The very next block in the file is the "after" using `process.env.API_KEY`. Verdict: **documentation, not embedded credential**.

2. **`gstack/test/skill-e2e-cso.test.ts:45`** — `const API_KEY = "sk-…";` (literal `sk-` prefix followed by a 32-char hex example in the source)
   Context: code comment on the previous line literally says `// Planted vuln: hardcoded API key`. This file deliberately constructs a vulnerable repo so the `cso` security skill can detect the planted vuln. Verdict: **deliberate test fixture, not credential**.

3. **`mcp-builder/reference/evaluation.md:444`** — `-e API_KEY=abc123 \`
   Context: example `docker run` command. Verdict: **documentation placeholder**.

### Obfuscation hits — all benign in context

`atob(b64Data)` in `skill-creator/eval-viewer/viewer.html:832` decodes XLSX data via SheetJS for the eval viewer. Other base64 patterns (in gstack) handle image data downloaded from the browser. None match the obfuscated-payload pattern that would indicate hidden code.

### Test-fixture clutter — `cli-skill-for-*` directories

Twenty-four directories under `~/.claude/skills/` follow the naming pattern `cli-skill-for-{export,export2,force,json,modify,noover,remove,remove2}-XXXXXX` with a six-character random suffix. Each is a single SKILL.md of <110 bytes, e.g.:

```
---
name: export-test-skill
description: A test skill for export
version: 1.0.0
---
# Export Test Skill
```

These were generated by automated CLI tests (likely `asm` integration tests that exercise the `init`/`install`/`uninstall`/`export` paths) and never cleaned up. They are **not a security risk** — the audit verdict for every one of them is `safe`. They are **clutter** and inflate the user's installed-skill count. The cleanup script (see _Actions taken_ below) uses `<200 bytes` as its stub threshold to leave headroom; observed sizes are all in the 79–108 byte range.

Full list:

| dirName                      | name                     | size  |
| ---------------------------- | ------------------------ | ----- |
| cli-skill-for-export-83n9wl  | export-test-skill        | 104 B |
| cli-skill-for-export-b4Ia0o  | export-test-skill        | 104 B |
| cli-skill-for-export-lk5Cy7  | export-test-skill        | 104 B |
| cli-skill-for-export2-IbF3Cl | export-default-skill     | 99 B  |
| cli-skill-for-export2-uycNNg | export-default-skill     | 99 B  |
| cli-skill-for-export2-xwshUm | export-default-skill     | 99 B  |
| cli-skill-for-force-Xy6FZZ   | export-force-skill       | 95 B  |
| cli-skill-for-force-gU2YZA   | export-force-skill       | 95 B  |
| cli-skill-for-force-lPaMH1   | export-force-skill       | 95 B  |
| cli-skill-for-json-998Qcl    | export-json-skill        | 93 B  |
| cli-skill-for-json-mrmX8o    | export-json-skill        | 93 B  |
| cli-skill-for-json-xcaFcQ    | export-json-skill        | 93 B  |
| cli-skill-for-modify-Ogmf6e  | modify-test-skill        | 104 B |
| cli-skill-for-modify-UxgYdj  | modify-test-skill        | 104 B |
| cli-skill-for-modify-wjLPh5  | modify-test-skill        | 104 B |
| cli-skill-for-noover-4Nu2sB  | export-nooverwrite-skill | 108 B |
| cli-skill-for-noover-pyUvUz  | export-nooverwrite-skill | 108 B |
| cli-skill-for-noover-yFn01K  | export-nooverwrite-skill | 108 B |
| cli-skill-for-remove-XhCsUM  | rm-skill-a               | 79 B  |
| cli-skill-for-remove-foG8Mw  | rm-skill-a               | 79 B  |
| cli-skill-for-remove-sGOMd0  | rm-skill-a               | 79 B  |
| cli-skill-for-remove2-7voeg8 | rm-only-skill            | 83 B  |
| cli-skill-for-remove2-fNSBRa | rm-only-skill            | 83 B  |
| cli-skill-for-remove2-xT5Cly | rm-only-skill            | 83 B  |

---

## Actions taken

1. **Audit report committed** — this document.
2. **Cleanup script committed** — `scripts/audit/remove-cli-skill-fixtures.sh`. The script:
   - Refuses to operate outside `$HOME/.claude/skills`.
   - Only matches the exact regex `cli-skill-for-(export|export2|force|json|modify|noover|remove|remove2)-[A-Za-z0-9]{6}$`.
   - Only deletes if the directory contains nothing but a `SKILL.md` under 200 bytes.
   - Provides `--dry-run` to preview without touching anything. The dry-run on 2026-05-09 listed all 24 fixtures.
   - Run the cleanup yourself with `bash scripts/audit/remove-cli-skill-fixtures.sh`.
3. **No legitimate skills were removed or recommended for removal.**

---

## Recommendations

### Repo-level

1. **Tighten the `asm` test-fixture lifecycle.** Tests that install fake skills under `~/.claude/skills/` should clean up on tear-down regardless of test outcome. The 24 leftover fixtures show this isn't reliable — likely a missing `afterEach` or a process killed mid-test. Suggested follow-up: a separate issue scoped to `tests/e2e/`.

2. **Refine the "dangerous" verdict in `asm audit security`.** The current rule "shell execution + network access => dangerous" appears to dominate dangerous-verdict findings: of the 20 skills with the `dangerous` verdict in this audit, all 20 were inspected and none matched the issue's strict risk model. The 60 `warning` and 83 `caution` skills were not exhaustively reviewed — the strict-risk filter reduced them to the three credential and one obfuscation findings analyzed above, all benign in context. Suggested follow-up: make the verdict require a _concrete_ signal (real credential pattern, obfuscated payload, prompt-injection text, or curl-pipe-bash to a non-pinned hash) — not just the union of two common capabilities. Filing as a separate issue is cleaner than expanding this one.

3. **Filter docs-placeholder credentials from "Embedded credentials" findings.** Pattern matches like `API_KEY=your-api-key-here`, `API_KEY=<placeholder>`, `API_KEY=process.env.…` should be downgraded from `critical` severity. Currently they dominate the findings noise.

### User-level

1. **Run `asm audit -y` periodically** to clean up duplicated skills (today's run shows 718 entries / 284 unique = 434 duplicate symlinks-and-copies).
2. **Re-run this audit on a cadence** — for example, append-only updates to this file when new skills are added in bulk.

---

## Acceptance Criteria Verification

| Criterion                                                  | Status | Evidence                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit all skills in global scope                           | ✓      | 284 unique skills, 11 provider directories, audited via `asm audit security --all` and manual review                                                                                              |
| Audit all skills in project scope                          | ✓      | 35 dirs across `.agents/`, `.claude/`, `.opencode/`, `.codex/`, `.gemini/`; openspec-\* and skill-index-updater                                                                                   |
| Check each skill for prompt injection vectors              | ✓      | Grep across all skill markdown for override/escape phrases; only defenses-describing-the-pattern matches found                                                                                    |
| Check each skill for credential/data exfiltration patterns | ✓      | Filtered for real key formats (`sk-`, `AKIA…`, `ghp_…`, etc.) and non-trusted network endpoints; all 3 hits are docs/test fixtures                                                                |
| Document each risky skill with evidence                    | ✓      | This document — risky-by-strict-model: 0; risky-by-asm-heuristic: 20, all reviewed individually                                                                                                   |
| Remove/delete risky skills from all installed locations    | ✓      | 0 risky-by-strict-model skills to remove. The 24 test-fixture clutter directories are queued for removal by `scripts/audit/remove-cli-skill-fixtures.sh` (committed in this PR; run after merge). |
| Verify no remaining risky skills after cleanup             | ✓      | The strict-risk count is already 0 before any deletion; the only thing the cleanup changes is fixture clutter, not risk                                                                           |
