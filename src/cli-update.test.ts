/**
 * `asm outdated` / `asm update` end to end, in-process, for a skill whose
 * SKILL.md is gone upstream (#814). A `github:` source is served from a local
 * bare repo through `~/.gitconfig` (`asm update` drops GIT_CONFIG_* from its
 * pinned git env), inside a throwaway HOME; no network.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runCliInProcess, CLI_BIN } from "./cli-test-harness";

const SKILL_MD = (name: string, version: string) =>
  `---\nname: ${name}\ndescription: ${name} test skill\nmetadata:\n  version: ${version}\n---\n# ${name}\n`;

describe("asm update refuses a skill whose SKILL.md is gone upstream (#814)", () => {
  let home: string;
  let cwd: string;
  let work: string;
  let installed: string;

  const skillsDir = () => join(home, ".claude", "skills");
  const lockPath = () =>
    join(home, ".config", "agent-skill-manager", ".skill-lock.json");

  const git = (...args: string[]) => {
    const r = spawnSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      { cwd: work, encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };

  /** Commit the work tree and publish it to the bare "github" repo. */
  const publish = (message: string) => {
    git("add", "-A");
    git("commit", "-qm", message);
    git("push", "-q", join(cwd, "skills.git"), "HEAD:refs/heads/main");
    return git("rev-parse", "HEAD");
  };

  const asm = (...args: string[]) =>
    runCliInProcess(["npx", "tsx", CLI_BIN, ...args], {
      cwd,
      env: { ...process.env, HOME: home, NO_COLOR: "1" },
    });

  async function snapshot(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const walk = async (rel: string) => {
      for (const name of (await readdir(join(dir, rel))).sort()) {
        const path = rel ? `${rel}/${name}` : name;
        const s = await lstat(join(dir, path));
        if (s.isSymbolicLink())
          out[path] = `link:${await readlink(join(dir, path))}`;
        else if (s.isDirectory()) await walk(path);
        else out[path] = await readFile(join(dir, path), "utf-8");
      }
    };
    await walk("");
    return out;
  }

  const sha256 = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");

  const readLock = async () => JSON.parse(await readFile(lockPath(), "utf-8"));

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "asm-814-home-"));
    cwd = await mkdtemp(join(tmpdir(), "asm-814-cwd-"));
    work = await mkdtemp(join(tmpdir(), "asm-814-work-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    // v1: two skills from one repo, both installed and locked at v1.
    for (const n of ["c9", "ok"]) {
      await mkdir(join(work, "skills", n), { recursive: true });
      await writeFile(
        join(work, "skills", n, "SKILL.md"),
        SKILL_MD(n, "1.0.0"),
      );
      await writeFile(join(work, "skills", n, "body.md"), `${n} v1\n`);
    }
    git("init", "-q", "-b", "main");
    spawnSync("git", ["init", "-q", "--bare", join(cwd, "skills.git")]);
    installed = publish("v1");
    await writeFile(
      join(home, ".gitconfig"),
      `[url "file://${join(cwd, "skills.git")}"]\n\tinsteadOf = https://github.com/acme/skills.git\n`,
    );
    const skills: Record<string, unknown> = {};
    for (const n of ["c9", "ok"]) {
      await mkdir(skillsDir(), { recursive: true });
      await cp(join(work, "skills", n), join(skillsDir(), n), {
        recursive: true,
      });
      skills[n] = {
        source: "github:acme/skills",
        commitHash: installed,
        ref: "main",
        installedAt: "2026-11-01T00:00:00.000Z",
        provider: "claude",
        scope: "global",
        skillPath: `skills/${n}`,
        targetDir: join(skillsDir(), n),
        sourceType: "github",
      };
    }
    await mkdir(join(home, ".config", "agent-skill-manager"), {
      recursive: true,
    });
    await writeFile(
      lockPath(),
      JSON.stringify({ version: 1, skills }, null, 2),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const d of [home, cwd, work]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("SKILL.md deleted: outdated labels it, update --yes keeps it, updates the other skill, exits 1", async () => {
    await rm(join(work, "skills", "c9", "SKILL.md"));
    await writeFile(
      join(work, "skills", "ok", "SKILL.md"),
      SKILL_MD("ok", "1.1.0"),
    );
    const latest = publish("v2: c9 SKILL.md deleted, ok bumped");
    const short = latest.slice(0, 7);

    const json = await asm("outdated", "--json");
    expect(json.exitCode).toBe(0);
    const out = JSON.parse(json.stdout);
    const byName = Object.fromEntries(
      out.skills.map((s: { name: string }) => [s.name, s]),
    );
    expect(byName.c9).toEqual({
      name: "c9",
      installed: installed.slice(0, 7),
      latest: short,
      source: "github",
      status: "removed-upstream",
      installedVersion: "1.0.0",
      latestVersion: null,
    });
    expect(byName.ok).toMatchObject({
      status: "outdated",
      installedVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    expect(out.summary).toEqual({
      outdated: 1,
      removedUpstream: 1,
      upToDate: 0,
      untracked: 0,
      errors: 0,
    });

    const table = await asm("outdated");
    expect(table.exitCode).toBe(1);
    expect(table.stdout).toMatch(
      /^c9 .*1\.0\.0 → \?.*\(removed upstream: no SKILL\.md\)$/m,
    );
    expect(table.stdout).toContain("1 outdated, 1 removed upstream");

    const c9Before = await snapshot(join(skillsDir(), "c9"));
    const c9LockBefore = (await readLock()).skills.c9;

    const update = await asm("update", "--yes");
    expect(update.exitCode).toBe(1);
    expect(update.stdout).toContain(
      `✗ c9 SKILL.md missing at ${short}: the skill was removed or moved upstream. Run "asm uninstall c9" to remove it, or reinstall it from its new path.`,
    );
    expect(update.stdout).toMatch(/✓ ok \S+ → \S+/);
    expect(update.stdout).toContain("1 updated, 1 failed");

    // The refused skill: same files, same lock entry. The other one moved on.
    expect(await snapshot(join(skillsDir(), "c9"))).toEqual(c9Before);
    const lock = await readLock();
    expect(lock.skills.c9).toEqual(c9LockBefore);
    expect(lock.skills.ok.commitHash).toBe(latest);
    expect(
      await readFile(join(skillsDir(), "ok", "SKILL.md"), "utf-8"),
    ).toContain("version: 1.1.0");
  });

  test("SKILL.md moved: plain update and update <name> both refuse, name the new path, and leave the lock file byte-identical", async () => {
    await mkdir(join(work, "skills", "v2"), { recursive: true });
    git("mv", "skills/c9", "skills/v2/c9");
    const latest = publish("v2: c9 moved");
    const short = latest.slice(0, 7);
    const lockSum = await sha256(lockPath());
    const c9Before = await snapshot(join(skillsDir(), "c9"));
    const reason = `✗ c9 SKILL.md missing at ${short}: the skill was removed or moved upstream. Run "asm uninstall c9" to remove it, or reinstall it from its new path: "asm install 'github:acme/skills#main:skills/v2/c9'".`;

    for (const args of [
      ["update"],
      ["update", "c9"],
      ["update", "c9", "--yes"],
    ]) {
      const r = await asm(...args);
      expect(r.exitCode, args.join(" ")).toBe(1);
      expect(r.stdout, args.join(" ")).toContain(reason);
      expect(r.stdout, args.join(" ")).toContain("1 failed");
      expect(await sha256(lockPath()), args.join(" ")).toBe(lockSum);
      expect(await snapshot(join(skillsDir(), "c9")), args.join(" ")).toEqual(
        c9Before,
      );
    }

    const json = JSON.parse((await asm("update", "c9", "--json")).stdout);
    expect(json.results).toEqual([
      { name: "c9", status: "failed", reason: reason.slice("✗ c9 ".length) },
    ]);
    expect(json.summary).toEqual({ updated: 0, skipped: 0, failed: 1 });

    const machine = JSON.parse((await asm("outdated", "--machine")).stdout);
    expect(
      machine.data.find((d: { name: string }) => d.name === "c9").status,
    ).toBe("removed-upstream");
  });

  test("nothing removed upstream: update behaves as before", async () => {
    await writeFile(join(work, "skills", "c9", "body.md"), "c9 v2\n");
    const latest = publish("v2: c9 body only");
    const out = JSON.parse((await asm("outdated", "--json")).stdout);
    expect(out.summary).toMatchObject({ outdated: 1, removedUpstream: 0 });

    const update = await asm("update", "--yes");
    expect(update.exitCode).toBe(0);
    expect(update.stdout).toMatch(/✓ c9 \S+ → \S+/);
    expect(update.stdout).toContain("1 updated");
    expect((await readLock()).skills.c9.commitHash).toBe(latest);
    expect(await readFile(join(skillsDir(), "c9", "body.md"), "utf-8")).toBe(
      "c9 v2\n",
    );
  });
});
