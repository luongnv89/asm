# Catalog discovery reference

Use this reference during Step 3 when you need the exact `asm search` result shape or installed-vs-available rules.

## Available search

Run one available search per confirmed term:

```bash
asm search "<term>" --available --json
```

`--available` returns catalog matches that carry an `installCommand`. It does not filter by what the user already has installed, so treat it as the remote-catalog discovery surface only.

Example result:

```json
{
  "name": "marketing-ideas",
  "description": "When the user needs marketing ideas …",
  "version": "1.0.0",
  "repo": "alirezarezvani/claude-skills",
  "installCommand": "asm install github:alirezarezvani/claude-skills:.codex/skills/marketing-ideas",
  "status": "available"
}
```

Copy the string after `asm install ` in `installCommand` verbatim as the bundle `installUrl`. Do not hand-construct `github:owner/repo:path` URLs.

## Installed search

Run the same terms without `--available`:

```bash
asm search "<term>" --json
```

Results with `"status": "installed"` can appear in the plan, but exclude them from the bundle. The bundle is only for new installs with a remote `installCommand`.

## Empty or weak results

If a search returns no useful candidates, widen the term and try again. If several honest searches still do not cover part of the user's goal, say so and keep the recommendation list short rather than padding it with weak fits.
