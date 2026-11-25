# Symlink rule for skill scans

Every asm command that reads a skill's files to scan or score them follows one rule:
**nothing outside the skill folder is opened, read, walked or printed.** A
symlink that leaves the folder is a finding and is never followed
([#779](https://github.com/luongnv89/asm/issues/779),
[#791](https://github.com/luongnv89/asm/issues/791),
[#825](https://github.com/luongnv89/asm/issues/825)).

## Where it applies

| Command                                                    | Boundary                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `asm audit security <path>` (local folder or collection)   | the folder you name                                                             |
| `asm audit security <name>`, `--all`                       | the installed skill's own folder                                                |
| `asm audit security github:…`                              | the temporary checkout                                                          |
| `asm get <skill> --audit`                                  | the skill's folder (installed, library, local), or the temporary clone (remote) |
| `asm install` preview, `asm get` preview of a remote skill | the clone or local source root                                                  |
| `asm update`                                               | the clone of the new version                                                    |
| `asm publish`                                              | the skill folder                                                                |
| `asm eval <skill folder or SKILL.md>`, `asm eval --fix`    | the skill folder (the folder holding `SKILL.md`)                                |
| `asm eval <collection>`                                    | each child skill's folder; a child that is a link is its own real folder        |
| `asm eval github:…`                                        | each skill's folder, and the skill must sit inside the temporary clone          |
| `asm inspect <path>`                                       | the folder you name                                                             |
| Finding skills: `asm list`, `inspect`, `search`, the TUI   | each skill's `SKILL.md` must resolve inside the skill's real folder             |

The boundary of a remote source is the whole checkout for `audit`, `get`,
`install` and `update`, so a skill may link to a sibling folder in the same
repository. `asm eval` scores one skill folder, so its boundary is that
folder, also for a remote source.

The "File Count" in `asm inspect` (skills and references) and the TUI detail
view walks the skill's real folder under the skill-folder boundary but reads no file
content and reports no finding: it counts regular files only (folders add 0),
a link inside the folder counts as its target (each real folder once), and a
link that leaves the folder, dangles or loops adds 0
([#826](https://github.com/luongnv89/asm/issues/826)).
`asm inspect <path>` (a folder that is not installed,
[#829](https://github.com/luongnv89/asm/issues/829)) reads only that folder's
`SKILL.md`, and refuses one that links outside the folder as `asm eval` does
(`SKILL_MD_OUTSIDE_LINK` with `--machine`).

Finding skills (the scanner behind `asm list`, `asm inspect <name>`,
`asm search`, `asm get <name>`, `--json` and the TUI, including library rows)
reads a skill's `SKILL.md` only when it resolves inside the skill's real
folder, so an `asm link` folder and an in-folder `SKILL.md -> real.md` link
keep working. A `SKILL.md` that leaves the folder is never opened: the skill
is listed under its folder name with no frontmatter fields and a
`skill-md-outside-folder` warning, `SKILL.md -> target (file, NOT read)`, and
`asm get <name>` refuses it, for an installed or a library skill
([#795](https://github.com/luongnv89/asm/issues/795)).

## What a link becomes

- **Leaves the folder** (file, directory, FIFO or device, `~`, `/proc/self`,
  `/`): a critical finding, `path -> target (kind, NOT read)`. The target is
  never opened, so a link to `/` or `/proc/self` finishes at once.
- **Dangles or loops:** a critical finding, never followed.
- **Named `.git` or `node_modules`:** checked before the skip-list, so a link
  with one of those names that leaves the folder is still reported. Real
  `.git` and `node_modules` folders are skipped as before.
- **`SKILL.md` leaves the folder** (`asm eval`): the skill is not evaluated;
  the error is `Symlink not read: SKILL.md -> target (kind, NOT read)`
  (`--machine` code `SKILL_MD_OUTSIDE_LINK`), and `--fix` writes nothing.
  `--fix` also refuses to write its `SKILL.md.bak` backup through a link
  that leaves the folder or dangles (`SKILL.md.bak -> target (kind, NOT
written)`).
- **Hard link** (a regular file with `st_nlink > 1`): read like any file,
  with an info note that its content may be shared with a file outside the
  folder. A hard link cannot be told apart from a normal file by its path.

A link finding is `critical` in severity but raises the verdict only to
`warning`, never `dangerous`, because the content behind it was not read.
Review those targets by hand. In practice:

- `asm update` skips the update unless you pass `--yes`, as for any warning.
- `asm publish` refuses unless you pass `--force`, as for any warning.
- In both cases the message names the links it did not read
  (`path -> target (kind)`, at most 3, then "and N more") and points to
  `asm audit security <name|path>` for the full report. `--json` and
  `--machine` carry the same list as `securityReasons` /
  `security_reasons`.
- The `asm install` and `asm get` previews list the link under
  `[Symlinks not read]` and label the skill **High Risk**. Whether
  `asm install` then copies such a link is tracked in
  [#753](https://github.com/luongnv89/asm/issues/753).

When `asm install` and `asm update` copy a skill, a relative link whose
target stays inside the copied folder (by its text and by its real path,
through real files and folders only, never through another link) keeps its
relative text, so it still resolves in the installed copy. Every
other link is copied as before: a relative link that leaves the folder,
dangles or loops is rewritten to an absolute path into the source
(the temporary clone for a remote skill), and an absolute link is kept
([#819](https://github.com/luongnv89/asm/issues/819)).

## In `asm eval`

A link that leaves the skill folder, dangles or loops is never linted,
PII-scanned or scored. It is reported once, however many in-folder paths
lead to it:

- `--json` and `--machine`: a `structure` finding
  `Symlink not read: path -> target (kind, NOT read)` (`not followed` for a
  dangling or looping link), and, in `--json`, `externalSymlinks` with the
  same fields as the audit's.
- Text: a `Symlinks not read (N):` block after the suggestions.

The link changes no score, so the score never depends on what it points
to: `asm eval` has no verdict, and `--min-score` / `--min-category` judge
the score alone. A link named like a licence file (`LICENSE`) that leaves
the folder or dangles earns no licence credit; the skill scores as if it
had none. A link that stays inside the folder is read and scored as before: a
folder reached through an in-folder link is walked again under that path,
at most 8 times per real folder, so folders that link to each other cannot
make the walk explode. Hidden folders and `node_modules` are skipped by
name, but a link with such a name that leaves the folder is still
reported. `shellcheck` runs with `--norc`, so a `.shellcheckrc` in or above
the skill cannot make it follow `source` lines out of the folder. Each linter
(`shellcheck`, `python3`) is run only from an absolute `PATH` entry, so an
empty, `.` or relative entry cannot make `asm eval` run a file of that name
the skill ships; with no absolute hit the lint is skipped as not installed
(on Windows the linter is still started by name). The linter itself starts
in asm's temporary copy folder with only the absolute `PATH` entries, so a
linter that looks up another program (an `env bash` shebang, a
version-manager shim) cannot reach the skill through a relative or `..`
entry either, even when `TMPDIR` is inside the skill (not on Windows).
The same `PATH` rule covers every `git` and `gh` child asm starts (clone,
checkout, fetch, `ls-remote` and `rev-parse` for `asm install`, `asm eval
github:…`, `asm update`, `asm outdated`, `asm index ingest` and the library,
plus `asm publish` and `asm doctor`) and the `npm` and `npx` it runs. Without
it, git's filter lookup (a `git-lfs` smudge filter in the user's config) ran
an executable the fresh clone ships. When no `PATH` entry is absolute, these
commands report that git was not found (not on Windows).
The git children that work on a repository asm does not own also run with
hooks turned off, except in the cases listed below. That covers the clone,
checkout, fetch, `ls-remote` and `rev-parse` above, `npx` (`skills add`
clones), and `npm`, whose
`--allow-git=none` stops it from cloning only where its version knows that
flag. Without this, a relative `core.hooksPath` in the user's config (such
as `.githooks`) resolved inside the fresh clone, and git ran the
`post-checkout` hook the clone ships before any audit. These settings are
added after any git config inherited from the environment (`asm outdated`
and pinned updates drop inherited git config first, as before):

- `core.hooksPath` points at `/dev/null`, or at the node binary on Windows,
  where Git for Windows would read `/dev/null` as a folder at the drive root.
  The Windows form has not been run on Windows.
- `hook.<event>.enabled=false` is set for every hook event. In git 2.55 and
  later this also turns off hooks defined in config (`hook.<name>.command`).
  Two cases are not covered, so a hook command in the user's own config
  still runs there: git 2.54, which has config-defined hooks but not this
  switch, and a user config that names a hook after an event (such as
  `hook.post-checkout.command` or `hook.post-checkout.parallel`, which git
  accepts). Git then reads `hook.post-checkout.enabled` as the switch for
  that one hook, and the user's other config hooks for `post-checkout` run.
- `core.fsmonitor` is set to an empty value, which turns the fsmonitor hook
  off. Git starts that hook from `core.fsmonitor`, not from the hooks
  folder, so a relative value (such as `./fsmonitor`) would run a file the
  clone ships when asm checks out a commit.

`asm publish`, `asm doctor` and the `git config` reads keep the user's
hooks, because they work on the user's own repository or config.

In a collection (`asm eval skills/`), a child that is a link to a folder
whose real path holds a `SKILL.md` is a skill folder in its own right, as
in "Linked folders" below: `asm activate`, cross-tool installs and
`asm link` create this layout. Its boundary is the child's real path, it is
evaluated exactly as `asm eval <child>` would be, and the link is reported
as information, not as an error: an `info: name -> target (linked skill
folder, evaluated at its real path)` line in text, and `link` (`path`,
`target`) on the result in `--json` and `--machine`. Links inside it that
leave its real path are not read, as for any skill. A child link that is a
file, or a folder with no `SKILL.md` (a link to `/` or `/proc/self`
included), is not a skill and is not listed: only the target and its
`SKILL.md` are `stat`ed, nothing is walked. A collection folder that is itself a link is
followed (see "Linked folders").

Each child's real path is resolved once, when the collection is read, and
that path is both the one checked and the only one read: `SKILL.md`, the
root listing, the walk, every file read and the linters' copies of the
scripts all go through it, never through the child's name again. A child
re-pointed or swapped for a link during the run is therefore never read
where it now leads: a linked child is still evaluated at the target its
`link` names, and a folder that no longer resolves to the path checked is
reported (`Symlink not read: . -> new target`, or an error saying it
changed after it was checked) and nothing more is read from it. Every file
read is checked after it is opened: the open file must be the one its path
names inside the checked folder. `asm audit security <collection>` walks
each child's checked real path the same way.

A `github:` source is untrusted content, so there a skill folder or subpath
that links outside the clone is not evaluated: its result is an error
`Symlink not read: name -> target (directory, NOT read)`.

## Linked folders

The folder you name, or an installed skill's folder, may itself be a link or
sit under one: an `asm link` dev install, a library install, a linked HOME.
It is followed, and the report shows its real path (`resolvedPath` in
`--json`, `Resolved:` in text). Links inside it then follow the rules above.

Every file read inside the folder is bounded. It is opened non-blocking,
`fstat` is checked on the descriptor (regular files only), and at most
`512 KiB + 1` bytes are read. `asm eval` raises that bound to the file's
size as the walk saw it, so a large file inside the folder is still read in
full.

## Known limits

- Discovery (`asm install` of a collection, the index) follows a sub-folder
  that is itself a link, as a linked skill folder is followed by design (see
  "Linked folders"), so a `SKILL.md` inside such a folder is read (tracked in
  [#753](https://github.com/luongnv89/asm/issues/753)).
- `asm eval` gives a skill with no licence file credit for the repository's
  (#771): it lists the names in the folders above the skill, up to the git
  root, and `stat`s a `LICENSE` candidate there. It never opens a file
  outside the skill folder.
- The walk resolves each entry, checks it, and then opens it by path. A link
  swapped in during that window could be followed (TOCTOU). It needs a writer
  racing the scan inside the folder. A `SKILL.md` read by `asm install` or
  `asm get` is the exception: it is read through a descriptor checked to be
  inside its folder, so a swap after the check reads nothing.
- `asm install --method vercel` hands the source to the Vercel skills CLI. A
  local source is checked first and refused when any `SKILL.md` in it links
  outside its folder; a remote source is cloned by that CLI, out of asm's
  reach, and only asm's own install that follows is checked.
