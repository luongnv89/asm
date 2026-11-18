# Control bytes in asm output

Skill authors control many of the strings asm prints: skill and folder names,
descriptions, frontmatter, bundle and index fields, and file contents. A raw
control byte in one of them could move the cursor, recolour the terminal, open
an OSC 8 hyperlink or forge an output line. A Unicode bidi control can
reorder the text a reader sees ("Trojan Source"), so that `evil.sh` reads as
`hs.live`. Typed arguments that asm echoes back in an error can do the same.

The helpers live in `src/utils/control-chars.ts`. The rule was introduced in
#830 / PR #833, extended to the remaining surfaces in #834, and extended to
bidi controls in #835.

## The rule

- **Human output.** Before an author string or a typed argument is printed,
  every C0 control except TAB, plus DEL (U+007F), C1 (U+0080–U+009F) and the
  bidi controls below, is replaced with `?` (`stripControlBytes`). Table cells and other single-line
  fields replace TAB as well (`stripControlBytesLine`). Multi-line text is
  stripped one line at a time, so its line breaks stay.
- **Bidi controls.** ALM (U+061C), LRM and RLM (U+200E, U+200F), the
  embeddings and overrides LRE, RLE, PDF, LRO and RLO (U+202A–U+202E), and
  the isolates LRI, RLI, FSI and PDI (U+2066–U+2069). Right-to-left letters
  such as Arabic and Hebrew, and the joiners ZWNJ and ZWJ (U+200C, U+200D),
  are not controls and are printed unchanged.
- **Strip only at render.** Sorting, grouping, dedupe keys, lookups and file
  system calls use the original strings. Two different strings can strip to
  the same text, so a stripped copy is used for display only.
- **`--json` and `--machine`.** These outputs go through `stringifyForOutput`,
  which writes DEL, C1 and the bidi controls as `\uXXXX` escapes. The JSON stays valid and
  decodes to the original characters.
- **`asm install --json`.** The step headers and previews go to stderr, so
  stdout carries exactly one JSON document. This includes the
  non-interactive stops, for example "Repository contains N skills" with no
  `--path` or `--all`.
- **Errors.** `Error:` lines and the `Fatal error:` handler strip each line of
  the message, and of the stack and `cause` chain.

## Exceptions, by design

- **`asm get` body.** `asm get <skill>` writes the SKILL.md body to stdout
  unchanged, because that output is content for an agent to read, not a
  display. The provenance lines on stderr are stripped.
- **`asm import --diff`.** The diff is file content, so each diff line is
  stripped and the `?` marks where a control byte was. A trailing CR (a CRLF
  line ending) is dropped first, as in the `asm eval --fix` diff. For a CRLF
  file, the shown diff therefore differs from earlier versions only by those
  CR bytes.
- **`asm install --method vercel`.** The output of `npx skills add` is
  third-party tool output and is passed through unchanged.
- **`asm audit security` findings.** The line excerpt and file name in each
  code finding are stripped when the scan builds the finding (#809), so a
  `--json` finding shows `?` where a control character or bidi control was,
  not a `\uXXXX` escape. The excerpt is a display copy of a line, not
  author data.

## Bidi controls in skill files

`asm audit security` reports U+202A–U+202E and U+2066–U+2069 in a skill's
scanned files as a "Hidden Unicode (Trojan Source)" warning. LRM, RLM and
ALM are not reported, because they occur in ordinary right-to-left text.
