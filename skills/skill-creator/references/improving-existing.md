# Improving an existing skill — the two subpaths

Path B from the entry-paths block in SKILL.md. Pick the subpath from what the user is asking for; they do not share an opening move.

## Subpath B1 — Retrofit an existing skill to the standard

Use this when the user says "update this skill to match the standard," "fix this skill," "review and improve," or invokes `/skill-creator` on a published skill that hasn't been touched in a while. The goal is mechanical conformance, not behavioral redesign. **Do not interview the user about purpose, triggers, or output format** — those are encoded in the existing SKILL.md.

1. Read the existing SKILL.md and surrounding directory. Note current frontmatter, body length, references, scripts, version. Skim `docs/README.md` for human-facing claims.
2. Run `python scripts/quick_validate.py <skill-path>`. Validates allowed keys, name format, description length, missing negative trigger, broken YAML.
3. Run the **Frontmatter Audit** described in `frontmatter-rules.md`. Cover every checklist item, not just what `quick_validate.py` flagged.
4. Inspect the body against the standards in this skill:
   - SKILL.md under 500 lines and under ~3000 words (split to `references/` if not).
   - Step Completion Reports section present.
   - "Repo Sync Before Edits" section if the skill mutates a git repo.
   - "Dependency Preflight" section if the skill invokes another skill — and none if it invokes none (`dependency-preflight.md`).
   - Bundled scripts print descriptive errors before exiting.
   - Progressive disclosure used appropriately; references one level deep.
5. Decide fix vs. review-only mode. If fixing, apply edits and **bump `metadata.version`** — patch for frontmatter-only fixes, minor for new sections, major for restructuring. If reviewing only, surface findings as before/after suggestions and don't silently edit.
6. Re-run `quick_validate.py` to confirm clean. Output a Step Completion Report with a `Frontmatter valid` check.
7. Optional: offer description optimization (`description-optimization.md`). Don't run it automatically — it costs eval tokens.

This subpath does **not** require running evals. Move to Subpath B2 only if body changes are substantive enough that the user wants verification.

## Subpath B2 — Iterate on a skill based on eval feedback

Use this when the user has eval results (or wants to run evals) and wants the skill revised based on what the evals show. The opening move is the **eval loop**, not interviewing.

1. Read `evals/misfires.jsonl` first if present — logged real-world failures are the highest-signal evals; convert them into test cases (schema in `schemas.md`). Then, if evals already exist, read the latest results and the user's `feedback.json`; if not, run them per SKILL.md → _Running and evaluating test cases_.
2. Read `iteration.md` for the five principles of revision (generalize, stay lean, explain the why, spot repeated work, consider subagents) and the iteration loop (apply → rerun → review → repeat).
3. Run the **Frontmatter Audit** alongside content revision — a polished body on top of broken frontmatter still fails validation.
4. Bump `metadata.version` per Version Management — minor for new capabilities or expanded triggers, patch for wording fixes.
5. Re-run evals into a new `iteration-<N+1>/` directory and let the user compare.

`iteration.md` also documents the optional blind A/B comparison system.
