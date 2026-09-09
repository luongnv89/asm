# Frontmatter Audit

The full Gate 1 checklist for SKILL.md frontmatter, plus the migration that converts `asm eval --fix` output into a layout `quick_validate.py` accepts.

The upstream rule source is `~/.claude/skills/skill-creator/references/frontmatter-rules.md` — re-check it when allowed-keys or YAML safety rules change.

## Mandatory checks (every audit)

| #   | Check                   | Pass criteria                                                                                                 |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Required fields         | `name` and `description` exist, non-empty strings                                                             |
| 2   | Name matches directory  | `name:` value === parent directory basename                                                                   |
| 3   | Name format             | 1–64 chars, lowercase letters/digits/hyphens, no leading/trailing/consecutive hyphens                         |
| 4   | Description single-line | No `\n` or `\r`; no `<` or `>`; ≤1024 chars hard, ≤250 target                                                 |
| 5   | Negative-trigger clause | Description names 2–3 adjacent domains as "Don't use for ..."                                                 |
| 6   | Allowed top-level keys  | Only `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`, `effort`, `dependencies` |
| 7   | `metadata.version`      | Present, follows `MAJOR.MINOR.PATCH`                                                                          |
| 8   | `metadata.author`       | Present (normalize `creator` / `owner` / `maintainer` to `author`)                                            |
| 9   | `effort` (if set)       | One of `low`, `medium`, `high`, `xhigh`, or `max`                                                             |
| 10  | YAML safety             | Every string with special chars is double-quoted                                                              |
| 11  | README consistency      | If `docs/README.md` exists, its title/tagline/author match the frontmatter                                    |

Run `python ~/.claude/skills/skill-creator/scripts/quick_validate.py "$SKILL_PATH"` first — it catches checks 1, 3, 4, 6, 9 mechanically and warns on 5. The remaining checks need a human / agent read.

## YAML safety — the special characters

Quote any frontmatter string value that contains any of these:

```
:  #  -  <  >  |  {  }  [  ]  ,  &  *  ?  =  !  %  @  `
```

Safest default: quote every multi-word string value.

```yaml
# BROKEN — colon after "workflow" starts a new YAML mapping in strict parsers
description: Follows a 5-step workflow: Analyze -> Design -> Plan -> Execute -> Summarize.

# FIXED
description: "Follows a 5-step workflow: Analyze -> Design -> Plan -> Execute -> Summarize."
```

```yaml
# BROKEN
compatibility: Claude Code; requires asm on PATH

# FIXED
compatibility: "Claude Code; requires asm on PATH"
```

If the value contains literal double quotes, escape them with `\"`.

## Normalizing `asm eval --fix` output (mandatory after Phase 1)

`asm eval --fix` only writes top-level keys when authorship or version is missing entirely:

- **No authorship anywhere** (no `author`, `metadata.author`, `creator`, or `metadata.creator`) → `--fix` appends top-level `author: <git user.name>`.
- **No version anywhere** (no `metadata.version` or top-level `version`) → `--fix` appends top-level `version: 0.1.0`.

`quick_validate.py` rejects both top-level `author:` and top-level `version:` as unexpected keys. The fix migrates them under `metadata:`. Older skills authored before the `author` rename may also carry a top-level `creator:` — treat it the same way (migrate to `metadata.author`).

### Before (post-`--fix`, fails Gate 1)

```yaml
---
name: my-skill
description: "..."
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Write
effort: high
author: alice # written by --fix when no authorship existed
version: 0.1.0 # written by --fix when no version existed
---
```

### After (passes Gate 1)

```yaml
---
name: my-skill
description: "..."
license: MIT
compatibility: "Claude Code"
allowed-tools: Bash Read Write
effort: high
metadata:
  version: 0.1.0
  author: alice
---
```

### Migration rules

1. **`author` → `metadata.author`.** Value carries over verbatim. This is the primary case for skills processed by the current `--fix`. If a legacy top-level `creator:` is present instead (older fixer output), apply the same migration — both resolve to `metadata.author`. If `metadata.author` already exists, prefer the non-empty value; if both have values, prefer the top-level one (that's what `--fix` just wrote) and drop the duplicate.
2. **`version` → `metadata.version`.** Same value-carryover rule. If `metadata.version` already exists with a different semver, prefer the higher one (the auto-improver bumped it).
3. **Other unexpected top-level keys.** Drop anything outside the allowed set (`name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`, `effort`, `dependencies`). The current `--fix` does not write `tags:`, but legacy skills sometimes carry it — surface non-trivial drops to the user before deleting.
4. **Quote any value** with the special characters listed above.
5. **Re-run `quick_validate.py`** after migration to confirm clean.

## Allowed-key drift

Sometimes a published skill carries fields invented by older tooling: `architecture`, `model`, `category`, `dependencies`. None are in the allowed set. Two options:

- If the field encodes information used at runtime (rare), move it under `metadata:` (any nested keys are accepted)
- Otherwise, drop it and surface to the user as a finding

Don't silently delete a non-trivial field — surface it first.

## How to apply audit findings

1. Run `quick_validate.py` first. Mechanical pass means most checks 1, 3, 4, 6, 9 are clean.
2. For each remaining check:
   - **Fix mode** (user asked to improve): apply the correction, **bump `metadata.version`** (patch for frontmatter-only).
   - **Review mode** (user asked only for a report): write the before/after YAML in the report and let the user paste it.
3. Add a `Frontmatter valid` row to the Step Completion Report for the phase that ran the audit.
4. The audit is cheap — re-run after every loop iteration that touches frontmatter.
