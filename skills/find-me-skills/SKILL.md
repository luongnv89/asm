---
name: find-me-skills
description: "Find Agent Skills for a goal the user cannot name yet, then export an installable bundle. Use when they ask which skills fit a project. Don't use for installing named skills, authoring skills, or catalog maintenance."
license: MIT
compatibility: "Claude Code with the `asm` CLI on PATH"
effort: medium
metadata:
  version: 1.4.0
  author: "Luong NGUYEN <luongnv89@gmail.com>"
---

# Find Me Skills

Help a user who has a **goal but not a skill list** find the right Agent Skills,
explain what each one does, lay out an order to run them in, and — if they
approve — hand them a single installable bundle file.

The user's defining trait is that they **don't know what to ask for**. Someone
who already knows they want `frontend-design` should just run
`asm install …`. This skill is for "I'm building an app and want to do marketing
from scratch, but I don't know marketing or which skills exist." Draw out the
goal, confirm it, then map it onto real, installable skills from the live catalog.

## The loop

1. **Collect intent** — conversationally draw out what the user is trying to achieve.
2. **Confirm understanding** — play back your read of their situation; let them correct it before you search.
3. **Discover** — query the live `asm` catalog for candidate skills (never guess skill names).
4. **Curate** — dedupe, group by step, and explain each skill in one plain sentence.
5. **Sequence** — give a step-by-step path with the input and output of each step.
6. **Export** — on approval, write a bundle file and give the one-line install command.

