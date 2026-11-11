import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  formatLinkedSkillFolder,
  listSkillFiles,
  readSkillMd,
  skillDirOutside,
  SkillMdOutsideLinkError,
} from "./evaluator-files";
import {
  applyFix,
  evaluateSkill,
  formatReport,
  formatReportJSON,
  resolveEvalInput,
} from "./evaluator";
import { skillBestPracticeProviderV1 } from "./eval/providers/skill-best-practice/v1";

// #825: `asm eval` follows the symlink rule (docs/security/symlink-rule.md).
// Every outside target holds MARKER plus PII and broken Python: if eval read
// any of them, the marker, the address or a lint error would show up.

const MARKER = "OUTSIDE-MARKER-825";
const DIRTY_PY = `def broken(:\n    pass  # ${MARKER}\n`;
const DIRTY_MD = `${MARKER} mail leak.person@realcorp.io or call 415-555-0134\n`;
const CLEAN_PY = "x = 1\n";
const CLEAN_MD = "nothing here\n";
const POSIX = process.platform !== "win32";
const LINUX = process.platform === "linux";

const SKILL_MD = `---
name: s1
description: "Use when testing links. Prints hi."
license: MIT
---

# s1

Run \`python3 scripts/ok.py\`.
`;

let base: string;
let skill: string;
let outside: string;

