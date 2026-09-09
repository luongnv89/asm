import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../cli";
import { cmdGet } from "./get";
import * as remote from "./eval";
import * as scanner from "../scanner";
import * as library from "../library";
import * as index from "../skill-index";
import * as registry from "../registry";
import { cleanupGetBorrow } from "../get-borrows";
import { getGetBorrowsDir } from "../config";
import type { GetPathResult } from "../utils/types";

let tempDir: string;
let cloneDir: string;
let selectedDir: string;
let stdout: string;
let stderr: string;
const body =
  "---\nname: helper\ndescription: Remote fixture\ndependencies: [other]\n---\n# Helper\nUse scripts/helper.sh and assets/data.bin.\n";
const sha = "a".repeat(40);
const source = `github:acme/skills#${sha}:skills/helper`;
const indexedMatch: index.IndexedSkillMatch = {
  repo: { owner: "acme", repo: "skills" },
  skill: {
    name: "helper",
    description: "Remote fixture",
    version: "1.0.0",
    license: "MIT",
    creator: "acme",
    compatibility: "",
    allowedTools: [],
    installUrl: source,
    relPath: "skills/helper",
  },
};

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(join(tmpdir(), "asm-get-command-")));
  vi.stubEnv("ASM_CONFIG_DIR", join(tempDir, "config"));
  vi.stubEnv("NO_COLOR", "1");
  cloneDir = join(tempDir, "clone");
  selectedDir = join(cloneDir, "skills", "helper");
  await mkdir(join(selectedDir, "scripts"), { recursive: true });
  await mkdir(join(selectedDir, "assets"));
  await mkdir(join(selectedDir, ".git"));
  await writeFile(join(selectedDir, "SKILL.md"), body);
  await writeFile(
    join(selectedDir, "scripts", "helper.sh"),
    "#!/bin/sh\nprintf helper\n",
    { mode: 0o755 },
  );
  await writeFile(
    join(selectedDir, "assets", "data.bin"),
    Buffer.from([0, 128, 255]),
  );
  await writeFile(join(selectedDir, ".git", "config"), "omit");
  await writeFile(
    join(cloneDir, "sibling.txt"),
    "not part of the selected skill",
  );
  vi.spyOn(scanner, "scanAllSkills").mockResolvedValue([]);
  vi.spyOn(library, "listLibrarySkills").mockResolvedValue([]);
  vi.spyOn(index, "resolveIndexedSkillByName").mockResolvedValue({
    status: "none",
  });
  vi.spyOn(registry, "resolveFromRegistry").mockResolvedValue({
    resolved: null,
    multipleMatches: [],
    suggestions: [],
  });
  vi.spyOn(remote, "fetchRemoteSkillDir").mockResolvedValue({
    rootDir: selectedDir,
    tempDir: cloneDir,
    sourceRef: source,
    commitSha: sha,
    cleanup: vi.fn(async () => {
      await rm(cloneDir, { recursive: true, force: true });
    }),
  });
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

function run(...args: string[]) {
  return cmdGet(parseArgs(["node", "asm", "get", ...args]));
}

describe("get path resolution and remote lifecycle", () => {
  it.each(["remote", "index", "registry"] as const)(
    "borrows the full selected %s skill before deleting its staging clone",
    async (tier) => {
      if (tier === "index")
        vi.mocked(index.resolveIndexedSkillByName).mockResolvedValue({
          status: "found",
          match: indexedMatch,
        });
      if (tier === "registry")
        vi.mocked(registry.resolveFromRegistry).mockResolvedValue({
          resolved: {
            source: "registry",
            manifest: {
              name: "helper",
              author: "acme",
              description: "Remote fixture",
              repository: "https://github.com/acme/skills",
              commit: sha,
              skill_path: "skills/helper",
              security_verdict: "pass",
              published_at: "2026-01-01T00:00:00Z",
            },
          },
          multipleMatches: [],
          suggestions: [],
        });
      await run(
        "--path",
        tier === "remote" ? source : "helper",
        "--json",
        "--transport",
        "https",
        "--no-cache",
      );
      const result = JSON.parse(stdout) as GetPathResult;
      expect(result).toMatchObject({
        name: "helper",
        tier,
        source,
        commit: sha,
        dependencies: ["other"],
        security: {
          risk: expect.any(String),
          warnings: expect.any(Number),
          categories: expect.any(Array),
        },
        cleanup: { command: "asm", args: ["cleanup", result.path] },
      });
      expect(result.files).toEqual([
        "SKILL.md",
        "assets/data.bin",
        "scripts/helper.sh",
      ]);
      expect(result).not.toHaveProperty("content");
      expect(await readFile(join(result.path, "SKILL.md"), "utf-8")).toBe(body);
      expect(await readFile(join(result.path, "assets", "data.bin"))).toEqual(
        Buffer.from([0, 128, 255]),
      );
      await expect(readdir(cloneDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(remote.fetchRemoteSkillDir).toHaveBeenCalledWith(
        source,
        "https",
        false,
      );
      if (tier === "registry")
        expect(registry.resolveFromRegistry).toHaveBeenCalledWith("helper", {
          noCache: true,
        });
      expect((await cleanupGetBorrow(result.path)).status).toBe("removed");
    },
  );

  it("keeps default remote body output unchanged and retains no borrow", async () => {
    await run(source);
    expect(stdout).toBe(body);
    expect(stderr).toContain("security:");
    expect(stderr).not.toContain("cleanup:");
    await expect(readdir(cloneDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(getGetBorrowsDir())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("still deletes remote staging on copy rejection without touching a symlink target", async () => {
    const outside = join(tempDir, "outside.txt");
    await writeFile(outside, "untouched");
    await symlink(outside, join(selectedDir, "nested-link"), "file");
    await run(source, "--path", "--machine");
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      command: "get",
      status: "error",
      error: { message: expect.stringContaining("symbolic link") },
    });
    await expect(readdir(cloneDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(outside, "utf-8")).toBe("untouched");
    await expect(
      readdir(join(getGetBorrowsDir(), "artifacts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not borrow or fetch when the indexed selection is ambiguous", async () => {
    vi.mocked(index.resolveIndexedSkillByName).mockResolvedValue({
      status: "ambiguous",
      matches: [indexedMatch, indexedMatch],
    });
    await run("helper", "--path", "--machine");
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "error",
      error: {
        code: "INVALID_ARGUMENT",
        details: { candidates: expect.any(Array) },
      },
    });
    expect(remote.fetchRemoteSkillDir).not.toHaveBeenCalled();
    await expect(readdir(getGetBorrowsDir())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("makes no borrow for a missing target", async () => {
    await run("NotARealSkill_654", "--path", "--machine");
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "error",
      error: { code: "SKILL_NOT_FOUND" },
    });
    expect(remote.fetchRemoteSkillDir).not.toHaveBeenCalled();
    await expect(readdir(getGetBorrowsDir())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
