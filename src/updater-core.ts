/**
 * Skill lifecycle management: outdated detection and atomic updates.
 *
 * Provides `checkOutdated()` to compare installed skill commits against
 * remote HEAD, and `updateSkills()` to upgrade skills atomically with
 * security re-audit.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

import { debug } from "./logger";
import { readLock } from "./utils/lock";
import { parseFrontmatter } from "./utils/frontmatter";
import { fetchRegistryIndex } from "./registry";
import type { RegistryIndex } from "./registry";
import type { LockEntry } from "./utils/types";

import type { SecurityVerdict } from "./utils/types";

const execFileAsync = promisify(execFile);

// Repository-local Git variables can redirect commands away from their cwd.
// Keep transport/auth variables intact, but never inherit repository routing.
const REPOSITORY_LOCAL_GIT_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
] as const;

export function createPinnedGitEnv(
  objectFormat: "sha1" | "sha256",
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const variable of REPOSITORY_LOCAL_GIT_ENV_VARS) {
    delete env[variable];
  }
  for (const variable of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(variable)) {
      delete env[variable];
    }
  }
  env.GIT_DEFAULT_HASH = objectFormat;
  return env;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type OutdatedStatus = "outdated" | "up-to-date" | "untracked" | "error";

export interface OutdatedEntry {
  name: string;
  installedCommit: string;
  latestCommit: string;
  source: string;
  sourceType: "registry" | "github" | "local";
  status: OutdatedStatus;
  error?: string;
  /**
   * The skill's `metadata.version` at the installed and latest commits. Set on
   * GitHub-sourced entries only; `null` when the SKILL.md declares no version
   * or could not be read (#807).
   */
  installedVersion?: string | null;
  latestVersion?: string | null;
  /**
   * Why the skill-folder check could not run for this entry; its status then
   * rests on the commit comparison alone (#807).
   */
  inspectionError?: string;
}

export interface OutdatedSummary {
  entries: OutdatedEntry[];
  outdatedCount: number;
  upToDateCount: number;
  untrackedCount: number;
  errorCount: number;
}

export interface UpdateResult {
  name: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  oldCommit?: string;
  newCommit?: string;
  securityVerdict?: SecurityVerdict;
  /**
   * Why a warning/caution audit held (or, with --yes, did not hold) the
   * update: the symlinks not read (path -> target, at most 3 then "and N
   * more") or the verdict reason (#791).
   */
  securityReasons?: string[];
}

export interface UpdateSummary {
  results: UpdateResult[];
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  /** Warnings for skills requested by name but not found in the lock file. */
  warnings?: string[];
}

// Keep resolved OIDs internal so public entries and formatter output retain their
// existing shape. updateSkills consumes the same entry objects returned below.
export const resolvedLatestCommits = new WeakMap<OutdatedEntry, string>();

function recordResolvedLatestCommit<T extends OutdatedEntry>(
  entry: T,
  commit: string,
): T {
  resolvedLatestCommits.set(entry, commit);
  return entry;
}

// ─── Concurrency Pool ───────────────────────────────────────────────────────

export function normalizedTargetIdentity(name: string): string {
  // toLowerCase uses Unicode's locale-independent default case mapping.
  return name.normalize("NFC").toLowerCase().normalize("NFC");
}

export async function poolAll<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ─── Remote Commit Resolution ───────────────────────────────────────────────

/**
 * Get the latest commit hash from a remote git repository.
 * Times out after 10 seconds.
 */
export async function getLatestRemoteCommit(
  repoUrl: string,
  ref: string | null,
): Promise<string | null> {
  try {
    const args = ["ls-remote", repoUrl];
    if (ref) {
      // Ask for the peeled form too so annotated tags resolve to commits.
      args.push(ref, `${ref}^{}`);
    } else {
      args.push("HEAD");
    }

    const { stdout } = await execFileAsync("git", args, { timeout: 10_000 });
    const advertised = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      const [hash, advertisedRef] = line.trim().split(/\s+/);
      if (
        advertisedRef &&
        hash &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)
      ) {
        advertised.set(advertisedRef, hash);
      }
    }

    if (!ref || ref === "HEAD") return advertised.get("HEAD") ?? null;
    if (ref.startsWith("refs/")) {
      return advertised.get(`${ref}^{}`) ?? advertised.get(ref) ?? null;
    }
    return (
      advertised.get(`refs/heads/${ref}`) ??
      advertised.get(`refs/tags/${ref}^{}`) ??
      advertised.get(`refs/tags/${ref}`) ??
      null
    );
  } catch (err) {
    debug(`updater: git ls-remote failed for ${repoUrl}: ${err}`);
    return null;
  }
}

