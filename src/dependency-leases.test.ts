import { createHash } from "crypto";
import { spawn } from "child_process";
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
  withDependencyLeaseSession,
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

  function statePath(sessionId: string): string {
    const key = createHash("sha256").update(sessionId).digest("hex");
    return join(rootDir, "sessions", `${key}.json`);
  }

  async function holdSessionLock(
    sessionId: string,
    pid = process.pid,
  ): Promise<string> {
    const lockDir = `${statePath(sessionId)}.lock`;
    const token = "00000000-0000-4000-8000-000000000001";
    const lockPath = join(lockDir, `${token}.json`);
    await mkdir(lockDir, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        pid,
        token,
        acquiredAt: new Date().toISOString(),
        ticket: 1,
      }),
    );
    return lockPath;
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

  it("waits for a filesystem lock held outside the in-process queue", async () => {
    const lockPath = await holdSessionLock("run-contended");
    const pending = acquire("run-contended", true);

    const earlyResult = await Promise.race([
      pending.then(() => "completed"),
      new Promise<"blocked">((resolveBlocked) =>
        setTimeout(() => resolveBlocked("blocked"), 60),
      ),
    ]);
    expect(earlyResult).toBe("blocked");
    await expect(readFile(lockPath, "utf-8")).resolves.toContain(
      `"pid":${process.pid}`,
    );

    await rm(lockPath, { force: true });
    const acquired = await pending;
    await expect(readFile(acquired.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
  });

  it("recovers a lock whose owning process was killed", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    const deadPid = child.pid!;
    const childExited = new Promise<void>((resolveExit) =>
      child.once("exit", () => resolveExit()),
    );
    child.kill("SIGKILL");
    await childExited;

    const deadOwnerPath = await holdSessionLock("run-dead-owner", deadPid);
    const acquired = await acquire("run-dead-owner", true);

    await expect(readFile(deadOwnerPath, "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(acquired.skillMdPath, "utf-8")).resolves.toContain(
      "# Helper",
    );
  });

  it("serializes resolution and acquisition against concurrent release", async () => {
    let enteredResolution!: () => void;
    const resolutionStarted = new Promise<void>((resolveStarted) => {
      enteredResolution = resolveStarted;
    });
    let continueResolution!: () => void;
    const resolutionGate = new Promise<void>((resolveGate) => {
      continueResolution = resolveGate;
    });

    const acquiring = withDependencyLeaseSession(
      "run-acquire-release",
      async (transaction) => {
        expect(await transaction.find("helper")).toBeNull();
        enteredResolution();
        await resolutionGate;
        return transaction.acquire({
          sessionId: "run-acquire-release",
          request: "helper",
          name: "helper",
          sourceDir,
          tier: "remote",
          source: "github:owner/repo",
          commit: "a".repeat(40),
          temporary: true,
        });
      },
      { rootDir },
    );

    await resolutionStarted;
    const releaseScript = `
      import { releaseDependencySession } from ${JSON.stringify(
        new URL("./dependency-leases.ts", import.meta.url).href,
      )};
      const result = await releaseDependencySession(
        "run-acquire-release",
        { rootDir: process.argv[1] },
      );
      process.stdout.write(JSON.stringify(result));
    `;
    const releaser = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", releaseScript, rootDir],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let releaseStdout = "";
    let releaseStderr = "";
    releaser.stdout.on("data", (chunk) => {
      releaseStdout += String(chunk);
    });
    releaser.stderr.on("data", (chunk) => {
      releaseStderr += String(chunk);
    });
    const releasing = new Promise<number | null>((resolveExit) =>
      releaser.once("exit", resolveExit),
    );
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      releaser.once("spawn", resolveSpawn);
      releaser.once("error", rejectSpawn);
    });
    await expect(
      Promise.race([
        releasing.then(() => "released"),
        new Promise<"blocked">((resolveBlocked) =>
          setTimeout(() => resolveBlocked("blocked"), 60),
        ),
      ]),
    ).resolves.toBe("blocked");

    continueResolution();
    const acquired = await acquiring;
    expect(await releasing, releaseStderr).toBe(0);
    const released = JSON.parse(releaseStdout);
    expect(released.removed).toEqual([acquired.path]);
    await expect(readFile(acquired.skillMdPath, "utf-8")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("rolls back an owned artifact when session persistence fails", async () => {
    let writes = 0;
    let firstStatus: string | undefined;
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
            const state = JSON.parse(content) as {
              acquisitions: Record<string, { status: string }>;
            };
            firstStatus = Object.values(state.acquisitions)[0]?.status;
            await mkdir(join(rootDir, "sessions"), { recursive: true });
            await writeFile(path, content);
          },
        },
      ),
    ).rejects.toThrow("injected persistence failure");
    expect(firstStatus).toBe("pending");

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

  it("preserves and reports unknown content in an artifact directory", async () => {
    const acquired = await acquire("run-unknown-content", true);
    const artifactsDir = join(acquired.path, "..");
    const unknownPath = join(artifactsDir, "user-created.txt");
    await writeFile(unknownPath, "keep me");

    const released = await releaseDependencySession("run-unknown-content", {
      rootDir,
    });

    expect(released.removed).toEqual([acquired.path]);
    expect(released.errors).toEqual([
      expect.stringContaining("Preserved unknown content"),
    ]);
    await expect(readFile(unknownPath, "utf-8")).resolves.toBe("keep me");
    await expect(
      readFile(statePath("run-unknown-content"), "utf-8"),
    ).resolves.toContain('"acquisitions": {}');

    await rm(unknownPath);
    await expect(
      releaseDependencySession("run-unknown-content", { rootDir }),
    ).resolves.toMatchObject({ errors: [] });
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

  it("rechecks updatedAt under the session lock before stale cleanup", async () => {
    const acquired = await acquire("run-refreshed", true);
    const path = statePath("run-refreshed");
    const state = JSON.parse(await readFile(path, "utf-8"));
    state.updatedAt = "2026-01-01T00:00:00.000Z";
    await writeFile(path, JSON.stringify(state));

    const lockPath = await holdSessionLock("run-refreshed");
    const cleanup = cleanupStaleDependencySessions(
      new Date("2026-06-01T00:00:00.000Z"),
      false,
      { rootDir },
    );

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 60));
    state.updatedAt = "2026-12-01T00:00:00.000Z";
    await writeFile(path, JSON.stringify(state));
    await rm(lockPath, { force: true });

    await expect(cleanup).resolves.toMatchObject({
      stale: [],
      active: ["run-refreshed"],
      cleaned: [],
      errors: [],
    });
    await expect(readFile(acquired.skillMdPath, "utf-8")).resolves.toContain(
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
