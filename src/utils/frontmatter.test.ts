import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "./frontmatter";

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
});
