import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, chmod, symlink, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join, delimiter } from "path";

import { detectAsmBinaries, buildShadowingReport } from "./path-shadowing";

let tmpRoot: string;
let dirA: string;
let dirB: string;
let dirC: string;

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "asm-shadow-test-"));
  dirA = join(tmpRoot, "a");
  dirB = join(tmpRoot, "b");
  dirC = join(tmpRoot, "c");
  await mkdir(dirA);
  await mkdir(dirB);
  await mkdir(dirC);

  // dirA: a real asm binary
  const binA = join(dirA, "asm");
  await writeFile(binA, "#!/bin/sh\necho a\n");
  await chmod(binA, 0o755);

  // dirB: a different real asm binary
  const binB = join(dirB, "asm");
  await writeFile(binB, "#!/bin/sh\necho b\n");
  await chmod(binB, 0o755);

  // dirC: a symlink pointing to the dirA binary (same realpath → dedup)
  await symlink(binA, join(dirC, "asm"));
});

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe("detectAsmBinaries", () => {
  test("returns empty list when PATH has no asm", async () => {
    const fakeDir = join(tmpRoot, "empty");
    await mkdir(fakeDir);
    const binaries = await detectAsmBinaries(fakeDir);
    expect(binaries).toEqual([]);
  });

  test("finds a single asm when only one PATH entry has it", async () => {
    const binaries = await detectAsmBinaries(dirA);
    expect(binaries.length).toBe(1);
    expect(binaries[0].path).toBe(join(dirA, "asm"));
  });

  test("returns distinct binaries in PATH order when they differ", async () => {
    const path = [dirA, dirB].join(delimiter);
    const binaries = await detectAsmBinaries(path);
    expect(binaries.length).toBe(2);
    expect(binaries[0].path).toBe(join(dirA, "asm"));
    expect(binaries[1].path).toBe(join(dirB, "asm"));
  });

  test("deduplicates entries that resolve to the same realpath", async () => {
    // dirC contains a symlink to dirA's binary
    const path = [dirA, dirC].join(delimiter);
    const binaries = await detectAsmBinaries(path);
    expect(binaries.length).toBe(1);
    expect(binaries[0].path).toBe(join(dirA, "asm"));
  });

  test("ignores empty PATH entries", async () => {
    const path = ["", dirA, ""].join(delimiter);
    const binaries = await detectAsmBinaries(path);
    expect(binaries.length).toBe(1);
  });

  test("symlink before target counts as one entry — symlink path is reported", async () => {
    // dirC symlink appears before dirA (the canonical target) in PATH
    const path = [dirC, dirA].join(delimiter);
    const binaries = await detectAsmBinaries(path);
    expect(binaries.length).toBe(1);
    expect(binaries[0].path).toBe(join(dirC, "asm"));
  });
});

describe("buildShadowingReport", () => {
  test("no binaries → resolved null, shadowed empty", async () => {
    const emptyDir = join(tmpRoot, "emptyreport");
    await mkdir(emptyDir);
    const report = await buildShadowingReport(emptyDir);
    expect(report.resolved).toBeNull();
    expect(report.shadowed).toEqual([]);
  });

  test("single binary → resolved set, shadowed empty", async () => {
    const report = await buildShadowingReport(dirA);
    expect(report.resolved).not.toBeNull();
    expect(report.resolved!.path).toBe(join(dirA, "asm"));
    expect(report.shadowed).toEqual([]);
  });

  test("two different binaries → second one is shadowed", async () => {
    const path = [dirA, dirB].join(delimiter);
    const report = await buildShadowingReport(path);
    expect(report.resolved).not.toBeNull();
    expect(report.resolved!.path).toBe(join(dirA, "asm"));
    expect(report.shadowed.length).toBe(1);
    expect(report.shadowed[0].path).toBe(join(dirB, "asm"));
  });
});
