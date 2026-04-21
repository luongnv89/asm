import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runProvider } from "../../../runner";
import { skillBestPracticeProviderV1 } from "./index";

async function withSkill(
  content: string,
  testFn: (skillPath: string) => Promise<void>,
): Promise<void> {
  const skillPath = await mkdtemp(
    join(tmpdir(), "skill-best-practice-provider-"),
  );
  try {
    await writeFile(join(skillPath, "SKILL.md"), content, "utf-8");
    await testFn(skillPath);
  } finally {
    await rm(skillPath, { recursive: true, force: true });
  }
}

async function run(content: string) {
  let result: Awaited<ReturnType<typeof runProvider>> | null = null;
  await withSkill(content, async (skillPath) => {
    result = await runProvider(skillBestPracticeProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
  });
  return result!;
}

describe("skillBestPracticeProviderV1", () => {
  it("accepts a valid skill", async () => {
    const result = await run(`---
name: valid-skill
description: Validate a skill when asked. Don't use for unrelated docs.
license: MIT
compatibility: Claude Code
effort: medium
metadata:
  version: 1.0.0
---

# Valid
`);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
    expect(result.categories[0]?.score).toBe(result.categories[0]?.max);
  });

  it("fails when frontmatter is missing", async () => {
    const result = await run(`# Missing

No frontmatter here.
`);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "missing-frontmatter")).toBe(
      true,
    );
  });

  it("fails when YAML is invalid", async () => {
    const result = await run(`---
name: bad
description: [unterminated
---
`);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "invalid-yaml")).toBe(true);
  });

  it("fails on disallowed keys", async () => {
    const result = await run(`---
name: disallowed-key
description: Validate a skill when asked. Don't use for unrelated docs.
creator: Somebody
---
`);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "allowed-keys")).toBe(true);
  });

  it("fails on invalid effort values", async () => {
    const result = await run(`---
name: invalid-effort
description: Validate a skill when asked. Don't use for unrelated docs.
effort: XL
---
`);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "effort-enum")).toBe(true);
  });

  it("fails when required fields are missing", async () => {
    const result = await run(`---
license: MIT
---
`);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "name-present")).toBe(true);
    expect(result.findings.some((f) => f.code === "description-present")).toBe(
      true,
    );
  });

  it("emits a warning when negative-trigger guidance is missing", async () => {
    const result = await run(`---
name: warning-skill
description: Validate a skill when asked.
---
`);
    expect(result.passed).toBe(true);
    expect(
      result.findings.some(
        (f) => f.code === "negative-trigger-clause" && f.severity === "warning",
      ),
    ).toBe(true);
  });
});
