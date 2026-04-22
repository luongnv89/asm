import { describe, expect, it } from "vitest";
import { verifySkill } from "./verifier";
import type { DiscoveredSkill } from "./utils/types";

function makeSkill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    relPath: "test-skill",
    name: "test-skill",
    description: "A test skill for unit testing",
    version: "1.0.0",
    license: "MIT",
    creator: "tester",
    compatibility: "Claude Code",
    allowedTools: [],
    ...overrides,
  };
}

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill for unit testing
version: 1.0.0
license: MIT
---

# Test Skill

This is a test skill with meaningful body content that exceeds the minimum threshold.
`;

describe("verifySkill", () => {
  it("returns verified=true for a valid skill", () => {
    const result = verifySkill(makeSkill(), VALID_SKILL_MD);
    expect(result.verified).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("fails verification when name is missing", () => {
    const result = verifySkill(makeSkill({ name: "" }), VALID_SKILL_MD);
    expect(result.verified).toBe(false);
    expect(result.reasons).toContain("missing frontmatter field: name");
  });

  it("fails verification when description is missing", () => {
    const result = verifySkill(makeSkill({ description: "" }), VALID_SKILL_MD);
    expect(result.verified).toBe(false);
    expect(result.reasons).toContain("missing frontmatter field: description");
  });

  it("fails verification when SKILL.md body is too short", () => {
    const shortMd = `---
name: test
description: short
---
Hi`;
    const result = verifySkill(makeSkill(), shortMd);
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("body too short"))).toBe(true);
  });

  it("fails verification when SKILL.md content is empty", () => {
    const result = verifySkill(makeSkill(), "");
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("body too short"))).toBe(true);
  });

  it("fails verification when malicious atob pattern is detected", () => {
    const maliciousMd = `---
name: evil-skill
description: A malicious skill
---

# Evil Skill

This skill does something suspicious: atob('aGVsbG8=') to decode secrets.
Plus more content to pass the body length check for the minimum threshold.
`;
    const result = verifySkill(makeSkill(), maliciousMd);
    expect(result.verified).toBe(false);
    expect(
      result.reasons.some((r) => r.includes("malicious pattern detected")),
    ).toBe(true);
  });

  it("fails verification when credential patterns are detected", () => {
    const credMd = `---
name: cred-skill
description: A skill with leaked credentials
---

# Credential Leak

Configuration: API_KEY='sk-12345abcdef' should not be hardcoded in skills.
This is enough body content to pass the minimum body length requirement.
`;
    const result = verifySkill(makeSkill(), credMd);
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("credential-leak"))).toBe(
      true,
    );
  });

  it("can report multiple failure reasons", () => {
    const badMd = `---
name: bad
---
`;
    const result = verifySkill(makeSkill({ name: "", description: "" }), badMd);
    expect(result.verified).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("passes verification with frontmatter-only when body is sufficient", () => {
    const md = `---
name: good-skill
description: A properly documented skill
version: 1.0.0
---

# Good Skill

This skill provides helpful instructions for the AI agent. It includes
detailed guidance on how to handle various scenarios and edge cases.
`;
    const result = verifySkill(makeSkill(), md);
    expect(result.verified).toBe(true);
  });

  it("does not false-positive on long alphanumeric strings without base64 padding", () => {
    const safeMd = `---
name: safe-skill
description: A skill with long alphanumeric strings
---

# Safe Skill

Commit: e28618d99255b508b9f4180388d16b0fec5abcdef1234567890abcdef12345678
Path: /Users/someone/buildspace/luongnv89/some/really/long/path/that/exceeds/forty/chars
UUID: 550e8400e29b41d4a716446655440000abcdef01234567890abcdef0123456789

This is a valid skill with enough body content to pass the minimum threshold.
`;
    const result = verifySkill(makeSkill(), safeMd);
    expect(result.verified).toBe(true);
  });

  it("detects actual base64-encoded strings with padding after assignment", () => {
    const base64Md = `---
name: base64-skill
description: A skill with actual base64 data
---

# Base64 Skill

secret= dGhpcyBpcyBhIHNlY3JldCBtZXNzYWdlIHRoYXQgaXMgbG9uZyBlbm91Z2g=

This is enough body content to pass the minimum body length requirement.
`;
    const result = verifySkill(makeSkill(), base64Md);
    expect(result.verified).toBe(false);
    expect(result.reasons.some((r) => r.includes("obfuscation:base64"))).toBe(
      true,
    );
  });

  it("handles SKILL.md without frontmatter delimiters", () => {
    const noFrontmatter = `
# A skill without frontmatter

This is a plain markdown file with enough content to pass the body check.
It has no YAML frontmatter section at all.
`;
    const result = verifySkill(makeSkill(), noFrontmatter);
    expect(result.verified).toBe(true);
  });
});
