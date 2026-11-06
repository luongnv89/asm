# Edge cases — expected results

Read from SKILL.md when a run hits one of these inputs.

| Input                                                                | Expected result                                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Version already has an entry                                         | already recorded; file unchanged                                                                                    |
| Two committed bumps since the last run                               | entry for the newest; older ones offered as backfill                                                                |
| Bumped twice before commit (1.2.0 → 1.2.1)                           | the uncommitted 1.2.0 entry is replaced                                                                             |
| Folder renamed, same `name:` or rename staged                        | one entry; range spans both folder names                                                                            |
| First version                                                        | `Added` with "Initial release."                                                                                     |
| Formatting-only diff                                                 | one `Changed` bullet: "Maintenance only; no behaviour change."                                                      |
| Folder renamed and `name:` changed in one commit                     | `rename_candidate` set; ask, then `--accept-rename` on yes; with no user, blocked when that commit is also the bump |
| Folder moved with `mv`, deletion staged or not, new folder untracked | blocked (`unpaired_deletions`) until the rename is staged                                                           |
| Shallow clone, no frontmatter, outside git                           | blocked; no file written                                                                                            |
