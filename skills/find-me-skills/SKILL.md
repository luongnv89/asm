---
name: find-me-skills
description: "Discover which Agent Skills a user needs for a goal they can't name yet, then export an installable bundle. Use for 'I want to do X but don't know which skills', 'find me skills for', or 'recommend skills for my project'. Don't use for installing an already-named skill, authoring a skill (skill-creator), or maintaining the catalog."
license: MIT
compatibility: Claude Code with the `asm` CLI on PATH
effort: medium
metadata:
  version: 1.0.0
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

`--available` returns catalog matches that carry an `installCommand` (the URL you
need for the bundle). It does **not** filter by what the user already has — a
skill they've installed can still show up here as `"status": "available"`. That's
fine for discovery; the "Also consider what's already installed" step below is
where you detect and exclude installed skills. Run a separate search per term —
broad terms ("marketing", "seo", "landing page", "launch") surface different
skills. Each JSON result has this shape:

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

The string after `asm install ` in `installCommand` is the skill's
**install URL** (`github:owner/repo:path`) — you will copy it verbatim into the
bundle. Read each candidate's `description` to judge relevance; the description's
own "Use when…" / "Don't use for…" text tells you whether it fits the user's goal.

If a search returns nothing useful, widen the term and try again. If after a few
honest attempts the catalog has no good match for part of the goal, **say so** —
don't pad the list with weak fits. A short, relevant list beats a long, padded one.

### Also consider what's already installed

Run `asm search "<term>" --json` (without `--available`) too — this is the
authoritative way to learn what the user already has, because the plain search
scans installed skills and the `--available` search does not. Skills returned
with `"status": "installed"` should be mentioned in the plan ("you already have
`code-review` for this step") but **excluded from the bundle** — the bundle is
for new installs. Before adding any skill to the bundle, confirm its name does
not appear in the installed set. Only `available` skills with an `installCommand`
go in.

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

Only after the user approves the plan, emit a **bundle file** in `asm`'s
`BundleManifest` format and give them the one-line install command.

> **Why a bundle, not `asm install <file>` or `asm import`?** `asm install` takes
> a single skill source, not a set file. `asm import` only restores skills from
> an `asm export` backup of already-installed skills. `asm bundle install <file>`
> is the purpose-built command that reads a set file and installs each skill from
> its remote URL — exactly the "skills-set file + one command" outcome the user
> wants.

Write the file (suggest a goal-based name like `marketing-starter.bundle.json`).
**Required shape** — every field below is validated by `asm`; the build will
reject the bundle if any are missing:

```json
{
  "version": 1,
  "name": "marketing-starter",
  "description": "Skills to market a new app from scratch: positioning, landing page, and launch copy.",
  "author": "find-me-skills",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "tags": ["marketing", "launch"],
  "skills": [
    {
      "name": "marketing-context",
      "installUrl": "github:alirezarezvani/claude-skills:.codex/skills/marketing-context",
      "description": "Create the positioning brief other marketing skills read first"
    },
    {
      "name": "landing-page-copywriter",
      "installUrl": "github:luongnv89/skills:skills/landing-page-copywriter",
      "description": "Write conversion-focused landing-page copy"
    }
  ]
}
```

Rules for a valid bundle:

- `version` must be the number `1`.
- `name`, `description`, `author`, `createdAt` are all required non-empty strings.
  Use an ISO-8601 timestamp for `createdAt` (run `date -u +%Y-%m-%dT%H:%M:%S.000Z`).
- `skills` must be non-empty. Each entry needs `name` and `installUrl`; `description`
  is optional but recommended. **`installUrl` is the `github:owner/repo:path` string
  you took from each `installCommand` in step 3** — copy it verbatim; do not
  hand-construct it.
- Only include `available` skills. Never put an already-installed skill or an
  invented URL in the bundle.

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
