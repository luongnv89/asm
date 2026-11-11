/**
 * Keep control characters from author-controlled strings (skill names, folder
 * and file names, link paths, frontmatter, index data) out of what asm prints
 * (issue #830).
 *
 * - Human output: {@link stripControlBytes} / {@link stripControlBytesDeep}
 *   replace every C0 (except TAB), DEL and C1 character with `?`, so nothing
 *   an author wrote can act as a terminal control sequence.
 *   {@link stripControlBytesLine} also replaces TAB, for single-line display
 *   fields such as table cells and list names.
 * - Strip only at render: sorting, grouping, dedupe keys, comparisons and
 *   anything that leads to an action run on the original strings. Two
 *   different strings can strip to the same text, so a stripped copy is for
 *   printing only.
 * - `--json` / `--machine` output: {@link stringifyForOutput} is
 *   `JSON.stringify` plus `\uXXXX` escapes for DEL and C1. `JSON.stringify`
 *   already escapes C0, so the JSON stays valid and decodes to the original
 *   characters, while no raw control byte reaches stdout.
 */

/** C0 except TAB, plus DEL (U+007F) and C1 (U+0080–U+009F). */
// eslint-disable-next-line no-control-regex
const CONTROL_BYTES = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;

/** {@link CONTROL_BYTES} plus TAB, for single-line display fields. */
// eslint-disable-next-line no-control-regex
const CONTROL_BYTES_AND_TAB = /[\x00-\x1f\x7f-\x9f]/g;

/** DEL and C1: the control characters `JSON.stringify` leaves raw. */
const JSON_RAW_CONTROLS = /[\u007f-\u009f]/g;

/**
 * Replace every control byte in `text` with `?` (TAB is kept). Use it on an
 * author-controlled string before it reaches human output.
 */
export function stripControlBytes(text: string): string {
  return text.replace(CONTROL_BYTES, "?");
}

/**
 * {@link stripControlBytes} that also replaces TAB with `?`. Use it on a
 * single-line display field (a table cell, a list name), where a TAB would
 * break the column alignment.
 */
export function stripControlBytesLine(text: string): string {
  return text.replace(CONTROL_BYTES_AND_TAB, "?");
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Return a copy of `value` with {@link stripControlBytes} applied to every
 * string inside it — object keys included — walking arrays and plain objects.
 * Other values (numbers, Dates, class instances) are kept as they are.
 *
 * `strip` picks the per-string treatment: {@link stripControlBytes} (the
 * default) or {@link stripControlBytesLine} for single-line display fields.
 *
 * Call it on the values a formatter is about to print, after every decision:
 * keys that collide after stripping merge, and different strings can compare
 * equal, so never sort, group, dedupe, compare or look up on the result, and
 * never pass it to file system calls. Its strings are for display only.
 */
export function stripControlBytesDeep<T>(
  value: T,
  strip: (text: string) => string = stripControlBytes,
): T {
  const seen = new Map<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return strip(v);
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (const item of v) out.push(walk(item));
      return out;
    }
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const [key, item] of Object.entries(v)) {
      out[strip(key)] = walk(item);
    }
    return out;
  };
  return walk(value) as T;
}

/**
 * `JSON.stringify` for anything asm prints to stdout or stderr (`--json`,
 * `--machine`). Same arguments (no replacer) and same output, except that DEL and C1
 * characters appear as `\u007f`…`\u009f` escapes instead of raw bytes. A JSON
 * text holds those characters only inside strings, so the escapes keep the
 * shape and decode to the same values; output without them is byte for byte
 * what `JSON.stringify` returns.
 *
 * JSON written to files (lock, index, config) keeps plain `JSON.stringify`.
 */
export function stringifyForOutput(
  value: unknown,
  replacer?: null,
  space?: string | number,
): string {
  // `JSON.stringify(undefined)` returns undefined at runtime; pass it through.
  const json = JSON.stringify(value, replacer, space) as string | undefined;
  if (json === undefined) return json as unknown as string;
  return json.replace(
    JSON_RAW_CONTROLS,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
