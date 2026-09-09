import { createHash, randomUUID } from "crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { getDependencyLeasesDir } from "./config";
import {
  AtomicWritePostRenameError,
  withFileMutationLock,
  writeTextFileAtomically,
} from "./utils/atomic-file";
import type {
  DependencyAcquireResult,
  DependencyLeaseAcquisition,
  DependencyLeaseSession,
  DependencyReleaseResult,
  DependencyStaleCleanupResult,
  GetTier,
} from "./utils/types";

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface DependencyLeasePaths {
  rootDir?: string;
  /** @internal Test seam for state-persistence failures. */
  writeState?: (path: string, content: string) => Promise<void>;
}

export interface AcquireDependencyInput {
  sessionId: string;
  request: string;
  name: string;
  sourceDir: string;
  tier: GetTier;
  source: string;
  commit: string | null;
  /** True when sourceDir is temporary and ASM must retain a lease-owned copy. */
  temporary: boolean;
}

function validateSessionId(sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      "Invalid session identity. Use 1-128 letters, digits, dots, underscores, colons, or hyphens.",
    );
  }
  return sessionId;
}

function leasesRoot(paths: DependencyLeasePaths): string {
  return resolve(paths.rootDir ?? getDependencyLeasesDir());
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionKey(sessionId: string): string {
  return hash(validateSessionId(sessionId));
}

function requestKey(request: string): string {
  return hash(request.trim());
}

function sessionPath(root: string, sessionId: string): string {
  return join(root, "sessions", `${sessionKey(sessionId)}.json`);
}

function sessionArtifactsDir(root: string, sessionId: string): string {
  return join(root, "artifacts", sessionKey(sessionId));
}

function ownerMarkerPath(artifactPath: string): string {
  return `${artifactPath}.owner.json`;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function safeArtifactName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "");
  return safe.slice(0, 64) || "skill";
}

function emptySession(sessionId: string, now: string): DependencyLeaseSession {
  return {
    version: 1,
    sessionId,
    createdAt: now,
    updatedAt: now,
    acquisitions: {},
  };
}

function parseSession(
  raw: string,
  expectedSessionId?: string,
): DependencyLeaseSession {
  const parsed = JSON.parse(raw) as Partial<DependencyLeaseSession> | null;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== 1 ||
    typeof parsed.sessionId !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !parsed.acquisitions ||
    typeof parsed.acquisitions !== "object" ||
    Array.isArray(parsed.acquisitions) ||
    (expectedSessionId !== undefined && parsed.sessionId !== expectedSessionId)
  ) {
    throw new Error("Invalid dependency lease state.");
  }
  return parsed as DependencyLeaseSession;
}

async function readSession(
  root: string,
  sessionId: string,
): Promise<DependencyLeaseSession | null> {
  try {
    return parseSession(
      await readFile(sessionPath(root, sessionId), "utf-8"),
      sessionId,
    );
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return null;
    }
    if (err instanceof SyntaxError) {
      throw new Error(
        `Dependency lease state for session "${sessionId}" is corrupted; refusing to mutate its artifacts.`,
        { cause: err },
      );
    }
    throw err;
  }
}

async function writeSession(
  root: string,
  session: DependencyLeaseSession,
  paths: DependencyLeasePaths,
): Promise<void> {
  const path = sessionPath(root, session.sessionId);
  const content = JSON.stringify(session, null, 2) + "\n";
  await (paths.writeState ?? writeTextFileAtomically)(path, content);
}

async function usableAcquisition(
  acquisition: DependencyLeaseAcquisition | undefined,
): Promise<boolean> {
  if (!acquisition || acquisition.status !== "ready") return false;
  try {
    await access(acquisition.skillMdPath);
    return true;
  } catch {
    return false;
  }
}

export async function findAcquiredDependency(
  sessionId: string,
  request: string,
  paths: DependencyLeasePaths = {},
): Promise<DependencyAcquireResult | null> {
  validateSessionId(sessionId);
  const normalizedRequest = request.trim();
  if (!normalizedRequest)
    throw new Error("Dependency reference cannot be empty.");

  const session = await readSession(leasesRoot(paths), sessionId);
  const acquisition = session?.acquisitions[requestKey(normalizedRequest)];
  if (!(await usableAcquisition(acquisition))) return null;
  return { ...acquisition!, sessionId, reused: true };
}

