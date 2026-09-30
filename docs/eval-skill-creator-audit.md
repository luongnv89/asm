# `asm eval` ↔ skill-creator v1.7.1 audit

Audit of literal MUST rules from the canonical skill-creator standard
(`~/.claude/skills/skill-creator/SKILL.md`, v1.7.1) against the two built-in
`asm eval` providers, run for issue #246.

The standard's "Frontmatter Audit on Review/Evaluation (mandatory)" section
(lines 134–150 of skill-creator's SKILL.md) is the primary source. Heuristic
prose advice (word count targets, imperative-verb openings, body length
sweet spots, etc.) is **out of scope** — those are quality-of-prose
suggestions the evaluator scores on its own, not literal standard mandates.

## Coverage table

| #   | Standard rule (line ref)                                                                                                                       | `skill-best-practice` v1.1.0                                                    | `quality` v1 (`evaluator.ts`)                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `name` and `description` non-empty (140)                                                                                                       | ✓ `name-present`, `description-present` (error)                                 | ✓ `scoreStructure` 1.5 + 1.5 pts                                                                                     |
| 2   | `name` matches parent directory (141, 189)                                                                                                     | ✓ `name-matches-directory` (error, this PR)                                     | ✓ aggregator bonus point in `evaluateSkillContent`                                                                   |
| 3   | `name` is 1–64 chars, lowercase letters/digits/hyphens, no leading/trailing or consecutive hyphens (142, 189)                                  | ✓ `name-kebab-case` (error) — strict                                            | ⚠ `scoreNaming` checks `^[a-z][a-z0-9-]*$` and ≤40 chars; tolerates trailing `-`, consecutive `--`, and 41–64 length |
| 4   | `description` is single-line, no angle brackets, ≤1024 hard ceiling, ≤250 runtime budget (143)                                                 | ✓ `description-shape` (error) + `description-runtime-budget` (warning, this PR) | ✗ `scoreDescription` only scores word count — no single-line, no angle-bracket, no hard ceiling check                |
| 5   | Negative-trigger clause present (144)                                                                                                          | ✓ `negative-trigger-clause` (warning)                                           | ✗ not checked                                                                                                        |
| 6   | Only allowed top-level keys: `name`, `description`, `license`, `allowed-tools`, `metadata`, `compatibility`, `effort`, `dependencies` (145)    | ✓ `allowed-keys` (error)                                                        | ✗ unknown keys silently ignored                                                                                      |
| 7   | `metadata.version` present and follows `MAJOR.MINOR.PATCH` (146)                                                                               | ✓ `metadata-version-present` + `metadata-version-semver` (both error, this PR)  | ⚠ `scoreStructure` checks "version known" (any non-default value) — does not enforce semver shape                    |
| 8   | `metadata.author` present (warning when missing on published skills) (147)                                                                     | ✓ `metadata-author-present` (warning, this PR)                                  | ✓ `scoreStructure` accepts `author`/`creator` at top or under `metadata`                                             |
| 9   | `effort` ∈ `{low, medium, high, xhigh, max}` when set (148)                                                                                    | ✓ `effort-enum` (error, this PR adds `xhigh`)                                   | ✗ no enum check                                                                                                      |
| 10  | YAML safety: quote strings containing `:`, `#`, `-`, `<`, `>`, `\|`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `?`, `=`, `!`, `%`, `@`, `` ` `` (149) | ✗ deferred — see PR #248 Decision Record                                        | ✗ not checked                                                                                                        |
| 11  | Consistency between frontmatter and `docs/README.md` for name/description/author (150)                                                         | ✗ not checked                                                                   | ✗ not checked                                                                                                        |

Legend: ✓ literal coverage · ⚠ partial · ✗ no coverage

## Findings

### Combined coverage across both providers is complete for 8 of 11 rules

Rules 1, 2, 5, 8 have full coverage in both providers. Rules 3, 4, 6, 7, 9
are fully covered by `skill-best-practice` (which is the literal-validation
provider) and partially or not by `quality` (which is the scoring provider).

### Three gaps in `quality` where `skill-best-practice` already enforces strictly

| Rule | Gap in `quality`                                             | Already covered (strictly) by                     |
| ---- | ------------------------------------------------------------ | ------------------------------------------------- |
| 4    | description single-line + angle brackets + 1024-char ceiling | `skill-best-practice` `description-shape` (error) |
| 6    | unknown top-level keys silently ignored                      | `skill-best-practice` `allowed-keys` (error)      |
| 9    | `effort` enum not validated                                  | `skill-best-practice` `effort-enum` (error)       |

For each: **`skill-best-practice` will fail the skill outright** when the
rule is violated. `quality` will score it without comment. The user-facing
behavior of `asm eval` (which runs both providers) therefore already flags
every violation — just from a different provider — and fails the overall
verdict because `skill-best-practice` returns `passed: false`.

Adding the same checks to `quality` would:

- Duplicate the finding (two providers emit the same complaint)
- Force snapshot regeneration of `src/eval/providers/quality/v1/fixtures/*.json`
  (the corpus snapshot tests)
- Blur the architectural line: `quality` becomes a validator alongside the
  scoring layer, and the two providers' findings overlap

### One partial gap in `quality` (rule 3)

`scoreNaming`'s regex (`^[a-z][a-z0-9-]*$`) tolerates trailing hyphens
(`my-skill-`), consecutive hyphens (`my--skill`), and lengths 41–64. The
standard forbids the first two and allows up to 64. `skill-best-practice`'s
`name-kebab-case` enforces all the rules strictly (error severity) — same
double-coverage logic as the gaps above.

### Two genuine uncovered rules (10, 11) — neither provider checks them

- **Rule 10 (YAML safety)**: PR #248 Decision Record explains the deferral.
  By the time `parseYaml()` succeeds the original quoting is lost, and a
  naive regex would flag almost every skill. The only documented failure
  mode (unquoted `:` in `description`) already breaks YAML parsing, which
  `skill-best-practice` catches as `invalid-yaml`. Tracked as a follow-up
  if a real-world need surfaces.
- **Rule 11 (`docs/README.md` consistency)**: cross-file consistency check
  comparing frontmatter `name`/`description`/`author` against the
  human-readable copy in `docs/README.md`. Not implemented in either
  provider. Worth a follow-up issue if the catalog starts depending on this.

## Conclusion

PR #248 brings `skill-best-practice` to full literal-rule coverage of the
v1.7.1 standard for the 9 rules it covers (1–9, minus the two deferred).
`quality` keeps its scoring-layer role; the hard-validation duplications it
lacks are all caught by `skill-best-practice` so the user-facing
`asm eval` verdict is correct without modifying `evaluator.ts`.

Two open follow-ups (rules 10 and 11) are uncovered by either provider and
should be tracked as separate issues if/when the need is concrete.