async function writeOutside(dirty: boolean) {
  await writeFile(join(outside, "secret.py"), dirty ? DIRTY_PY : CLEAN_PY);
  await writeFile(join(outside, "dir", "bad2.py"), dirty ? DIRTY_PY : CLEAN_PY);
  await writeFile(
    join(outside, "dir", "notes.md"),
    dirty ? DIRTY_MD : CLEAN_MD,
  );
  await writeFile(join(outside, "SKILL.md"), dirty ? DIRTY_MD : CLEAN_MD);
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "asm-eval-links-")));
  skill = join(base, "s1");
  outside = join(base, "outside");
  await mkdir(join(outside, "dir"), { recursive: true });
  await mkdir(join(skill, "scripts"), { recursive: true });
  await mkdir(join(skill, "lib"), { recursive: true });
  await writeOutside(true);
  await writeFile(join(skill, "SKILL.md"), SKILL_MD);
  await writeFile(join(skill, "scripts", "ok.py"), CLEAN_PY);
  // In-folder: a broken script reached directly, by a file link and by a
  // folder link. All three paths are linted, as before #825.
  await writeFile(join(skill, "lib", "inner_bad.py"), "x = (\n");
  await symlink("../lib/inner_bad.py", join(skill, "scripts", "inner.py"));
  await symlink("lib", join(skill, "libalias"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** The case table: link path in the skill → expected kind. */
async function plantOutsideLinks(): Promise<Record<string, string>> {
  const s = (p: string) => join(skill, p);
  await symlink(join(outside, "secret.py"), s("scripts/linked.py"));
  await symlink(join(outside, "dir"), s("scripts/linkdir"));
  // Parent of the target path is itself a link that leaves the folder.
  await symlink("linkdir/bad2.py", s("scripts/viaparent.py"));
  await symlink("../../outside/secret.py", s("scripts/dotdot.py"));
  await symlink("../../outside/missing.py", s("scripts/gone.py"));
  // A hidden folder is skipped by name, but a link named like one is not.
  await symlink(join(outside, "dir"), s(".cache"));
  const expected: Record<string, string> = {
    "scripts/linked.py": "file",
    "scripts/linkdir": "directory",
    "scripts/viaparent.py": "file",
    "scripts/dotdot.py": "file",
    "scripts/gone.py": "dangling",
    ".cache": "directory",
  };
  if (POSIX) {
    await symlink("/dev/zero", s("scripts/zero.py"));
    expected["scripts/zero.py"] = "special";
    spawnSync("mkfifo", [join(outside, "fifo")]);
    await symlink(join(outside, "fifo"), s("scripts/fifo.md"));
    expected["scripts/fifo.md"] = "special";
    await symlink("/", s("rootlink"));
    expected["rootlink"] = "directory";
  }
  if (LINUX) {
    await symlink("/proc/self", s("proc"));
    expected["proc"] = "directory";
  }
  return expected;
}

function scores(report: Awaited<ReturnType<typeof evaluateSkill>>) {
  return Object.fromEntries(report.categories.map((c) => [c.id, c.score]));
}

function lintFindings(report: Awaited<ReturnType<typeof evaluateSkill>>) {
  return report.categories.find((c) => c.id === "script-lint")!.findings;
}

describe("asm eval keeps to the skill folder (#825)", () => {
  test.skipIf(!POSIX)(
    "each outside link is reported once, never read, and never scored",
    async () => {
      const baseline = await evaluateSkill(skill);
      const expected = await plantOutsideLinks();

      const started = Date.now();
      const report = await evaluateSkill(skill);
      expect(Date.now() - started).toBeLessThan(10_000);

      const links = Object.fromEntries(
        (report.externalSymlinks ?? []).map((l) => [l.path, l.kind]),
      );
      expect(links).toEqual(expected);
      expect(report.externalSymlinks).toHaveLength(
        Object.keys(expected).length,
      );

      const structure = report.categories.find((c) => c.id === "structure")!;
      for (const path of Object.keys(expected)) {
        const hits = structure.findings.filter((f) =>
          f.startsWith(`Symlink not read: ${path} -> `),
        );
        expect(hits).toHaveLength(1);
      }

      // Neither surface carries anything from behind a link.
      const json = formatReportJSON(report);
      const text = formatReport(report);
      for (const out of [json, text]) {
        expect(out).not.toContain(MARKER);
        expect(out).not.toContain("realcorp");
        expect(out).not.toContain("415-555");
      }
      expect(text).toContain("Symlinks not read (");
      expect(text).toContain("scripts/linked.py -> ");
      expect(text).toContain("(file, NOT read)");
      expect(text).toContain("(dangling, not followed)");

      // No outside script is linted; in-folder ones still are.
      const lint = lintFindings(report).join("\n");
      for (const name of ["linked.py", "bad2.py", "viaparent", "dotdot"]) {
        expect(lint).not.toContain(name);
      }
      for (const rel of [
        "lib/inner_bad.py",
        "scripts/inner.py",
        "libalias/inner_bad.py",
      ]) {
        expect(lint).toContain(rel);
      }

      // The score does not depend on the links or on what they point to.
      expect(scores(report)).toEqual(scores(baseline));
      await writeOutside(false);
      expect(scores(await evaluateSkill(skill))).toEqual(scores(baseline));
    },
  );

  test("a skill with no outside links has no externalSymlinks field", async () => {
    const report = await evaluateSkill(skill);
    expect(report).not.toHaveProperty("externalSymlinks");
    expect(formatReport(report)).not.toContain("Symlinks not read");
  });

  test("in-folder links are still read and scored as before", async () => {
    const { files, externalSymlinks } = await listSkillFiles(skill);
    expect(externalSymlinks).toEqual([]);
    expect(files.map((f) => f.relPath).sort()).toEqual([
      "SKILL.md",
      "lib/inner_bad.py",
      "libalias/inner_bad.py",
      "scripts/inner.py",
      "scripts/ok.py",
    ]);
  });

  test("SKILL.md that links outside is refused without being read", async () => {
    const linked = join(base, "s2");
    await mkdir(linked);
    await symlink(join(outside, "SKILL.md"), join(linked, "SKILL.md"));
    const run = evaluateSkill(linked);
    await expect(run).rejects.toThrow(
      /Symlink not read: SKILL\.md -> .*\(file, NOT read\)/,
    );
    const err = await evaluateSkill(linked).catch((e: unknown) => e);
    expect(String(err)).not.toContain(MARKER);
    expect(err).toBeInstanceOf(SkillMdOutsideLinkError);
    // Named directly, its folder is still the boundary.
    await expect(evaluateSkill(join(linked, "SKILL.md"))).rejects.toThrow(
      /NOT read/,
    );
    await expect(
      skillBestPracticeProviderV1.run(
        { skillPath: linked, skillMdPath: join(linked, "SKILL.md") },
        {},
      ),
    ).rejects.toThrow(/NOT read/);
  });

  test.skipIf(!POSIX)(
    "SKILL.md linked to a special file is refused at once",
    async () => {
      const linked = join(base, "s3");
      await mkdir(linked);
      await symlink("/dev/zero", join(linked, "SKILL.md"));
      await expect(readSkillMd(join(linked, "SKILL.md"))).rejects.toThrow(
        /\(special, NOT read\)/,
      );
    },
  );

  test("readSkillMd reads an in-folder SKILL.md link and a large file in full", async () => {
    await mkdir(join(skill, "docs"));
    const big = SKILL_MD + "x".repeat(600 * 1024) + "\nEND\n";
    await writeFile(join(skill, "docs", "real.md"), big);
    await rm(join(skill, "SKILL.md"));
    await symlink("docs/real.md", join(skill, "SKILL.md"));
    expect(await readSkillMd(join(skill, "SKILL.md"))).toBe(big);
    expect(await readSkillMd(join(base, "nope", "SKILL.md"))).toBeNull();
  });

  test("--fix never reads or writes through a link that leaves the folder", async () => {
    const linked = join(base, "s4");
    await mkdir(linked);
    await symlink(join(outside, "SKILL.md"), join(linked, "SKILL.md"));
    await expect(applyFix(linked, { dryRun: false })).rejects.toThrow(
      /NOT read/,
    );
    expect(await readFile(join(outside, "SKILL.md"), "utf-8")).toBe(DIRTY_MD);

    // A backup link to outside would make copyFile write there.
    const victim = join(outside, "victim.txt");
    await writeFile(victim, "keep me\n");
    await rm(join(linked, "SKILL.md"));
    await writeFile(join(linked, "SKILL.md"), SKILL_MD); // no version: fixable
    await symlink(victim, join(linked, "SKILL.md.bak"));
    await expect(applyFix(linked, { dryRun: false })).rejects.toThrow(
      /Refusing to write through SKILL\.md\.bak -> .*\(file, NOT written\)/,
    );
    expect(await readFile(victim, "utf-8")).toBe("keep me\n");
    expect(await readFile(join(linked, "SKILL.md"), "utf-8")).toBe(SKILL_MD);
  });

  test("a collection child linked to a skill folder is its own skill folder", async () => {
    const coll = join(base, "coll");
    await mkdir(join(coll, "real"), { recursive: true });
    await writeFile(join(coll, "real", "SKILL.md"), SKILL_MD);
    await symlink(skill, join(coll, "away"));
    const resolved = await resolveEvalInput(coll);
    expect(resolved.isCollection).toBe(true);
    const away = resolved.targets.find((t) => t.label === "away")!;
    // Evaluated as `asm eval <child>` would be: no collection boundary, and
    // the link is reported as information.
    expect(away.boundary).toBeUndefined();
    expect(away.link).toEqual({ path: "away", target: skill });
    expect(formatLinkedSkillFolder(away.link!)).toBe(
      `away -> ${skill} (linked skill folder, evaluated at its real path)`,
    );
    const single = await resolveEvalInput(join(coll, "away"));
    expect(single.targets[0]).toEqual({
      skillPath: away.skillPath,
      skillMdPath: away.skillMdPath,
      label: away.label,
    });
    const real = resolved.targets.find((t) => t.label === "real")!;
    expect(real.boundary).toBe(coll);
    expect(real.link).toBeUndefined();
    expect(await skillDirOutside(real.skillPath, real.boundary!)).toBeNull();

    // Inside the linked child, links out of its real path are still unread.
    await plantOutsideLinks();
    const report = await evaluateSkill(away.skillPath);
    expect(report.externalSymlinks?.map((l) => l.path)).toContain(
      "scripts/linked.py",
    );
    expect(formatReportJSON(report)).not.toContain(MARKER);
  });

  test("a collection child link with no SKILL.md behind it is never listed", async () => {
    const coll = join(base, "coll");
    await mkdir(join(coll, "real"), { recursive: true });
    await writeFile(join(coll, "real", "SKILL.md"), SKILL_MD);
    await symlink(join(outside, "dir"), join(coll, "nomd")); // dir, no SKILL.md
    await symlink(join(outside, "SKILL.md"), join(coll, "filelink"));
    if (POSIX) await symlink("/", join(coll, "root"));
    if (LINUX) await symlink("/proc/self", join(coll, "proc"));
    const started = Date.now();
    const resolved = await resolveEvalInput(coll);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(resolved.targets.map((t) => t.label)).toEqual(["real"]);
  });

  test("an outside or dangling LICENSE link earns no licence credit", async () => {
    const lic = (r: Awaited<ReturnType<typeof evaluateSkill>>) =>
      r.categories.find((c) => c.id === "license")!.score;
    const none = await evaluateSkill(skill);
    await writeFile(join(outside, "LICENSE"), "MIT License\n");
    await symlink(join(outside, "LICENSE"), join(skill, "LICENSE"));
    const outsideLink = await evaluateSkill(skill);
    expect(lic(outsideLink)).toBe(lic(none));
    expect(outsideLink.overallScore).toBe(none.overallScore);
    expect(outsideLink.externalSymlinks?.map((l) => l.path)).toEqual([
      "LICENSE",
    ]);
    await rm(join(skill, "LICENSE"));
    await symlink(join(outside, "gone"), join(skill, "LICENSE"));
    const dangling = await evaluateSkill(skill);
    expect(lic(dangling)).toBe(lic(none));
    expect(dangling.overallScore).toBe(none.overallScore);
    // A real LICENSE in the folder still earns credit.
    await rm(join(skill, "LICENSE"));
    await writeFile(join(skill, "LICENSE"), "MIT License\n");
    expect(lic(await evaluateSkill(skill))).toBeGreaterThan(lic(none));
  });

  test("a remote subpath that links out of the clone is never listed", async () => {
    const clone = join(base, "clone");
    await mkdir(clone);
    // The outside folder holds a skill collection eval must not discover.
    await mkdir(join(outside, "child"), { recursive: true });
    await writeFile(join(outside, "child", "SKILL.md"), SKILL_MD);
    await symlink(outside, join(clone, "skills"));
    const resolved = await resolveEvalInput("github:acme/linked:skills", {
      fetchRemote: async () => ({
        rootDir: join(clone, "skills"),
        tempDir: clone,
        cleanup: async () => {},
        sourceRef: "github:acme/linked:skills",
        commitSha: null,
      }),
    });
    expect(resolved.isCollection).toBe(false);
    expect(resolved.targets).toHaveLength(1);
    expect(resolved.targets[0]).toMatchObject({
      label: "skills",
      boundary: clone,
    });
    expect(existsSync(join(outside, "child", "SKILL.md"))).toBe(true);
  });
});
