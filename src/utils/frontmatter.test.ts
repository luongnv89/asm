import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  resolveVersion,
  resolveAllowedTools,
} from "./frontmatter";

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
