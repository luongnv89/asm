/**
 * Direct-import coverage for `src/updater-core.ts`.
 *
 * The module split (#455) exported these helpers for cross-module wiring with
 * `updater-updates.ts`, but deliberately did NOT forward them through the
 * `src/updater.ts` facade. `src/updater.test.ts` imports from the facade and so
 * cannot reach them — everything here imports from `./updater-core` directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  createPinnedGitEnv,
  resolvedLatestCommits,
  normalizedTargetIdentity,
  poolAll,
  getUpdateSourceDir,
  checkOutdated,
} from "./updater-core";
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
