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
  rename,
  rm,
  symlink,
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
      `✗ c9 SKILL.md missing at ${short}: the skill was removed or moved upstream. Run: asm uninstall c9 — or reinstall it from its new path\n`,
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
    // Commands are printed bare, never inside "…", so a copy never expands $(…).
    const reason = `✗ c9 SKILL.md missing at ${short}: the skill was removed or moved upstream. Run: asm uninstall c9 — or reinstall it from its new path: asm install 'github:acme/skills#main:skills/v2/c9'`;

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

    // --json and --machine report the refusal as "failed" and exit 1, like
    // the table output (#822).
    const jsonRun = await asm("update", "c9", "--json");
    expect(jsonRun.exitCode).toBe(1);
    const json = JSON.parse(jsonRun.stdout);
    expect(json.results).toEqual([
      { name: "c9", status: "failed", reason: reason.slice("✗ c9 ".length) },
    ]);
    expect(json.summary).toEqual({ updated: 0, skipped: 0, failed: 1 });

    const machineRun = await asm("update", "c9", "--machine");
    expect(machineRun.exitCode).toBe(1);
    expect(JSON.parse(machineRun.stdout).data).toMatchObject([
      { name: "c9", status: "failed" },
    ]);

    const machine = JSON.parse((await asm("outdated", "--machine")).stdout);
    expect(
      machine.data.find((d: { name: string }) => d.name === "c9").status,
    ).toBe("removed-upstream");
  });

  // B1: the skill folder itself replaced upstream by a symlink.
  for (const target of ["inside", "outside"] as const) {
    for (const yes of [false, true]) {
      test(`skill folder replaced by a symlink ${target} the repo${yes ? " with --yes" : ""}: refused, other skill updates`, async () => {
        let linkTo: string;
        if (target === "inside") {
          await mkdir(join(work, "other", "c9"), { recursive: true });
          await writeFile(
            join(work, "other", "c9", "SKILL.md"),
            SKILL_MD("c9", "9.9.9"),
          );
          linkTo = "../other/c9";
        } else {
          linkTo = join(cwd, "outside", "c9");
          await mkdir(linkTo, { recursive: true });
          await writeFile(join(linkTo, "SKILL.md"), SKILL_MD("c9", "9.9.9"));
          await writeFile(join(linkTo, "payload.txt"), "PAYLOAD-OUT\n");
        }
        git("rm", "-rq", "skills/c9");
        await symlink(linkTo, join(work, "skills", "c9"));
        await writeFile(
          join(work, "skills", "ok", "SKILL.md"),
          SKILL_MD("ok", "1.1.0"),
        );
        const latest = publish(`v2: c9 -> ${target}`);
        const short = latest.slice(0, 7);

        const out = JSON.parse((await asm("outdated", "--json")).stdout);
        expect(
          out.skills.find((x: { name: string }) => x.name === "c9").status,
        ).toBe("removed-upstream");

        const c9Before = await snapshot(join(skillsDir(), "c9"));
        const c9LockBefore = (await readLock()).skills.c9;
        const update = await asm("update", ...(yes ? ["--yes"] : []));
        expect(update.exitCode).toBe(1);
        expect(update.stdout).toContain(
          `✗ c9 SKILL.md missing at ${short}: the skill was removed or moved upstream (skills/c9 is a symlink, which asm does not follow). Run: asm uninstall c9 — or reinstall it from its new path`,
        );
        expect(update.stdout).toMatch(/✓ ok \S+ → \S+/);
        expect(update.stdout).toContain("1 updated, 1 failed");

        expect((await lstat(join(skillsDir(), "c9"))).isSymbolicLink()).toBe(
          false,
        );
        expect(await snapshot(join(skillsDir(), "c9"))).toEqual(c9Before);
        const lock = await readLock();
        expect(lock.skills.c9).toEqual(c9LockBefore);
        expect(lock.skills.ok.commitHash).toBe(latest);
      });
    }
  }

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
  test("source unreachable: outdated and update report the fetch error and exit 1 (#822)", async () => {
    await writeFile(join(work, "skills", "c9", "body.md"), "c9 v2\n");
    publish("v2: c9 body only");
    await rename(join(cwd, "skills.git"), join(cwd, "moved.git"));
    const lockSum = await sha256(lockPath());

    const table = await asm("outdated");
    expect(table.exitCode).toBe(1);
    expect(table.stdout).toMatch(/^c9 .*Failed to fetch remote commit$/m);
    expect(table.stdout).toContain("2 error");

    for (const args of [["update"], ["update", "--yes"], ["update", "c9"]]) {
      const r = await asm(...args);
      const label = args.join(" ");
      expect(r.exitCode, label).toBe(1);
      expect(r.stdout, label).not.toContain("All skills are up to date.");
      expect(r.stdout, label).toContain("✗ c9 Failed to fetch remote commit\n");
      if (args.length === 1 || args[1] === "--yes") {
        expect(r.stdout, label).toContain(
          "✗ ok Failed to fetch remote commit\n",
        );
        expect(r.stdout, label).toContain("2 failed");
      } else {
        expect(r.stdout, label).not.toContain("✗ ok");
        expect(r.stdout, label).toContain("1 failed");
      }
      expect(await sha256(lockPath()), label).toBe(lockSum);
    }

    const jsonRun = await asm("update", "--yes", "--json");
    expect(jsonRun.exitCode).toBe(1);
    const json = JSON.parse(jsonRun.stdout);
    expect(
      [...json.results].sort((a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name),
      ),
    ).toEqual([
      { name: "c9", status: "failed", reason: "Failed to fetch remote commit" },
      { name: "ok", status: "failed", reason: "Failed to fetch remote commit" },
    ]);
    expect(json.summary).toEqual({ updated: 0, skipped: 0, failed: 2 });

    const machineRun = await asm("update", "c9", "--machine");
    expect(machineRun.exitCode).toBe(1);
    expect(JSON.parse(machineRun.stdout).data).toMatchObject([
      { name: "c9", status: "failed", reason: "Failed to fetch remote commit" },
    ]);
  });

  test("a lock key with control bytes prints none of them in outdated and update (#822)", async () => {
    const rawControls = (text: string) =>
      // eslint-disable-next-line no-control-regex
      text.match(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g) ?? [];
    const hostile =
      "evil\x1b[31m\x1b]8;;https://x.example\x07link\x1b]8;;\x07\x9b2J";
    const lock = await readLock();
    lock.skills[hostile] = { ...lock.skills.c9 };
    await writeFile(lockPath(), JSON.stringify(lock, null, 2));
    await rename(join(cwd, "skills.git"), join(cwd, "moved.git"));

    const table = await asm("outdated");
    expect(table.exitCode).toBe(1);
    expect(table.stdout).toContain("evil?[31m");
    expect(rawControls(table.stdout + table.stderr)).toEqual([]);

    const update = await asm("update", "--yes");
    expect(update.exitCode).toBe(1);
    expect(update.stdout).toContain("✗ evil?[31m");
    expect(rawControls(update.stdout + update.stderr)).toEqual([]);
  });

  test("successful update exits 0 in --json and --machine (#822)", async () => {
    await writeFile(join(work, "skills", "c9", "body.md"), "c9 v2\n");
    publish("v2: c9 body only");

    const jsonRun = await asm("update", "--yes", "--json");
    expect(jsonRun.exitCode).toBe(0);
    expect(JSON.parse(jsonRun.stdout).summary).toEqual({
      updated: 1,
      skipped: 0,
      failed: 0,
    });

    const outdated = await asm("outdated");
    expect(outdated.exitCode).toBe(0);
    const machineRun = await asm("update", "--machine");
    expect(machineRun.exitCode).toBe(0);
    expect(JSON.parse(machineRun.stdout).data).toEqual([]);
  });
});
