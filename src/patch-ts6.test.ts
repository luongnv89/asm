import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execFileSync } from "child_process";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/patch-ts6.cjs",
);

const { checkPatch, applyPatch, TARGETS } = createRequire(import.meta.url)(
  SCRIPT,
) as {
  checkPatch: (root: string) => string[];
  applyPatch: (root: string) => number;
  expectedLinks: (root: string) => string[];
  TARGETS: string[];
};

let root: string;
let ts6Dir: string;

function installTs6(version = "6.0.2") {
  mkdirSync(ts6Dir, { recursive: true });
  writeFileSync(join(ts6Dir, "package.json"), JSON.stringify({ version }));
}

function installTarget(
  name: string,
  link: "symlink" | "missing" | "wrong" | "realdir",
) {
  const nested = join(root, "node_modules", name, "node_modules");
  mkdirSync(nested, { recursive: true });
  if (link === "missing") return;
  if (link === "symlink") {
    symlinkSync(ts6Dir, join(nested, "typescript"), "dir");
    return;
  }
  const other = join(root, "node_modules", `${name}-other-ts`);
  mkdirSync(other, { recursive: true });
  writeFileSync(
    join(other, "package.json"),
    JSON.stringify({ version: link === "wrong" ? "7.0.0" : "6.0.2" }),
  );
  if (link === "wrong") {
    symlinkSync(other, join(nested, "typescript"), "dir");
  } else {
    symlinkSync(other, join(nested, "typescript"), "dir");
    // realdir: replace the link with a real directory holding the ts6 manifest
    rmSync(join(nested, "typescript"));
    mkdirSync(join(nested, "typescript"));
    writeFileSync(
      join(nested, "typescript", "package.json"),
      JSON.stringify({ version: "6.0.2" }),
    );
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "patch-ts6-"));
  ts6Dir = join(root, "node_modules", "@typescript", "typescript6");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("patch-ts6 --check", () => {
  test("passes when every installed target links to @typescript/typescript6", () => {
    installTs6();
    installTarget("typescript-eslint", "symlink");
    installTarget("ts-api-utils", "symlink");
    expect(checkPatch(root)).toEqual([]);
  });

  test("fails when @typescript/typescript6 is not installed", () => {
    installTarget("typescript-eslint", "missing");
    expect(checkPatch(root)).toEqual([
      expect.stringContaining("typescript6 is not installed"),
    ]);
  });

  test("fails when an expected nested link is missing", () => {
    installTs6();
    installTarget("typescript-eslint", "missing");
    const failures = checkPatch(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("node_modules/typescript: missing");
  });

  test("fails when a nested link points at typescript@7", () => {
    installTs6();
    installTarget("typescript-eslint", "wrong");
    const failures = checkPatch(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("typescript@7.0.0");
  });

  test("accepts a real directory containing typescript@6 (materialized override)", () => {
    installTs6();
    installTarget("typescript-eslint", "realdir");
    expect(checkPatch(root)).toEqual([]);
  });

  test("ignores target packages that are not installed", () => {
    installTs6();
    installTarget("typescript-eslint", "symlink");
    // every other entry in TARGETS is absent — nothing to verify for them
    expect(checkPatch(root)).toEqual([]);
    expect(TARGETS.length).toBeGreaterThan(2);
  });
});

describe("patch-ts6 apply + check round-trip", () => {
  test("applyPatch then checkPatch yields zero failures", () => {
    installTs6();
    mkdirSync(join(root, "node_modules", "typescript-eslint"), {
      recursive: true,
    });
    expect(applyPatch(root)).toBe(1);
    expect(checkPatch(root)).toEqual([]);
  });
});

describe("patch-ts6 CLI", () => {
  test("--check --root exits 0 on a patched tree", () => {
    installTs6();
    installTarget("typescript-eslint", "symlink");
    const out = execFileSync("node", [SCRIPT, "--check", "--root", root], {
      encoding: "utf-8",
    });
    expect(out).toContain("--check:");
  });

  test("--check --root exits 1 with an actionable message on a broken tree", () => {
    installTs6();
    installTarget("typescript-eslint", "missing");
    let code = 0;
    let stderr = "";
    try {
      execFileSync("node", [SCRIPT, "--check", "--root", root], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      code = (err as { status?: number }).status ?? -1;
      stderr = String((err as { stderr?: unknown }).stderr);
    }
    expect(code).toBe(1);
    expect(stderr).toContain("TS 6 patch did not apply");
    expect(stderr).toContain("node scripts/patch-ts6.cjs");
    expect(stderr).toContain("missing");
  });
});
