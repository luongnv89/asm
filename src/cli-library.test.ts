import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdir, realpath, rm, writeFile } from "fs/promises";
import { runCLI } from "./cli-test-harness";
import type { LibrarySkillInfo } from "./library";
import type { LibraryLockFile, LibrarySkillEntry } from "./utils/types";

// `asm library list` tag coverage (PR1 of the tag-library feature):
//   - `--tag` filters by AND over the EFFECTIVE tags — frontmatter tags plus
//     the skill-tags.json overlay, keyed by the canonical library path;
//   - `--json` rows gain a `tags` array (existing fields unchanged);
//   - the human table keeps its five columns, matching `asm list`.
// ─── CLI integration: library skill tags ────────────────────────────────────

const configDir = () => process.env.ASM_CONFIG_DIR!;
const libraryDir = () => join(configDir(), "library");
const skillsDir = () => join(libraryDir(), "skills");

type LibraryRowJson = LibrarySkillInfo & { tags: string[] };

interface FixtureSkill {
  dirName: string;
  /** Frontmatter tags; omitted means the SKILL.md has no tags line. */
  tags?: string[];
  /** false plants a lock entry whose library copy is gone (`missing`). */
  onDisk?: boolean;
}

async function setupLibrary(skills: FixtureSkill[]): Promise<void> {
  const lock: LibraryLockFile = { version: 1, skills: {} };

  for (const skill of skills) {
    const libraryPath = join(skillsDir(), skill.dirName);
    lock.skills[skill.dirName] = {
      name: skill.dirName,
      version: "1.0.0",
      source: `local:${libraryPath}`,
      commitHash: "deadbeef",
      ref: null,
      skillPath: `skills/${skill.dirName}`,
      libraryPath,
      installedAt: "2026-01-01T00:00:00.000Z",
      sourceType: "local",
    } satisfies LibrarySkillEntry;

    if (skill.onDisk !== false) {
      await mkdir(libraryPath, { recursive: true });
      const tags = skill.tags ? `tags: [${skill.tags.join(", ")}]\n` : "";
      await writeFile(
        join(libraryPath, "SKILL.md"),
        `---\nname: ${skill.dirName}\ndescription: Fixture skill\n${tags}---\n# ${skill.dirName}\n`,
      );
    }
  }

  await mkdir(libraryDir(), { recursive: true });
  await writeFile(
    join(libraryDir(), "library-lock.json"),
    JSON.stringify(lock, null, 2),
  );
}

/** Write an overlay entry keyed exactly like `skillTagKey` (canonical path). */
async function writeTagOverlay(
  dirName: string,
  added: string[],
  removed: string[] = [],
): Promise<void> {
  const key = await realpath(join(skillsDir(), dirName));
  await writeFile(
    join(configDir(), "skill-tags.json"),
    JSON.stringify(
      { version: 1, skills: { [key]: { added, removed } } },
      null,
      2,
    ),
  );
}

async function listJson(...extraArgs: string[]): Promise<LibraryRowJson[]> {
  const res = await runCLI("library", "list", "--json", ...extraArgs);
  expect(res.exitCode).toBe(0);
  expect(res.stderr).toBe("");
  return JSON.parse(res.stdout) as LibraryRowJson[];
}

function names(rows: LibraryRowJson[]): string[] {
  return rows.map((row) => row.name);
}

beforeEach(async () => {
  await rm(libraryDir(), { recursive: true, force: true });
  await rm(join(configDir(), "skill-tags.json"), { force: true });
});

afterEach(async () => {
  await rm(libraryDir(), { recursive: true, force: true });
  await rm(join(configDir(), "skill-tags.json"), { force: true });
});

