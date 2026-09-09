import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runProvider } from "../../../runner";
import { skillBestPracticeProviderV1 } from "./index";

const FIXTURES_DIR = join(__dirname, "fixtures");

// Tests build a real skill directory because the provider checks the
// frontmatter `name` against the parent directory basename. The outer tmp
// dir is throwaway; the inner `dirName` directory is what the provider sees
// as the skill root.
async function withSkill(
  dirName: string,
  content: string,
  testFn: (skillPath: string) => Promise<void>,
): Promise<void> {
  const tmpRoot = await mkdtemp(
    join(tmpdir(), "skill-best-practice-provider-"),
  );
  try {
    const skillPath = join(tmpRoot, dirName);
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), content, "utf-8");
    await testFn(skillPath);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function run(content: string, dirName = "test-skill") {
  let result: Awaited<ReturnType<typeof runProvider>> | null = null;
  await withSkill(dirName, content, async (skillPath) => {
    result = await runProvider(skillBestPracticeProviderV1, {
      skillPath,
      skillMdPath: join(skillPath, "SKILL.md"),
    });
  });
  return result!;
}

// Load a fixture skill from `./fixtures/<fixtureName>/SKILL.md`, copy it into
// a tmp directory whose basename equals `dirName` (defaults to the fixture
// name), and run the provider against it. Lets pass/fail fixtures live as
// real on-disk SKILL.md files (AC #3) while still controlling the directory
// basename the provider sees for `name-matches-directory`.
async function runFixture(fixtureName: string, dirName = fixtureName) {
  const content = await readFile(
    join(FIXTURES_DIR, fixtureName, "SKILL.md"),
    "utf-8",
  );
  return run(content, dirName);
}

describe("skillBestPracticeProviderV1", () => {
  it("accepts a valid skill", async () => {
    const result = await run(`---
name: test-skill
description: Validate a skill when asked. Don't use for unrelated docs.
license: MIT
compatibility: Claude Code
effort: medium
metadata:
  version: 1.0.0
  author: Test User
---

# Valid
`);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
    expect(result.categories[0]?.score).toBe(result.categories[0]?.max);
  });

  it("accepts effort: xhigh", async () => {
    const result = await runFixture("effort-xhigh-pass");
    expect(result.passed).toBe(true);
    expect(result.findings.some((f) => f.code === "effort-enum")).toBe(false);
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
    const result = await run(
      `---
name: disallowed-key
description: Validate a skill when asked. Don't use for unrelated docs.
creator: Somebody
---
`,
      "disallowed-key",
    );
    expect(result.passed).toBe(false);
    expect(result.findings.some((f) => f.code === "allowed-keys")).toBe(true);
  });

  it("allows optional skill dependency metadata", async () => {
    const result = await run(
      `---
name: dependency-metadata
description: Validate dependencies when asked. Don't use for unrelated docs.
dependencies:
  - code-review
  - github:owner/repo:skills/helper
---
`,
      "dependency-metadata",
    );
    expect(result.findings.some((f) => f.code === "allowed-keys")).toBe(false);
    expect(result.findings.some((f) => f.code === "dependencies-shape")).toBe(
      false,
    );
  });

  it.each([
    ["a mapping", "dependencies:\n  helper: github:owner/repo"],
    ["a scalar", "dependencies: code-review"],
    ["an empty list", "dependencies: []"],
    ["a nested value", "dependencies:\n  - [code-review]"],
    ["an empty string", 'dependencies:\n  - ""'],
  ])("fails when dependencies is %s", async (_label, dependenciesYaml) => {
    const result = await run(`---
name: test-skill
description: Validate dependencies when asked. Don't use for unrelated docs.
${dependenciesYaml}
metadata:
  version: 1.0.0
  author: Test
---
`);
    expect(result.passed).toBe(false);
    expect(
      result.findings.some(
        (finding) =>
          finding.code === "dependencies-shape" && finding.severity === "error",
      ),
    ).toBe(true);
  });

  it("fails on invalid effort values", async () => {
    const result = await runFixture("invalid-effort");
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
name: test-skill
description: Validate a skill when asked.
metadata:
  version: 1.0.0
  author: Test
---
`);
    expect(result.passed).toBe(true);
    expect(
      result.findings.some(
        (f) => f.code === "negative-trigger-clause" && f.severity === "warning",
      ),
    ).toBe(true);
  });

  it("warns when description exceeds the 250-char runtime budget", async () => {
    const result = await runFixture("runtime-budget-fail");
    expect(
      result.findings.some(
        (f) =>
          f.code === "description-runtime-budget" && f.severity === "warning",
      ),
    ).toBe(true);
  });

  it("does NOT warn when description fits the runtime budget", async () => {
    const result = await runFixture("runtime-budget-pass");
    expect(
      result.findings.some((f) => f.code === "description-runtime-budget"),
    ).toBe(false);
  });

  it("accepts metadata.version when present", async () => {
    const result = await runFixture("metadata-version-present-pass");
    expect(
      result.findings.some((f) => f.code === "metadata-version-present"),
    ).toBe(false);
  });

  it("fails when metadata.version is missing", async () => {
    const result = await runFixture("metadata-version-present-fail");
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "metadata-version-present"),
    ).toBe(true);
  });

  it("accepts metadata.version in semver form", async () => {
    const result = await runFixture("metadata-version-semver-pass");
    expect(
      result.findings.some((f) => f.code === "metadata-version-semver"),
    ).toBe(false);
  });

  it("fails when metadata.version is not semver", async () => {
    const result = await runFixture("metadata-version-semver-fail");
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "metadata-version-semver"),
    ).toBe(true);
  });

  it("accepts metadata.author when present", async () => {
    const result = await runFixture("metadata-author-present-pass");
    expect(
      result.findings.some((f) => f.code === "metadata-author-present"),
    ).toBe(false);
  });

  it("warns when metadata.author is missing", async () => {
    const result = await runFixture("metadata-author-present-fail");
    expect(result.passed).toBe(true);
    expect(
      result.findings.some(
        (f) => f.code === "metadata-author-present" && f.severity === "warning",
      ),
    ).toBe(true);
  });

  it("fails when name does not match the parent directory", async () => {
    const result = await runFixture("actual-dir-name");
    expect(result.passed).toBe(false);
    expect(
      result.findings.some((f) => f.code === "name-matches-directory"),
    ).toBe(true);
  });
});
