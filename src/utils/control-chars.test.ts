import { describe, test, expect } from "vitest";
import {
  stripControlBytes,
  stripControlBytesDeep,
  stripControlBytesLine,
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

/** Every bidi control the helpers neutralise (#835). */
const BIDI_CODE_POINTS = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069,
];
const BIDI_ALL = String.fromCharCode(...BIDI_CODE_POINTS);

/** Right-to-left scripts and joiners that must pass through unchanged. */
const RTL_SAMPLES = [
  "مرحبا بالعالم", // Arabic
  "שלום עולם", // Hebrew
  "می\u200cخواهم", // Persian with ZWNJ
  "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}", // ZWJ emoji sequence
  "skill: سلام — ok",
];

describe("bidi controls (#835)", () => {
  test("stripControlBytes and stripControlBytesLine replace each with ?", () => {
    for (const cp of BIDI_CODE_POINTS) {
      const ch = String.fromCharCode(cp);
      expect(stripControlBytes(`a${ch}b`)).toBe("a?b");
      expect(stripControlBytesLine(`a${ch}b`)).toBe("a?b");
    }
    // The Trojan Source example: an RLO that makes `evil.sh` read reversed.
    expect(stripControlBytes("evil\u202ehs.sh")).toBe("evil?hs.sh");
    expect(stripControlBytesDeep({ ["k\u2066"]: ["v\u202e"] })).toEqual({
      "k?": ["v?"],
    });
  });

  test("leaves right-to-left text and joiners unchanged", () => {
    for (const text of RTL_SAMPLES) {
      expect(stripControlBytes(text)).toBe(text);
      expect(stripControlBytesLine(text)).toBe(text);
      expect(stringifyForOutput(text)).toBe(JSON.stringify(text));
    }
  });

  test("stringifyForOutput escapes each as \\uXXXX and round-trips", () => {
    const value = { name: `x${BIDI_ALL}y`, [`k${BIDI_ALL}`]: [BIDI_ALL] };
    for (const space of [0, 2]) {
      const json = stringifyForOutput(value, null, space);
      for (const cp of BIDI_CODE_POINTS) {
        expect(json).not.toContain(String.fromCharCode(cp));
        expect(json).toContain(`\\u${cp.toString(16).padStart(4, "0")}`);
      }
      expect(JSON.parse(json)).toEqual(value);
    }
  });
});

describe("stripControlBytesLine", () => {
  test("also replaces TAB, for single-line display fields", () => {
    expect(stripControlBytesLine("a\tb\0c\nd\x7fe\u0080f\u009fg")).toBe(
      "a?b?c?d?e?f?g",
    );
    expect(stripControlBytesLine("skill — 研究 ü   ok")).toBe(
      "skill — 研究 ü   ok",
    );
  });
});

describe("stripControlBytesDeep", () => {
  test("takes the per-string strip to apply", () => {
    expect(
      stripControlBytesDeep({ a: ["x\ty\x1b"] }, stripControlBytesLine),
    ).toEqual({ a: ["x?y?"] });
    expect(stripControlBytesDeep({ a: ["x\ty\x1b"] })).toEqual({
      a: ["x\ty?"],
    });
  });

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
