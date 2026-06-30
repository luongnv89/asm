---
name: find-me-skills
description: "Find Agent Skills for a goal the user cannot name yet, then export an installable bundle. Use when they ask which skills fit a project. Don't use for installing named skills, authoring skills, or catalog maintenance."
license: MIT
compatibility: "Claude Code with the `asm` CLI on PATH"
effort: medium
metadata:
  version: 1.2.0
  author: Luong NGUYEN <luongnv89@gmail.com>
---

# Find Me Skills

Help a user who has a **goal but not a skill list** find the right Agent Skills,
explain what each one does, lay out an order to run them in, and — if they
approve — hand them a single installable bundle file.

The user's defining trait is that they **don't know what to ask for**. Someone
who already knows they want `frontend-design` should just run
`asm install …`. This skill is for "I'm building an app and want to do marketing
from scratch, but I don't know marketing or which skills exist." Meet them there:
draw out the goal, confirm you understood it, then map it onto real, installable
skills from the live catalog.

## The loop

1. **Collect intent** — conversationally draw out what the user is trying to achieve.
2. **Confirm understanding** — play back your read of their situation; let them correct it before you search.
3. **Discover** — query the live `asm` catalog for candidate skills (never guess skill names).
4. **Curate** — dedupe, group by step, and explain each skill in one plain sentence.
5. **Sequence** — give a step-by-step path with the input and output of each step.
6. **Export** — on approval, write a bundle file and give the one-line install command.

Identify where the user already is and start there. If they open with a rich
goal ("I need SEO, a landing page, and launch copy for my SaaS"), you can confirm
quickly and move to discovery. If they're vague ("help me market my app"), spend
more time in steps 1–2. Don't skip step 2 — confirming understanding before
searching is what keeps recommendations relevant and is an explicit requirement.

## Prerequisite (check once, up front)

This skill drives the `asm` CLI for discovery and produces a file it installs.
Verify `asm` is available before promising recommendations:

```bash
command -v asm || echo "MISSING"
```

