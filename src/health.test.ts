import { describe, expect, it, beforeEach, afterEach } from "bun:test";
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
