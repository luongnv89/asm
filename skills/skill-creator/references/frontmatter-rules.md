# Frontmatter Rules

Mandatory rules for `metadata.version`, YAML safety, and the frontmatter audit that runs on every review.

## Version Management

Every skill must have a `metadata.version` field in its YAML frontmatter using semantic versioning (`MAJOR.MINOR.PATCH`). This version tracks the evolution of the skill itself — it tells users and tooling which iteration they're running.

**When creating a new skill**, set `metadata.version: 1.0.0` in the frontmatter:

```yaml
---
name: my-skill
description: ...
metadata:
  version: 1.0.0
---
```

**When updating or modifying an existing skill**, always bump the version before saving. Read the current version from the frontmatter and increment it:

- **Patch** (`x.y.Z`): Bug fixes, typo corrections, minor wording tweaks that don't change behavior
- **Minor** (`x.Y.0`): New capabilities, added sections, new subagents, expanded trigger phrases
- **Major** (`X.0.0`): Breaking changes to the skill's workflow, output format changes, restructured architecture

If the frontmatter has no `metadata.version` field, add one starting at `1.0.0`.

This applies every time you write or edit a SKILL.md — whether creating from scratch, improving after eval feedback, optimizing the description, or any other modification. The version bump is part of the edit, not a separate step.

## YAML Frontmatter Safety

YAML is surprisingly easy to break. An unquoted value containing a colon (`:`) causes many parsers to treat the rest of the line as a new mapping, silently producing wrong output or a hard parse error. This has bitten real skills — `cli-builder` and `code-review` both shipped with broken frontmatter for this reason.

**Rule: quote every frontmatter string that contains any of these characters: `:`, `#`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `?`, `|`, `-`, `<`, `>`, `=`, `!`, `%`, `@`, `` ` ``.**

In practice, the safest approach is to quote all multi-word string values in frontmatter by default — it costs nothing and prevents the whole class of bugs.

```yaml
# BROKEN — the : after "workflow" starts a new mapping in strict parsers
description: Follows a 5-step workflow: Analyze -> Design -> Plan -> Execute -> Summarize.

# FIXED
description: "Follows a 5-step workflow: Analyze -> Design -> Plan -> Execute -> Summarize."
```

```yaml
# BROKEN — the : after "B+C" breaks strict parsers
architecture: subagent (Pattern B+C: Parallel Workers + Review Loop)

# FIXED
architecture: "subagent (Pattern B+C: Parallel Workers + Review Loop)"
```

When writing or editing any SKILL.md frontmatter, scan every value for colons and other special characters and wrap the value in double quotes if any are present. If the value itself contains double quotes, escape them with `\"`.

## Frontmatter Audit on Review/Evaluation

Whenever this skill is used to **review, evaluate, improve, or iterate on an existing skill** (not just author a new one), audit the target skill's YAML frontmatter as part of the review. Broken or outdated frontmatter is one of the most common defects in published skills, and it silently degrades triggering, validation, and catalog display — so reviewers should not let it slide.

**What to check on every review:**

- **Required fields present**: `name` and `description` exist and are non-empty strings.
- **`name` matches the parent directory** exactly (e.g., `skills/my-skill/SKILL.md` → `name: my-skill`). Mismatches fail `scripts/quick_validate.py`.
- **`name` format**: 1–64 chars, lowercase letters/digits/hyphens only, no leading/trailing or consecutive hyphens.
- **`description` is a single line** (no newlines), with no angle brackets. Target **≤250 characters** to stay within the runtime context budget; **1024 is a hard ceiling** but only the spec-level limit.
- **Negative-trigger clause**: description names adjacent domains that should _not_ trigger the skill (e.g., "Don't use for …"). `quick_validate.py` emits a warning when it's missing — treat that as a review finding, not noise.
- **Only allowed top-level keys** appear: `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`, `effort`, `dependencies`. Anything else is a typo or stale field.
- **`dependencies`** (if present) is a non-empty YAML list of optional skill references accepted by `asm get`; it declares discovery metadata and never causes eager installation.
- **`metadata.version`** is present and follows `MAJOR.MINOR.PATCH`. If missing, flag it and propose `1.0.0`.
- **`metadata.author`** is present when the skill is published/shared. Normalize alternate keys (`creator`, `owner`, `maintainer`) to `author` under `metadata:`.
- **`effort`** (if set) is one of `low | medium | high | xhigh | max`.
- **YAML safety**: any string value containing the special characters listed above is wrapped in double quotes.
- **Consistency with `docs/README.md`**: skill name, description summary, and author shown to humans should match the frontmatter.

**How to apply the findings:**

1. Run `python scripts/quick_validate.py <skill-path>` first — it catches mechanical issues without LLM reasoning.
2. For each issue found:
   - If the user asked to **fix** the skill, apply the correction directly and **bump `metadata.version`** per the Version Management rules above. Frontmatter fix → patch bump; renaming a field or restructuring metadata → minor.
   - If the user asked only to **review / evaluate**, surface issues as concrete suggestions in the review output — include the exact before/after YAML so the user can paste it. Do not silently edit the file in review-only mode.
3. Include the frontmatter audit in the step-completion report under a check named `Frontmatter valid` (pass/fail with a brief note on what was fixed or suggested).

This audit is cheap and catches real regressions, so run it on every review pass — not just on the first one.
