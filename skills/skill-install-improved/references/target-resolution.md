# Target Resolution

The contract for Phase 0: turn whatever the user typed into exactly one local directory, `$SKILL_PATH`, that contains a `SKILL.md`.

Two invariants hold for every input form:

1. **`$SKILL_PATH` is a directory, never a file.** `skill-auto-improver` takes a directory (`skills/skill-auto-improver/SKILL.md` — "Inputs"). A `SKILL.md` file path folds to its parent.
2. **`$SKILL_PATH` lives under `$(mktemp -d)`.** Including local-path targets. See SKILL.md → Prerequisites for why, and for the trade-off.

```bash
WORK="$(mktemp -d)"
```

## Deciding which form the user gave

Check in this order — the first match wins:

| Test                                                 | Form       |
| ---------------------------------------------------- | ---------- |
| Path exists on disk (after `~` expansion)            | Local path |
| Looks like a GitHub URL, `github:…`, or `owner/repo` | Repo       |
| Anything else                                        | Skill name |

An input that looks path-shaped but does not exist is **not** a local path — say so and ask, rather than falling through to a catalog search for a typo'd path.

## Form 1 — Local path

```bash
SRC="<path the user gave>"
# A SKILL.md file path folds to its parent directory
[ -f "$SRC" ] && SRC="$(dirname "$SRC")"

# Keep the original directory name — it becomes the installed directory name
cp -R "$SRC" "$WORK/$(basename "$SRC")"
SKILL_PATH="$WORK/$(basename "$SRC")"
```

`asm install` names the installed directory after `$SKILL_PATH`'s basename, so a generic temp name like `$WORK/target` would install as `target`. Preserve the source directory name for every form.

The copy has no `origin` remote and no history. `skill-auto-improver`'s mandatory repo sync is inapplicable — log the skip and continue.

Provenance to record: the literal path the user supplied; `installUrl` = `n/a (local path)`; upstream SHA = `n/a` unless the source directory happened to sit in a git repo, in which case record `git -C "$SRC" rev-parse HEAD` for traceability.

## Form 2 — Repo

Use a plain clone. **Never `gh repo fork`** — this skill performs no public GitHub action, opens no PR, and creates nothing under the user's GitHub account.

```bash
git clone --depth 1 "https://github.com/$OWNER/$REPO" "$WORK/repo"
# If the user named a ref:
git -C "$WORK/repo" fetch --depth 1 origin "$REF" && git -C "$WORK/repo" checkout "$REF"
SKILL_PATH="$WORK/repo/<subpath>"     # or the repo root when the skill is at top level
```

If the user gave a subpath, use it. If not, run the multi-candidate check below.

**Top-level skill:** `$SKILL_PATH` would then be `$WORK/repo`, and `asm install` would name the installed directory `repo`. Copy the checkout's skill files into `$WORK/<frontmatter name>` and point `$SKILL_PATH` there instead.

Provenance to record: the clone URL, the ref, and `git -C "$WORK/repo" rev-parse HEAD`.

## Form 3 — Skill name

Query the catalog, then trust its own install string:

```bash
asm search "<term>" --available --json
```

Each result carries an `installCommand` such as:

```
asm install github:alirezarezvani/claude-skills:.codex/skills/marketing-ideas
```

**Copy the string after `asm install ` verbatim** as `$INSTALL_URL`. Never hand-construct `github:owner/repo:path` — the contract is stated in `skills/find-me-skills/references/catalog-discovery.md`, and reconstructed URLs silently resolve to the wrong subpath.

Then materialize `$INSTALL_URL` locally: split it into its repo, optional `#ref`, and optional `:path` components, clone as in Form 2, and set `$SKILL_PATH` to the cloned subpath.

Selection rules:

- **No results** — report the search terms and stop. Do not broaden the query and install something adjacent.
- **Exactly one result** — use it, and name it in the report so the user can see what was matched.
- **Several results** — list name, repo, and description; ask the user to pick. Never install the first hit on a tie.

Provenance to record: the term the user supplied, the chosen `installUrl`, and the clone's HEAD SHA.

## Multiple `SKILL.md` candidates

Whenever a checkout could hold more than one skill and the user gave no subpath:

```bash
find "$WORK" -maxdepth 5 -name "SKILL.md" -type f
```

- One match → use its parent directory.
- More than one → list every candidate with its parent directory and frontmatter `name`, and **ask the user which one**. Never guess. Installing the wrong skill is worse than one extra question, and unlike a wrong PR it lands on the user's machine.

## Provenance record

Carry these fields forward to the Phase 4 report:

| Field          | Source                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suppliedAs`   | The identifier the user typed, verbatim                                                                                                              |
| `resolvedFrom` | `installUrl` (name form), clone URL (repo form), or `n/a`                                                                                            |
| `upstreamSha`  | Repo and name forms: `git -C "$WORK/repo" rev-parse HEAD`. Local path: `git -C "$SRC" rev-parse HEAD` when the source sits in a git repo, else `n/a` |
| `skillName`    | Frontmatter `name` of the resolved `SKILL.md`                                                                                                        |
| `skillPath`    | `$SKILL_PATH`                                                                                                                                        |
