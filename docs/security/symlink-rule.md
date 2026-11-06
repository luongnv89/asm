# Symlink rule for skill scans

Every asm command that reads a skill's files to scan them follows one rule:
**nothing outside the skill folder is opened, read, walked or printed.** A
symlink that leaves the folder is a finding and is never followed
([#779](https://github.com/luongnv89/asm/issues/779),
[#791](https://github.com/luongnv89/asm/issues/791)).

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

The boundary of a remote source is the whole checkout, so a skill may link
to a sibling folder in the same repository.

## What a link becomes

- **Leaves the folder** (file, directory, FIFO or device, `~`, `/proc/self`,
  `/`): a critical finding, `path -> target (kind, NOT read)`. The target is
  never opened, so a link to `/` or `/proc/self` finishes at once.
- **Dangles or loops:** a critical finding, never followed.
- **Named `.git` or `node_modules`:** checked before the skip-list, so a link
  with one of those names that leaves the folder is still reported. Real
  `.git` and `node_modules` folders are skipped as before.
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

## Linked folders

The folder you name, or an installed skill's folder, may itself be a link or
sit under one: an `asm link` dev install, a library install, a linked HOME.
It is followed, and the report shows its real path (`resolvedPath` in
`--json`, `Resolved:` in text). Links inside it then follow the rules above.

Every file read inside the folder is bounded. It is opened non-blocking,
`fstat` is checked on the descriptor (regular files only), and at most
`512 KiB + 1` bytes are read.

## Known limits

- Finding installed skills (the scanner behind `asm list`) still reads each
  `SKILL.md`'s frontmatter, even through a link. An audit never prints a
  name taken from a `SKILL.md` outside the folder, but `asm list` and the
  body that `asm get` prints can show it.
- The walk resolves each entry, checks it, and then opens it by path. A link
  swapped in during that window could be followed (TOCTOU). It needs a writer
  racing the scan inside the folder.