describe("CLI integration: asm library list tags", () => {
  test("--json rows carry effective tags and keep the existing fields", async () => {
    await setupLibrary([
      { dirName: "alpha", tags: ["docs", "cli"] },
      { dirName: "beta", tags: ["docs", "testing"] },
      { dirName: "gamma" },
    ]);

    const rows = await listJson();

    expect(names(rows)).toEqual(["alpha", "beta", "gamma"]);
    expect(rows[0]).toMatchObject({
      dirName: "alpha",
      name: "alpha",
      version: "1.0.0",
      source: `local:${join(skillsDir(), "alpha")}`,
      skillPath: "skills/alpha",
      libraryPath: join(skillsDir(), "alpha"),
      missing: false,
      tags: ["docs", "cli"],
    });
    expect(rows[1].tags).toEqual(["docs", "testing"]);
    expect(rows[2].tags).toEqual([]);
  });

  test("--tag filters by AND across repeatable and comma-separated flags", async () => {
    await setupLibrary([
      { dirName: "alpha", tags: ["docs", "cli"] },
      { dirName: "beta", tags: ["docs", "testing"] },
      { dirName: "gamma" },
    ]);

    // No filter: every lock row is still listed.
    expect(names(await listJson())).toEqual(["alpha", "beta", "gamma"]);

    // Repeatable flags require every tag.
    expect(names(await listJson("--tag", "docs", "--tag", "cli"))).toEqual([
      "alpha",
    ]);

    // Comma-separated values in one flag behave the same way.
    expect(names(await listJson("--tag", "docs,testing"))).toEqual(["beta"]);

    // A single tag matches every skill that carries it.
    expect(names(await listJson("--tag", "docs"))).toEqual(["alpha", "beta"]);

    // One missing tag excludes an otherwise matching row.
    expect(await listJson("--tag", "docs", "--tag", "missing")).toEqual([]);
  });

  test("--tag uses effective tags from the skill-tags.json overlay", async () => {
    await setupLibrary([{ dirName: "alpha", tags: ["docs", "cli"] }]);
    // Added tags join the frontmatter set; removed tags tombstone it. The
    // overlay key is realpath(libraryPath), which is what activated copies
    // of this skill also resolve to.
    await writeTagOverlay("alpha", ["overlay"], ["cli"]);

    const rows = await listJson();
    expect(rows[0].tags).toEqual(["docs", "overlay"]);

    expect(names(await listJson("--tag", "overlay"))).toEqual(["alpha"]);
    expect(await listJson("--tag", "cli")).toEqual([]);
  });

  test("rejects invalid and missing --tag values with exit 2", async () => {
    await setupLibrary([{ dirName: "alpha", tags: ["docs"] }]);

    const invalid = await runCLI("library", "list", "--tag", "bad tag");
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("Invalid tag value");

    const missing = await runCLI("library", "list", "--tag");
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain("Missing value");
  });

  test("missing library copies keep their row, carry no tags, and never match", async () => {
    await setupLibrary([
      { dirName: "alpha", tags: ["docs"] },
      { dirName: "gone", onDisk: false },
    ]);

    const rows = await listJson();
    expect(names(rows)).toEqual(["alpha", "gone"]);
    expect(rows[1]).toMatchObject({ name: "gone", missing: true, tags: [] });

    expect(names(await listJson("--tag", "docs"))).toEqual(["alpha"]);
  });

  test("the human table keeps five columns and does not render tags", async () => {
    await setupLibrary([
      { dirName: "zebra", tags: ["docs"] },
      { dirName: "gone", onDisk: false },
    ]);

    const res = await runCLI("library", "list");
    expect(res.exitCode).toBe(0);

    const [header] = res.stdout.split("\n");
    expect(header).toMatch(/^Name\s+Version\s+Source\s+Path\s+Status$/);
    // Five aligned columns: name, version, source, path, status.
    expect(res.stdout).toMatch(/^zebra\s+1\.0\.0\s+\S+\s+skills\/zebra\s+ok$/m);
    expect(res.stdout).toMatch(
      /^gone\s+1\.0\.0\s+\S+\s+skills\/gone\s+missing$/m,
    );
    expect(res.stdout).not.toContain("Tags");
    expect(res.stdout).not.toContain("docs");
  });
});
