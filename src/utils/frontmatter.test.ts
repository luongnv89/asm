import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  resolveVersion,
  resolveCreator,
  resolveAllowedTools,
  resolveSkillDependencies,
  resolveTags,
  normalizeTag,
  normalizeTags,
  resolveModelInvocable,
  resolveUserInvocable,
  formatInvocability,
  matchesInvocabilityFilters,
} from "./frontmatter";

describe("tag normalization", () => {
  it("parses comma-separated, whitespace-separated, and inline-array tags", () => {
    expect(resolveTags({ tags: "CLI, Testing cli" })).toEqual([
      "cli",
      "testing",
    ]);
    expect(resolveTags({ tags: "['frontend', \"accessibility\"]" })).toEqual([
      "frontend",
      "accessibility",
    ]);
  });

  it("normalizes valid tags and rejects invalid values", () => {
    expect(normalizeTag(" TypeScript ")).toBe("typescript");
    expect(normalizeTag("c")).toBe("c");
    expect(normalizeTag("bad tag")).toBeNull();
    expect(normalizeTag("!bad")).toBeNull();
    expect(normalizeTag("x".repeat(33))).toBeNull();
    expect(normalizeTags(["CLI", "cli", "test_tools", ""])).toEqual([
      "cli",
      "test_tools",
    ]);
  });

  it("returns an empty list when tags are missing or invalid", () => {
    expect(resolveTags({})).toEqual([]);
    expect(resolveTags({ tags: "[!, @]" })).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("parses simple key-value pairs", () => {
    const input = `---
name: my-skill
version: 1.0.0
---
# Body content`;
    const result = parseFrontmatter(input);
    expect(result).toEqual({ name: "my-skill", version: "1.0.0" });
  });

  it("returns empty object for content without frontmatter", () => {
    const input = "# Just a markdown file\nNo frontmatter here.";
    expect(parseFrontmatter(input)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseFrontmatter("")).toEqual({});
  });

  it("strips surrounding double quotes from values", () => {
    const input = `---
name: "quoted-name"
---`;
    expect(parseFrontmatter(input)).toEqual({ name: "quoted-name" });
  });

  it("strips surrounding single quotes from values", () => {
    const input = `---
name: 'single-quoted'
---`;
    expect(parseFrontmatter(input)).toEqual({ name: "single-quoted" });
  });

  it("skips keys with empty values", () => {
    const input = `---
name:
version: 1.0.0
---`;
    expect(parseFrontmatter(input)).toEqual({ version: "1.0.0" });
  });

  it("handles literal block scalar (|)", () => {
    const input = `---
description: |
  Line one
  Line two
name: my-skill
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Line one Line two");
    expect(result.name).toBe("my-skill");
  });

  it("handles folded block scalar (>)", () => {
    const input = `---
description: >
  Folded line one
  Folded line two
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Folded line one Folded line two");
    expect(result.name).toBe("test");
  });

  it("handles block scalar with keep indicator (|+)", () => {
    const input = `---
description: |+
  Kept content
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Kept content");
    expect(result.name).toBe("test");
  });

  it("handles block scalar with strip indicator (>-)", () => {
    const input = `---
description: >-
  Stripped content
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Stripped content");
  });

  it("handles block scalar with |- indicator", () => {
    const input = `---
description: |-
  Literal stripped
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Literal stripped");
  });

  it("handles block scalar with >+ indicator", () => {
    const input = `---
description: >+
  Folded kept
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("Folded kept");
  });

  it("handles multiline value with blank lines inside", () => {
    const input = `---
description: |
  First paragraph

  Second paragraph
name: test
---`;
    const result = parseFrontmatter(input);
    expect(result.description).toBe("First paragraph Second paragraph");
  });

  it("handles multiple keys", () => {
    const input = `---
name: skill-one
version: 2.3.1
description: A useful skill
author: someone
---`;
    const result = parseFrontmatter(input);
    expect(result).toEqual({
      name: "skill-one",
      version: "2.3.1",
      description: "A useful skill",
      author: "someone",
    });
  });

  it("handles hyphenated keys", () => {
    const input = `---
my-key: my-value
---`;
    expect(parseFrontmatter(input)).toEqual({ "my-key": "my-value" });
  });

  it("stops parsing at second --- delimiter", () => {
    const input = `---
name: inside
---
outside: not-parsed`;
    const result = parseFrontmatter(input);
    expect(result).toEqual({ name: "inside" });
    expect(result.outside).toBeUndefined();
  });

  it("handles only opening delimiter with no closing", () => {
    const input = `---
name: unclosed
version: 1.0.0`;
    const result = parseFrontmatter(input);
    // flushKey is called at the end, so keys should be captured
    expect(result.name).toBe("unclosed");
    expect(result.version).toBe("1.0.0");
  });

  it("ignores lines before the first ---", () => {
    const input = `some random text
---
name: after-text
---`;
    expect(parseFrontmatter(input)).toEqual({ name: "after-text" });
  });

  it("handles values with colons", () => {
    const input = `---
url: https://example.com
---`;
    expect(parseFrontmatter(input)).toEqual({ url: "https://example.com" });
  });

  it("handles trailing whitespace on values", () => {
    const input = `---
name: trailing-spaces
---`;
    expect(parseFrontmatter(input)).toEqual({ name: "trailing-spaces" });
  });

  it("parses nested metadata block with dot notation", () => {
    const input = `---
name: my-skill
metadata:
  version: 1.0.0
  creator: Luong NGUYEN <luongnv89@gmail.com>
---`;
    const result = parseFrontmatter(input);
    expect(result.name).toBe("my-skill");
    expect(result["metadata.version"]).toBe("1.0.0");
    expect(result["metadata.creator"]).toBe(
      "Luong NGUYEN <luongnv89@gmail.com>",
    );
  });

  it("parses full new frontmatter format", () => {
    const input = `---
name: my-skill
description: A great skill
license: MIT
metadata:
  version: 1.0.0
  creator: Luong NGUYEN <luongnv89@gmail.com>
---
# Body`;
    const result = parseFrontmatter(input);
    expect(result).toEqual({
      name: "my-skill",
      description: "A great skill",
      license: "MIT",
      "metadata.version": "1.0.0",
      "metadata.creator": "Luong NGUYEN <luongnv89@gmail.com>",
    });
  });

  it("handles nested block with only one sub-key", () => {
    const input = `---
name: test
metadata:
  version: 2.0.0
---`;
    const result = parseFrontmatter(input);
    expect(result["metadata.version"]).toBe("2.0.0");
    expect(result["metadata.creator"]).toBeUndefined();
  });

  it("ends nested block at next top-level key", () => {
    const input = `---
metadata:
  version: 1.0.0
license: MIT
---`;
    const result = parseFrontmatter(input);
    expect(result["metadata.version"]).toBe("1.0.0");
    expect(result.license).toBe("MIT");
  });

  it("supports both top-level version and metadata.version", () => {
    const input = `---
name: test
version: 0.5.0
metadata:
  version: 1.0.0
---`;
    const result = parseFrontmatter(input);
    expect(result.version).toBe("0.5.0");
    expect(result["metadata.version"]).toBe("1.0.0");
  });

  it("handles nested sub-value with quoted strings", () => {
    const input = `---
metadata:
  version: "2.0.0"
  creator: 'Some Author'
---`;
    const result = parseFrontmatter(input);
    expect(result["metadata.version"]).toBe("2.0.0");
    expect(result["metadata.creator"]).toBe("Some Author");
  });

  it("skips nested sub-keys with empty values", () => {
    const input = `---
metadata:
  version:
  creator: Someone
---`;
    const result = parseFrontmatter(input);
    expect(result["metadata.version"]).toBeUndefined();
    expect(result["metadata.creator"]).toBe("Someone");
  });

  it("parses a YAML block list without consuming the following key", () => {
    const input = `---
name: parent
dependencies:
  - code-review
  - "github:owner/repo:skills/helper"
version: 1.0.0
---`;
    const result = parseFrontmatter(input);
    expect(result.dependencies).toBe(
      '["code-review","github:owner/repo:skills/helper"]',
    );
    expect(result.version).toBe("1.0.0");
  });

  it("preserves quoted dependency items and removes inline comments", () => {
    const input = `---
dependencies:
  - "github:owner/repo:skills/path with spaces" # optional helper
  - './local helper'
---`;
    expect(resolveSkillDependencies(parseFrontmatter(input))).toEqual([
      "github:owner/repo:skills/path with spaces",
      "./local helper",
    ]);
  });

  it("ignores full-line comments throughout dependency sequences", () => {
    const input = `---
dependencies:
  # before
  - code-review
    # between
  - "github:owner/repo:skills/helper"
  # after
metadata:
  version: 1.0.0
---`;
    const result = parseFrontmatter(input);
    expect(resolveSkillDependencies(result)).toEqual([
      "code-review",
      "github:owner/repo:skills/helper",
    ]);
    expect(result["metadata.version"]).toBe("1.0.0");
  });

  it("rejects unsupported dependency mappings clearly", () => {
    const input = `---
dependencies:
  helper: github:owner/repo
---`;
    expect(() => parseFrontmatter(input)).toThrow(
      "use a sequence of scalar strings",
    );
  });
});

describe("resolveCreator (#787)", () => {
  it("returns metadata.author when it is the only key", () => {
    expect(
      resolveCreator({
        "metadata.author": "Luong NGUYEN <luongnv89@gmail.com>",
      }),
    ).toBe("Luong NGUYEN");
  });

  it("prefers metadata.creator over metadata.author", () => {
    expect(
      resolveCreator({
        "metadata.creator": "creator-x",
        "metadata.author": "author-y",
      }),
    ).toBe("creator-x");
  });

  it("falls back to top-level creator, then author", () => {
    expect(resolveCreator({ creator: "legacy-c", author: "legacy-a" })).toBe(
      "legacy-c",
    );
    expect(resolveCreator({ author: "legacy-a" })).toBe("legacy-a");
    expect(
      resolveCreator({ "metadata.author": "meta-a", creator: "legacy-c" }),
    ).toBe("meta-a");
  });

  it("trims and skips blank values; empty string when none is set", () => {
    expect(
      resolveCreator({ "metadata.creator": "   ", "metadata.author": " a " }),
    ).toBe("a");
    expect(resolveCreator({ name: "x" })).toBe("");
  });

  it("keeps a plain handle as written", () => {
    expect(resolveCreator({ "metadata.author": "luongnv89" })).toBe(
      "luongnv89",
    );
  });

  it("strips a trailing <email>, including surrounding spaces", () => {
    expect(resolveCreator({ "metadata.author": "  Name <x@y>  " })).toBe(
      "Name",
    );
    expect(resolveCreator({ "metadata.creator": "Name<x@y>" })).toBe("Name");
    expect(resolveCreator({ "metadata.author": "<x@y>" })).toBe("");
  });

  it("returns empty for a bare email so no address is exposed", () => {
    expect(resolveCreator({ "metadata.author": "a@b.com" })).toBe("");
    expect(resolveCreator({ author: " a@b.com " })).toBe("");
    expect(resolveCreator({ author: "mailto:a@b.c" })).toBe("");
  });

  it("falls back to the next key when the winning key is only an email", () => {
    expect(
      resolveCreator({
        "metadata.creator": "a@b.c",
        "metadata.author": "Real Name",
      }),
    ).toBe("Real Name");
    expect(
      resolveCreator({
        "metadata.author": "<x@y.org>",
        creator: "",
        author: "Legacy",
      }),
    ).toBe("Legacy");
  });

  it("joins a list-form value with ', ', trimming and dropping empty parts", () => {
    expect(resolveCreator({ author: "Alice\nBob" })).toBe("Alice, Bob");
    expect(
      resolveCreator({ author: " Alice <a@x.io>\n\n  \nbob@x.io\n Bob " }),
    ).toBe("Alice, Bob");
    expect(
      resolveCreator(
        parseFrontmatter("---\nname: s\nauthor:\n  - Alice\n  - Bob\n---\n"),
      ),
    ).toBe("Alice, Bob");
  });

  // Every case the owner listed: the creator is a display name, so no email
  // may survive anywhere in it (#787).
  const EMAIL_CASES: Array<[string, Record<string, string>, string]> = [
    [
      "angle",
      { "metadata.author": "Luong NGUYEN <luongnv89@gmail.com>" },
      "Luong NGUYEN",
    ],
    ["angle, spaces", { "metadata.author": "  Name  <a@b.c>  " }, "Name"],
    ["bare", { "metadata.author": "a@b.c" }, ""],
    ["angle only", { "metadata.author": "<a@b.c>" }, ""],
    ["parens", { "metadata.author": "Name (a@b.c)" }, "Name"],
    ["inline", { "metadata.author": "Name a@b.c" }, "Name"],
    ["mailto", { "metadata.author": "Name <mailto:a@b.co>" }, "Name"],
    [
      "two in one line",
      { "metadata.author": "A <a@x.org>, B <b@y.org>" },
      "A, B",
    ],
    [
      "angle then role",
      { "metadata.author": "Alice <alice@x.org> (maintainer)" },
      "Alice (maintainer)",
    ],
    [
      "role with email inside",
      { "metadata.author": "Alice (maintainer, alice@x.org)" },
      "Alice (maintainer)",
    ],
    [
      "flow list",
      { "metadata.author": "[Alice <alice@x.org>, bob@y.org]" },
      "Alice",
    ],
    [
      "block list",
      parseFrontmatter(
        "---\nname: s\nauthor:\n  - Alice <alice@x.org>\n  - Bob (bob@y.org)\n  - carol@z.org\n---\n",
      ),
      "Alice, Bob",
    ],
    [
      "paren mid-sentence",
      {
        "metadata.author":
          "Cocoon AI (hello@cocoon-ai.com), ported by Hermes Agent",
      },
      "Cocoon AI, ported by Hermes Agent",
    ],
    ["bracketed", { author: "Name [first.last+tag@sub.example.org]" }, "Name"],
    ["team at", { "metadata.author": "Team @ Acme" }, "Team @ Acme"],
    ["handle", { "metadata.author": "@luongnv89" }, "@luongnv89"],
    ["plain", { "metadata.author": "luongnv89" }, "luongnv89"],
    [
      "fallback",
      { "metadata.creator": "a@b.c", "metadata.author": "Real Name" },
      "Real Name",
    ],
  ];

  it.each(EMAIL_CASES)("removes every email: %s", (_label, fm, expected) => {
    expect(resolveCreator(fm)).toBe(expected);
  });

  const EMAIL_SHAPE = /[^\s<>()[\],;:]+@[^\s<>()[\],;:]+\.[a-z]{2,}/i;

  it("never returns an email-shaped substring (property)", () => {
    const emails = [
      "a@b.co",
      "first.last+tag@sub.example.org",
      "MAILTO:x@y.io",
      "hello@cocoon-ai.com",
    ];
    const wrappers = ["%", "<%>", "(%)", "[%]", "< % >", "{%}"];
    const shapes = [
      "N W",
      "W N",
      "N W, Other",
      "N (role) W",
      "N W (role)",
      "W, N",
      "N W W",
      "[N W, W]",
      "N\nW\nOther W",
    ];
    const inputs = EMAIL_CASES.map(([, fm]) => fm);
    for (const email of emails) {
      for (const wrap of wrappers) {
        const w = wrap.replace("%", email);
        for (const shape of shapes) {
          const value = shape.replace("N", "Alice").replaceAll("W", w);
          inputs.push({ "metadata.author": value }, { author: value });
        }
      }
    }
    for (const fm of inputs) {
      const creator = resolveCreator(fm);
      expect(creator, JSON.stringify(fm)).not.toMatch(EMAIL_SHAPE);
      expect(creator, JSON.stringify(fm)).not.toMatch(/mailto/i);
      const raw = Object.values(fm).join(" ");
      if (raw.includes("Alice")) expect(creator).toContain("Alice");
    }
  });
});

describe("resolveVersion", () => {
  it("prefers metadata.version over top-level version", () => {
    expect(
      resolveVersion({ version: "0.5.0", "metadata.version": "1.0.0" }),
    ).toBe("1.0.0");
  });

  it("falls back to top-level version", () => {
    expect(resolveVersion({ version: "0.5.0" })).toBe("0.5.0");
  });

  it("defaults to 0.0.0 when no version present", () => {
    expect(resolveVersion({ name: "test" })).toBe("0.0.0");
  });

  it("defaults to 0.0.0 for empty object", () => {
    expect(resolveVersion({})).toBe("0.0.0");
  });
});

describe("parseFrontmatter — allowed-tools", () => {
  it("parses space-delimited allowed-tools", () => {
    const input = `---
name: my-skill
allowed-tools: Bash Read Grep
---`;
    const result = parseFrontmatter(input);
    expect(result["allowed-tools"]).toBe("Bash Read Grep");
  });

  it("parses allowed-tools as multiline block scalar", () => {
    const input = `---
name: my-skill
allowed-tools: |
  Bash Read Grep
  WebFetch Write
---`;
    const result = parseFrontmatter(input);
    expect(result["allowed-tools"]).toBe("Bash Read Grep WebFetch Write");
  });

  it("parses compatibility field", () => {
    const input = `---
name: my-skill
compatibility: Claude Code, Codex
---`;
    const result = parseFrontmatter(input);
    expect(result.compatibility).toBe("Claude Code, Codex");
  });

  it("parses full frontmatter with all spec fields", () => {
    const input = `---
name: code-review
description: Perform code reviews
license: MIT
compatibility: Claude Code
allowed-tools: Bash Read Grep Glob WebFetch
metadata:
  version: 1.0.1
  creator: Luong NGUYEN
---
# Body`;
    const result = parseFrontmatter(input);
    expect(result.name).toBe("code-review");
    expect(result.description).toBe("Perform code reviews");
    expect(result.license).toBe("MIT");
    expect(result.compatibility).toBe("Claude Code");
    expect(result["allowed-tools"]).toBe("Bash Read Grep Glob WebFetch");
    expect(result["metadata.version"]).toBe("1.0.1");
    expect(result["metadata.creator"]).toBe("Luong NGUYEN");
  });
});

describe("resolveAllowedTools", () => {
  it("splits space-delimited tools", () => {
    expect(resolveAllowedTools({ "allowed-tools": "Bash Read Grep" })).toEqual([
      "Bash",
      "Read",
      "Grep",
    ]);
  });

  it("handles multiline joined value", () => {
    expect(
      resolveAllowedTools({
        "allowed-tools": "Bash Read Grep WebFetch Write",
      }),
    ).toEqual(["Bash", "Read", "Grep", "WebFetch", "Write"]);
  });

  it("returns empty array when field is missing", () => {
    expect(resolveAllowedTools({})).toEqual([]);
  });

  it("returns empty array for empty value", () => {
    expect(resolveAllowedTools({ "allowed-tools": "" })).toEqual([]);
  });

  it("handles comma-separated tools", () => {
    expect(
      resolveAllowedTools({ "allowed-tools": "Bash, Read, Grep" }),
    ).toEqual(["Bash", "Read", "Grep"]);
  });
});

describe("resolveSkillDependencies", () => {
  it("normalizes block and inline list forms and removes duplicates", () => {
    expect(
      resolveSkillDependencies({
        dependencies:
          "code-review\ngithub:owner/repo:skills/helper\ncode-review",
      }),
    ).toEqual(["code-review", "github:owner/repo:skills/helper"]);
    expect(
      resolveSkillDependencies({
        dependencies: "['skill-creator', \"test-coverage\"]",
      }),
    ).toEqual(["skill-creator", "test-coverage"]);
  });

  it("preserves quoted spaces, commas, and inline comments", () => {
    expect(
      resolveSkillDependencies({
        dependencies:
          '["./path with spaces", "github:owner/repo:skills/a,b"] # comment',
      }),
    ).toEqual(["./path with spaces", "github:owner/repo:skills/a,b"]);
    expect(
      resolveSkillDependencies({
        dependencies:
          "\"./path with spaces\" # first\n'github:owner/repo:skills/other path' # second",
      }),
    ).toEqual(["./path with spaces", "github:owner/repo:skills/other path"]);
  });

  it("rejects non-string and nested dependency values", () => {
    expect(() =>
      resolveSkillDependencies({ dependencies: "[skill, { nested: value }]" }),
    ).toThrow("only non-empty strings");
    expect(() =>
      resolveSkillDependencies({ dependencies: '"unterminated' }),
    ).toThrow("unterminated quoted string");
  });

  it("returns an empty list when dependencies are omitted", () => {
    expect(resolveSkillDependencies({})).toEqual([]);
  });
});

describe("invocability frontmatter (#417)", () => {
  it("defaults model and user invocability to true", () => {
    expect(resolveModelInvocable({})).toBe(true);
    expect(resolveUserInvocable({})).toBe(true);
    expect(formatInvocability(undefined, undefined)).toBe("both");
  });

  it("treats disable-model-invocation true as model off", () => {
    expect(resolveModelInvocable({ "disable-model-invocation": "true" })).toBe(
      false,
    );
    expect(formatInvocability(false, true)).toBe("user");
  });

  it("treats user-invocable false as user off", () => {
    expect(resolveUserInvocable({ "user-invocable": "false" })).toBe(false);
    expect(formatInvocability(true, false)).toBe("model");
  });

  it("never collapses both into a single-side label", () => {
    expect(formatInvocability(true, true)).toBe("both");
    expect(formatInvocability(false, false)).toBe("none");
  });

  it("filters independently and ANDs when both flags are set", () => {
    const both = { modelInvocable: true, userInvocable: true };
    const modelOnly = { modelInvocable: true, userInvocable: false };
    const userOnly = { modelInvocable: false, userInvocable: true };
    expect(
      matchesInvocabilityFilters(modelOnly, { modelInvocable: true }),
    ).toBe(true);
    expect(matchesInvocabilityFilters(userOnly, { modelInvocable: true })).toBe(
      false,
    );
    expect(matchesInvocabilityFilters(userOnly, { userInvocable: true })).toBe(
      true,
    );
    expect(
      matchesInvocabilityFilters(modelOnly, {
        modelInvocable: true,
        userInvocable: true,
      }),
    ).toBe(false);
    expect(
      matchesInvocabilityFilters(both, {
        modelInvocable: true,
        userInvocable: true,
      }),
    ).toBe(true);
  });
});
