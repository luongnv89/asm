# Cross-gate tradeoffs (Phase 4 sidebar)

The principles to hold in mind throughout Phase 3 category fixes. This is **not** a sequential phase — read it once before Phase 3 and apply it on every edit.

## The two gates pull in opposite directions on body length

- `asm eval`'s `prompt-engineering` rewards bodies up to ~3000 words
- `asm eval`'s `context-efficiency` rewards bodies under ~1500 words (and penalizes bodies over ~3000)
- Gate 1 caps SKILL.md at **500 lines** (the hard skill-creator rule, ~a few thousand words)

A fix that lifts one category can sink another: expanding the body for `testability` can tank `context-efficiency` or push SKILL.md over the 500-line cap (failing Gate 1). This is why Phase 3 works one category at a time, re-evals after each change, and reverts any edit that regresses either gate.

## When you add content, default to linking out, not inlining

- Long examples → `references/examples.md` with `See references/examples.md for...`
- Long scripts → `scripts/foo.sh` with `Run scripts/foo.sh to...`
- Long tables → `references/rubric.md`
- Long prerequisite lists → `references/prerequisites.md`

This pattern earns `context-efficiency` points (the words "reference" / "see" / "link" / "template" are scanned for), keeps SKILL.md under the 500-line Gate 1 cap, and cuts token cost on every invocation.

**Rule of thumb:** if a new section would need more than ~80 lines, put it in `references/` and link to it from SKILL.md in 2–3 lines.
