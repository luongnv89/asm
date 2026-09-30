# Edge cases

The full list. `SKILL.md` → _Edge Cases_ carries the four that change the run's shape; the rest are consulted reactively when the situation arises.

- **Skill already passes both gates**: do not edit it. Still run the Phase 2b predictability audit read-only and report any advisory findings, then stop — passing gates does not guarantee a predictable process, but open findings here never force an edit. A gate-passing skill with heavy non-delegable steps is a **Mode 2** candidate: offer the conversion, do not edit under Mode 1.
- **SKILL.md has no frontmatter**: `asm eval --fix` cannot add it. Ask the user whether to scaffold one (using the skill-creator template) or abort.
- **Iterating regresses either gate**: revert the last edit (`cp SKILL.md.bak SKILL.md` if available, or undo via git) and try a different fix pattern from `references/category-playbook.md`.
- **`asm eval --fix` writes a key `quick_validate.py` rejects**: this is expected — Phase 1's normalization step handles it. Do not skip the normalization.
- **`asm eval --fix` reports "No fixes needed"**: the dry-run satisfies Phase 1. Do not apply `--fix` anyway — on an already-normalized skill it can write the top-level keys the normalization then has to undo, plus a stray `SKILL.md.bak`.
- **Description over 250 chars after edits**: trim. The 250-char target prevents tail-first truncation in Claude Code's `/skills` listing, which would chop your negative-trigger clause.
- **SKILL.md body over 500 lines**: split into `references/` per the progressive-disclosure rule. SKILL.md must drop below 500 before exit.
- **SKILL.md body over 3000 words**: `context-efficiency` scores 0 on its length bucket and caps the category at 6, failing Gate 2 on its own. Split to `references/` until the body clears 3000 with margin — the evaluator's own count is in `baseline.json` under the Context efficiency findings, not something to approximate by hand.
- **The target's content is pinned by a test**: grep the repo for the skill name before editing. A contract test that asserts on SKILL.md strings turns a harmless-looking cut into a failing suite; keep the pinned phrasing verbatim or update the test in the same commit.
- **Loop caps out at 8 iterations**: the skill has structural issues auto-improvement cannot solve. Write the blocker report and hand back to the user.
- **GitHub shorthand input**: for v1, ask the user to clone locally first. Remote editing is out of scope.
- **Destructive action**: never `rm -rf` the skill directory. `asm eval --fix` creates `SKILL.md.bak` — leave it in place until the user explicitly cleans up.