export async function acquireDependency(
  input: AcquireDependencyInput,
  paths: DependencyLeasePaths = {},
): Promise<DependencyAcquireResult> {
  const sessionId = validateSessionId(input.sessionId);
  const request = input.request.trim();
  if (!request) throw new Error("Dependency reference cannot be empty.");

  await access(join(input.sourceDir, "SKILL.md"));
  const root = leasesRoot(paths);
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

  return withFileMutationLock(statePath, async () => {
    const current = await readSession(root, sessionId);
    const existing = current?.acquisitions[key];
    if (await usableAcquisition(existing)) {
      return { ...existing!, sessionId, reused: true };
    }
    if (existing?.owned) {
      await removeOwnedAcquisition(root, sessionId, existing);
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
      await mkdir(dirname(acquisition.path), { recursive: true });
      const marker = {
        version: 1,
        sessionId,
        artifactId: acquisition.artifactId,
        path: acquisition.path,
      };
      await writeTextFileAtomically(
        ownerMarkerPath(acquisition.path),
        JSON.stringify(marker, null, 2) + "\n",
      );
      await cp(input.sourceDir, acquisition.path, { recursive: true });
      await rm(join(acquisition.path, ".git"), {
        recursive: true,
        force: true,
      });

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
      await rm(acquisition.path, { recursive: true, force: true });
      await rm(ownerMarkerPath(acquisition.path), { force: true });
      delete session.acquisitions[key];
      if (Object.keys(session.acquisitions).length === 0) {
        await rm(statePath, { force: true });
      } else {
        session.updatedAt = new Date().toISOString();
        await writeSession(root, session, paths);
      }
      throw err;
    }
  });
}

async function removeOwnedAcquisition(
  root: string,
  sessionId: string,
  acquisition: DependencyLeaseAcquisition,
): Promise<"removed" | "missing"> {
  const artifactsDir = sessionArtifactsDir(root, sessionId);
  if (!isInside(artifactsDir, acquisition.path)) {
    throw new Error(
      `Refusing to remove artifact outside its lease: ${acquisition.path}`,
    );
  }

  let markerRaw: string;
  try {
    markerRaw = await readFile(ownerMarkerPath(acquisition.path), "utf-8");
  } catch (err: unknown) {
    try {
      await access(acquisition.path);
    } catch {
      return "missing";
    }
    throw new Error(
      `Refusing to remove unowned artifact: ${acquisition.path}`,
      {
        cause: err,
      },
    );
  }

  let marker: {
    version?: number;
    sessionId?: string;
    artifactId?: string;
    path?: string;
  };
  try {
    marker = JSON.parse(markerRaw);
  } catch (err) {
    throw new Error(
      `Refusing to remove artifact with invalid ownership marker: ${acquisition.path}`,
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
      `Refusing to remove artifact with mismatched ownership: ${acquisition.path}`,
    );
  }

  await rm(acquisition.path, { recursive: true, force: true });
  await rm(ownerMarkerPath(acquisition.path), { force: true });
  return "removed";
}

export async function releaseDependencySession(
  sessionId: string,
  paths: DependencyLeasePaths = {},
): Promise<DependencyReleaseResult> {
  validateSessionId(sessionId);
  const root = leasesRoot(paths);
  const statePath = sessionPath(root, sessionId);

  return withFileMutationLock(statePath, async () => {
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
        );
        result[status].push(acquisition.path);
      } catch (err) {
        result.errors.push(err instanceof Error ? err.message : String(err));
        remaining[key] = acquisition;
      }
    }

    if (Object.keys(remaining).length === 0) {
      await rm(statePath, { force: true });
      await rm(sessionArtifactsDir(root, sessionId), {
        recursive: true,
        force: true,
      });
    } else {
      session.updatedAt = new Date().toISOString();
      session.acquisitions = remaining;
      await writeSession(root, session, paths);
    }
    return result;
  });
}

export async function cleanupStaleDependencySessions(
  staleBefore: Date,
  dryRun: boolean,
  paths: DependencyLeasePaths = {},
): Promise<DependencyStaleCleanupResult> {
  if (!Number.isFinite(staleBefore.getTime())) {
    throw new Error("--stale-before must be a valid ISO-8601 timestamp.");
  }

  const root = leasesRoot(paths);
  const result: DependencyStaleCleanupResult = {
    staleBefore: staleBefore.toISOString(),
    dryRun,
    stale: [],
    active: [],
    cleaned: [],
    errors: [],
  };

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
    try {
      const session = parseSession(
        await readFile(join(root, "sessions", file), "utf-8"),
      );
      const updatedAt = Date.parse(session.updatedAt);
      if (!Number.isFinite(updatedAt)) {
        throw new Error("Lease has an invalid updatedAt timestamp.");
      }
      if (updatedAt >= staleBefore.getTime()) {
        result.active.push(session.sessionId);
        continue;
      }

      result.stale.push(session.sessionId);
      if (!dryRun) {
        const released = await releaseDependencySession(
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
      }
    } catch (err) {
      result.errors.push({
        sessionId: basename(file, ".json"),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
