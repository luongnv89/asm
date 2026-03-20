/**
 * Parse an editor command string (as found in $VISUAL or $EDITOR) into
 * [executable, args[]] for use with child_process.spawn.
 *
 * Handles:
 *   "vim"                        -> ["vim", []]
 *   "code --wait"                -> ["code", ["--wait"]]
 *   'emacsclient --tty -a ""'    -> ["emacsclient", ["--tty", "-a", ""]]
 */
export function parseEditorCommand(cmd: string): [string, string[]] {
  const trimmed = cmd.trim();
  if (!trimmed) return ["vi", []];

  const tokens: string[] = [];
  let current = "";
  let hasQuoted = false; // tracks whether current token contains a quoted segment
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    if (ch === '"') {
      // Double-quoted segment: respect \" and \\ escapes
      hasQuoted = true;
      i++;
      while (i < trimmed.length && trimmed[i] !== '"') {
        if (trimmed[i] === "\\" && i + 1 < trimmed.length) {
          const next = trimmed[i + 1];
          if (next === '"' || next === "\\") {
            current += next;
            i += 2;
            continue;
          }
        }
        current += trimmed[i];
        i++;
      }
      i++; // consume closing "
    } else if (ch === "'") {
      // Single-quoted segment: no escaping
      hasQuoted = true;
      i++;
      while (i < trimmed.length && trimmed[i] !== "'") {
        current += trimmed[i];
        i++;
      }
      i++; // consume closing '
    } else if (ch === " " || ch === "\t") {
      // Whitespace: flush current token (allow empty tokens from quotes like "")
      if (current.length > 0 || hasQuoted) {
        tokens.push(current);
        current = "";
        hasQuoted = false;
      }
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  if (current.length > 0 || hasQuoted) tokens.push(current);
  if (tokens.length === 0) return ["vi", []];

  return [tokens[0], tokens.slice(1)];
}
