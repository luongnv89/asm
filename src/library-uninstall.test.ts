/**
 * Unit tests for the library-uninstall domain module (issue #799).
 *
 * Every test uses its own temp root and passes explicit `skillsDir`/`lockPath`/
 * `cwd`; nothing here relies on the ambient config directory or the real user
 * library. Permission-based cases are skipped for root/Windows where mode bits
 * do not gate access.
 */
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertManagedLibraryRemovalTarget,
  buildSideEffectNotice,
  describeCheckedScope,
  libraryDirectoryPresent,
  removeLibrarySkill,
  resolveLibraryEntryForRemoval,
  resolveProviderLocationPath,
  scanLibraryReferences,
} from "./library-uninstall";
import type { LibraryCheckLocation } from "./library-uninstall";
import { listLibrarySkills } from "./library-core";
import type { LibrarySkillInfo } from "./library-core";
import type { LibrarySkillEntry, ProviderConfig } from "./utils/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

async function makeTempRoot(
  prefix = "asm-library-uninstall-",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) continue;
    await rm(root, { recursive: true, force: true });
  }
});

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const permissionCase = it.skipIf(process.platform === "win32" || isRoot);

function makeEntry(
  dirName: string,
  overrides: Partial<LibrarySkillEntry> = {},
): LibrarySkillEntry {
  return {
    name: dirName,
    version: "1.0.0",
    source: "github:owner/repo",
    sourceType: "github",
    commitHash: "a".repeat(40),
    ref: null,
    skillPath: ".",
    libraryPath: join("/tmp/asm-library-skills", dirName),
    installedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRow(
  dirName: string,
  name: string,
  overrides: Partial<LibrarySkillInfo> = {},
): LibrarySkillInfo {
  return {
    dirName,
    name,
    version: "1.0.0",
    source: "github:owner/repo",
    sourceType: "github",
    commitHash: "a".repeat(40),
    ref: null,
    skillPath: ".",
    libraryPath: `/library/skills/${dirName}`,
    installedAt: "2026-01-01T00:00:00.000Z",
    missing: false,
    ...overrides,
  };
}

function makeProvider(
  name: string,
  global: string,
  project: string,
  enabled = true,
): ProviderConfig {
  return { name, label: `${name}-label`, global, project, enabled };
}

async function writeLock(
  lockPath: string,
  skills: Record<string, LibrarySkillEntry>,
): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({ version: 1, skills }, null, 2) + "\n",
    "utf-8",
  );
}

async function readLockSkills(
  lockPath: string,
): Promise<Record<string, LibrarySkillEntry>> {
  const parsed = JSON.parse(await readFile(lockPath, "utf-8"));
  return parsed.skills;
}

async function makeLibraryDir(
  skillsDir: string,
  dirName: string,
): Promise<string> {
  const libraryPath = join(skillsDir, dirName);
  await mkdir(libraryPath, { recursive: true });
  await writeFile(join(libraryPath, "SKILL.md"), `# ${dirName}\n`, "utf-8");
  return libraryPath;
}

async function createSymlink(target: string, linkPath: string): Promise<void> {
  await mkdir(join(linkPath, ".."), { recursive: true });
  await symlink(target, linkPath);
}

// ─── resolveProviderLocationPath ────────────────────────────────────────────

describe("resolveProviderLocationPath", () => {
  it("expands a ~/ template against the home directory", () => {
    expect(resolveProviderLocationPath("~/.claude/skills", "/cwd")).toBe(
      join(homedir(), ".claude/skills"),
    );
  });

  it("leaves an absolute template untouched", () => {
    expect(resolveProviderLocationPath("/opt/skills", "/cwd")).toBe(
      "/opt/skills",
    );
  });

  it("resolves a relative project template against the given cwd", () => {
    expect(resolveProviderLocationPath(".claude/skills", "/tmp/project")).toBe(
      resolve("/tmp/project", ".claude/skills"),
    );
  });
});

// ─── resolveLibraryEntryForRemoval ──────────────────────────────────────────

