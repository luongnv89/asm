import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  chmod,
  stat,
} from "fs/promises";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { borrowGetSkill, cleanupGetBorrow } from "./get-borrows";
import { getDependencyLeasesDir, getGetBorrowsDir } from "./config";
import { cleanupStaleDependencySessions } from "./dependency-leases";
import type { DependencyLeaseSession, GetResult, GetTier } from "./utils/types";

let tempDir: string;
let sourceDir: string;
const body = "---\nname: helper\ndescription: Borrow fixture\n---\n# Helper\n";
const binary = Buffer.from([0, 255, 128, 13, 10, 1]);
const dirLinkType = process.platform === "win32" ? "junction" : "dir";

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "asm-get-borrows-")));
  vi.stubEnv("ASM_CONFIG_DIR", join(tempDir, "config"));
  sourceDir = join(tempDir, "source");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "SKILL.md"), body);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

function result(tier: GetTier = "local"): GetResult {
  return {
    name: "helper",
    description: "Borrow fixture",
    dependencies: ["another-skill"],
    tier,
    source: sourceDir,
    commit: null,
    tokenCount: 10,
    security: null,
    content: body,
  };
}

const borrow = (tier: GetTier = "local", dir = sourceDir) =>
  borrowGetSkill("helper", dir, result(tier));
const statePath = (path: string) =>
  join(getGetBorrowsDir(), "sessions", `${basename(dirname(path))}.json`);
async function ownerMarker(path: string): Promise<string> {
  return join(
    path,
    (await readdir(path)).find((name) => name.startsWith(".asm-owner-"))!,
  );
}
async function expectSource(): Promise<void> {
  expect(await readFile(join(sourceDir, "SKILL.md"), "utf-8")).toBe(body);
}
async function quarantine(path: string): Promise<string> {
  const name = (await readdir(dirname(path))).find((entry) =>
    entry.includes(".quarantine-"),
  );
  expect(name).toBeDefined();
  return join(dirname(path), name!);
}

