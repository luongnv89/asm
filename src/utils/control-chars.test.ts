import { describe, test, expect } from "vitest";
import {
  stripControlBytes,
  stripControlBytesDeep,
  stringifyForOutput,
} from "./control-chars";

// ESC, an OSC 8 hyperlink, BEL, C1 CSI (U+009B) and DEL (#830).
const HOSTILE = "a\x1b[31m\x1b]8;;mailto:e@x\x07L\x1b]8;;\x07\x07\u009b\x7fz";

/** Raw control characters a JSON text may not carry outside its whitespace. */
function rawControls(text: string): string[] {
  // eslint-disable-next-line no-control-regex
  return text.match(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g) ?? [];
}

describe("stripControlBytes", () => {
  test("replaces C0 (except tab), DEL and C1 with ?", () => {
    expect(stripControlBytes("a\tb\0c\nd\x7fe\u0080f\u009fg")).toBe(
      "a\tb?c?d?e?f?g",
    );
    expect(stripControlBytes(HOSTILE)).toBe(
      "a?[31m?]8;;mailto:e@x?L?]8;;????z",
    );
  });

  test("leaves printable text, including non-ASCII, unchanged", () => {
    const text = "skill — 研究 ü   ok";
    expect(stripControlBytes(text)).toBe(text);
  });
});

describe("stripControlBytesDeep", () => {
  test("strips every string in nested arrays and plain objects, keys too", () => {
    const input = {
      name: HOSTILE,
      list: [HOSTILE, 3, null, { [`k${"\x1b"}`]: HOSTILE }],
      count: 2,
      flag: true,
    };
    expect(stripControlBytesDeep(input)).toEqual({
      name: stripControlBytes(HOSTILE),
      list: [
        stripControlBytes(HOSTILE),
        3,
        null,
        { "k?": stripControlBytes(HOSTILE) },
      ],
      count: 2,
      flag: true,
    });
  });

  test("returns a copy and never mutates its input", () => {
    const input = { name: HOSTILE, tags: [HOSTILE] };
    const out = stripControlBytesDeep(input);
    expect(out).not.toBe(input);
    expect(input.name).toBe(HOSTILE);
    expect(input.tags[0]).toBe(HOSTILE);
  });

  test("keeps non-plain objects as they are", () => {
    const when = new Date(0);
    const out = stripControlBytesDeep({ when, map: new Map([["a", 1]]) });
    expect(out.when).toBe(when);
    expect(out.map.get("a")).toBe(1);
  });

  test("survives a cycle", () => {
    const node: Record<string, unknown> = { name: "\x1bx" };
    node.self = node;
    const out = stripControlBytesDeep(node);
    expect(out.name).toBe("?x");
    expect(out.self).toBe(out);
  });
});

describe("stringifyForOutput", () => {
  test("is byte-identical to JSON.stringify for strings without C1 or DEL", () => {
    const samples: unknown[] = [
      { name: "skill", n: 1, nested: [true, null, { é: "研究 — ok" }] },
      ["a\tb", "line\nbreak", "\x1b[0m", "  "],
      "plain",
      42,
      null,
    ];
    for (const value of samples) {
      for (const space of [undefined, 0, 2]) {
        expect(stringifyForOutput(value, null, space)).toBe(
          JSON.stringify(value, null, space),
        );
      }
    }
    expect(stringifyForOutput(undefined)).toBe(JSON.stringify(undefined));
  });

  test("escapes DEL and C1 in values and keys; the JSON decodes to the original", () => {
    const value = { [HOSTILE]: [HOSTILE, { path: `/x/${HOSTILE}` }] };
    for (const space of [0, 2]) {
      const json = stringifyForOutput(value, null, space);
      expect(rawControls(json)).toEqual([]);
      expect(json).toContain("\\u009b");
      expect(json).toContain("\\u007f");
      expect(json).toContain("\\u001b");
      expect(JSON.parse(json)).toEqual(value);
    }
  });

  test("escapes every character in U+007F–U+009F", () => {
    let all = "";
    for (let c = 0x7f; c <= 0x9f; c++) all += String.fromCharCode(c);
    const json = stringifyForOutput(all);
    expect(rawControls(json)).toEqual([]);
    expect(json).toBe(
      `"${[...all].map((ch) => `\\u00${ch.charCodeAt(0).toString(16)}`).join("")}"`,
    );
    expect(JSON.parse(json)).toBe(all);
  });
});
