import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import {
  loadLibrarySkills,
  partitionLibrarySkills,
  type LibrarySkill,
} from "./library-skills";
import { writeLibraryLock, emptyLibraryLock } from "./library-core";
import { getLibraryLockPath, getLibrarySkillsDir } from "./config";

/**
 * Library skills are invisible to `scanAllSkills`, so `asm tag add` and the
 * tag inventory need their own loader. These tests pin the loader contract:
 * frontmatter tags are read, the canonical path is the tag key, and missing
 * library directories are skipped.
 */

async function writeLibrarySkill(
  dirName: string,
  frontmatter: string,
): Promise<string> {
  const dir = join(getLibrarySkillsDir(), dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nBody\n`);
  return dir;
}

async function lockEntry(dirName: string, libraryPath: string) {
  return {
    name: dirName,
    version: "1.0.0",
    source: "local",
    sourceType: "local" as const,
    commitHash: "abc123",
    ref: null,
    skillPath: libraryPath,
    libraryPath,
    installedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("loadLibrarySkills", () => {
  beforeEach(async () => {
    await rm(getLibrarySkillsDir(), { recursive: true, force: true });
    await writeLibraryLock(emptyLibraryLock());
  });

  afterEach(async () => {
    await rm(getLibrarySkillsDir(), { recursive: true, force: true });
    await rm(getLibraryLockPath(), { force: true });
  });

  test("returns library skills with frontmatter tags and canonical realPath", async () => {
    const dir = await writeLibrarySkill(
      "tagged-lib",
      "name: tagged-lib\ndescription: Library fixture\ntags: [cli, testing]\nversion: 2.1.0",
    );
    const lock = emptyLibraryLock();
    lock.skills["tagged-lib"] = await lockEntry("tagged-lib", dir);
    await writeLibraryLock(lock);

    const skills = await loadLibrarySkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("tagged-lib");
    expect(skills[0].description).toBe("Library fixture");
    expect(skills[0].tags).toEqual(["cli", "testing"]);
    expect(skills[0].version).toBe("2.1.0");
    expect(skills[0].provider).toBe("library");
    expect(skills[0].location).toBe("library");
    expect(skills[0].dirName).toBe("tagged-lib");
    // realPath is canonicalized (on macOS the temp dir is a symlink), so an
    // activated copy of this skill shares one tag record with the library row.
    expect(skills[0].realPath).toBe(await realpath(dir));
    expect(skills[0].path).toBe(dir);
  });

  test("skips library entries whose directory is gone", async () => {
    const dir = await writeLibrarySkill(
      "present-lib",
      "name: present-lib\ndescription: Present",
    );
    const lock = emptyLibraryLock();
    lock.skills["present-lib"] = await lockEntry("present-lib", dir);
    lock.skills["gone-lib"] = await lockEntry(
      "gone-lib",
      join(getLibrarySkillsDir(), "gone-lib"),
    );
    await writeLibraryLock(lock);

    const skills = await loadLibrarySkills();
    expect(skills.map((s) => s.dirName)).toEqual(["present-lib"]);
  });

  test("returns an empty list when the library is empty", async () => {
    expect(await loadLibrarySkills()).toEqual([]);
  });

  test("reads a skill whose SKILL.md is unreadable without throwing", async () => {
    const dir = join(getLibrarySkillsDir(), "broken-lib");
    await mkdir(dir, { recursive: true });
    const lock = emptyLibraryLock();
    lock.skills["broken-lib"] = await lockEntry("broken-lib", dir);
    await writeLibraryLock(lock);

    const skills = await loadLibrarySkills();
    expect(skills).toHaveLength(0);
  });
});

describe("partitionLibrarySkills", () => {
  const make = (realPath: string): LibrarySkill =>
    ({
      realPath,
      dirName: realPath,
      name: realPath,
      path: realPath,
      originalPath: realPath,
      location: "library",
      scope: "global",
      provider: "library",
      providerLabel: "Library",
      isSymlink: false,
      symlinkTarget: null,
      description: "",
      creator: "",
      license: "",
      compatibility: "",
      allowedTools: [],
      version: "1.0.0",
    }) as LibrarySkill;

  test("separates library-only skills from already-scanned ones", () => {
    const scanned = make("/skills/scanned");
    const only = make("/skills/only");
    const { libraryOnly, alreadyScanned } = partitionLibrarySkills(
      [scanned, only],
      new Set(["/skills/scanned"]),
    );
    expect(alreadyScanned.map((s) => s.realPath)).toEqual(["/skills/scanned"]);
    expect(libraryOnly.map((s) => s.realPath)).toEqual(["/skills/only"]);
  });

  test("treats every skill as library-only when nothing is scanned", () => {
    const { libraryOnly, alreadyScanned } = partitionLibrarySkills(
      [make("/skills/a"), make("/skills/b")],
      new Set(),
    );
    expect(libraryOnly).toHaveLength(2);
    expect(alreadyScanned).toHaveLength(0);
  });
});