Start at the step the user is already at. If they open with a rich goal ("I need
SEO, a landing page, and launch copy for my SaaS"), confirm quickly and move to
discovery. If they're vague ("help me market my app"), spend more time in steps
1–2. Never skip step 2: confirming before searching keeps recommendations relevant.

If the user asks for one capability ("is there a skill that converts PDFs?"), skip the loop: run one `asm search "<term>" --available --json` and give the matching `asm install <installUrl>` line.

## Prerequisite (check once, up front)

This skill drives the `asm` CLI for discovery and produces a file it installs.
Run this before promising recommendations:

```bash
command -v asm || echo "MISSING"
```

If the output is `MISSING`, tell the user the skill needs the Agent Skill
Manager CLI on PATH, point them at `npm install -g agent-skill-manager`, and stop.

## Step 1 — Collect intent

Ask open questions, one or two at a time, until you can state the user's goal in
a sentence. Useful prompts:

- What are you building or working on right now?
- What outcome do you want — a launched product, a written artifact, a faster workflow?
- What part feels hardest or most unfamiliar? (This is often where skills help most.)
- Is this a one-off task or something you'll repeat?

Match your vocabulary to theirs. A non-marketer asking for "marketing" may
actually need positioning, a landing page, and launch copy — offer those as
options; do not assume. Avoid jargon ("ICP", "ASO") unless they use it first.

## Step 2 — Confirm understanding (do not skip)

Before searching, play back what you heard and ask for an explicit confirmation:

> Here's what I understand: you're building **{project}**, and you want to
> **{goal}**. The pieces you're unsure about are **{gaps}**. Did I get that right?

If they correct you, fold it in and ask again. Move on only after they agree.
Confirming the situation is what prevents a confidently-wrong skill list.

## Step 3 — Discover candidates from the live catalog

**Never invent skill names or install URLs.** The catalog changes constantly;
the only trustworthy source at runtime is the `asm` CLI on the user's machine.
Derive 2–5 search terms from the confirmed goal and query each:

```bash
asm search "<term>" --available --json
```

Run a separate search per term — broad terms ("marketing", "seo", "landing page", "launch") surface different skills. Read `references/catalog-discovery.md` when you need the JSON shape, installed-vs-available rules, or empty-result handling; keep this detail out of the main context budget until Step 3 needs it.

Read each candidate's `description` to judge relevance; its "Use when…" / "Don't use for…" text tells you whether it fits the goal. Then run `asm search "<term>" --json` without `--available` to detect installed skills. Mention installed matches in the plan, but exclude them from the bundle. Only `available` skills with an `installCommand` go in.

## Step 4 — Curate: dedupe and explain

From the union of search hits, build the recommendation set:

- **Deduplicate by skill `name`.** Keep one entry per name. If two repos offer
  the same name, keep the one whose description best matches the goal and note
  the choice in the plan.
- **Drop weak fits.** Keep only skills you can justify in one sentence tied to
  the user's goal.
- **Explain each in plain language** — one sentence on what it does _for this
  user_, not a paraphrase of its description. "`landing-page-copywriter` writes
  the words for your launch page so visitors understand and sign up."

## Step 5 — Sequence into a step-by-step path

Order the curated skills into the sequence the user should run them in. For each
step, state its **input** (what the user or the previous step provides) and its
**output** (what they'll have after). Foundational/context skills usually come
first; review/QA skills usually come last. Example shape:

```
Step 1 — marketing-context
  in:  your product description, target customer
  out: a saved brand/positioning brief other skills read first
Step 2 — landing-page-copywriter
  in:  the brief from step 1
  out: landing-page copy ready to paste
```

Show this plan to the user before exporting anything. Make it easy to say
"drop step 2" or "add something for email". After any change, show the revised
plan and ask for approval again.

## Step 6 — Export an installable bundle (on approval)

Only after the user approves the plan, write a **bundle file** in `asm`'s `BundleManifest` format with a goal-based name such as `marketing-starter.bundle.json`. Write it to the current directory unless the user names another path.

See `references/bundle-format.md` for the required JSON template, validation rules, and the reason this skill uses `asm bundle install` instead of `asm install` or `asm import`. Copy each `installUrl` from Step 3 verbatim; never hand-construct it and never include already-installed skills.

Check the file before handing it off:

```bash
asm bundle show ./marketing-starter.bundle.json --json
```

- If the command exits 0 and its `skills[].name` list matches the approved plan, give the user the install command `asm bundle install ./marketing-starter.bundle.json`. In a terminal it asks for the tool, then which bundle skills to install, then the scope. Outside a terminal, `-p/--tool <tool>` is required; `-y` skips the skill and scope pickers.
- If the command errors, fix the field the error names, then run the check again. After two failed checks, stop, report `blocked` with the error, and do not hand off an install command.

## Step Completion Reports

After each step, print a compact status block: `√` pass, `×` fail, `—` context.

```
◆ Step N — [step name]
··································································
  [check]:           √ pass
  Result:            PASS | FAIL | PARTIAL
```

Checks per step:

- **Prerequisite** — `asm on PATH`
- **Steps 1–2** — `goal stated in one sentence`, `user confirmed the goal`
- **Step 3** — `one available search per term`, `one installed search per term`
- **Steps 4–5** — `no duplicate names`, `every step has in/out`, `user approved the plan`
- **Step 6** — `bundle file written`, `asm bundle show --json exit 0`, `listed skills match the plan`

## Final output

End every run with a short report the user can read without scrolling back:

1. **Result** — the first line states `complete`, `plan only` (nothing to bundle, or the user declined export), or `blocked` (with the reason).
2. **The plan** — numbered steps, each with the skill, a one-line purpose, and in/out.
3. **Evidence** — the search terms you ran, the bundle file path, and whether `asm bundle show` passed.
4. **Uncertainty** — say that each recommendation is based on the skill's catalog description; you did not run, test, or security-audit any skill. Name any part of the goal with no catalog match.
5. **Decision** — for `complete`, the user's next action: `asm bundle install ./<file>` on its own line; installation happens only when they run it, so no other approval is needed. For `plan only` or `blocked`, name what would unblock the next step, or state that no action is needed.

Keep explanations plain. The user came here because they _didn't_ know the
landscape — leave them understanding what they're about to install and why.

## Acceptance Criteria

Verify all of these before calling the run complete:

- The user explicitly confirmed the goal before any catalog search.
- At least one `asm search "<term>" --available --json` query was run for each chosen search term.
- Installed skills were checked with `asm search "<term>" --json` and excluded from the bundle.
- The user approved the sequenced plan before any file was written.
- Expected output for `complete`: a numbered plan, a bundle file path, and an install command. For `plan only`: the numbered plan and no bundle file.
- For `complete`, `asm bundle show ./<file>.bundle.json --json` succeeded; otherwise the run reports `blocked` with the validation error instead of handing off a broken command.

When reviewing a run's output (by eval or by a human), also check that a reader can:

- **Find the main result** — the first line states the completion status.
- **Separate facts from assumptions** — catalog-description judgements and untested behavior are labeled as such.
- **Trace claims** — each recommended skill maps to a search term and a catalog result; "bundle valid" maps to the `asm bundle show` check.
- **See the next decision** — the install command is named, or the report states why there is none.

An agent's own review cannot confirm human understanding. A reviewer who received no human feedback records understanding as unconfirmed.

## Edge cases

- **`asm` not installed** — stop at the prerequisite check; point them at the install docs.
- **Vague goal that won't sharpen** — stay in steps 1–2; offer 2–3 concrete directions ("Do you mean A, B, or C?") rather than searching on a guess.
- **No catalog matches for part of the goal** — say so; recommend only what fits, and suggest `skill-creator` if they may need to author something that doesn't exist yet.
- **Everything relevant is already installed** — there's nothing to bundle; give the step-by-step plan using their installed skills, skip the export, and report the result as `plan only`.
- **User declines the plan** — don't write a file. Adjust from their feedback and ask again, or stop and report `plan only`.
- **Duplicate skill names across repos** — keep one; pick the better-matching description and note the choice.
