/**
 * Test fixture for #897: a git repo that ships executable hooks under
 * `.githooks/`, and a global git config whose `core.hooksPath` points at
 * them with a relative path, as a user's `~/.gitconfig` can. Any hook that
 * runs appends its name and cwd to `marker`.
 */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The hooks a clone, fetch or checkout can run. */
export const SHIPPED_HOOKS = [
  "post-checkout",
  "reference-transaction",
  "post-index-change",
] as const;

/** The `core.hooksPath` forms #897 tests; `null` leaves it unset. */
export const HOOKS_PATH_FORMS: [string, string | null][] = [
  ["relative .githooks", ".githooks"],
  ["relative .git/hooks", ".git/hooks"],
  ["unset", null],
];

export function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_DEFAULT_HASH: "sha1" },
  }).trim();
}

export interface HookRepo {
  /** Work tree with one commit. */
  repo: string;
  /** Bare clone of `repo`, the "remote". */
  bare: string;
  sha: string;
  marker: string;
}

/**
 * `<base>/repo` with `files` plus the shipped hooks, committed, and a bare
 * copy at `<base>/repo.git`. Run with no `GIT_CONFIG_GLOBAL` stubbed yet, so
 * setting it up runs no hook.
 */
export async function makeHookRepo(
  base: string,
  files: Record<string, string>,
): Promise<HookRepo> {
  const repo = join(base, "repo");
  const bare = join(base, "repo.git");
  const marker = join(base, "MARKER");
  await mkdir(join(repo, ".githooks"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await writeFile(join(repo, rel), content);
  }
  for (const hook of SHIPPED_HOOKS) {
    const file = join(repo, ".githooks", hook);
    await writeFile(
      file,
      `#!/bin/sh\necho "${hook} $(pwd)" >> '${marker}'\nexit 0\n`,
    );
    await chmod(file, 0o755);
  }
  git(["init", "-q", "-b", "main"], repo);
  git(["add", "-A"], repo);
  git(
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"],
    repo,
  );
  git(["clone", "-q", "--bare", repo, bare], base);
  return { repo, bare, sha: git(["rev-parse", "HEAD"], repo), marker };
}

/**
 * Write `<base>/gitconfig` with `core.hooksPath = hooksPath` (left out when
 * null) and the given `url.<to>.insteadOf = <from>` rewrites; returns its
 * path, for `GIT_CONFIG_GLOBAL`.
 */
export async function writeGlobalGitConfig(
  base: string,
  hooksPath: string | null,
  insteadOf: Record<string, string> = {},
): Promise<string> {
  const lines = ['[protocol "file"]', "\tallow = always"];
  if (hooksPath !== null) lines.push("[core]", `\thooksPath = ${hooksPath}`);
  for (const [from, to] of Object.entries(insteadOf)) {
    lines.push(`[url "${to}"]`, `\tinsteadOf = ${from}`);
  }
  const path = join(base, "gitconfig");
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}