describe("resolveLibraryEntryForRemoval", () => {
  it("resolves an exact directory key", () => {
    const rows = [makeRow("deploy-helper", "Deploy Helper")];
    const result = resolveLibraryEntryForRemoval(rows, "deploy-helper");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.dirName).toBe("deploy-helper");
  });

  it("prefers the exact directory key over a frontmatter-name match", () => {
    const rows = [
      makeRow("shared", "First Skill"),
      makeRow("other-dir", "shared"),
    ];
    const result = resolveLibraryEntryForRemoval(rows, "shared");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.dirName).toBe("shared");
  });

  it("falls back to a unique exact frontmatter name", () => {
    const rows = [
      makeRow("deploy-helper-dir", "deploy-helper"),
      makeRow("other", "other"),
    ];
    const result = resolveLibraryEntryForRemoval(rows, "deploy-helper");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.dirName).toBe("deploy-helper-dir");
  });

  it("does not resolve a partial or substring name", () => {
    const rows = [makeRow("deploy-helper", "deploy-helper")];
    const result = resolveLibraryEntryForRemoval(rows, "deploy");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBeFalsy();
      expect(result.reason).toContain("asm library list");
    }
  });

  it("does not resolve a case-mismatched name", () => {
    const rows = [makeRow("deploy-helper", "deploy-helper")];
    const result = resolveLibraryEntryForRemoval(rows, "Deploy-Helper");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("asm library list");
  });

  it("reports ambiguity when two entries share a frontmatter name", () => {
    const rows = [
      makeRow("alpha", "shared-name"),
      makeRow("beta", "shared-name"),
    ];
    const result = resolveLibraryEntryForRemoval(rows, "shared-name");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.reason).toContain("alpha");
      expect(result.reason).toContain("beta");
      expect(result.reason).toContain("ambiguous");
    }
  });

  it("reports an unknown name with the library-list hint", () => {
    const result = resolveLibraryEntryForRemoval(
      [makeRow("alpha", "alpha")],
      "nope",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBeFalsy();
      expect(result.reason).toContain('Library skill "nope" not found');
      expect(result.reason).toContain("asm library list");
    }
  });
});

// ─── assertManagedLibraryRemovalTarget ──────────────────────────────────────

describe("assertManagedLibraryRemovalTarget", () => {
  it("returns the resolved library path for a managed entry", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "good-skill");
    const result = await assertManagedLibraryRemovalTarget({
      dirName: "good-skill",
      entry: makeEntry("good-skill", { libraryPath }),
      skillsDir,
    });
    expect(result).toBe(resolve(libraryPath));
  });

  it("throws for a path outside the library skills directory", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    await mkdir(skillsDir, { recursive: true });
    const outside = join(root, "elsewhere", "evil");
    await mkdir(outside, { recursive: true });
    await expect(
      assertManagedLibraryRemovalTarget({
        dirName: "evil",
        entry: makeEntry("evil", {
          libraryPath: outside,
          source: "local:" + join(root, "source"),
        }),
        skillsDir,
      }),
    ).rejects.toThrow(/outside the managed library/);
  });

  it("throws when the library path is the skills directory itself", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    await mkdir(skillsDir, { recursive: true });
    await expect(
      assertManagedLibraryRemovalTarget({
        dirName: "skills",
        entry: makeEntry("skills", { libraryPath: skillsDir }),
        skillsDir,
      }),
    ).rejects.toThrow(/library skills directory itself/);
  });

  it("throws when the path basename does not match the lock key", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "actual-name");
    await expect(
      assertManagedLibraryRemovalTarget({
        dirName: "different-key",
        entry: makeEntry("different-key", { libraryPath }),
        skillsDir,
      }),
    ).rejects.toThrow(/does not match the lock entry key/);
  });

  it("throws when the library path is the local: source root", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "local-copy");
    await expect(
      assertManagedLibraryRemovalTarget({
        dirName: "local-copy",
        entry: makeEntry("local-copy", {
          libraryPath,
          sourceType: "local",
          source: `local:${libraryPath}`,
        }),
        skillsDir,
      }),
    ).rejects.toThrow(/is the local source directory/);
  });

  it("throws when a symlinked library entry resolves outside the library", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const outside = join(root, "outside-target");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(outside, { recursive: true });
    const libraryPath = join(skillsDir, "sneaky");
    await symlink(outside, libraryPath);

    await expect(
      assertManagedLibraryRemovalTarget({
        dirName: "sneaky",
        entry: makeEntry("sneaky", { libraryPath }),
        skillsDir,
      }),
    ).rejects.toThrow(/resolves outside the managed library/);
  });
});

