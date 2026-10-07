import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildGhostSkills } from "./ghost-skills";
import type { LibrarySkillInfo } from "./library-core";
import type { SkillInfo } from "./utils/types";

let libraryDir: string;

beforeEach(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), "asm-ghost-"));
});

afterEach(async () => {
  await rm(libraryDir, { recursive: true, force: true });
});

async function makeLibrarySkill(
  dirName: string,
  over: Partial<LibrarySkillInfo> = {},
): Promise<LibrarySkillInfo> {
  const libraryPath = join(libraryDir, dirName);
  await mkdir(libraryPath, { recursive: true });
  await writeFile(
    join(libraryPath, "SKILL.md"),
    `---
name: ${dirName}
description: Library copy of ${dirName}.
effort: low
metadata:
  creator: lib-author
---`,
  );
  return {
    dirName,
    name: dirName,
    version: "1.0.0",
    source: "local:/tmp/src",
    sourceType: "local",
    commitHash: "",
    ref: null,
    skillPath: dirName,
    libraryPath,
    installedAt: "2026-01-01T00:00:00.000Z",
    missing: false,
    ...over,
  };
}

function makeInstalled(dirName: string): SkillInfo {
  return {
    name: dirName,
    version: "1.0.0",
    description: "",
    creator: "",
    license: "",
    compatibility: "",
    allowedTools: [],
    dirName,
    path: `/installed/${dirName}`,
    originalPath: `/installed/${dirName}`,
    location: "global",
    scope: "global",
    provider: "claude",
    providerLabel: "Claude",
    isSymlink: false,
    symlinkTarget: null,
    realPath: `/installed/${dirName}`,
  };
}

describe("buildGhostSkills", () => {
  it("returns the library-minus-installed difference, enriched from SKILL.md", async () => {
    const library = [
      await makeLibrarySkill("alpha"),
      await makeLibrarySkill("beta"),
    ];
    const ghosts = await buildGhostSkills(
      library,
      [makeInstalled("BETA")],
      "project",
    );
    expect(ghosts.map((g) => g.dirName)).toEqual(["alpha"]);
    expect(ghosts[0]).toMatchObject({
      isGhost: true,
      scope: "project",
      provider: "library",
      description: "Library copy of alpha.",
      creator: "lib-author",
      effort: "low",
      path: library[0].libraryPath,
    });
    expect(ghosts[0].tokenCount).toBeGreaterThan(0);
  });

  it("generates no ghosts in the both scope and none for an empty library", async () => {
    const library = [await makeLibrarySkill("alpha")];
    expect(await buildGhostSkills(library, [], "both")).toEqual([]);
    expect(await buildGhostSkills([], [makeInstalled("beta")], "project")).toEqual([]);
  });

  it("degrades gracefully: unreadable SKILL.md is blank, missing dirs are skipped", async () => {
    const present = await makeLibrarySkill("alpha");
    const vanished = await makeLibrarySkill("beta", { missing: true });
    const ghosts = await buildGhostSkills(
      [present, vanished],
      [],
      "global",
    );
    expect(ghosts.map((g) => g.dirName)).toEqual(["alpha"]);
    expect(ghosts.every((g) => g.scope === "global")).toBe(true);
  });

  it("shows blank display fields for a present entry whose SKILL.md cannot be read", async () => {
    const entry = await makeLibrarySkill("alpha");
    await rm(entry.libraryPath, { recursive: true, force: true });
    const ghosts = await buildGhostSkills([{ ...entry, missing: false }], [], "project");
    expect(ghosts.map((g) => g.dirName)).toEqual(["alpha"]);
    expect(ghosts[0].description).toBe("");
    expect(ghosts[0].tokenCount).toBeUndefined();
  });
});
