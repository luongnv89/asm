# Improving an existing skill — the three subpaths

Path B from the entry-paths block in SKILL.md. Pick the subpath from what the user is asking for, **before** Phase 0 of the retrofit loop runs; the subpaths do not share an opening move. Every subpath ends at the same bar as Path A: `skill-standard.md`.

## Subpath B1 — Retrofit to the standard (default)

Use this when the user says "update this skill to match the standard," "fix this skill," "improve," "level up," "review and improve," or invokes `/skill-creator` on a skill that hasn't been touched in a while. Any ambiguous improvement request is B1. The goal is conformance, not behavioral redesign. **Do not interview the user about purpose, triggers, or output format** — those are encoded in the existing SKILL.md.

Follow `retrofit-loop.md` end to end: prerequisites, repo sync, Phases 0–7, the 8-iteration / 3-no-move / 2-regression caps, and the `.asm-improver/` artifacts (`baseline.json`, `iter-N.json`, `report.md`).

**Review-only** request ("just review this skill"): run Phase 0 and report the findings as before/after suggestions. Make no edits.

This subpath does **not** require running evals. Move to Subpath B2 only if body changes are substantive enough that the user wants behavioral verification. Optionally offer description optimization (`description-optimization.md`) afterwards — never run it automatically; it costs eval tokens.

## Subpath B2 — Iterate on a skill based on eval feedback

Use this when the user has eval results (or wants to run evals) and wants the skill revised based on what the evals show. The opening move is the **eval loop**, not interviewing.

1. Read `evals/misfires.jsonl` first if present — logged real-world failures are the highest-signal evals; convert them into test cases (schema in `schemas.md`). Then, if evals already exist, read the latest results and the user's `feedback.json`; if not, run them per SKILL.md → _Running and evaluating test cases_.
2. Read `iteration.md` for the five principles of revision (generalize, stay lean, explain the why, spot repeated work, consider subagents) and the iteration loop (apply → rerun → review → repeat).
3. Run the **Frontmatter Audit** alongside content revision — a polished body on top of broken frontmatter still fails validation.
4. Bump `metadata.version` per Version Management — minor for new capabilities or expanded triggers, patch for wording fixes.
5. Re-run evals into a new `iteration-<N+1>/` directory and let the user compare.
6. Close with the skill standard as Path A does (`skill-standard.md` → _How each path applies the standard_): skip `retrofit-loop.md`'s prerequisite list and repo sync, but set `$SKILL_PATH` to the revised skill, resolve `$QV`, and check `command -v asm` — missing `asm` means Gate 2 not measured, never PASS (`skill-standard.md` → _Without `asm`_). Then run `retrofit-loop.md` Phase 0 (`retrofit-loop.md` → _Prerequisites_, closing paragraph).

`iteration.md` also documents the optional blind A/B comparison system.

## Subpath B3 — Delegation conversion (opt-in)

Restructure the target's steps onto **per-step context delegation**: each heavy step names the slice of its own `references/` tree its worker needs and hands it over as that worker's `Input`. Runs **outside** the Phase 6 loop, only on a target that already clears Gate 1, and only once the user confirms. A Phase 2b delegability finding routes here but never starts a conversion by itself. Procedure: `delegation-conversion.md`.
