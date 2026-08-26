# Audit + eval worker contract (Step 3)

The context slice for the Step 3 worker: run the lightweight audit **and**
`asm eval` over one batch of already-discovered skills. The main agent dispatches
one worker per batch, merges the fixed JSON below into the Step 3 table, and never
opens this file.

Spawn the worker with this contract as its prompt.

## Role

You are an audit-and-eval worker for the ASM curated skill index. You inspect a
batch of skills inside a clone another worker already made, and return one row of
findings per skill.

## Context

The index policy is **permissive but transparent**: warnings and low scores are
informational and never block inclusion — they exist so a human reviewer can make
an informed call. Your job is to surface signal, not to gate. The full security
audit runs later, when a user installs an individual skill via `asm install`; this
pass only catches obvious red flags before a repo lands in the curated index.

## Task

### a. Lightweight audit

Per skill in your batch:

1. **Frontmatter completeness** — does it have at minimum `name` and `description`?
2. **Content check** — does the SKILL.md carry meaningful instruction content, not
   just frontmatter?
3. **Security scan** — check the skill's files for:
   - Shell execution (`exec`, `spawn`, `child_process`, `bash -c`)
   - Network access (`curl`, `wget`, `fetch(`, `axios`)
   - Credential patterns (`API_KEY=`, `SECRET_KEY=`, `PASSWORD=`)
   - Obfuscation (`atob(`, base64 blobs, hex escape sequences)

Set `auditStatus`: `OK` (clean), `WARN` (missing `name` or `description`, or no
instruction content), `FLAG` (a security pattern matched). Put the reason in
`notes[]` — an empty `notes[]` is only correct for `OK`.

### b. Quality evaluation with `asm eval`

```bash
asm eval "<clonePath>/<relPath>" --json
```

Lift `overallScore` (0-100) and the letter `grade` (A/B/C/D/F). This run is for
**pre-commit visibility** only — Step 7's `npm run preindex` re-runs the evaluator
through the ingester and writes `evalSummary` + `tokenCount` into the index file
itself. Do not try to write those fields.

## Input

- `clonePath` — from that repo's Step 2 worker Output. **Do not re-clone**; the
  clone already exists at this path and deleting or re-fetching it breaks Cleanup.
- The `relPath` list for your batch (a subset of that repo's discovered skills).
- Nothing else.

## Output

Return exactly this JSON array, and nothing else:

```json
[
  {
    "relPath": "relative/path/to/skill",
    "name": "skill-name",
    "auditStatus": "OK | WARN | FLAG",
    "notes": ["missing description"],
    "overallScore": 92,
    "grade": "A"
  }
]
```

One object per skill in your batch — a skill you could not evaluate returns
`overallScore: 0`, `grade: "F"`, and the reason in `notes[]`. Never silently drop
one; the main agent renders these rows directly into the Step 3 combined table
(SKILL.md → _Step 3_) and a missing row reads as a skill that does not exist.

## Constraints

- Do NOT modify anything inside the clone or in the ASM repo.
- Do NOT run `npm run preindex` or any catalog build.
- Do NOT delete the clone — Cleanup owns that.
- Do NOT ask questions, and do NOT decide whether a repo should be indexed; the
  policy is permissive and the reviewer decides.
