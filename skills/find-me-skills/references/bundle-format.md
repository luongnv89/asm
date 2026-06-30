# Bundle format reference

Use this reference during Step 6 when writing and checking the installable bundle.

## Why bundle install

Use `asm bundle install <file>` for a recommended set of skills. `asm install <file>` expects one skill source, and `asm import` restores backups of already-installed skills.

## Required shape

```json
{
  "version": 1,
  "name": "marketing-starter",
  "description": "Skills to market a new app from scratch: positioning, landing page, and launch copy.",
  "author": "find-me-skills",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "tags": ["marketing", "launch"],
  "skills": [
    {
      "name": "marketing-context",
      "installUrl": "github:alirezarezvani/claude-skills:.codex/skills/marketing-context",
      "description": "Create the positioning brief other marketing skills read first"
    }
  ]
}
```

## Validation rules

- `version` must be the number `1`.
- `name`, `description`, `author`, and `createdAt` must be non-empty strings.
- `createdAt` must be ISO-8601; generate it with `date -u +%Y-%m-%dT%H:%M:%S.000Z`.
- `skills` must be non-empty.
- Each skill needs `name` and `installUrl`; `description` is optional but recommended.
- `installUrl` must be the raw source part after the leading `asm install ` prefix in the `installCommand` returned by `asm search --available --json` (for example, `github:owner/repo:path`), not the full command.
- Exclude already-installed skills and invented URLs.

## Final check

```bash
asm bundle show ./marketing-starter.bundle.json
```

If the check fails, fix the named field and re-run it before handing the install command to the user.
