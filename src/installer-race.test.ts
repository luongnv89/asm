/**
 * #869: a source SKILL.md swapped for an outside link between the check and
 * the read is never read. `realpath` is wrapped so the swap lands exactly
 * after the outside-link check has resolved the file inside its folder.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, unlink, symlink } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";

const hook = vi.hoisted(() => ({
  target: "" as string,
  onResolved: null as null | (() => Promise<void>),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  const realpath = (async (p: Parameters<typeof actual.realpath>[0]) => {
    const out = await actual.realpath(p);
    if (hook.onResolved && resolve(String(p)) === hook.target) {
      const swap = hook.onResolved;
      hook.onResolved = null;
      await swap();
    }
    return out;
  }) as typeof actual.realpath;
  return { ...actual, realpath, default: { ...actual, realpath } };
});

const { validateSkill, SkillMdOutsideFolderError } =
  await import("./installer");

describe.skipIf(process.platform === "win32")(
  "a SKILL.md swapped for an outside link after the check (#869)",
  () => {
    const SECRET = "OUTSIDE-SECRET-869-RACE";
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "asm-test-md-race-"));
    });

    afterEach(async () => {
      hook.onResolved = null;
      await rm(tempDir, { recursive: true, force: true });
    });

    test("validateSkill refuses it and never reads the outside file", async () => {
      const outsideMd = join(tempDir, "outside.md");
      await writeFile(outsideMd, `---\nname: ${SECRET}\n---\n`);
      const skill = join(tempDir, "skill");
      await mkdir(skill);
      const skillMd = join(skill, "SKILL.md");
      await writeFile(skillMd, "---\nname: inside\n---\n");

      hook.target = resolve(skillMd);
      hook.onResolved = async () => {
        await unlink(skillMd);
        await symlink(outsideMd, skillMd);
      };

      const outcome = await validateSkill(skill).then(
        (r) => r,
        (err: unknown) => err,
      );
      expect(hook.onResolved).toBeNull();
      expect(outcome).toBeInstanceOf(SkillMdOutsideFolderError);
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
      expect((outcome as Error).message).not.toContain(SECRET);
    });
  },
);
