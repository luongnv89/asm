import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { rm, writeFile, mkdir, readFile } from "fs/promises";
import { homedir } from "os";
import { runCLI } from "./cli-test-harness";

// `asm tags` CLI tests — split from cli.test.ts (issue #678).
// ─── CLI integration: local skill tags (#584) ───────────────────────────────

describe("CLI integration: local skill tags", () => {
  const skillName = "issue-584-tag-fixture";
  const skillDir = join(homedir(), ".claude", "skills", skillName);

  beforeEach(async () => {
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: Tag CLI fixture\ntags: [cli, testing]\n---\nBody\n`,
    );
    await rm(join(process.env.ASM_CONFIG_DIR!, "skill-tags.json"), {
      force: true,
    });
  });

  afterEach(async () => {
    await rm(skillDir, { recursive: true, force: true });
    await rm(join(process.env.ASM_CONFIG_DIR!, "skill-tags.json"), {
      force: true,
    });
  });

  test("adds and removes persisted tags without changing SKILL.md", async () => {
    const before = await readFile(join(skillDir, "SKILL.md"), "utf-8");
    const added = await runCLI(
      "tag",
      "add",
      skillName,
      "automation,CLI",
      "--json",
    );
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout)[0].tags).toEqual([
      "cli",
      "testing",
      "automation",
    ]);
    expect(JSON.parse(added.stdout)[0].applied).toEqual(["automation"]);

    const removed = await runCLI(
      "tag",
      "remove",
      skillName,
      "testing",
      "--json",
    );
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout)[0].tags).toEqual(["cli", "automation"]);
    expect(JSON.parse(removed.stdout)[0].applied).toEqual(["testing"]);
    expect(await readFile(join(skillDir, "SKILL.md"), "utf-8")).toBe(before);
  });

  test("inspect --json reflects local tag edits", async () => {
    const added = await runCLI("tag", "add", skillName, "automation", "--json");
    expect(added.exitCode).toBe(0);

    const inspected = await runCLI("inspect", skillName, "--json");
    expect(inspected.exitCode).toBe(0);
    const data = JSON.parse(inspected.stdout);
    const skill = Array.isArray(data) ? data[0] : data;
    expect(skill.tags).toEqual(["cli", "testing", "automation"]);

    const inspectedText = await runCLI("inspect", skillName);
    expect(inspectedText.exitCode).toBe(0);
    expect(inspectedText.stdout).toContain("Tags:");
    expect(inspectedText.stdout).toContain("automation");
  });

  test("list and search accept repeatable AND tag filters", async () => {
    await runCLI("tag", "add", skillName, "automation", "--json");

    const listed = await runCLI(
      "list",
      "--tag",
      "cli,automation",
      "--tag",
      "testing",
      "--json",
    );
    expect(listed.exitCode).toBe(0);
    expect(
      JSON.parse(listed.stdout).map((skill: { name: string }) => skill.name),
    ).toContain(skillName);

    const searched = await runCLI(
      "search",
      skillName,
      "--installed",
      "--tag",
      "cli,automation",
      "--json",
    );
    expect(searched.exitCode).toBe(0);
    expect(JSON.parse(searched.stdout)).toMatchObject([
      { name: skillName, tags: ["cli", "testing", "automation"] },
    ]);

    const noMatch = await runCLI("list", "--tag", "cli,missing-tag", "--json");
    expect(noMatch.exitCode).toBe(0);
    expect(JSON.parse(noMatch.stdout)).toEqual([]);
  });

  test("rejects invalid and missing tag arguments", async () => {
    const invalid = await runCLI("tag", "add", skillName, "bad tag");
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("Invalid tag value");

    const missing = await runCLI("list", "--tag");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Missing value");
  });
});
