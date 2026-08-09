import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { checkHealth } from "./health";
import type { SkillInfo } from "./utils/types";
import { mkdtemp, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tempDir: string;

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const path = overrides.path ?? "/tmp/test-skill";
  return {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName: "test-skill",
    path,
    originalPath: path,
    location: "global-claude",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude Code",
    isSymlink: false,
    symlinkTarget: null,
    realPath: path,
    fileCount: 3,
    effort: undefined,
    ...overrides,
  };
}

describe("checkHealth", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "health-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array for healthy skill", async () => {
    // Create a SKILL.md with frontmatter and body
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---

This skill does something useful.
`,
    );
    const skill = makeSkill({ path: tempDir });
    const warnings = await checkHealth(skill);
    expect(warnings).toHaveLength(0);
  });

  it("uses cached scanner content without reading SKILL.md from disk", async () => {
    const skill = makeSkill({
      path: join(tempDir, "missing-skill"),
      _skillMdContent: `---
name: test-skill
version: 1.0.0
description: A test skill
---

Cached body content.
`,
    });

    await expect(checkHealth(skill)).resolves.toEqual([]);
  });

  it("treats empty cached content as present instead of falling back to disk", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---

Healthy disk body.
`,
    );
    const skill = makeSkill({ path: tempDir, _skillMdContent: "" });

    await expect(checkHealth(skill)).resolves.toEqual([
      {
        category: "empty-body",
        message: "SKILL.md contains only frontmatter with no body content",
      },
    ]);
  });

  it("produces identical warnings from cached content and disk fallback", async () => {
    const content = `---
name: test-skill
description: Invalid: unquoted value
---
`;
    await writeFile(join(tempDir, "SKILL.md"), content);
    const overrides = {
      description: "",
      version: "0.0.0",
      fileCount: 600,
    };

    const diskWarnings = await checkHealth(
      makeSkill({ path: tempDir, ...overrides }),
    );
    const cachedWarnings = await checkHealth(
      makeSkill({
        path: join(tempDir, "missing-skill"),
        _skillMdContent: content,
        ...overrides,
      }),
    );

    expect(cachedWarnings).toEqual(diskWarnings);
    expect(cachedWarnings.map((warning) => warning.category)).toEqual([
      "missing-description",
      "missing-version",
      "empty-body",
      "invalid-yaml",
      "high-file-count",
    ]);
  });

  it("warns on missing description", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir, description: "" });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).toContain("missing-description");
  });

  it("warns on missing version (0.0.0)", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
description: A test skill
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir, version: "0.0.0" });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).toContain("missing-version");
  });

  it("warns on empty body (frontmatter only)", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---
`,
    );
    const skill = makeSkill({ path: tempDir });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).toContain("empty-body");
  });

  it("warns on high file count", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir, fileCount: 600 });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).toContain("high-file-count");
  });

  it("does not warn on file count below threshold", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: A test skill
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir, fileCount: 499 });
    const warnings = await checkHealth(skill);
    expect(warnings).toHaveLength(0);
  });

  it("warns on invalid YAML frontmatter", async () => {
    // Embedded quotes + colon later triggers YAML flow mapping error
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: Use when users ask to "build a CLI", "create a tool", or mention frameworks. Follows a strict workflow: Analyze -> Execute.
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).toContain("invalid-yaml");
  });

  it("does not warn on valid YAML frontmatter", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
version: 1.0.0
description: "Use when users ask to build a CLI or create something"
---

Body content here.
`,
    );
    const skill = makeSkill({ path: tempDir });
    const warnings = await checkHealth(skill);
    const cats = warnings.map((w) => w.category);
    expect(cats).not.toContain("invalid-yaml");
  });

  it("warning objects have category and message", async () => {
    await writeFile(
      join(tempDir, "SKILL.md"),
      `---
name: test-skill
---
`,
    );
    const skill = makeSkill({
      path: tempDir,
      description: "",
      version: "0.0.0",
    });
    const warnings = await checkHealth(skill);
    for (const w of warnings) {
      expect(typeof w.category).toBe("string");
      expect(typeof w.message).toBe("string");
      expect(w.category.length).toBeGreaterThan(0);
      expect(w.message.length).toBeGreaterThan(0);
    }
  });
});
