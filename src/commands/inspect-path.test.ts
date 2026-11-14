import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  chmod,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "fs/promises";
import { execFileSync } from "child_process";
import { createServer } from "net";
import { join } from "path";
import { tmpdir } from "os";
import {
  isInspectPathArg,
  isInspectPathFallback,
  readSkillFolder,
  InspectPathError,
} from "./inspect-path";

const POSIX = process.platform !== "win32";

describe("isInspectPathArg (#829)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), "asm-inspect-arg-")));
    await mkdir(join(cwd, ".skill"));
    await writeFile(join(cwd, ".skill", "SKILL.md"), "---\nname: s\n---\n");
    await mkdir(join(cwd, ".empty"));
    await writeFile(join(cwd, ".file"), "x");
    await mkdir(join(cwd, ".md-dir", "SKILL.md"), { recursive: true });
    if (POSIX) {
      await symlink(join(cwd, ".skill"), join(cwd, ".skill-link"));
      await symlink(join(cwd, "gone"), join(cwd, ".dangling"));
      await writeFile(join(cwd, "outside.md"), "---\nname: o\n---\n");
      await mkdir(join(cwd, ".md-out"));
      await symlink(join(cwd, "outside.md"), join(cwd, ".md-out", "SKILL.md"));
      await mkdir(join(cwd, ".md-in"));
      await writeFile(join(cwd, ".md-in", "real.md"), "---\nname: i\n---\n");
      await symlink("real.md", join(cwd, ".md-in", "SKILL.md"));
      await mkdir(join(cwd, ".md-locked"));
      await writeFile(join(cwd, ".md-locked", "SKILL.md"), "x");
      await chmod(join(cwd, ".md-locked", "SKILL.md"), 0o000);
    }
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test.each(["./x", "../x", "/abs/x", "skills/x", ".", "..", "x/", ".skill"])(
    "%s is a path",
    (arg) => {
      expect(isInspectPathArg(arg, cwd)).toBe(true);
    },
  );

  test.each([
    "code-review",
    "my_skill",
    "x.y",
    "skill-1.0",
    ".hidden",
    "..x",
    ".empty",
    ".file",
    ".md-dir",
  ])("%s is a name", (arg) => {
    expect(isInspectPathArg(arg, cwd)).toBe(false);
  });

  test.skipIf(!POSIX)(
    "a dot-named link is a path only when its target holds a SKILL.md",
    () => {
      expect(isInspectPathArg(".skill-link", cwd)).toBe(true);
      expect(isInspectPathArg(".dangling", cwd)).toBe(false);
    },
  );

  test.skipIf(!POSIX)(
    "a SKILL.md link counts only while it stays inside the folder",
    () => {
      expect(isInspectPathArg(".md-in", cwd)).toBe(true);
      expect(isInspectPathArg(".md-out", cwd)).toBe(false);
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "an unreadable SKILL.md does not make a dot name a path",
    () => {
      expect(isInspectPathArg(".md-locked", cwd)).toBe(false);
    },
  );

  test("a dot name falls back to the path error only when something exists", () => {
    expect(isInspectPathFallback(".empty", cwd)).toBe(true);
    expect(isInspectPathFallback(".file", cwd)).toBe(true);
    expect(isInspectPathFallback(".hidden", cwd)).toBe(false);
    if (POSIX) expect(isInspectPathFallback(".dangling", cwd)).toBe(false);
  });
});