If `asm` is missing, tell the user the skill needs the Agent Skill Manager CLI
installed and on PATH, point them at `npm install -g agent-skill-manager` (or
the project's documented install), and stop. Everything downstream depends on it.

## Step 1 — Collect intent

Ask open questions, one or two at a time, until you can state the user's goal in
a sentence. Useful prompts:

- What are you building or working on right now?
- What outcome do you want — a launched product, a written artifact, a faster workflow?
- What part feels hardest or most unfamiliar? (This is often where skills help most.)
- Is this a one-off task or something you'll repeat?

Match your vocabulary to theirs. A non-marketer asking for "marketing" may
actually need positioning, a landing page, and launch copy — surface those as
options, don't assume. Avoid jargon ("ICP", "ASO") unless they use it first.

## Step 2 — Confirm understanding (do not skip)

Before searching, play back what you heard and get an explicit confirmation:

> Here's what I understand: you're building **{project}**, and you want to
> **{goal}**. The pieces you're unsure about are **{gaps}**. Did I get that right?

If they correct you, fold it in and confirm again. Only move on once they agree.
This step is an acceptance criterion of this skill — confirming the situation is
what prevents a confidently-wrong skill list.

## Step 3 — Discover candidates from the live catalog

**Never invent skill names or install URLs.** The catalog changes constantly;
the only trustworthy source at runtime is the `asm` CLI on the user's machine.
Derive 2–5 search terms from the confirmed goal and query each:

```bash
asm search "<term>" --available --json
```

Run a separate search per term — broad terms ("marketing", "seo", "landing page", "launch") surface different skills. Read `references/catalog-discovery.md` when you need the JSON shape, installed-vs-available rules, or empty-result handling; keep this detail out of the main context budget until Step 3 needs it.

Read each candidate's `description` to judge relevance; the description's own "Use when…" / "Don't use for…" text tells you whether it fits the user's goal. Also run `asm search "<term>" --json` without `--available` to detect installed skills: mention installed matches in the plan, but exclude them from the bundle. Only `available` skills with an `installCommand` go in.

## Step 4 — Curate: dedupe and explain

From the union of search hits, build the recommendation set:

- **Deduplicate by skill `name`.** The same skill surfaces under multiple search
  terms and sometimes from multiple repos. Keep one entry per name. If two repos
  offer the same name, prefer the one whose description best matches the goal
  (note the choice if it's not obvious).
- **Drop weak fits.** Only keep skills you can justify in one sentence tied to
  the user's goal.
- **Explain each in plain language** — one sentence on what it does _for this
  user_, not a paraphrase of its description. "`landing-page-copywriter` writes
  the words for your launch page so visitors understand and sign up."

## Step 5 — Sequence into a step-by-step path

Order the curated skills into the sequence the user should actually run them in,
and for each step state its **input** (what the user/previous step provides) and
**output** (what they'll have after). Foundational/context skills usually come
first; review/QA skills usually come last. Example shape:

```
Step 1 — marketing-context
  in:  your product description, target customer
  out: a saved brand/positioning brief other skills read first
Step 2 — landing-page-copywriter
  in:  the brief from step 1
  out: landing-page copy ready to paste
Step 3 — x-post-generator
  in:  the positioning + launch angle
  out: launch posts for X
```

Show this plan to the user before exporting anything. Make it easy to say
"drop step 3" or "add something for email" — adjust and re-confirm.

## Step 6 — Export an installable bundle (on approval)

Only after the user approves the plan, emit a **bundle file** in `asm`'s `BundleManifest` format and give them the one-line install command. Write a goal-based file such as `marketing-starter.bundle.json`.

See `references/bundle-format.md` for the required JSON template, validation rules, and the reason this skill uses `asm bundle install` instead of `asm install` or `asm import`. Copy each `installUrl` from Step 3 verbatim; never hand-construct it and never include already-installed skills.

Then verify and hand off:

```bash
# Sanity-check the file parses as a bundle before telling the user to install:
asm bundle show ./marketing-starter.bundle.json
```

If `asm bundle show` reports the bundle correctly, give the user the final command:

```bash
asm bundle install ./marketing-starter.bundle.json
```

Tell them what it does: it installs every recommended skill from its source, with
a confirmation prompt (add `-y` to skip it). They can re-run the plan's steps in
order afterward. If `asm bundle show` errors, fix the offending field (the error
names it) and re-check before handing off.

## Acceptance Criteria

Verify all of these before calling the run complete:

- The user explicitly confirmed the goal before any catalog search.
- At least one `asm search "<term>" --available --json` query was run for each chosen search term.
- Installed skills were checked with `asm search "<term>" --json` and excluded from the bundle.
- The user approved the sequenced plan before any file was written.
- Expected output exists: a numbered plan, a bundle file path, and an install command.
- `asm bundle show ./<file>.bundle.json` succeeds, or the run reports the validation error instead of handing off a broken command.

## Output format

End every successful run with three things, clearly separated:

1. **The plan** — numbered steps, each with the skill, a one-line purpose, and in/out.
2. **The bundle file** — written to disk, path shown.
3. **The install command** — `asm bundle install ./<file>` on its own line.

Keep explanations plain. The user came here because they _didn't_ know the
landscape — leave them understanding what they're about to install and why.

## Edge cases

- **`asm` not installed** — stop at the prerequisite check; point them at the install docs.
- **Vague goal that won't sharpen** — stay in steps 1–2; offer 2–3 concrete directions ("Do you mean A, B, or C?") rather than searching on a guess.
- **No catalog matches for part of the goal** — say so honestly; recommend only what genuinely fits, and suggest `skill-creator` if they may need to author something that doesn't exist yet.
- **Everything relevant is already installed** — there's nothing to bundle; just give the step-by-step plan using their installed skills and skip the export.
- **User declines the plan** — don't write a file. Adjust based on their feedback and re-confirm, or stop cleanly.
- **Duplicate skill names across repos** — keep one; pick the better-matching description and note the choice.