describe("durable full-directory get borrows", () => {
  it("resolves the isolated namespace lazily and is not swept by dependency cleanup", async () => {
    expect(getGetBorrowsDir()).toBe(join(tempDir, "config", "get-borrows"));
    expect(getDependencyLeasesDir()).not.toBe(getGetBorrowsDir());
    const acquired = await borrow();
    await cleanupStaleDependencySessions(new Date("2999-01-01"), false);
    expect(await readFile(join(acquired.path, "SKILL.md"), "utf-8")).toBe(body);
    vi.stubEnv("ASM_CONFIG_DIR", join(tempDir, "other-config"));
    expect(getGetBorrowsDir()).toBe(
      join(tempDir, "other-config", "get-borrows"),
    );
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("not-found");
    await expectSource();
  });

  it.each<GetTier>([
    "local",
    "installed",
    "library",
    "index",
    "registry",
    "remote",
  ])(
    "copies every supporting file for %s and preserves the original after cleanup",
    async (tier) => {
      for (const dir of [
        "scripts",
        "templates",
        "assets",
        "references",
        ".git",
        "nested/.git",
      ]) {
        await mkdir(join(sourceDir, dir), { recursive: true });
      }
      await writeFile(
        join(sourceDir, "scripts", "run.sh"),
        "#!/bin/sh\nprintf helper\n",
      );
      await chmod(join(sourceDir, "scripts", "run.sh"), 0o755);
      await writeFile(join(sourceDir, "templates", "sample.txt"), "template");
      await writeFile(join(sourceDir, "assets", "image.bin"), binary);
      await writeFile(join(sourceDir, "references", "guide.md"), "reference");
      await writeFile(join(sourceDir, ".hidden"), "hidden support file");
      await writeFile(join(sourceDir, ".git", "config"), "git internals");
      await writeFile(
        join(sourceDir, "nested", ".git", "config"),
        "nested git internals",
      );
      await writeFile(join(sourceDir, ".asm-owner-unrelated.json"), "{}");

      const acquired = await borrow(tier);
      expect(acquired.path).not.toBe(sourceDir);
      expect(await realpath(acquired.path)).toBe(acquired.path);
      expect(acquired).toMatchObject({
        tier,
        source: sourceDir,
        dependencies: ["another-skill"],
        cleanup: { command: "asm", args: ["cleanup", acquired.path] },
      });
      expect(acquired).not.toHaveProperty("content");
      expect(acquired.files).toEqual([
        ".hidden",
        "SKILL.md",
        "assets/image.bin",
        "references/guide.md",
        "scripts/run.sh",
        "templates/sample.txt",
      ]);
      expect(
        await readFile(join(acquired.path, "assets", "image.bin")),
      ).toEqual(binary);
      if (process.platform !== "win32") {
        expect(
          (await stat(join(acquired.path, "scripts", "run.sh"))).mode & 0o777,
        ).toBe(0o755);
      }
      await expect(stat(join(acquired.path, ".git"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        stat(join(acquired.path, "nested", ".git")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(join(acquired.path, "SKILL.md"), "caller edits its copy");
      expect((await cleanupGetBorrow(acquired.path)).status).toBe("removed");
      await expect(stat(acquired.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expectSource();
      expect(await readFile(join(sourceDir, "assets", "image.bin"))).toEqual(
        binary,
      );
    },
  );

  it("canonicalizes a legitimate installed root symlink before copying", async () => {
    const installed = join(tempDir, "installed-link");
    await symlink(sourceDir, installed, dirLinkType);
    const acquired = await borrow("installed", installed);
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("removed");
    expect(await realpath(installed)).toBe(sourceDir);
    await expectSource();
  });

  it.each(["file", "dir"] as const)(
    "rejects nested source %s symlinks",
    async (type) => {
      const external = join(tempDir, "external");
      await mkdir(external);
      await writeFile(join(external, "sentinel"), "keep");
      await symlink(
        type === "file" ? join(external, "sentinel") : external,
        join(sourceDir, "link"),
        type === "file" ? "file" : dirLinkType,
      );
      await expect(borrow()).rejects.toThrow("symbolic link");
      await expectSource();
      expect(await readFile(join(external, "sentinel"), "utf-8")).toBe("keep");
    },
  );

  it("rejects a symlink SKILL.md rather than copying its target", async () => {
    const target = join(tempDir, "outside.md");
    await rename(join(sourceDir, "SKILL.md"), target);
    await symlink(target, join(sourceDir, "SKILL.md"), "file");
    await expect(borrow()).rejects.toThrow("SKILL.md must be a real file");
    expect(await readFile(target, "utf-8")).toBe(body);
  });

  it("isolates concurrent borrows of the same reference and serializes repeated cleanup", async () => {
    const [one, two] = await Promise.all([borrow(), borrow()]);
    expect(one.path).not.toBe(two.path);
    const releases = await Promise.all([
      cleanupGetBorrow(one.path),
      cleanupGetBorrow(one.path),
    ]);
    expect(releases.map((r) => r.status).sort()).toEqual([
      "not-found",
      "removed",
    ]);
    expect(await readFile(join(two.path, "SKILL.md"), "utf-8")).toBe(body);
    expect((await cleanupGetBorrow(one.path)).status).toBe("not-found");
    expect((await cleanupGetBorrow(two.path)).status).toBe("removed");
    await expectSource();
  });

  it("treats an already missing artifact as safe registered cleanup", async () => {
    const acquired = await borrow();
    await rm(acquired.path, { recursive: true });
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("missing");
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("not-found");
    await expectSource();
  });
});

describe("exact registered borrow cleanup boundary", () => {
  it("refuses original/outside, parent, child, relative and symlink alias paths", async () => {
    const acquired = await borrow();
    const alias = join(tempDir, "alias");
    await symlink(acquired.path, alias, dirLinkType);
    const rootAlias = join(tempDir, "root-alias");
    await symlink(getGetBorrowsDir(), rootAlias, dirLinkType);
    for (const path of [
      sourceDir,
      tempDir,
      getGetBorrowsDir(),
      dirname(acquired.path),
      join(acquired.path, "SKILL.md"),
      "relative-path",
      `${acquired.path}/../${basename(acquired.path)}`,
      alias,
      join(
        rootAlias,
        "artifacts",
        basename(dirname(acquired.path)),
        basename(acquired.path),
      ),
    ]) {
      expect(await cleanupGetBorrow(path)).toMatchObject({
        status: "not-found",
        errors: [],
      });
    }
    expect(await readFile(join(acquired.path, "SKILL.md"), "utf-8")).toBe(body);
    await expectSource();
  });

  it("never authorizes cleanup from a marker without registered state", async () => {
    const acquired = await borrow();
    await rm(statePath(acquired.path));
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("not-found");
    expect(await readFile(join(acquired.path, "SKILL.md"), "utf-8")).toBe(body);
    await expectSource();
  });

  it.each(["missing", "forged", "invalid", "symlink"] as const)(
    "preserves quarantined content with a %s ownership marker",
    async (kind) => {
      const acquired = await borrow();
      const marker = await ownerMarker(acquired.path);
      if (kind === "missing") await rm(marker);
      if (kind === "forged")
        await writeFile(
          marker,
          JSON.stringify({
            version: 1,
            sessionId: "wrong",
            artifactId: "wrong",
            path: acquired.path,
          }),
        );
      if (kind === "invalid") await writeFile(marker, "not JSON");
      if (kind === "symlink") {
        const outside = join(tempDir, "outside-marker.json");
        await rename(marker, outside);
        await symlink(outside, marker, "file");
      }
      const cleaned = await cleanupGetBorrow(acquired.path);
      expect(cleaned.status).toBe("refused");
      expect(cleaned.errors).toHaveLength(1);
      expect(
        await readFile(
          join(await quarantine(acquired.path), "SKILL.md"),
          "utf-8",
        ),
      ).toBe(body);
      await expectSource();
    },
  );

  it("preserves the target of a swapped artifact root symlink", async () => {
    const acquired = await borrow();
    await rename(acquired.path, `${acquired.path}.original`);
    await symlink(sourceDir, acquired.path, dirLinkType);
    const cleaned = await cleanupGetBorrow(acquired.path);
    expect(cleaned.status).toBe("refused");
    expect(cleaned.errors.join()).toContain("symbolic-link artifact");
    await expectSource();
    expect(
      await readFile(join(`${acquired.path}.original`, "SKILL.md"), "utf-8"),
    ).toBe(body);
  });

  it("quarantines an unowned replacement directory without deleting it", async () => {
    const acquired = await borrow();
    await rename(acquired.path, `${acquired.path}.original`);
    await mkdir(acquired.path);
    await writeFile(join(acquired.path, "sentinel"), "replacement");
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("refused");
    expect(
      await readFile(
        join(await quarantine(acquired.path), "sentinel"),
        "utf-8",
      ),
    ).toBe("replacement");
    await expectSource();
  });

  it("preserves a nested link introduced after acquisition and its target", async () => {
    const acquired = await borrow();
    await symlink(sourceDir, join(acquired.path, "link"), dirLinkType);
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("refused");
    expect(
      await readFile(
        join(await quarantine(acquired.path), "SKILL.md"),
        "utf-8",
      ),
    ).toBe(body);
    await expectSource();
  });

  it("does not follow a swapped borrow namespace into outside content", async () => {
    const acquired = await borrow();
    const root = getGetBorrowsDir();
    await rename(root, `${root}.original`);
    await symlink(sourceDir, root, dirLinkType);
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("not-found");
    await expectSource();
    expect(await readdir(sourceDir)).toEqual(["SKILL.md"]);
  });

  it.each(["sessions", "artifacts"])(
    "refuses a swapped managed %s parent",
    async (parent) => {
      const acquired = await borrow();
      const managed = join(getGetBorrowsDir(), parent);
      await rename(managed, `${managed}.original`);
      await symlink(sourceDir, managed, dirLinkType);
      expect((await cleanupGetBorrow(acquired.path)).status).toBe("refused");
      await expectSource();
      expect(await readdir(sourceDir)).toEqual(["SKILL.md"]);
    },
  );

  it.each(["session", "multiple", "unowned", "identity", "corrupt"])(
    "refuses %s persisted state without deleting the copy",
    async (kind) => {
      const acquired = await borrow();
      const file = statePath(acquired.path);
      const state = JSON.parse(
        await readFile(file, "utf-8"),
      ) as DependencyLeaseSession;
      const acquisition = Object.values(state.acquisitions)[0];
      if (kind === "session") state.sessionId = "different-session";
      if (kind === "multiple")
        state.acquisitions.other = { ...acquisition, path: sourceDir };
      if (kind === "unowned") acquisition.owned = false;
      if (kind === "identity") acquisition.artifactId = null;
      await writeFile(
        file,
        kind === "corrupt" ? "not JSON" : JSON.stringify(state),
      );
      expect((await cleanupGetBorrow(acquired.path)).status).toBe("refused");
      expect(await readFile(join(acquired.path, "SKILL.md"), "utf-8")).toBe(
        body,
      );
      await expectSource();
    },
  );

  it("does not accept a state symlink as a registration", async () => {
    const acquired = await borrow();
    const file = statePath(acquired.path);
    await rename(file, `${file}.original`);
    await symlink(`${file}.original`, file, "file");
    expect((await cleanupGetBorrow(acquired.path)).status).toBe("refused");
    expect(await readFile(join(acquired.path, "SKILL.md"), "utf-8")).toBe(body);
    await expectSource();
  });
});
