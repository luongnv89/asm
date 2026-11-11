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
| `asm eval <collection>`                                    | each child skill's folder, and the child must sit inside the collection         |
| `asm eval github:…`                                        | each skill's folder, and the skill must sit inside the temporary clone          |

The boundary of a remote source is the whole checkout for `audit`, `get`,
`install` and `update`, so a skill may link to a sibling folder in the same
repository. `asm eval` scores one skill folder, so its boundary is that
folder, also for a remote source.

The "File Count" in `asm inspect` (skills and references) and the TUI detail
view walks the skill's real folder under the same boundary but reads no file
content and reports no finding: it counts regular files only (folders add 0),
a link inside the folder counts as its target (each real folder once), and a
link that leaves the folder, dangles or loops adds 0
([#826](https://github.com/luongnv89/asm/issues/826)).

## What a link becomes

- **Leaves the folder** (file, directory, FIFO or device, `~`, `/proc/self`,
  `/`): a critical finding, `path -> target (kind, NOT read)`. The target is
  never opened, so a link to `/` or `/proc/self` finishes at once.
- **Dangles or loops:** a critical finding, never followed.
- **Named `.git` or `node_modules`:** checked before the skip-list, so a link
  with one of those names that leaves the folder is still reported. Real
  `.git` and `node_modules` folders are skipped as before.
- **`SKILL.md` leaves the folder** (`asm eval`): the skill is not evaluated;
  the error is `Symlink not read: SKILL.md -> target (kind, NOT read)`, and
  `--fix` writes nothing. `--fix` also refuses to write its `SKILL.md.bak`
  backup through a link that leaves the folder or dangles.
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
to. A link that stays inside the folder is read and scored as before: a
folder reached through an in-folder link is walked again under that path,
at most 8 times per real folder, so folders that link to each other cannot
make the walk explode. Hidden folders and `node_modules` are skipped by
name, but a link with such a name that leaves the folder is still
reported. `shellcheck` runs with `--norc`, so a `.shellcheckrc` in or above
the skill cannot make it follow `source` lines out of the folder.

In a collection (`asm eval skills/`), a child skill folder that links
outside the collection, or a `github:` subpath that links outside the
clone, is not evaluated: its result is an error
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

- Finding installed skills (the scanner behind `asm list`) still reads each
  `SKILL.md`'s frontmatter, even through a link. An audit never prints a
  name taken from a `SKILL.md` outside the folder, but `asm list` and the
  body that `asm get` prints can show it.
- `asm eval` gives a skill with no licence file credit for the repository's
  (#771): it lists the names in the folders above the skill, up to the git
  root, and `stat`s a `LICENSE` candidate there. It never opens a file
  outside the skill folder.
- The walk resolves each entry, checks it, and then opens it by path. A link
  swapped in during that window could be followed (TOCTOU). It needs a writer
  racing the scan inside the folder.