// ─── scanLibraryReferences ──────────────────────────────────────────────────

describe("scanLibraryReferences", () => {
  it("reports missing locations for absent directories and finds nothing", async () => {
    const root = await makeTempRoot();
    const libraryPath = join(root, "library", "skills", "absent");
    const providers = [
      makeProvider("claude", join(root, "none", "claude"), ".claude/skills"),
      makeProvider("codex", join(root, "none", "codex"), ".codex/skills"),
    ];

    const scan = await scanLibraryReferences({
      libraryPath,
      providers,
      cwd: join(root, "project"),
    });

    expect(scan.libraryPath).toBe(resolve(libraryPath));
    expect(scan.locations).toHaveLength(4);
    expect(scan.locations.every((l) => l.status === "missing")).toBe(true);
    expect(scan.locations.map((l) => l.scope)).toEqual([
      "global",
      "project",
      "global",
      "project",
    ]);
    expect(scan.references).toEqual([]);
    expect(scan.unreadableLocations).toEqual([]);
    expect(scan.locations.map((l) => l.enabled)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("detects a global symlink activation", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(libraryPath, join(globalDir, "deploy-helper"));

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [
        makeProvider("claude", globalDir, join(root, "proj", ".claude")),
      ],
      cwd: join(root, "proj"),
    });

    expect(scan.locations[0].status).toBe("checked");
    expect(scan.references).toHaveLength(1);
    expect(scan.references[0]).toMatchObject({
      provider: "claude",
      providerLabel: "claude-label",
      scope: "global",
      target: resolve(libraryPath),
      dangling: false,
    });
    expect(scan.references[0].linkPath).toBe(join(globalDir, "deploy-helper"));
  });

  it("detects a project symlink resolved relative to cwd", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const projectCwd = join(root, "project");
    await createSymlink(
      libraryPath,
      join(projectCwd, ".claude", "skills", "deploy-helper"),
    );

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [
        makeProvider("claude", join(root, "no-global"), ".claude/skills"),
      ],
      cwd: projectCwd,
    });

    expect(scan.references).toHaveLength(1);
    expect(scan.references[0]).toMatchObject({
      scope: "project",
      provider: "claude",
      dangling: false,
    });
    expect(scan.references[0].linkPath).toBe(
      resolve(projectCwd, ".claude/skills/deploy-helper"),
    );
  });

  it("finds a renamed activation by target rather than by name", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(libraryPath, join(globalDir, "totally-renamed"));

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(1);
    expect(basename(scan.references[0].linkPath)).toBe("totally-renamed");
  });

  it("scans a disabled provider's location and still detects its reference", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const globalDir = join(root, "providers", "disabled", "skills");
    await createSymlink(libraryPath, join(globalDir, "deploy-helper"));

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills", false)],
      cwd: join(root, "project"),
    });

    expect(scan.locations[0]).toMatchObject({
      provider: "claude",
      enabled: false,
      status: "checked",
    });
    expect(scan.references).toHaveLength(1);
    expect(scan.references[0].provider).toBe("claude");
  });

  it("ignores a real directory with the same name as an unrelated copy", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const globalDir = join(root, "providers", "claude", "skills");
    // A real directory (not a link) that merely shares the activation name.
    await mkdir(join(globalDir, "deploy-helper"), { recursive: true });
    await writeFile(
      join(globalDir, "deploy-helper", "SKILL.md"),
      "# independent copy\n",
      "utf-8",
    );

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toEqual([]);
  });

  it("ignores a symlink pointing at an unrelated path", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const unrelated = join(root, "unrelated-skill");
    await mkdir(unrelated, { recursive: true });
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(unrelated, join(globalDir, "deploy-helper"));

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toEqual([]);
  });

  it("detects a dangling symlink whose missing target is the library path", async () => {
    const root = await makeTempRoot();
    const missingLibraryPath = join(root, "library", "skills", "deleted-skill");
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(missingLibraryPath, join(globalDir, "deleted-skill"));

    const scan = await scanLibraryReferences({
      libraryPath: missingLibraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(1);
    expect(scan.references[0]).toMatchObject({
      target: resolve(missingLibraryPath),
      dangling: true,
    });
    await expect(access(scan.references[0].target)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("detects a reference whose target reaches the library through a symlinked ancestor", async () => {
    const root = await makeTempRoot();
    const realSkillsDir = join(root, "store", "skills");
    const realLibraryPath = await makeLibraryDir(
      realSkillsDir,
      "deploy-helper",
    );
    const alias = join(root, "alias");
    await symlink(join(root, "store"), alias);
    const aliasedLibraryPath = join(alias, "skills", "deploy-helper");

    const globalDir = join(root, "providers", "claude", "skills");
    // Link target uses the realpath spelling while the caller names the alias.
    await createSymlink(realLibraryPath, join(globalDir, "deploy-helper"));

    const scan = await scanLibraryReferences({
      libraryPath: aliasedLibraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(1);
    expect(scan.references[0].dangling).toBe(false);
    expect(await realpath(scan.references[0].target)).toBe(
      await realpath(realLibraryPath),
    );
  });

  it("matches a reference spelled with a symlinked ancestor when the library path is real", async () => {
    const root = await makeTempRoot();
    const realSkillsDir = join(root, "store", "skills");
    const realLibraryPath = await makeLibraryDir(
      realSkillsDir,
      "deploy-helper",
    );
    const alias = join(root, "alias");
    await symlink(join(root, "store"), alias);

    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(
      join(alias, "skills", "deploy-helper"),
      join(globalDir, "deploy-helper"),
    );

    const scan = await scanLibraryReferences({
      libraryPath: realLibraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(1);
    expect(scan.references[0].dangling).toBe(false);
  });

  it("detects a symlink pointing inside the library entry directory", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    await mkdir(join(libraryPath, "references"), { recursive: true });
    await writeFile(
      join(libraryPath, "references", "guide.md"),
      "# guide\n",
      "utf-8",
    );
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(
      join(libraryPath, "SKILL.md"),
      join(globalDir, "skill-file-link"),
    );
    await createSymlink(
      join(libraryPath, "references"),
      join(globalDir, "references-dir-link"),
    );

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(2);
    expect(scan.references.map((r) => basename(r.linkPath)).sort()).toEqual([
      "references-dir-link",
      "skill-file-link",
    ]);
    expect(scan.references.every((r) => !r.dangling)).toBe(true);
    for (const reference of scan.references) {
      expect(
        reference.target === resolve(libraryPath) ||
          reference.target.startsWith(resolve(libraryPath) + "/"),
      ).toBe(true);
    }
  });

  it("does not match a sibling directory sharing a name prefix", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const siblingPath = await makeLibraryDir(skillsDir, "deploy-helper-extra");
    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(siblingPath, join(globalDir, "deploy-helper"));

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toEqual([]);
  });

  it("sorts references by linkPath for deterministic output", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const globalDir = join(root, "providers", "claude", "skills");
    const projectCwd = join(root, "project");
    await createSymlink(libraryPath, join(globalDir, "zeta-link"));
    await createSymlink(libraryPath, join(globalDir, "alpha-link"));
    await createSymlink(
      libraryPath,
      join(projectCwd, ".codex", "skills", "middle-link"),
    );

    const scan = await scanLibraryReferences({
      libraryPath,
      providers: [
        makeProvider("claude", globalDir, ".claude/skills"),
        makeProvider("codex", join(root, "no-global"), ".codex/skills"),
      ],
      cwd: projectCwd,
    });

    const linkPaths = scan.references.map((reference) => reference.linkPath);
    expect(linkPaths).toHaveLength(3);
    expect(linkPaths).toEqual(
      [...linkPaths].sort((a, b) => a.localeCompare(b)),
    );
    // Sorted by full path, not by basename: the project path sorts before the
    // provider path even though "alpha-link" sorts first alphabetically.
    expect(linkPaths.map((p) => basename(p))).toEqual([
      "middle-link",
      "alpha-link",
      "zeta-link",
    ]);
  });

  it("matches an inside-library realpath target when the library path is a lexical alias", async () => {
    const root = await makeTempRoot();
    const realSkillsDir = join(root, "store", "skills");
    const realLibraryPath = await makeLibraryDir(
      realSkillsDir,
      "deploy-helper",
    );
    const alias = join(root, "alias");
    await symlink(join(root, "store"), alias);
    const aliasedLibraryPath = join(alias, "skills", "deploy-helper");

    const globalDir = join(root, "providers", "claude", "skills");
    // Provider link points at a file inside the library, spelled as realpath.
    await createSymlink(
      join(realLibraryPath, "SKILL.md"),
      join(globalDir, "skill-file-link"),
    );

    const scan = await scanLibraryReferences({
      libraryPath: aliasedLibraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toHaveLength(1);
    expect(scan.references[0].target).toBe(join(realLibraryPath, "SKILL.md"));
    expect(scan.references[0].dangling).toBe(false);
  });

  it("does not match a realpath-spelled sibling when the library path is a lexical alias", async () => {
    const root = await makeTempRoot();
    const realSkillsDir = join(root, "store", "skills");
    await makeLibraryDir(realSkillsDir, "foo");
    const realSiblingPath = await makeLibraryDir(realSkillsDir, "foo-extra");
    const alias = join(root, "alias");
    await symlink(join(root, "store"), alias);
    const aliasedLibraryPath = join(alias, "skills", "foo");

    const globalDir = join(root, "providers", "claude", "skills");
    await createSymlink(
      join(realSiblingPath, "SKILL.md"),
      join(globalDir, "foo-extra"),
    );

    const scan = await scanLibraryReferences({
      libraryPath: aliasedLibraryPath,
      providers: [makeProvider("claude", globalDir, ".claude/skills")],
      cwd: join(root, "project"),
    });

    expect(scan.references).toEqual([]);
  });

  permissionCase(
    "reports an unreadable location instead of claiming no references",
    async () => {
      const root = await makeTempRoot();
      const libraryPath = await makeLibraryDir(
        join(root, "library", "skills"),
        "deploy-helper",
      );
      const globalDir = join(root, "providers", "claude", "skills");
      await mkdir(globalDir, { recursive: true });
      await chmod(globalDir, 0o000);
      try {
        const scan = await scanLibraryReferences({
          libraryPath,
          providers: [makeProvider("claude", globalDir, ".claude/skills")],
          cwd: join(root, "project"),
        });

        const globalLocation = scan.locations.find((l) => l.scope === "global");
        expect(globalLocation).toMatchObject({
          status: "unreadable",
          path: globalDir,
        });
        expect(globalLocation?.error).toBeTruthy();
        expect(scan.unreadableLocations).toHaveLength(1);
        expect(scan.unreadableLocations[0].path).toBe(globalDir);
        expect(scan.locations.find((l) => l.scope === "project")?.status).toBe(
          "missing",
        );
        expect(scan.references).toEqual([]);
      } finally {
        await chmod(globalDir, 0o755);
      }
    },
  );
});

// ─── removeLibrarySkill ─────────────────────────────────────────────────────

describe("removeLibrarySkill", () => {
  it("removes the directory and only the targeted lock entry", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const lockPath = join(root, "library", "library-lock.json");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const otherPath = await makeLibraryDir(skillsDir, "other-skill");
    await writeLock(lockPath, {
      "deploy-helper": makeEntry("deploy-helper", { libraryPath }),
      "other-skill": makeEntry("other-skill", { libraryPath: otherPath }),
    });

    const outcome = await removeLibrarySkill({
      dirName: "deploy-helper",
      entry: makeEntry("deploy-helper", { libraryPath }),
      skillsDir,
      lockPath,
    });

    expect(outcome).toMatchObject({
      libraryPath: resolve(libraryPath),
      removedDirectory: true,
      removedLockEntry: true,
      directoryPresent: false,
      lockEntryPresent: false,
      errors: [],
    });
    await expect(access(libraryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const skills = await readLockSkills(lockPath);
    expect(Object.keys(skills).sort()).toEqual(["other-skill"]);
    await expect(access(otherPath)).resolves.toBeUndefined();
  });

  it("cleans up a stale lock entry when the directory is already gone", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const lockPath = join(root, "library", "library-lock.json");
    await mkdir(skillsDir, { recursive: true });
    const missingLibraryPath = join(skillsDir, "deploy-helper");
    const keptPath = await makeLibraryDir(skillsDir, "kept");
    await writeLock(lockPath, {
      "deploy-helper": makeEntry("deploy-helper", {
        libraryPath: missingLibraryPath,
      }),
      kept: makeEntry("kept", { libraryPath: keptPath }),
    });

    const outcome = await removeLibrarySkill({
      dirName: "deploy-helper",
      entry: makeEntry("deploy-helper", {
        libraryPath: missingLibraryPath,
      }),
      skillsDir,
      lockPath,
    });

    expect(outcome).toMatchObject({
      removedDirectory: false,
      removedLockEntry: true,
      directoryPresent: false,
      lockEntryPresent: false,
      errors: [],
    });
    const skills = await readLockSkills(lockPath);
    expect(Object.keys(skills)).toEqual(["kept"]);
  });

  permissionCase(
    "keeps the lock entry when the directory removal fails",
    async () => {
      const root = await makeTempRoot();
      const skillsDir = join(root, "library", "skills");
      const lockPath = join(root, "library", "library-lock.json");
      const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
      await writeLock(lockPath, {
        "deploy-helper": makeEntry("deploy-helper", { libraryPath }),
      });

      await chmod(skillsDir, 0o500);
      let outcome;
      try {
        outcome = await removeLibrarySkill({
          dirName: "deploy-helper",
          entry: makeEntry("deploy-helper", { libraryPath }),
          skillsDir,
          lockPath,
        });
      } finally {
        await chmod(skillsDir, 0o755);
      }

      expect(outcome.removedDirectory).toBe(false);
      expect(outcome.removedLockEntry).toBe(false);
      expect(outcome.directoryPresent).toBe(true);
      expect(outcome.lockEntryPresent).toBe(true);
      expect(outcome.errors.length).toBeGreaterThan(0);
      expect(outcome.errors.join("\n")).toContain(
        "Failed to remove library directory",
      );
      const skills = await readLockSkills(lockPath);
      expect(Object.keys(skills)).toEqual(["deploy-helper"]);
      await expect(access(libraryPath)).resolves.toBeUndefined();
    },
  );

  it("reports a lock-write failure after the directory was already removed", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const lockPath = join(root, "library", "library-lock.json");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    // A directory at the lock path makes every read/write of the lock fail.
    await mkdir(lockPath, { recursive: true });

    const outcome = await removeLibrarySkill({
      dirName: "deploy-helper",
      entry: makeEntry("deploy-helper", { libraryPath }),
      skillsDir,
      lockPath,
    });

    expect(outcome.removedDirectory).toBe(true);
    expect(outcome.directoryPresent).toBe(false);
    expect(outcome.removedLockEntry).toBe(false);
    expect(outcome.lockEntryPresent).toBe(true);
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors.join("\n")).toContain(
      "Failed to update library lock",
    );
    await expect(access(libraryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes the library copy but never the local: source directory", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const lockPath = join(root, "library", "library-lock.json");
    const sourceDir = join(root, "my-local-source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "# local\n", "utf-8");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    const entry = makeEntry("deploy-helper", {
      libraryPath,
      sourceType: "local",
      source: `local:${sourceDir}`,
    });
    await writeLock(lockPath, { "deploy-helper": entry });

    const outcome = await removeLibrarySkill({
      dirName: "deploy-helper",
      entry,
      skillsDir,
      lockPath,
    });

    expect(outcome.removedDirectory).toBe(true);
    expect(outcome.removedLockEntry).toBe(true);
    expect(outcome.errors).toEqual([]);
    await expect(access(libraryPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(sourceDir, "SKILL.md"))).resolves.toBeUndefined();
  });

  it("lists the entry before removal and not after", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const lockPath = join(root, "library", "library-lock.json");
    const libraryPath = await makeLibraryDir(skillsDir, "deploy-helper");
    await writeLock(lockPath, {
      "deploy-helper": makeEntry("deploy-helper", { libraryPath }),
    });

    expect((await listLibrarySkills(lockPath)).map((r) => r.dirName)).toEqual([
      "deploy-helper",
    ]);

    await removeLibrarySkill({
      dirName: "deploy-helper",
      entry: makeEntry("deploy-helper", { libraryPath }),
      skillsDir,
      lockPath,
    });

    expect(await listLibrarySkills(lockPath)).toEqual([]);
  });
});

// ─── libraryDirectoryPresent ────────────────────────────────────────────────

describe("libraryDirectoryPresent", () => {
  it("is true for an existing library directory", async () => {
    const root = await makeTempRoot();
    const libraryPath = await makeLibraryDir(
      join(root, "library", "skills"),
      "deploy-helper",
    );
    await expect(libraryDirectoryPresent(libraryPath)).resolves.toBe(true);
  });

  it("is false for a regular file at the path", async () => {
    const root = await makeTempRoot();
    const filePath = join(root, "not-a-directory");
    await writeFile(filePath, "just a file\n", "utf-8");
    await expect(libraryDirectoryPresent(filePath)).resolves.toBe(false);
  });

  it("is false for a dangling symlink at the path", async () => {
    const root = await makeTempRoot();
    const linkPath = join(root, "dangling-directory-link");
    await symlink(join(root, "missing-target"), linkPath);
    await expect(libraryDirectoryPresent(linkPath)).resolves.toBe(false);
  });

  it("is false for a missing library directory", async () => {
    const root = await makeTempRoot();
    await expect(
      libraryDirectoryPresent(join(root, "library", "skills", "gone")),
    ).resolves.toBe(false);
  });

  it("reports the directory present even when SKILL.md is missing", async () => {
    const root = await makeTempRoot();
    const skillsDir = join(root, "library", "skills");
    const libraryPath = join(skillsDir, "no-skill-md");
    await mkdir(libraryPath, { recursive: true });
    const lockPath = join(root, "library", "library-lock.json");
    await writeLock(lockPath, {
      "no-skill-md": makeEntry("no-skill-md", { libraryPath }),
    });

    // `missing` is only about SKILL.md; the directory itself still exists.
    const rows = await listLibrarySkills(lockPath);
    expect(rows[0].missing).toBe(true);
    await expect(libraryDirectoryPresent(rows[0].libraryPath)).resolves.toBe(
      true,
    );
  });
});

// ─── buildSideEffectNotice / describeCheckedScope ───────────────────────────

describe("buildSideEffectNotice", () => {
  it("states that other projects are not checked", () => {
    const notice = buildSideEffectNotice();
    expect(notice).toContain("Other projects are NOT checked.");
    expect(notice).toContain("global skill folders");
    expect(notice).toContain("break activation links");
  });

  it("never claims the skill is unused globally", () => {
    const notice = buildSideEffectNotice();
    expect(notice).toMatch(/cannot\s+know whether other projects use/i);
    expect(notice).not.toMatch(/\bunused\b/i);
    expect(notice).not.toMatch(/\bnot used\b/i);
    expect(notice).not.toMatch(/\bno references\b/i);
    expect(notice).not.toMatch(/safe to delete/i);
  });
});

describe("describeCheckedScope", () => {
  it("counts statuses and dedupes providers", () => {
    const locations: LibraryCheckLocation[] = [
      {
        provider: "claude",
        providerLabel: "Claude Code",
        scope: "global",
        path: "/skills/claude/global",
        enabled: true,
        status: "checked",
      },
      {
        provider: "claude",
        providerLabel: "Claude Code",
        scope: "project",
        path: "/project/.claude/skills",
        enabled: true,
        status: "missing",
      },
      {
        provider: "codex",
        providerLabel: "Codex",
        scope: "global",
        path: "/skills/codex/global",
        enabled: false,
        status: "unreadable",
        error: "EACCES",
      },
      {
        provider: "codex",
        providerLabel: "Codex",
        scope: "project",
        path: "/project/.codex/skills",
        enabled: false,
        status: "checked",
      },
    ];

    expect(describeCheckedScope({ locations })).toEqual({
      providerCount: 2,
      locationCount: 4,
      existingCount: 2,
      missingCount: 1,
      unreadableCount: 1,
      providers: ["claude", "codex"],
    });
  });

  it("handles an empty scan", () => {
    expect(describeCheckedScope({ locations: [] })).toEqual({
      providerCount: 0,
      locationCount: 0,
      existingCount: 0,
      missingCount: 0,
      unreadableCount: 0,
      providers: [],
    });
  });
});
