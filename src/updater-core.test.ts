/**
 * Direct-import coverage for `src/updater-core.ts`.
 *
 * The module split (#455) exported these helpers for cross-module wiring with
 * `updater-updates.ts`, but deliberately did NOT forward them through the
 * `src/updater.ts` facade. `src/updater.test.ts` imports from the facade and so
 * cannot reach them — everything here imports from `./updater-core` directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dirname, join } from "path";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  createPinnedGitEnv,
  resolvedLatestCommits,
  normalizedTargetIdentity,
  poolAll,
  getUpdateSourceDir,
  checkOutdated,
  getLatestRemoteCommit,
  inspectSkillFolders,
  readSkillVersion,
} from "./updater-core";
import { updateSkills } from "./updater-updates";
import type { LockEntry } from "./utils/types";
import type { RegistryIndex } from "./registry";

// ─── createPinnedGitEnv ─────────────────────────────────────────────────────

describe("createPinnedGitEnv", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("sets GIT_DEFAULT_HASH to the requested object format", () => {
    expect(createPinnedGitEnv("sha1").GIT_DEFAULT_HASH).toBe("sha1");
    expect(createPinnedGitEnv("sha256").GIT_DEFAULT_HASH).toBe("sha256");
  });

  it("strips repository-local routing variables", () => {
    process.env.GIT_DIR = "/somewhere/.git";
    process.env.GIT_WORK_TREE = "/somewhere";
    process.env.GIT_COMMON_DIR = "/somewhere/.git";
    process.env.GIT_INDEX_FILE = "/somewhere/.git/index";
    process.env.GIT_OBJECT_DIRECTORY = "/somewhere/.git/objects";
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = "/elsewhere/objects";
    process.env.GIT_CEILING_DIRECTORIES = "/";
    process.env.GIT_NAMESPACE = "ns";
    process.env.GIT_QUARANTINE_PATH = "/quarantine";
    process.env.GIT_PREFIX = "sub/";

    const env = createPinnedGitEnv("sha1");

    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_COMMON_DIR).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(env.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
    expect(env.GIT_CEILING_DIRECTORIES).toBeUndefined();
    expect(env.GIT_NAMESPACE).toBeUndefined();
    expect(env.GIT_QUARANTINE_PATH).toBeUndefined();
    expect(env.GIT_PREFIX).toBeUndefined();
  });

  it("strips inline config overrides, including numbered key/value pairs", () => {
    process.env.GIT_CONFIG = "/etc/gitconfig";
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_PARAMETERS = "'core.hooksPath=/evil'";
    process.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
    process.env.GIT_CONFIG_VALUE_0 = "/evil";
    process.env.GIT_CONFIG_KEY_12 = "core.pager";
    process.env.GIT_CONFIG_VALUE_12 = "cat";

    const env = createPinnedGitEnv("sha1");

    expect(env.GIT_CONFIG).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_12).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_12).toBeUndefined();
  });

  it("keeps look-alike variables that the anchored pattern does not match", () => {
    process.env.GIT_CONFIG_KEY_x = "not-numbered";
    process.env.GIT_CONFIG_KEYS_1 = "plural";
    process.env.MY_GIT_CONFIG_KEY_1 = "prefixed";

    const env = createPinnedGitEnv("sha1");

    expect(env.GIT_CONFIG_KEY_x).toBe("not-numbered");
    expect(env.GIT_CONFIG_KEYS_1).toBe("plural");
    expect(env.MY_GIT_CONFIG_KEY_1).toBe("prefixed");
  });

  it("preserves transport and auth variables", () => {
    process.env.GIT_SSH_COMMAND = "ssh -i /key";
    process.env.GIT_ASKPASS = "/usr/bin/askpass";
    process.env.GIT_TERMINAL_PROMPT = "0";
    process.env.PATH = process.env.PATH ?? "/usr/bin";

    const env = createPinnedGitEnv("sha256");

    expect(env.GIT_SSH_COMMAND).toBe("ssh -i /key");
    expect(env.GIT_ASKPASS).toBe("/usr/bin/askpass");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("returns a copy that does not mutate process.env", () => {
    process.env.GIT_DIR = "/somewhere/.git";
    const before = process.env.GIT_DEFAULT_HASH;

    const env = createPinnedGitEnv("sha256");
    env.SOME_NEW_VAR = "added";

    expect(process.env.GIT_DIR).toBe("/somewhere/.git");
    expect(process.env.GIT_DEFAULT_HASH).toBe(before);
    expect(process.env.SOME_NEW_VAR).toBeUndefined();
  });
});

// ─── resolvedLatestCommits ──────────────────────────────────────────────────

describe("resolvedLatestCommits", () => {
  const FULL_COMMIT = "a".repeat(39) + "9";

  function registryLock(commitHash: string) {
    return {
      version: 1 as const,
      skills: {
        "code-review": {
          source: "github:acme/skills",
          commitHash,
          ref: null,
          installedAt: "2026-01-01T00:00:00.000Z",
          provider: "claude",
          sourceType: "registry" as const,
          registryName: "code-review",
        },
      },
    };
  }

  function registryIndex(commit: string): RegistryIndex {
    return {
      generated_at: "2026-01-01T00:00:00.000Z",
      manifests: [
        {
          name: "code-review",
          author: "acme",
          description: "Review code",
          repository: "https://github.com/acme/skills",
          commit,
          security_verdict: "pass",
          published_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  }

  it("is a WeakMap", () => {
    expect(resolvedLatestCommits).toBeInstanceOf(WeakMap);
  });

  it("is the same instance the checkOutdated writer path populates", async () => {
    const summary = await checkOutdated({
      lock: registryLock("b".repeat(40)),
      fetchRegistryIndexFn: async () => registryIndex(FULL_COMMIT),
    });

    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0].status).toBe("outdated");
    // The map holds the FULL oid while the entry exposes only the short hash.
    expect(resolvedLatestCommits.get(summary.entries[0])).toBe(FULL_COMMIT);
  });

  it("records the resolved commit for up-to-date entries too", async () => {
    const summary = await checkOutdated({
      lock: registryLock(FULL_COMMIT),
      fetchRegistryIndexFn: async () => registryIndex(FULL_COMMIT),
    });

    expect(summary.entries[0].status).toBe("up-to-date");
    expect(resolvedLatestCommits.get(summary.entries[0])).toBe(FULL_COMMIT);
  });

  it("does not record entries that never resolved a remote commit", async () => {
    const summary = await checkOutdated({
      lock: {
        version: 1,
        skills: {
          "my-local": {
            source: "local:/path/to/skill",
            commitHash: "abc1234",
            ref: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
            sourceType: "local",
          },
        },
      },
      fetchRegistryIndexFn: async () => null,
    });

    expect(resolvedLatestCommits.get(summary.entries[0])).toBeUndefined();
  });

  it("keys strictly by entry object identity", async () => {
    const summary = await checkOutdated({
      lock: registryLock("b".repeat(40)),
      fetchRegistryIndexFn: async () => registryIndex(FULL_COMMIT),
    });

    const clone = { ...summary.entries[0] };
    expect(resolvedLatestCommits.get(clone)).toBeUndefined();
    expect(resolvedLatestCommits.get(summary.entries[0])).toBe(FULL_COMMIT);
  });
});

// ─── normalizedTargetIdentity ───────────────────────────────────────────────

describe("normalizedTargetIdentity", () => {
  it("lowercases ASCII names", () => {
    expect(normalizedTargetIdentity("My-Skill")).toBe("my-skill");
    expect(normalizedTargetIdentity("I")).toBe("i");
  });

  it("is idempotent", () => {
    for (const name of ["Café", "MY-SKILL", "éclair", "straße"]) {
      expect(normalizedTargetIdentity(normalizedTargetIdentity(name))).toBe(
        normalizedTargetIdentity(name),
      );
    }
  });

  it("maps decomposed and precomposed forms to the same identity", () => {
    const decomposed = "Cafe\u0301"; // e + combining acute
    const precomposed = "Caf\u00e9"; // precomposed e-acute
    expect(normalizedTargetIdentity(decomposed)).toBe(
      normalizedTargetIdentity(precomposed),
    );
    expect(normalizedTargetIdentity(decomposed)).toBe("caf\u00e9");
  });

  it("does not trim surrounding whitespace", () => {
    expect(normalizedTargetIdentity("  My Skill  ")).toBe("  my skill  ");
  });

  it("returns the empty string unchanged", () => {
    expect(normalizedTargetIdentity("")).toBe("");
  });
});

// ─── poolAll ────────────────────────────────────────────────────────────────

describe("poolAll", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("returns results in input order regardless of completion order", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const pending = poolAll([0, 1, 2], 3, async (i) => {
      await gates[i].promise;
      return `item-${i}`;
    });

    // Finish in reverse order.
    gates[2].resolve();
    gates[1].resolve();
    gates[0].resolve();

    await expect(pending).resolves.toEqual(["item-0", "item-1", "item-2"]);
  });

  it("never exceeds the concurrency limit", async () => {
    const items = [0, 1, 2, 3, 4, 5, 6];
    const gates = items.map(() => deferred<void>());
    let inFlight = 0;
    let maxInFlight = 0;

    const pending = poolAll(items, 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[i].promise;
      inFlight--;
      return i;
    });

    // Release one at a time so each free slot is immediately refilled.
    for (const gate of gates) {
      gate.resolve();
      await new Promise((r) => setImmediate(r));
    }

    await pending;
    expect(maxInFlight).toBe(3);
  });

  it("runs items sequentially when concurrency is 1", async () => {
    const order: string[] = [];
    await poolAll([0, 1, 2], 1, async (i) => {
      order.push(`start-${i}`);
      await Promise.resolve();
      order.push(`end-${i}`);
      return i;
    });

    expect(order).toEqual([
      "start-0",
      "end-0",
      "start-1",
      "end-1",
      "start-2",
      "end-2",
    ]);
  });

  it("caps worker count at the item count when concurrency exceeds it", async () => {
    let maxInFlight = 0;
    let inFlight = 0;

    const results = await poolAll([1, 2], 100, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return n * 2;
    });

    expect(results).toEqual([2, 4]);
    expect(maxInFlight).toBe(2);
  });

  it("resolves immediately for an empty item list without calling fn", async () => {
    let calls = 0;
    const results = await poolAll([], 5, async (item: number) => {
      calls++;
      return item;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("spawns no workers when concurrency is 0", async () => {
    let calls = 0;
    const results = await poolAll([1, 2, 3], 0, async (n) => {
      calls++;
      return n;
    });

    expect(calls).toBe(0);
    expect(results).toHaveLength(3);
  });

  it("rejects with the first error thrown by the mapper", async () => {
    await expect(
      poolAll([1, 2, 3], 2, async (n) => {
        if (n === 1) throw new Error(`boom on ${n}`);
        return n;
      }),
    ).rejects.toThrow("boom on 1");
  });

  it("propagates a rejected promise returned by the mapper", async () => {
    await expect(
      poolAll([1], 1, () => Promise.reject(new Error("rejected"))),
    ).rejects.toThrow("rejected");
  });
});

// ─── getUpdateSourceDir ─────────────────────────────────────────────────────

describe("getUpdateSourceDir", () => {
  function entryWith(skillPath?: string): LockEntry {
    return {
      source: "github:acme/skills",
      commitHash: "a".repeat(40),
      ref: null,
      installedAt: "2026-01-01T00:00:00.000Z",
      provider: "claude",
      ...(skillPath === undefined ? {} : { skillPath }),
    };
  }

  it("joins the skill path onto the temp dir", () => {
    expect(getUpdateSourceDir("/tmp/clone", entryWith("skills/review"))).toBe(
      join("/tmp/clone", "skills/review"),
    );
  });

  it("returns the temp dir when skillPath is absent", () => {
    expect(getUpdateSourceDir("/tmp/clone", entryWith())).toBe("/tmp/clone");
  });

  it("treats an empty skillPath as the repository root", () => {
    expect(getUpdateSourceDir("/tmp/clone", entryWith(""))).toBe("/tmp/clone");
  });

  it("normalizes redundant separators and dot segments", () => {
    expect(getUpdateSourceDir("/tmp/clone/", entryWith("./a//b"))).toBe(
      "/tmp/clone/a/b",
    );
  });

  it("appends rather than rebases an absolute skillPath", () => {
    // join() does not reset on a leading separator the way resolve() would.
    expect(getUpdateSourceDir("/tmp/clone", entryWith("/etc/passwd"))).toBe(
      "/tmp/clone/etc/passwd",
    );
  });

  it("does not guard against parent traversal in skillPath", () => {
    // Documents current behaviour: `..` segments escape the temp dir.
    expect(getUpdateSourceDir("/tmp/clone", entryWith("../outside"))).toBe(
      "/tmp/outside",
    );
  });
});

// ─── checkOutdated: skill folder + metadata.version (#807) ─────────────────

describe("checkOutdated skill folder inspection (#807)", () => {
  const exec = promisify(execFile);
  let tempDir: string;

  const git = async (cwd: string, ...args: string[]) =>
    (
      await exec("git", args, {
        cwd,
        env: { ...process.env, GIT_DEFAULT_HASH: "sha1" },
      })
    ).stdout.trim();

  const skillMd = (name: string, version?: string) =>
    [
      "---",
      `name: ${name}`,
      `description: ${name} test skill`,
      ...(version ? ["metadata:", `  version: ${version}`] : []),
      "---",
      `# ${name}`,
      "",
    ].join("\n");

  async function write(root: string, rel: string, content: string) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }

  async function commitAll(work: string, message: string) {
    await git(work, "add", "-A");
    await git(work, "commit", "-q", "-m", message);
    return git(work, "rev-parse", "HEAD");
  }

  /** Work repo + bare "remote"; `blobless` lets the bare serve partial fetches like GitHub. */
  async function makeRepo(name: string, blobless: boolean) {
    const work = join(tempDir, `${name}-work`);
    const bare = join(tempDir, `${name}.git`);
    await mkdir(work, { recursive: true });
    await git(tempDir, "init", "-q", "-b", "main", work);
    await git(work, "config", "user.email", "test@test.com");
    await git(work, "config", "user.name", "Test");
    await git(tempDir, "init", "-q", "--bare", "-b", "main", bare);
    if (blobless) await git(bare, "config", "uploadpack.allowFilter", "true");
    const publish = () => git(work, "push", "-q", bare, "HEAD:refs/heads/main");
    return { work, url: `file://${bare}`, publish };
  }

  const lockEntry = (
    url: string,
    commitHash: string,
    skillPath: string,
  ): LockEntry => ({
    source: url,
    commitHash,
    ref: "main",
    installedAt: "2026-01-01T00:00:00.000Z",
    provider: "claude",
    sourceType: "github",
    skillPath,
  });

  /** One repo, four skills installed at v1; then a bump, sibling-only changes and an unversioned change. */
  async function multiSkillRepo() {
    const repo = await makeRepo("skills", true);
    await write(repo.work, "skills/alpha/SKILL.md", skillMd("alpha", "1.6.0"));
    await write(repo.work, "skills/beta/SKILL.md", skillMd("beta", "1.5.0"));
    await write(repo.work, "skills/gamma/SKILL.md", skillMd("gamma", "2.0.0"));
    await write(repo.work, "skills/plain/SKILL.md", skillMd("plain"));
    // A sibling whose name shares beta's prefix must not count as beta.
    await write(repo.work, "skills/beta-extra/SKILL.md", skillMd("x", "0.1.0"));
    const installed = await commitAll(repo.work, "v1");

    await write(repo.work, "skills/alpha/SKILL.md", skillMd("alpha", "1.7.0"));
    await write(repo.work, "skills/alpha/references/new.md", "new\n");
    await commitAll(repo.work, "alpha 1.7.0");
    await write(repo.work, "skills/beta-extra/more.md", "sibling only\n");
    await write(repo.work, "README.md", "repo readme\n");
    await commitAll(repo.work, "touch beta-extra and README only");
    await write(repo.work, "skills/plain/extra.md", "plain change\n");
    const latest = await commitAll(repo.work, "plain change");
    await repo.publish();
    return { ...repo, installed, latest };
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-outdated-807-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports versions, keeps outdated skills outdated, and treats untouched folders as current", async () => {
    const repo = await multiSkillRepo();
    const skills: Record<string, LockEntry> = {};
    for (const name of ["alpha", "beta", "gamma", "plain"]) {
      skills[name] = lockEntry(repo.url, repo.installed, `skills/${name}`);
    }
    const lsRemote = vi.fn(getLatestRemoteCommit);
    const inspect = vi.fn(inspectSkillFolders);

    const summary = await checkOutdated({
      lock: { version: 1, skills },
      fetchRegistryIndexFn: async () => null,
      getLatestRemoteCommitFn: lsRemote,
      inspectSkillFoldersFn: inspect,
    });
    const byName = Object.fromEntries(summary.entries.map((e) => [e.name, e]));

    // Version bump: outdated, with both versions.
    expect(byName.alpha).toMatchObject({
      status: "outdated",
      installedVersion: "1.6.0",
      latestVersion: "1.7.0",
      installedCommit: repo.installed.slice(0, 7),
      latestCommit: repo.latest.slice(0, 7),
    });
    // Only a sibling folder (and README) changed: current, not outdated.
    expect(byName.beta).toMatchObject({
      status: "up-to-date",
      installedVersion: "1.5.0",
      latestVersion: "1.5.0",
      installedCommit: repo.installed.slice(0, 7),
      latestCommit: repo.latest.slice(0, 7),
    });
    expect(byName.gamma).toMatchObject({
      status: "up-to-date",
      installedVersion: "2.0.0",
      latestVersion: "2.0.0",
    });
    // No metadata.version: null on both sides, still outdated on a change.
    expect(byName.plain).toMatchObject({
      status: "outdated",
      installedVersion: null,
      latestVersion: null,
    });
    expect(summary.outdatedCount).toBe(2);
    expect(summary.upToDateCount).toBe(2);

    // One ls-remote and one inspection for the whole repository.
    expect(lsRemote).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    // The resolved full OID is still recorded for `asm update`.
    expect(resolvedLatestCommits.get(byName.alpha)).toBe(repo.latest);
  });

  it("treats every change as a change for a skill installed from the repo root", async () => {
    const repo = await makeRepo("root-skill", false);
    await write(repo.work, "SKILL.md", skillMd("root-skill", "3.0.0"));
    const installed = await commitAll(repo.work, "v1");
    await write(repo.work, "docs/guide.md", "outside SKILL.md\n");
    const latest = await commitAll(repo.work, "docs only");
    await repo.publish();

    const outdated = await checkOutdated({
      lock: {
        version: 1,
        skills: { "root-skill": lockEntry(repo.url, installed, "") },
      },
      fetchRegistryIndexFn: async () => null,
    });
    expect(outdated.entries[0]).toMatchObject({
      status: "outdated",
      installedVersion: "3.0.0",
      latestVersion: "3.0.0",
    });

    const current = await checkOutdated({
      lock: {
        version: 1,
        skills: { "root-skill": lockEntry(repo.url, latest, "") },
      },
      fetchRegistryIndexFn: async () => null,
    });
    expect(current.entries[0]).toMatchObject({
      status: "up-to-date",
      installedVersion: "3.0.0",
      latestVersion: "3.0.0",
    });
  });

  it("stays outdated, with the latest version, when the installed commit is gone upstream", async () => {
    const repo = await multiSkillRepo();
    const gone = "0123456789abcdef0123456789abcdef01234567";
    const summary = await checkOutdated({
      lock: {
        version: 1,
        skills: { beta: lockEntry(repo.url, gone, "skills/beta") },
      },
      fetchRegistryIndexFn: async () => null,
    });
    expect(summary.entries[0]).toMatchObject({
      status: "outdated",
      installedVersion: null,
      latestVersion: "1.5.0",
      inspectionError: "installed commit 0123456 could not be fetched",
    });
  });

  it("runs distinct remote lookups in parallel, at most five at once", async () => {
    const skills: Record<string, LockEntry> = {};
    for (let i = 0; i < 8; i++) {
      for (const n of ["a", "b"]) {
        skills[`r${i}-${n}`] = lockEntry(
          `file:///repo-${i}.git`,
          "a".repeat(40),
          `skills/${n}`,
        );
      }
    }
    let active = 0;
    let peak = 0;
    const calls: string[] = [];
    const summary = await checkOutdated({
      lock: { version: 1, skills },
      fetchRegistryIndexFn: async () => null,
      getLatestRemoteCommitFn: async (url) => {
        calls.push(url);
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return "a".repeat(40);
      },
      inspectSkillFoldersFn: async (_url, _latest, probes) =>
        probes.map(() => ({
          changed: false,
          installedVersion: "1.0.0",
          latestVersion: "1.0.0",
        })),
    });
    expect(calls).toHaveLength(8);
    expect(new Set(calls).size).toBe(8);
    expect(peak).toBe(5);
    expect(summary.upToDateCount).toBe(16);
  });

  /**
   * Real change in skills/linkd/; `.claude/skills -> ../skills` is a git
   * symlink, so `.claude/skills/linkd` is a path git does not know (#811 B1).
   * skills/quiet is untouched; skills/pre only sees its prefix sibling change.
   */
  async function unknownPathRepo() {
    const repo = await makeRepo("linked", true);
    for (const name of ["linkd", "quiet", "pre", "pre-extra"]) {
      await write(repo.work, `skills/${name}/SKILL.md`, skillMd(name, "1.0.0"));
    }
    await write(tempDir, "link-target", "../skills");
    const linkOid = await git(
      repo.work,
      "hash-object",
      "-w",
      join(tempDir, "link-target"),
    );
    await git(repo.work, "add", "skills");
    await git(
      repo.work,
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${linkOid},.claude/skills`,
    );
    await git(repo.work, "commit", "-q", "-m", "v1");
    const installed = await git(repo.work, "rev-parse", "HEAD");
    await write(repo.work, "skills/linkd/body.md", "L\n");
    await write(repo.work, "skills/pre-extra/more.md", "sibling only\n");
    await git(repo.work, "add", "skills");
    await git(repo.work, "commit", "-q", "-m", "change linkd and pre-extra");
    const latest = await git(repo.work, "rev-parse", "HEAD");
    expect(
      await git(repo.work, "ls-tree", installed, ".claude/skills"),
    ).toMatch(/^120000 blob /);
    await repo.publish();
    return { ...repo, installed, latest };
  }

  const unknownPathCases = (pwned: string) => ({
    "r-symlink-parent": ".claude/skills/linkd",
    "r-case-mismatch": "skills/Linkd",
    "r-missing": "skills/nope",
    "inj-sp": `--output=${pwned}`,
  });

  it("never treats a skill path git does not know as an unchanged folder", async () => {
    const repo = await unknownPathRepo();
    const pwned = join(tempDir, "pwned-sp");
    const skills: Record<string, LockEntry> = {
      linkd: lockEntry(repo.url, repo.installed, "skills/linkd"),
      "sib-only": lockEntry(repo.url, repo.installed, "skills/quiet"),
      "prefix-sib": lockEntry(repo.url, repo.installed, "skills/pre"),
    };
    for (const [name, path] of Object.entries(unknownPathCases(pwned))) {
      skills[name] = lockEntry(repo.url, repo.installed, path);
    }

    const summary = await checkOutdated({
      lock: { version: 1, skills },
      fetchRegistryIndexFn: async () => null,
    });
    const byName = Object.fromEntries(summary.entries.map((e) => [e.name, e]));

    for (const name of Object.keys(unknownPathCases(pwned))) {
      expect(byName[name].status, name).toBe("outdated");
      expect(byName[name].inspectionError, name).toMatch(
        /^no SKILL\.md at ".*" in installed commit [0-9a-f]{7}$/,
      );
    }
    expect(byName.linkd.status).toBe("outdated");
    expect(byName.linkd.inspectionError).toBeUndefined();
    expect(byName["sib-only"]).toMatchObject({
      status: "up-to-date",
      installedVersion: "1.0.0",
    });
    expect(byName["prefix-sib"].status).toBe("up-to-date");
    expect(byName["sib-only"].inspectionError).toBeUndefined();
    await expect(access(pwned)).rejects.toThrow();

    // asm update installs every one of them except the two current skills.
    const updateSkillFn = vi.fn(async (name: string) => ({
      name,
      status: "updated" as const,
    }));
    await updateSkills(null, true, {
      readLockFn: async () => ({ version: 1, skills }),
      checkOutdatedFn: (o) =>
        checkOutdated({ ...o, fetchRegistryIndexFn: async () => null }),
      updateSkillFn,
    });
    expect(updateSkillFn.mock.calls.map((c) => c[0]).sort()).toEqual([
      "inj-sp",
      "linkd",
      "r-case-mismatch",
      "r-missing",
      "r-symlink-parent",
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps skillPath out of git's argv and ends options before URLs and commits",
    async () => {
      const repo = await unknownPathRepo();
      const pwned = join(tempDir, "pwned-argv");
      const shimDir = join(tempDir, "shim");
      const log = join(tempDir, "git-argv.log");
      const realGit = (
        await exec("sh", ["-c", "command -v git"])
      ).stdout.trim();
      await mkdir(shimDir);
      await writeFile(
        join(shimDir, "git"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${realGit}" "$@"\n`,
        { mode: 0o755 },
      );
      const savedPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${savedPath}`;
      let summary;
      try {
        summary = await checkOutdated({
          lock: {
            version: 1,
            skills: {
              "inj-sp": lockEntry(
                repo.url,
                repo.installed,
                `--output=${pwned}`,
              ),
              "dash-sp": lockEntry(repo.url, repo.installed, "-skills/linkd"),
            },
          },
          fetchRegistryIndexFn: async () => null,
        });
      } finally {
        process.env.PATH = savedPath;
      }
      expect(summary.entries.map((e) => e.status)).toEqual([
        "outdated",
        "outdated",
      ]);
      const calls = (await readFile(log, "utf8")).trim().split("\n");
      const ours = calls.filter((c) =>
        /(^| )(fetch|ls-tree|diff-tree) /.test(c),
      );
      expect(ours.length).toBeGreaterThanOrEqual(4);
      for (const call of calls) {
        expect(call).not.toContain("pwned");
        expect(call).not.toContain("-skills/linkd");
      }
      for (const call of ours) expect(call).toContain(" --end-of-options ");
      await expect(access(pwned)).rejects.toThrow();
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports each installed commit's own diff-tree failure",
    async () => {
      const repo = await makeRepo("diff-fail", true);
      await write(repo.work, "skills/x/SKILL.md", skillMd("x", "1.0.0"));
      const first = await commitAll(repo.work, "v1");
      await write(repo.work, "skills/x/a.md", "a\n");
      const second = await commitAll(repo.work, "v2");
      await write(repo.work, "skills/x/b.md", "b\n");
      const latest = await commitAll(repo.work, "v3");
      await repo.publish();

      // A git shim that fails `diff-tree` with text naming the installed commit.
      const shimDir = join(tempDir, "shim");
      const realGit = (
        await exec("sh", ["-c", "command -v git"])
      ).stdout.trim();
      await mkdir(shimDir);
      await writeFile(
        join(shimDir, "git"),
        [
          "#!/bin/sh",
          'case " $* " in',
          `  *" diff-tree "*" ${first} "*) echo "fatal: bad tree one" >&2; exit 128 ;;`,
          `  *" diff-tree "*" ${second} "*) echo "fatal: bad tree two" >&2; exit 128 ;;`,
          "esac",
          `exec "${realGit}" "$@"`,
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const savedPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${savedPath}`;
      let reports;
      try {
        reports = await inspectSkillFolders(repo.url, latest, [
          { installedCommit: first, skillPath: "skills/x" },
          { installedCommit: second, skillPath: "skills/x" },
        ]);
      } finally {
        process.env.PATH = savedPath;
      }
      expect(reports.map((r) => [r.changed, r.error])).toEqual([
        [null, "could not compare commits: fatal: bad tree one"],
        [null, "could not compare commits: fatal: bad tree two"],
      ]);
    },
  );

  it("leaves the commit comparison in force when inspection fails", async () => {
    const summary = await checkOutdated({
      lock: {
        version: 1,
        skills: {
          one: lockEntry("file:///nowhere.git", "a".repeat(40), "skills/one"),
        },
      },
      fetchRegistryIndexFn: async () => null,
      getLatestRemoteCommitFn: async () => "b".repeat(40),
      inspectSkillFoldersFn: async () => {
        throw new Error("network down");
      },
    });
    expect(summary.entries[0]).toMatchObject({
      status: "outdated",
      installedVersion: null,
      latestVersion: null,
      inspectionError: "skill folder check failed: network down",
    });
  });

  it("flags only rows whose status depends on a failed folder check", async () => {
    const latest = "b".repeat(40);
    const lock = {
      version: 1 as const,
      skills: {
        current: lockEntry("file:///nowhere.git", latest, "skills/current"),
        stale: lockEntry("file:///nowhere.git", "a".repeat(40), "skills/stale"),
      },
    };
    const failures: Array<typeof inspectSkillFolders> = [
      async () => {
        throw new Error("network down");
      },
      async (_url, _latest, probes) =>
        probes.map(() => ({
          changed: null,
          installedVersion: null,
          latestVersion: null,
          error: "skill folder check failed: network down",
        })),
    ];
    for (const inspectSkillFoldersFn of failures) {
      const summary = await checkOutdated({
        lock,
        fetchRegistryIndexFn: async () => null,
        getLatestRemoteCommitFn: async () => latest,
        inspectSkillFoldersFn,
      });
      const byName = Object.fromEntries(
        summary.entries.map((e) => [e.name, e]),
      );
      expect(byName.current.status).toBe("up-to-date");
      expect(byName.current).not.toHaveProperty("inspectionError");
      expect(byName.stale).toMatchObject({
        status: "outdated",
        inspectionError: "skill folder check failed: network down",
      });
    }
  });

  it("reports no folder error for a probe already at the latest commit", async () => {
    const latest = "b".repeat(40);
    const url = `file://${join(tempDir, "missing.git")}`;
    // Only a current probe: the single tree fetch fails.
    expect(
      await inspectSkillFolders(url, latest, [
        { installedCommit: latest.toUpperCase(), skillPath: "skills/x" },
      ]),
    ).toEqual([{ changed: false, installedVersion: null, latestVersion: null }]);
    // With a stale probe too: the fallback fetch throws as well.
    const reports = await inspectSkillFolders(url, latest, [
      { installedCommit: latest, skillPath: "skills/x" },
      { installedCommit: "a".repeat(40), skillPath: "skills/y" },
    ]);
    expect(reports[0]).toEqual({
      changed: false,
      installedVersion: null,
      latestVersion: null,
    });
    expect(reports[1]).toMatchObject({ changed: null });
    expect(reports[1].error).toMatch(/^skill folder check failed: /);
  });

  it("does not add version fields to non-GitHub entries", async () => {
    const summary = await checkOutdated({
      lock: {
        version: 1,
        skills: {
          mine: {
            source: "local:/somewhere",
            commitHash: "abc1234",
            ref: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            provider: "claude",
          },
        },
      },
      fetchRegistryIndexFn: async () => null,
    });
    expect(summary.entries[0]).not.toHaveProperty("installedVersion");
    expect(summary.entries[0]).not.toHaveProperty("latestVersion");
  });

  it("asm update updates the outdated skills and skips the current ones", async () => {
    const repo = await multiSkillRepo();
    const skills: Record<string, LockEntry> = {};
    for (const name of ["alpha", "beta", "gamma", "plain"]) {
      skills[name] = lockEntry(repo.url, repo.installed, `skills/${name}`);
    }
    const updateSkillFn = vi.fn(
      async (
        name: string,
        _entry: LockEntry,
        _yes: boolean,
        _o?: unknown,
        known?: string,
      ) => ({
        name,
        status: "updated" as const,
        newCommit: known,
      }),
    );
    const summary = await updateSkills(null, true, {
      readLockFn: async () => ({ version: 1, skills }),
      checkOutdatedFn: (o) =>
        checkOutdated({ ...o, fetchRegistryIndexFn: async () => null }),
      updateSkillFn,
    });
    expect(updateSkillFn.mock.calls.map((c) => c[0]).sort()).toEqual([
      "alpha",
      "plain",
    ]);
    for (const call of updateSkillFn.mock.calls) {
      expect(call[4]).toBe(repo.latest);
    }
    expect(summary.updatedCount).toBe(2);
  });
});

describe("readSkillVersion", () => {
  it("prefers metadata.version and falls back to a top-level version", () => {
    expect(
      readSkillVersion("---\nname: a\nmetadata:\n  version: 1.2.3\n---\n"),
    ).toBe("1.2.3");
    expect(readSkillVersion("---\nname: a\nversion: 0.9.0\n---\n")).toBe(
      "0.9.0",
    );
    expect(readSkillVersion("---\nname: a\n---\n")).toBeNull();
    expect(readSkillVersion("no frontmatter")).toBeNull();
  });
});
