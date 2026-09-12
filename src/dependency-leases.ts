import { randomUUID } from "crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import {
  AtomicWritePostRenameError,
  writeTextFileAtomically,
} from "./utils/atomic-file";
import type {
  DependencyAcquireResult,
  DependencyLeaseAcquisition,
  DependencyReleaseResult,
  DependencyStaleCleanupResult,
} from "./utils/types";
import {
  validateSessionId,
  requestKey,
  sessionPath,
  sessionArtifactsDir,
  ownerMarkerPath,
  withSessionMutationLock,
  isInside,
  canonicalLeasesRoot,
  ensureManagedDirectory,
  assertNoSymlinks,
  validateTemporarySource,
  safeArtifactName,
  emptySession,
  parseSession,
  readSession,
  writeSession,
  usableAcquisition,
  findAcquiredDependencyUnlocked,
} from "./dependency-leases-store";
import type {
  DependencyLeasePaths,
  AcquireDependencyInput,
} from "./dependency-leases-store";

export interface DependencyLeaseTransaction {
  find(request: string): Promise<DependencyAcquireResult | null>;
  acquire(input: AcquireDependencyInput): Promise<DependencyAcquireResult>;
}

export async function withDependencyLeaseSession<T>(
  sessionId: string,
  operation: (transaction: DependencyLeaseTransaction) => Promise<T>,
  paths: DependencyLeasePaths = {},
): Promise<T> {
  const validatedSessionId = validateSessionId(sessionId);
  const root = (await canonicalLeasesRoot(paths, true))!;
  return withSessionMutationLock(
    root,
    sessionPath(root, validatedSessionId),
    () =>
      operation({
        find: (request) =>
          findAcquiredDependencyUnlocked(root, validatedSessionId, request),
        acquire: (input) => {
          if (validateSessionId(input.sessionId) !== validatedSessionId) {
            throw new Error(
              "Dependency acquisition session does not match the locked session.",
            );
          }
          return acquireDependencyUnlocked(input, root, paths);
        },
      }),
    paths,
  );
}

export async function acquireDependency(
  input: AcquireDependencyInput,
  paths: DependencyLeasePaths = {},
): Promise<DependencyAcquireResult> {
  return withDependencyLeaseSession(
    input.sessionId,
    (transaction) => transaction.acquire(input),
    paths,
  );
}