describe("readSkillFolder (#829)", () => {
  let root: string;
  let skillDir: string;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "asm-inspect-folder-")));
    skillDir = join(root, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: d\nversion: 2.0.0\n---\n\nBody\n",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("builds an uninstalled SkillInfo from the folder", async () => {
    const skill = await readSkillFolder(skillDir);
    expect(skill).toMatchObject({
      name: "my-skill",
      version: "2.0.0",
      dirName: "my-skill",
      path: skillDir,
      realPath: skillDir,
      provider: "",
      providerLabel: "",
      location: "",
      scope: null,
      isSymlink: false,
    });
    expect(skill.tokenCount).toBeGreaterThan(0);
    // The SKILL.md text is cached for the health check, not serialized.
    expect(skill._skillMdContent).toContain("Body");
    expect(JSON.stringify(skill)).not.toContain("_skillMdContent");
  });

  test("falls back to the folder name when the frontmatter has none", async () => {
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\ndescription: d\n---\nB\n",
    );
    expect((await readSkillFolder(skillDir)).name).toBe("my-skill");
  });

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "a path under a parent that cannot be entered is SKILL_DIR_UNREADABLE",
    async () => {
      const parent = join(root, "p");
      await mkdir(join(parent, "s"), { recursive: true });
      await chmod(parent, 0o600);
      try {
        const err = await readSkillFolder(join(parent, "s")).catch((e) => e);
        expect(err).toBeInstanceOf(InspectPathError);
        expect(err.code).toBe("SKILL_DIR_UNREADABLE");
        expect(err.message).toBe(
          `Cannot read ${join(parent, "s")} (permission denied).`,
        );
      } finally {
        await chmod(parent, 0o755);
      }
    },
  );

  test("a missing folder is still No folder at", async () => {
    const err = await readSkillFolder(join(root, "gone")).catch((e) => e);
    expect(err).toBeInstanceOf(InspectPathError);
    expect(err.code).toBe("SKILL_NOT_FOUND");
    expect(err.message).toContain("No folder at");
  });

  test("a path that is a file is SKILL_PATH_NOT_DIR", async () => {
    const err = await readSkillFolder(join(skillDir, "SKILL.md")).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(InspectPathError);
    expect(err.code).toBe("SKILL_PATH_NOT_DIR");
    expect(err.message).toContain("is not a folder");
  });

  test("a folder without SKILL.md is SKILL_NOT_FOUND", async () => {
    const empty = join(root, "empty");
    await mkdir(empty);
    const err = await readSkillFolder(empty).catch((e) => e);
    expect(err).toBeInstanceOf(InspectPathError);
    expect(err.code).toBe("SKILL_NOT_FOUND");
  });

  test("a SKILL.md that is a folder is an error, not a crash", async () => {
    const odd = join(root, "odd");
    await mkdir(join(odd, "SKILL.md"), { recursive: true });
    const err = await readSkillFolder(odd).catch((e) => e);
    expect(err).toBeInstanceOf(InspectPathError);
    expect(err.code).toBe("SKILL_MD_UNREADABLE");
    expect(err.message).toContain("not a regular file");
  });

  test.skipIf(!POSIX)(
    "a SKILL.md that is a FIFO or a socket is SKILL_MD_UNREADABLE",
    async () => {
      const fifoDir = join(root, "fifo");
      await mkdir(fifoDir);
      execFileSync("mkfifo", [join(fifoDir, "SKILL.md")]);
      const sockDir = join(root, "sock");
      await mkdir(sockDir);
      const server = createServer();
      await new Promise<void>((done) =>
        server.listen(join(sockDir, "SKILL.md"), done),
      );
      try {
        for (const dir of [fifoDir, sockDir]) {
          const err = await readSkillFolder(dir).catch((e) => e);
          expect(err).toBeInstanceOf(InspectPathError);
          expect(err.code).toBe("SKILL_MD_UNREADABLE");
          expect(err.message).toBe(
            `${join(dir, "SKILL.md")} is not a regular file or could not be read.`,
          );
        }
      } finally {
        await new Promise((done) => server.close(done));
      }
    },
  );

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    "an unreadable SKILL.md, or a link to one inside the folder, is SKILL_MD_UNREADABLE",
    async () => {
      const locked = join(root, "locked");
      await mkdir(locked);
      await writeFile(join(locked, "SKILL.md"), "---\nname: l\n---\n");
      await chmod(join(locked, "SKILL.md"), 0o000);
      const viaLink = join(root, "via-link");
      await mkdir(viaLink);
      await writeFile(join(viaLink, "real.md"), "---\nname: v\n---\n");
      await chmod(join(viaLink, "real.md"), 0o000);
      await symlink("real.md", join(viaLink, "SKILL.md"));
      for (const dir of [locked, viaLink]) {
        const err = await readSkillFolder(dir).catch((e) => e);
        expect(err).toBeInstanceOf(InspectPathError);
        expect(err.code).toBe("SKILL_MD_UNREADABLE");
        expect(err.message).toContain(
          "is not a regular file or could not be read.",
        );
      }
    },
  );

  test.skipIf(!POSIX)(
    "a SKILL.md link out of the folder is SKILL_MD_OUTSIDE_LINK",
    async () => {
      const outside = join(root, "outside.md");
      await writeFile(outside, "---\nname: leaked\n---\n");
      const dir = join(root, "linked");
      await mkdir(dir);
      await symlink(outside, join(dir, "SKILL.md"));
      const err = await readSkillFolder(dir).catch((e) => e);
      expect(err).toBeInstanceOf(InspectPathError);
      expect(err.code).toBe("SKILL_MD_OUTSIDE_LINK");
      expect(err.message).not.toContain("leaked");
    },
  );

  test.skipIf(!POSIX)(
    "a SKILL.md link that stays inside the folder is read",
    async () => {
      const dir = join(root, "inner");
      await mkdir(join(dir, "docs"), { recursive: true });
      await writeFile(
        join(dir, "docs", "real.md"),
        "---\nname: inner-name\ndescription: d\n---\nB\n",
      );
      await symlink(join(dir, "docs", "real.md"), join(dir, "SKILL.md"));
      expect((await readSkillFolder(dir)).name).toBe("inner-name");
    },
  );
});
