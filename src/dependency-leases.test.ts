import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireDependency,
  cleanupStaleDependencySessions,
  findAcquiredDependency,
  releaseDependencySession,
} from "./dependency-leases";

describe("temporary dependency leases", () => {
  let tempDir: string;
  let rootDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "asm-dependency-leases-"));
    rootDir = join(tempDir, "leases");
    sourceDir = join(tempDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: helper\nversion: 1.0.0\n---\n# Helper\n",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function acquire(sessionId: string, temporary: boolean, request = "helper") {
    return acquireDependency(
      {
        sessionId,
        request,
        name: "helper",
        sourceDir,
        tier: temporary ? "remote" : "local",
        source: temporary ? "github:owner/repo" : sourceDir,
        commit: temporary ? "a".repeat(40) : null,
        temporary,
      },
      { rootDir },
    );
  }

  it("copies a temporary dependency into a directly usable owned artifact", async () => {
    const result = await acquire("run-1", true);

    expect(result).toMatchObject({
      sessionId: "run-1",
      name: "helper",
      status: "ready",
      owned: true,
      reused: false,
    });
    await expect(readFile(result.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
    expect(result.path.startsWith(rootDir)).toBe(true);

    const reused = await findAcquiredDependency("run-1", "helper", {
      rootDir,
    });
    expect(reused).toMatchObject({ path: result.path, reused: true });
  });

  it("removes lease-owned artifacts and makes release idempotent", async () => {
    const acquired = await acquire("run-release", true);

    const released = await releaseDependencySession("run-release", {
      rootDir,
    });
    expect(released.removed).toEqual([acquired.path]);
    await expect(readFile(acquired.skillMdPath, "utf-8")).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );

    await expect(
      releaseDependencySession("run-release", { rootDir }),
    ).resolves.toMatchObject({
      alreadyReleased: true,
      removed: [],
      errors: [],
    });
  });

  it("records and preserves a dependency that existed before the lease", async () => {
    const acquired = await acquire("run-existing", false);
    expect(acquired).toMatchObject({
      path: await realpath(sourceDir),
      owned: false,
    });

    const released = await releaseDependencySession("run-existing", {
      rootDir,
    });
    expect(released.preserved).toEqual([await realpath(sourceDir)]);
    await expect(
      readFile(join(sourceDir, "SKILL.md"), "utf-8"),
    ).resolves.toContain("# Helper");
  });

  it("rolls back an owned artifact when session persistence fails", async () => {
    let writes = 0;
    await expect(
      acquireDependency(
        {
          sessionId: "run-rollback",
          request: "helper",
          name: "helper",
          sourceDir,
          tier: "remote",
          source: "github:owner/repo",
          commit: "a".repeat(40),
          temporary: true,
        },
        {
          rootDir,
          writeState: async (path, content) => {
            writes++;
            if (writes === 2) {
              throw new Error("injected persistence failure");
            }
            await mkdir(join(rootDir, "sessions"), { recursive: true });
            await writeFile(path, content);
          },
        },
      ),
    ).rejects.toThrow("injected persistence failure");

    const artifacts = await readdir(join(rootDir, "artifacts"), {
      recursive: true,
    });
    expect(artifacts.some((entry) => entry.endsWith("SKILL.md"))).toBe(false);
  });

  it("refuses cleanup when an ownership marker no longer matches", async () => {
    const acquired = await acquire("run-owner-check", true);
    await writeFile(
      `${acquired.path}.owner.json`,
      JSON.stringify({
        version: 1,
        sessionId: "another-run",
        artifactId: acquired.artifactId,
        path: acquired.path,
      }),
    );

    const released = await releaseDependencySession("run-owner-check", {
      rootDir,
    });
    expect(released.errors).toHaveLength(1);
    expect(released.errors[0]).toContain("mismatched ownership");
    await expect(readFile(acquired.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
  });

  it("classifies by an explicit cutoff and cleans only stale sessions", async () => {
    const stale = await acquire("run-stale", true, "stale-helper");
    const active = await acquire("run-active", true, "active-helper");
    const sessionsDir = join(rootDir, "sessions");
    for (const file of await readdir(sessionsDir)) {
      const path = join(sessionsDir, file);
      const state = JSON.parse(await readFile(path, "utf-8"));
      state.updatedAt =
        state.sessionId === "run-stale"
          ? "2026-01-01T00:00:00.000Z"
          : "2026-12-01T00:00:00.000Z";
      await writeFile(path, JSON.stringify(state));
    }

    const result = await cleanupStaleDependencySessions(
      new Date("2026-06-01T00:00:00.000Z"),
      false,
      { rootDir },
    );

    expect(result).toMatchObject({
      stale: ["run-stale"],
      active: ["run-active"],
      cleaned: ["run-stale"],
      errors: [],
    });
    await expect(readFile(stale.skillMdPath, "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(active.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
  });

  it("supports dry-run stale classification without removing artifacts", async () => {
    const acquired = await acquire("run-dry", true);

    const result = await cleanupStaleDependencySessions(
      new Date("2999-01-01T00:00:00.000Z"),
      true,
      { rootDir },
    );

    expect(result.stale).toEqual(["run-dry"]);
    expect(result.cleaned).toEqual([]);
    await expect(readFile(acquired.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
  });

  it("rejects session identities that could escape the lease root", async () => {
    await expect(acquire("../other-session", true)).rejects.toThrow(
      "Invalid session identity",
    );
  });
});