/**
 * Resolve the source type for a lock entry.
 * Backward compatible: entries without sourceType are inferred from the source string.
 */
export function resolveSourceType(
  entry: LockEntry,
): "registry" | "github" | "local" {
  if (entry.sourceType) return entry.sourceType;
  if (entry.source.startsWith("local:")) return "local";
  return "github";
}

/**
 * Extract the clone URL from a lock entry source string.
 * Handles formats: "github:owner/repo" -> "https://github.com/owner/repo.git"
 */
export function sourceToCloneUrl(source: string): string | null {
  if (source.startsWith("github:")) {
    let ownerRepo = source.slice("github:".length);
    // Strip #ref or #ref:subpath fragments (lock entries may contain them)
    const hashIdx = ownerRepo.indexOf("#");
    if (hashIdx !== -1) {
      ownerRepo = ownerRepo.slice(0, hashIdx);
    }
    return `https://github.com/${ownerRepo}.git`;
  }
  // Support file:// URLs for testing and local bare-repo sources
  if (source.startsWith("file://")) {
    return source;
  }
  return null;
}

/**
 * Extract owner and repo from a source string like "github:owner/repo"
 * or "github:owner/repo#ref". Returns null if the source is not a GitHub source.
 */
export function extractOwnerRepo(
  source: string,
): { owner: string; repo: string } | null {
  if (!source.startsWith("github:")) return null;
  let ownerRepo = source.slice("github:".length);
  // Strip #ref or #ref:subpath fragments
  const hashIdx = ownerRepo.indexOf("#");
  if (hashIdx !== -1) {
    ownerRepo = ownerRepo.slice(0, hashIdx);
  }
  const parts = ownerRepo.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function getUpdateSourceDir(tempDir: string, entry: LockEntry): string {
  return entry.skillPath ? join(tempDir, entry.skillPath) : tempDir;
}

// ─── Skill Folder Inspection (#807) ─────────────────────────────────────────

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export interface SkillFolderProbe {
  /** Full OID of the commit the skill was installed from. */
  installedCommit: string;
  /** Repo-relative skill directory; empty for a skill at the repo root. */
  skillPath: string;
}

export interface SkillFolderReport {
  /** Whether anything under the skill folder differs; null when unknown. */
  changed: boolean | null;
  installedVersion: string | null;
  latestVersion: string | null;
  /** Why `changed` (or a version) could not be determined, when it matters. */
  error?: string;
}

/** First line of a git failure: its stderr when present, else the message. */
function gitFailure(err: unknown): string {
  const stderr = (err as { stderr?: unknown })?.stderr;
  const text =
    typeof stderr === "string" && stderr.trim()
      ? stderr
      : err instanceof Error
        ? err.message
        : String(err);
  return text.trim().split("\n")[0] || "unknown error";
}

function normalizeSkillPath(skillPath: string | undefined): string {
  const p = (skillPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
  return p === "." ? "" : p;
}

function isUnderSkillPath(file: string, skillPath: string): boolean {
  return (
    skillPath === "" || file === skillPath || file.startsWith(`${skillPath}/`)
  );
}

/** Version from SKILL.md frontmatter: `metadata.version`, else `version`. */
export function readSkillVersion(content: string): string | null {
  const fm = parseFrontmatter(content);
  return fm["metadata.version"] || fm.version || null;
}

/** Parse `git cat-file --batch` output into oid -> content. */
function parseCatFileBatch(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break;
    const [oid, type, size] = buf.toString("utf8", pos, nl).split(" ");
    pos = nl + 1;
    if (!size || type === "missing") continue;
    const end = pos + Number(size);
    if (type === "blob") out.set(oid, buf.toString("utf8", pos, end));
    pos = end + 1;
  }
  return out;
}

/**
 * For skills installed from one repository, decide whether each skill's own
 * folder changed between its installed commit and `latestCommit`, and read
 * `metadata.version` at both commits.
 *
 * Network cost per repository: one blobless, depth-1 fetch of every distinct
 * installed commit plus the latest one (trees only), then one fetch of just
 * the SKILL.md blobs. Never throws: whatever cannot be determined is `null`,
 * and a `null` `changed` leaves the caller's commit comparison in force.
 * `changed` is `false` only when the skill folder is known to exist at the
 * installed commit (the repo root, or a SKILL.md under `skillPath`), so a
 * path git does not know (a symlinked parent, a different case, a stale
 * path) never makes a skill current. `skillPath` never reaches git's argv.
 */
export async function inspectSkillFolders(
  cloneUrl: string,
  latestCommit: string,
  probes: SkillFolderProbe[],
): Promise<SkillFolderReport[]> {
  const unknown = (error: string): SkillFolderReport[] =>
    probes.map(() => ({
      changed: null,
      installedVersion: null,
      latestVersion: null,
      error,
    }));
  const latest = latestCommit.toLowerCase();
  if (probes.length === 0) return [];
  if (!OID_RE.test(latest)) return unknown("invalid latest commit");

  const env = createPinnedGitEnv(latest.length === 40 ? "sha1" : "sha256");
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "asm-outdated-"));
    const cwd = dir;
    const git = (args: string[], timeout = 10_000) =>
      execFileAsync("git", args, {
        cwd,
        env,
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
      });
    await git(["init", "-q"]);

    const installedCommits = [
      ...new Set(
        probes
          .map((p) => p.installedCommit.toLowerCase())
          .filter((c) => c.length === latest.length && OID_RE.test(c)),
      ),
    ].filter((c) => c !== latest);

    const fetchTrees = ["fetch", "-q", "--no-tags", "--depth=1"];
    fetchTrees.push("--filter=blob:none", "--end-of-options", cloneUrl);
    try {
      await git([...fetchTrees, latest, ...installedCommits], 60_000);
    } catch (err) {
      // An installed commit may no longer exist upstream; keep the latest.
      debug(`updater: tree fetch failed for ${cloneUrl}: ${err}`);
      if (installedCommits.length === 0) {
        return unknown(`fetch failed: ${gitFailure(err)}`);
      }
      await git([...fetchTrees, latest], 60_000);
    }

    // Commit -> (path -> blob OID) for the SKILL.md files we care about.
    const skillPaths = probes.map((p) => normalizeSkillPath(p.skillPath));
    const wantedDirs = new Set(skillPaths);
    const skillMdByCommit = new Map<string, Map<string, string>>();
    for (const commit of [latest, ...installedCommits]) {
      try {
        const { stdout } = await git([
          "ls-tree",
          "-r",
          "-z",
          "--full-tree",
          "--end-of-options",
          commit,
        ]);
        const found = new Map<string, string>();
        for (const record of stdout.split("\0")) {
          const tab = record.indexOf("\t");
          if (tab === -1) continue;
          const [, type, oid] = record.slice(0, tab).split(" ");
          const path = record.slice(tab + 1);
          const slash = path.lastIndexOf("/");
          const dirName = slash === -1 ? "" : path.slice(0, slash);
          const base = path.slice(slash + 1);
          if (type !== "blob" || !wantedDirs.has(dirName)) continue;
          if (
            base === "SKILL.md" ||
            (!found.has(dirName) && /^skill\.md$/i.test(base))
          ) {
            found.set(dirName, oid);
          }
        }
        skillMdByCommit.set(commit, found);
      } catch {
        // Commit not fetched (gone upstream): its probes stay unknown.
      }
    }

    // Changed paths per installed commit, compared with the latest tree.
    const changedByCommit = new Map<string, string[]>();
    let diffError: string | undefined;
    for (const commit of installedCommits) {
      if (!skillMdByCommit.has(commit)) continue;
      try {
        const { stdout } = await git([
          "diff-tree",
          "-r",
          "-z",
          "--no-renames",
          "--name-only",
          "--end-of-options",
          commit,
          latest,
        ]);
        changedByCommit.set(commit, stdout.split("\0").filter(Boolean));
      } catch (err) {
        debug(`updater: diff-tree failed for ${cloneUrl}: ${err}`);
        diffError = gitFailure(err);
      }
    }

    // Fetch every needed SKILL.md blob in one request (a no-op for blobs the
    // tree fetch already brought), then read them with lazy fetching off: the
    // blobless fetch marks the URL as a promisor, and git would otherwise
    // fetch each missing blob in its own round trip.
    const blobOids = new Set<string>();
    for (const found of skillMdByCommit.values()) {
      for (const oid of found.values()) blobOids.add(oid);
    }
    const contents = new Map<string, string>();
    let blobError: string | undefined;
    if (blobOids.size > 0) {
      try {
        await git(
          [
            "-c",
            "fetch.negotiationAlgorithm=noop",
            "fetch",
            "-q",
            "--no-tags",
            "--filter=blob:none",
            "--end-of-options",
            cloneUrl,
            ...blobOids,
          ],
          60_000,
        );
        const run = execFileAsync("git", ["cat-file", "--batch"], {
          cwd,
          env: { ...env, GIT_NO_LAZY_FETCH: "1" },
          timeout: 10_000,
          maxBuffer: GIT_MAX_BUFFER,
          encoding: "buffer",
        });
        run.child.stdin?.end(`${[...blobOids].join("\n")}\n`);
        const { stdout } = await run;
        for (const [oid, text] of parseCatFileBatch(stdout)) {
          contents.set(oid, text);
        }
      } catch (err) {
        debug(`updater: SKILL.md fetch failed for ${cloneUrl}: ${err}`);
        blobError = gitFailure(err);
      }
    }

    const versionAt = (commit: string, skillPath: string): string | null => {
      const oid = skillMdByCommit.get(commit)?.get(skillPath);
      const text = oid ? contents.get(oid) : undefined;
      return text === undefined ? null : readSkillVersion(text);
    };

    return probes.map((probe, i) => {
      const installed = probe.installedCommit.toLowerCase();
      const skillPath = skillPaths[i];
      const installedTree = skillMdByCommit.get(installed);
      let changed: boolean | null = null;
      let error: string | undefined;
      if (installed === latest) {
        changed = false;
      } else if (!installedTree) {
        error = `installed commit ${shortHash(installed)} could not be fetched`;
      } else if (skillPath !== "" && !installedTree.has(skillPath)) {
        // Unknown to git at that commit: never read as "unchanged".
        error = `no SKILL.md at "${skillPath}" in installed commit ${shortHash(installed)}`;
      } else {
        const files = changedByCommit.get(installed);
        if (files) changed = files.some((f) => isUnderSkillPath(f, skillPath));
        else
          error = `could not compare commits: ${diffError ?? "unknown error"}`;
      }
      const wantsBlob = [installed, latest].some((c) => {
        const oid = skillMdByCommit.get(c)?.get(skillPath);
        return oid !== undefined && !contents.has(oid);
      });
      if (!error && blobError && wantsBlob) {
        error = `could not read SKILL.md: ${blobError}`;
      }
      return {
        changed,
        installedVersion: versionAt(installed, skillPath),
        latestVersion: versionAt(latest, skillPath),
        ...(error ? { error } : {}),
      };
    });
  } catch (err) {
    debug(`updater: skill folder inspection failed for ${cloneUrl}: ${err}`);
    return unknown(`skill folder check failed: ${gitFailure(err)}`);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Outdated Check ─────────────────────────────────────────────────────────

/**
 * Check all installed skills for newer versions.
 * Registry skills are compared against index.json.
 * Non-registry skills use one git ls-remote per repository and ref (at most
 * 5 at once); GitHub skills then get one folder/version inspection per
 * repository (`inspectSkillFolders`, #807).
 */

/** @internal — injectable overrides for testing checkOutdated. */
export interface _CheckOutdatedTestOverrides {
  readLockFn?: typeof readLock;
  fetchRegistryIndexFn?: typeof fetchRegistryIndex;
  /** Pre-read lock file — avoids a redundant readLock() call when the caller already has it. */
  lock?: import("./utils/types").LockFile;
  getLatestRemoteCommitFn?: typeof getLatestRemoteCommit;
  inspectSkillFoldersFn?: typeof inspectSkillFolders;
}

export async function checkOutdated(
  _overrides?: _CheckOutdatedTestOverrides,
): Promise<OutdatedSummary> {
  const readLockFn = _overrides?.readLockFn ?? readLock;
  const fetchRegistryFn =
    _overrides?.fetchRegistryIndexFn ?? fetchRegistryIndex;
  const lock = _overrides?.lock ?? (await readLockFn());
  const entries = Object.entries(lock.skills);
  const latestCommitFn =
    _overrides?.getLatestRemoteCommitFn ?? getLatestRemoteCommit;
  const inspectFn = _overrides?.inspectSkillFoldersFn ?? inspectSkillFolders;

  // One ls-remote per (repository, ref), however many skills it supplies,
  // with at most REMOTE_CONCURRENCY running at once.
  const REMOTE_CONCURRENCY = 5;
  let activeRemotes = 0;
  const remoteWaiters: Array<() => void> = [];
  const limitedLatestCommit = async (url: string, ref: string | null) => {
    while (activeRemotes >= REMOTE_CONCURRENCY) {
      await new Promise<void>((resolve) => remoteWaiters.push(resolve));
    }
    activeRemotes++;
    try {
      return await latestCommitFn(url, ref);
    } finally {
      activeRemotes--;
      remoteWaiters.shift()?.();
    }
  };
  const remoteCommits = new Map<string, Promise<string | null>>();
  const resolveRemote = (url: string, ref: string | null) => {
    const key = `${url}\n${ref ?? ""}`;
    let pending = remoteCommits.get(key);
    if (!pending) {
      pending = limitedLatestCommit(url, ref);
      remoteCommits.set(key, pending);
    }
    return pending;
  };

  // GitHub entries whose latest commit resolved, grouped per repository and
  // latest commit for the folder/version inspection below.
  const inspectGroups = new Map<
    string,
    {
      cloneUrl: string;
      latestCommit: string;
      items: { entry: OutdatedEntry; probe: SkillFolderProbe }[];
    }
  >();

  if (entries.length === 0) {
    return {
      entries: [],
      outdatedCount: 0,
      upToDateCount: 0,
      untrackedCount: 0,
      errorCount: 0,
    };
  }

  // Fetch registry index once for all registry skills
  let registryIndex: RegistryIndex | null = null;
  const hasRegistrySkills = entries.some(
    ([, e]) => resolveSourceType(e) === "registry" || e.registryName,
  );
  if (hasRegistrySkills) {
    registryIndex = await fetchRegistryFn();
  }

  // Per-entry work is only bookkeeping around the shared remote lookups, so
  // walk every entry at once: skills from one repository must not hold the
  // lookups for other repositories behind them.
  const width = entries.length;
  const results = await poolAll(entries, width, async ([name, entry]) => {
    const sourceType = resolveSourceType(entry);

    // Untracked: no commit hash recorded (pre-registry installs)
    if (!entry.commitHash || entry.commitHash === "unknown") {
      return {
        name,
        installedCommit: entry.commitHash || "unknown",
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "untracked" as OutdatedStatus,
      };
    }

    // Local skills: cannot check for updates remotely
    if (sourceType === "local") {
      return {
        name,
        installedCommit: entry.commitHash,
        latestCommit: entry.commitHash,
        source: entry.source,
        sourceType,
        status: "up-to-date" as OutdatedStatus,
      };
    }

    // Registry skills: check against index.json manifest
    if (sourceType === "registry" && registryIndex) {
      const registryName = entry.registryName || name;
      const manifest = registryIndex.manifests.find(
        (m) => m.name.toLowerCase() === registryName.toLowerCase(),
      );
      if (manifest) {
        const isOutdated = manifest.commit !== entry.commitHash;
        return recordResolvedLatestCommit(
          {
            name,
            installedCommit: shortHash(entry.commitHash),
            latestCommit: shortHash(manifest.commit),
            source: entry.source,
            sourceType,
            status: isOutdated
              ? ("outdated" as OutdatedStatus)
              : ("up-to-date" as OutdatedStatus),
          },
          manifest.commit,
        );
      }
      // Registry skill not found in index — fall through to git ls-remote
    }

    // GitHub skills: use git ls-remote
    const cloneUrl = sourceToCloneUrl(entry.source);
    if (!cloneUrl) {
      return {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "error" as OutdatedStatus,
        error: "Cannot determine remote URL",
      };
    }

    const latestCommit = await resolveRemote(cloneUrl, entry.ref);
    if (!latestCommit) {
      return {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: "unknown",
        source: entry.source,
        sourceType,
        status: "error" as OutdatedStatus,
        error: "Failed to fetch remote commit",
      };
    }

    const isOutdated = latestCommit !== entry.commitHash;
    const result = recordResolvedLatestCommit(
      {
        name,
        installedCommit: shortHash(entry.commitHash),
        latestCommit: shortHash(latestCommit),
        source: entry.source,
        sourceType,
        status: isOutdated
          ? ("outdated" as OutdatedStatus)
          : ("up-to-date" as OutdatedStatus),
      },
      latestCommit,
    );
    if (sourceType === "github") {
      const key = `${cloneUrl}\n${latestCommit}`;
      const group = inspectGroups.get(key) ?? {
        cloneUrl,
        latestCommit,
        items: [],
      };
      group.items.push({
        entry: result,
        probe: {
          installedCommit: entry.commitHash,
          skillPath: entry.skillPath ?? "",
        },
      });
      inspectGroups.set(key, group);
    }
    return result;
  });

  // A commit that changes nothing under the skill's own folder does not make
  // it outdated (#807). The lock keeps the installed commit; only `asm update`
  // records a new one, when it actually installs.
  await poolAll([...inspectGroups.values()], 4, async (group) => {
    let reports: SkillFolderReport[];
    try {
      reports = await inspectFn(
        group.cloneUrl,
        group.latestCommit,
        group.items.map((item) => item.probe),
      );
    } catch (err) {
      debug(`updater: inspection failed for ${group.cloneUrl}: ${err}`);
      const reason = `skill folder check failed: ${gitFailure(err)}`;
      for (const { entry } of group.items) entry.inspectionError = reason;
      return;
    }
    group.items.forEach(({ entry }, i) => {
      const report = reports[i];
      if (!report) return;
      entry.installedVersion = report.installedVersion;
      entry.latestVersion = report.latestVersion;
      if (report.error) entry.inspectionError = report.error;
      if (entry.status === "outdated" && report.changed === false) {
        entry.status = "up-to-date";
      }
    });
  });

  for (const result of results as OutdatedEntry[]) {
    if (result.sourceType === "github") {
      result.installedVersion ??= null;
      result.latestVersion ??= null;
    }
  }

  return {
    entries: results,
    outdatedCount: results.filter((r) => r.status === "outdated").length,
    upToDateCount: results.filter((r) => r.status === "up-to-date").length,
    untrackedCount: results.filter((r) => r.status === "untracked").length,
    errorCount: results.filter((r) => r.status === "error").length,
  };
}

// ─── Update Skills ──────────────────────────────────────────────────────────

/**
 * Update one or more skills to the latest version.
 * For each skill:
 *   1. Clone latest version to temp directory
 *   2. Run SecurityAuditor on the new version
 *   3. If audit fails (dangerous): skip
 *   4. Atomic swap: remove old -> move new into place
 *   5. Update .skill-lock.json with new commit SHA
 */
/** @internal — injectable overrides for testing (avoids mock.module leaks). */

export function shortHash(hash: string): string {
  if (!hash || hash === "unknown") return "unknown";
  return hash.slice(0, 7);
}
