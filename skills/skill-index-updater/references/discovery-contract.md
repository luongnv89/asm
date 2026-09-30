# Discovery worker contract (Step 2)

The context slice for the Step 2 worker: clone **one** repository to a temp
directory and report every skill in it. The main agent dispatches one worker per
repo and keeps only the JSON below — it never opens this file.

Spawn the worker with this contract as its prompt, substituting `<owner>` and
`<repo>`.

## Role

You are a repository discovery worker for the ASM curated skill index. You clone
one GitHub repo and report the skills it contains. You index nothing, evaluate
nothing, and write nothing outside your own temp directory.

## Context

`discoverSkills` (used by `asm index ingest` and `npm run preindex`) indexes a
**root** `SKILL.md` when present **and** keeps scanning subdirectories for more.
A repo with both root and nested skills must list every one of them — not only
the root. Replicate that behavior exactly; the index entry is built from what you
return.

## Task

1. Clone the repo shallow into a fresh temp directory:

```bash
TEMP_DIR=$(mktemp -d)
git clone --depth 1 "https://github.com/<owner>/<repo>.git" "$TEMP_DIR/<repo>"
```

2. Find every SKILL.md, at most 5 levels deep — matching ASM's `discoverSkills`:

```bash
find "$TEMP_DIR/<repo>" -maxdepth 5 -name "SKILL.md" -type f
```

Each hit is the `SKILL.md` **file**; the skill is its **parent directory**.
Record that directory, relative to the clone root, as the skill's `relPath` —
the Output section below pins that value.

3. Parse each file's YAML frontmatter and extract `name` (required),
   `description` (required), `version` (defaults to `"0.0.0"`), `license`,
   `creator`, `compatibility`, and `allowed-tools` / `allowedTools`.

## Input

- `owner` and `repo`, normalized by Step 1.
- Nothing else. You do not receive the resources JSON, the existing index files,
  or any other worker's results.

## Output

Return exactly this JSON, and nothing else — no prose, no summary:

```json
{
  "owner": "...",
  "repo": "...",
  "tempRoot": "/abs/path/to/temp",
  "clonePath": "/abs/path/to/temp/<repo>",
  "status": "ok | clone-failed | no-skills",
  "error": "message when status is clone-failed, otherwise empty",
  "skills": [
    {
      "relPath": "relative/path/to/skill",
      "name": "...",
      "description": "...",
      "version": "0.0.0",
      "license": "",
      "creator": "",
      "compatibility": "",
      "allowedTools": []
    }
  ]
}
```

Both paths are load-bearing, and both are absolute and always present — even on a
failure. The main agent's shell has no `$TEMP_DIR`, so these fields are the only way
the paths reach the rest of the pipeline:

- `tempRoot` is your `mktemp -d` value verbatim. Cleanup deletes exactly this
  directory; it never derives a path from `clonePath`, because a derived `rm -rf`
  target is one layout change away from the system temp root.
- `clonePath` is where the Step 3 worker runs `asm eval`.

`relPath` is pinned just as tightly. It is the skill's **directory** — the parent
of the discovered `SKILL.md`, never the file itself — expressed **relative to
`clonePath`**, which is the repo root. A root-level `SKILL.md` gives `""`. That
one value is what the index entry's `relPath` field stores verbatim, what
`installUrl` appends as `github:{owner}/{repo}:{relPath}` (a root skill omits the
`:` and the path entirely), and what Step 3 joins with `clonePath` to reach the
skill on disk. Base it anywhere else — at `tempRoot`, or with the clone directory
name still prefixed — and `data/skill-index/{owner}_{repo}.json` ships a broken
`installUrl` that fails `asm install` for every skill in the repo.

## Constraints

- Do NOT delete your temp directory — Step 3 still needs the clone.
- Do NOT run `asm eval`, `npm run preindex`, or any catalog build; Steps 3 and 7
  own those.
- Do NOT modify anything in the ASM repo.
- Do NOT ask questions. A clone failure is a `status`, not a stop; a repo with no
  SKILL.md is `status: "no-skills"` with an empty `skills` array, not an error.
