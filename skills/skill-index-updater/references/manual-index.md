# Manual index file (Step 7 fallback)

Use this only for a repo whose Step 7 `index ingest` failed. A hand-built file
bypasses the ingester, so name every manually generated repo in the Step 9
summary under **Uncertainty**.

Create `data/skill-index/{owner}_{repo}.json` with this structure, one `skills[]`
entry per skill from that repo's Step 2 worker result:

```json
{
  "repoUrl": "https://github.com/{owner}/{repo}.git",
  "owner": "{owner}",
  "repo": "{repo}",
  "updatedAt": "{ISO timestamp}",
  "skillCount": N,
  "skills": [
    {
      "name": "skill-name",
      "description": "Skill description from frontmatter",
      "version": "0.0.0",
      "license": "",
      "creator": "",
      "compatibility": "",
      "allowedTools": [],
      "installUrl": "github:{owner}/{repo}:{relPath}",
      "relPath": "{relPath}",
      "tokenCount": 0,
      "evalSummary": {
        "overallScore": 0,
        "grade": "F",
        "categories": [
          { "id": "structure", "name": "Structure & completeness", "score": 0, "max": 10 }
        ],
        "evaluatedAt": "{ISO timestamp}",
        "evaluatedVersion": "0.0.0"
      }
    }
  ]
}
```

Field sources:

- `name`, `description`, `version`, `license`, `creator`, `compatibility`,
  `allowedTools`, `relPath` — copy verbatim from the Step 2 worker JSON.
- `installUrl` — `github:{owner}/{repo}:{relPath}`. A root-level skill has an
  empty `relPath`; its `installUrl` is `github:{owner}/{repo}` with no trailing `:`.
  A wrong `installUrl` breaks `asm install` for that skill.
- `evalSummary` and `tokenCount` — run `asm eval <clonePath>/<relPath> --json`
  (for a root skill, the path is just `clonePath`) and lift `overallScore`,
  `grade`, `categories`, and `evaluatedAt` into the entry.
- `skillCount` — the length of `skills[]`.

Verify with `jq empty data/skill-index/{owner}_{repo}.json` before continuing to Step 8.