async function acquireDependencyUnlocked(
  input: AcquireDependencyInput,
  root: string,
  paths: DependencyLeasePaths,
): Promise<DependencyAcquireResult> {
  const sessionId = validateSessionId(input.sessionId);
  const request = input.request.trim();
  if (!request) throw new Error("Dependency reference cannot be empty.");

  const temporarySource = input.temporary
    ? await validateTemporarySource(input.sourceDir)
    : null;
  if (!input.temporary) await access(join(input.sourceDir, "SKILL.md"));
  const statePath = sessionPath(root, sessionId);
  const now = new Date().toISOString();
  const key = requestKey(request);

  let acquisition: DependencyLeaseAcquisition;
  if (input.temporary) {
    const artifactId = randomUUID();
    const artifactPath = join(
      sessionArtifactsDir(root, sessionId),
      `${safeArtifactName(input.name)}-${key.slice(0, 12)}-${artifactId.slice(0, 8)}`,
    );
    acquisition = {
      request,
      name: input.name,
      path: artifactPath,
      skillMdPath: join(artifactPath, "SKILL.md"),
      tier: input.tier,
      source: input.source,
      commit: input.commit,
      status: "pending",
      owned: true,
      artifactId,
      acquiredAt: now,
    };
  } else {
    const canonicalPath = await realpath(input.sourceDir);
    acquisition = {
      request,
      name: input.name,
      path: canonicalPath,
      skillMdPath: join(canonicalPath, "SKILL.md"),
      tier: input.tier,
      source: input.source,
      commit: input.commit,
      status: "ready",
      owned: false,
      artifactId: null,
      acquiredAt: now,
    };
  }

  const current = await readSession(root, sessionId);
  const existing = current?.acquisitions[key];
  if (await usableAcquisition(existing)) {
    return { ...existing!, sessionId, reused: true };
  }
  if (existing?.owned) {
    await removeOwnedAcquisition(root, sessionId, existing, paths);
  }

  const session = current ?? emptySession(sessionId, now);
  session.updatedAt = now;
  session.acquisitions[key] = acquisition;

  if (!acquisition.owned) {
    await writeSession(root, session, paths);
    return { ...acquisition, sessionId, reused: false };
  }

  // Publish pending ownership before the first artifact byte. If the process
  // is killed during the copy, a later release can still prove ownership and
  // remove the partial target.
  try {
    await writeSession(root, session, paths);
  } catch (err) {
    if (!(err instanceof AtomicWritePostRenameError)) throw err;
  }

  try {
    const artifactsDir = sessionArtifactsDir(root, sessionId);
    await ensureManagedDirectory(root, artifactsDir);
    const canonicalArtifactParent = await realpath(dirname(acquisition.path));
    if (!isInside(root, canonicalArtifactParent)) {
      throw new Error(
        `Dependency artifact parent resolves outside lease root: ${acquisition.path}`,
      );
    }
    await mkdir(acquisition.path);
    const artifactEntry = await lstat(acquisition.path);
    if (artifactEntry.isSymbolicLink() || !artifactEntry.isDirectory()) {
      throw new Error(
        `Dependency artifact is not a real directory: ${acquisition.path}`,
      );
    }
    const marker = {
      version: 1,
      sessionId,
      artifactId: acquisition.artifactId,
      path: acquisition.path,
    };
    await writeTextFileAtomically(
      ownerMarkerPath(acquisition.path, acquisition.artifactId!),
      JSON.stringify(marker, null, 2) + "\n",
    );
    await cp(temporarySource!, acquisition.path, {
      recursive: true,
      filter: (source) =>
        source === temporarySource || basename(source) !== ".git",
    });
    await assertNoSymlinks(acquisition.path, false);

    acquisition.status = "ready";
    session.updatedAt = new Date().toISOString();
    session.acquisitions[key] = acquisition;
    try {
      await writeSession(root, session, paths);
    } catch (err) {
      if (!(err instanceof AtomicWritePostRenameError)) throw err;
    }
    return { ...acquisition, sessionId, reused: false };
  } catch (err) {
    try {
      await removeOwnedAcquisition(root, sessionId, acquisition, paths);
      delete session.acquisitions[key];
      if (Object.keys(session.acquisitions).length === 0) {
        await rm(statePath, { force: true });
      } else {
        session.updatedAt = new Date().toISOString();
        await writeSession(root, session, paths);
      }
    } catch (cleanupError) {
      throw new Error(
        `Dependency acquisition failed (${err instanceof Error ? err.message : String(err)}) and its artifact was preserved because ownership-safe cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        { cause: cleanupError },
      );
    }
    throw err;
  }
}

async function removeOwnedAcquisition(
  root: string,
  sessionId: string,
  acquisition: DependencyLeaseAcquisition,
  paths: DependencyLeasePaths,
): Promise<"removed" | "missing"> {
  const artifactsDir = sessionArtifactsDir(root, sessionId);
  if (!isInside(artifactsDir, acquisition.path)) {
    throw new Error(
      `Refusing to remove artifact outside its lease: ${acquisition.path}`,
    );
  }
  if (resolve(dirname(acquisition.path)) !== resolve(artifactsDir)) {
    throw new Error(
      `Refusing to remove artifact from an unexpected lease descendant: ${acquisition.path}`,
    );
  }
  if (!acquisition.artifactId) {
    throw new Error(
      `Refusing to remove artifact without an ownership identity: ${acquisition.path}`,
    );
  }
  await ensureManagedDirectory(root, artifactsDir);

  try {
    const entry = await lstat(acquisition.path);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Refusing to remove symbolic-link artifact: ${acquisition.path}`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return "missing";
    }
    throw err;
  }

  const quarantinePath = join(
    artifactsDir,
    `.${basename(acquisition.path)}.quarantine-${randomUUID()}`,
  );
  try {
    await (paths.renameArtifact ?? rename)(acquisition.path, quarantinePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return "missing";
    if (code === "EXDEV") {
      throw new Error(
        `Refusing non-atomic cross-device artifact removal: ${acquisition.path}`,
        { cause: err },
      );
    }
    throw err;
  }

  const quarantinedEntry = await lstat(quarantinePath);
  if (quarantinedEntry.isSymbolicLink() || !quarantinedEntry.isDirectory()) {
    throw new Error(
      `Preserved quarantined replacement that is not an owned directory: ${quarantinePath}`,
    );
  }

  const markerPath = ownerMarkerPath(quarantinePath, acquisition.artifactId);
  const markerEntry = await lstat(markerPath).catch((err: unknown) => {
    throw new Error(
      `Preserved quarantined artifact without an ownership marker: ${quarantinePath}`,
      { cause: err },
    );
  });
  if (markerEntry.isSymbolicLink() || !markerEntry.isFile()) {
    throw new Error(
      `Preserved quarantined artifact with an unsafe ownership marker: ${quarantinePath}`,
    );
  }

  let markerRaw: string;
  let marker: {
    version?: number;
    sessionId?: string;
    artifactId?: string;
    path?: string;
  };
  try {
    markerRaw = await readFile(markerPath, "utf-8");
    marker = JSON.parse(markerRaw);
  } catch (err) {
    throw new Error(
      `Preserved quarantined artifact with invalid ownership marker: ${quarantinePath}`,
      {
        cause: err,
      },
    );
  }
  if (
    marker.version !== 1 ||
    marker.sessionId !== sessionId ||
    marker.artifactId !== acquisition.artifactId ||
    resolve(marker.path ?? "") !== resolve(acquisition.path)
  ) {
    throw new Error(
      `Preserved quarantined artifact with mismatched ownership: ${quarantinePath}`,
    );
  }

  await assertNoSymlinks(quarantinePath, false);
  await rm(quarantinePath, { recursive: true });
  return "removed";
}

export async function releaseDependencySession(
  sessionId: string,
  paths: DependencyLeasePaths = {},
): Promise<DependencyReleaseResult> {
  validateSessionId(sessionId);
  const root = await canonicalLeasesRoot(paths, false);
  if (!root) {
    return {
      sessionId,
      alreadyReleased: true,
      removed: [],
      preserved: [],
      missing: [],
      errors: [],
    };
  }
  const statePath = sessionPath(root, sessionId);

  return withSessionMutationLock(
    root,
    statePath,
    () => releaseDependencySessionUnlocked(root, sessionId, paths),
    paths,
  );
}

/**
 * Release an exact registered artifact from a single-acquisition session.
 * The path only locates state: persisted acquisition identity plus the existing
 * guarded release authorize deletion. Markers alone are never authorization.
 */
export async function releaseDependencyByPath(
  artifactPath: string,
  paths: DependencyLeasePaths = {},
): Promise<DependencyReleaseResult | null> {
  if (!isAbsolute(artifactPath) || resolve(artifactPath) !== artifactPath) {
    return null;
  }
  const root = await canonicalLeasesRoot(paths, false);
  if (!root) return null;
  const segments = relative(root, artifactPath).split(/[\\/]+/);
  if (
    segments.length !== 3 ||
    segments[0] !== "artifacts" ||
    !/^[a-f0-9]{64}$/.test(segments[1]) ||
    join(root, ...segments) !== artifactPath
  ) {
    return null;
  }

  const statePath = join(root, "sessions", `${segments[1]}.json`);
  return withSessionMutationLock(
    root,
    statePath,
    async () => {
      let raw: string;
      try {
        raw = await readFile(statePath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT")
          return null;
        throw err;
      }
      const session = parseSession(raw);
      if (sessionPath(root, session.sessionId) !== statePath) {
        throw new Error("Dependency lease filename does not match session.");
      }
      const acquisitions = Object.values(session.acquisitions);
      if (!acquisitions.some((entry) => entry?.path === artifactPath))
        return null;
      if (
        acquisitions.length !== 1 ||
        acquisitions[0].owned !== true ||
        !acquisitions[0].artifactId
      ) {
        throw new Error(
          "Refusing path cleanup without a single owned acquisition.",
        );
      }
      return releaseDependencySessionUnlocked(root, session.sessionId, paths);
    },
    paths,
  );
}

async function releaseDependencySessionUnlocked(
  root: string,
  sessionId: string,
  paths: DependencyLeasePaths,
): Promise<DependencyReleaseResult> {
  const statePath = sessionPath(root, sessionId);
  const session = await readSession(root, sessionId);
  if (!session) {
    return {
      sessionId,
      alreadyReleased: true,
      removed: [],
      preserved: [],
      missing: [],
      errors: [],
    };
  }

  const result: DependencyReleaseResult = {
    sessionId,
    alreadyReleased: false,
    removed: [],
    preserved: [],
    missing: [],
    errors: [],
  };
  const remaining: Record<string, DependencyLeaseAcquisition> = {};

  for (const [key, acquisition] of Object.entries(session.acquisitions)) {
    if (!acquisition.owned) {
      result.preserved.push(acquisition.path);
      continue;
    }
    try {
      const status = await removeOwnedAcquisition(
        root,
        sessionId,
        acquisition,
        paths,
      );
      result[status].push(acquisition.path);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      remaining[key] = acquisition;
    }
  }

  if (Object.keys(remaining).length === 0) {
    const artifactsDir = sessionArtifactsDir(root, sessionId);
    try {
      await rmdir(artifactsDir);
      await rm(statePath, { force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        await rm(statePath, { force: true });
      } else {
        result.errors.push(
          `Preserved unknown content in dependency lease artifacts directory: ${artifactsDir}`,
        );
        session.updatedAt = new Date().toISOString();
        session.acquisitions = {};
        await writeSession(root, session, paths);
      }
    }
  } else {
    session.updatedAt = new Date().toISOString();
    session.acquisitions = remaining;
    await writeSession(root, session, paths);
  }
  return result;
}

export async function cleanupStaleDependencySessions(
  staleBefore: Date,
  dryRun: boolean,
  paths: DependencyLeasePaths = {},
): Promise<DependencyStaleCleanupResult> {
  if (!Number.isFinite(staleBefore.getTime())) {
    throw new Error("--stale-before must be a valid ISO-8601 timestamp.");
  }

  const result: DependencyStaleCleanupResult = {
    staleBefore: staleBefore.toISOString(),
    dryRun,
    stale: [],
    active: [],
    cleaned: [],
    errors: [],
  };
  const root = await canonicalLeasesRoot(paths, false);
  if (!root) return result;

  let files: string[];
  try {
    files = await readdir(join(root, "sessions"));
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return result;
    }
    throw err;
  }

  for (const file of files.filter((entry) => entry.endsWith(".json")).sort()) {
    const statePath = join(root, "sessions", file);
    try {
      await withSessionMutationLock(
        root,
        statePath,
        async () => {
          // Classification happens only after acquiring the same lock used by
          // acquire/release, so a just-refreshed session cannot be cleaned.
          let rawSession: string;
          try {
            rawSession = await readFile(statePath, "utf-8");
          } catch (err) {
            if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT")
              return;
            throw err;
          }
          const session = parseSession(rawSession);
          if (sessionPath(root, session.sessionId) !== statePath) {
            throw new Error(
              "Dependency lease filename does not match session.",
            );
          }
          const updatedAt = Date.parse(session.updatedAt);
          if (!Number.isFinite(updatedAt)) {
            throw new Error("Lease has an invalid updatedAt timestamp.");
          }
          if (updatedAt >= staleBefore.getTime()) {
            result.active.push(session.sessionId);
            return;
          }

          result.stale.push(session.sessionId);
          if (dryRun) return;

          const released = await releaseDependencySessionUnlocked(
            root,
            session.sessionId,
            paths,
          );
          if (released.errors.length > 0) {
            result.errors.push({
              sessionId: session.sessionId,
              message: released.errors.join("; "),
            });
          } else {
            result.cleaned.push(session.sessionId);
          }
        },
        paths,
      );
    } catch (err) {
      result.errors.push({
        sessionId: basename(file, ".json"),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// Re-exports — public surface preserved after the split (#677).
export { findAcquiredDependency } from "./dependency-leases-store";
export type {
  DependencyLeasePaths,
  AcquireDependencyInput,
} from "./dependency-leases-store";
