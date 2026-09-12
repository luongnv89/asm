import { createHash, randomUUID } from "crypto";
import { execFile } from "child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { promisify } from "util";
import { getDependencyLeasesDir } from "./config";
import {
  withFileMutationLock,
  writeTextFileAtomically,
} from "./utils/atomic-file";
import type {
  DependencyAcquireResult,
  DependencyLeaseAcquisition,
  DependencyLeaseSession,
  GetTier,
} from "./utils/types";
// Split from dependency-leases.ts (issue #677).

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOCK_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LOCK_RETRY_MS = 100;
// Remote resolution has individual operations up to 120 seconds. Keep the
// interprocess wait bounded, but comfortably above a complete resolution.
const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60_000;
const execFileAsync = promisify(execFile);

export interface DependencyLeasePaths {
  rootDir?: string;
  /** @internal Test seam for state-persistence failures. */
  writeState?: (path: string, content: string) => Promise<void>;
  /** @internal Test seam for lock timing. */
  lockTimeoutMs?: number;
  /** @internal Test seam for lock timing. */
  lockRetryMs?: number;
  /** @internal Test seam for deterministic process-liveness checks. */
  lockProcessLiveness?: (pid: number) => "alive" | "dead" | "unknown";
  /** @internal Test seam for deterministic PID-reuse checks. */
  lockProcessStartIdentity?: (
    pid: number,
    timeoutMs: number,
  ) => Promise<string | null>;
  /** @internal Test seam for cross-platform process identity commands. */
  lockProcessIdentityCommand?: (
    file: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<string | null>;
  /** @internal Test seam for process identity platform branches. */
  lockPlatform?: NodeJS.Platform;
  /** @internal Test seam for artifact rename races. */
  renameArtifact?: (from: string, to: string) => Promise<void>;
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

export function validateSessionId(sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(
      "Invalid session identity. Use 1-128 letters, digits, dots, underscores, colons, or hyphens.",
    );
  }
  return sessionId;
}

export function leasesRoot(paths: DependencyLeasePaths): string {
  return resolve(paths.rootDir ?? getDependencyLeasesDir());
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sessionKey(sessionId: string): string {
  return hash(validateSessionId(sessionId));
}

export function requestKey(request: string): string {
  return hash(request.trim());
}

export function sessionPath(root: string, sessionId: string): string {
  return join(root, "sessions", `${sessionKey(sessionId)}.json`);
}

export function sessionArtifactsDir(root: string, sessionId: string): string {
  return join(root, "artifacts", sessionKey(sessionId));
}

export function ownerMarkerPath(
  artifactPath: string,
  artifactId: string,
): string {
  return join(artifactPath, `.asm-owner-${artifactId}.json`);
}

export function sessionLockPath(statePath: string): string {
  return `${statePath}.lock`;
}

interface SessionLockOwner {
  version: 1;
  pid: number;
  processStartIdentity: string | null;
  token: string;
  acquiredAt: string;
  ticket: number | null;
}

function parseSessionLockOwner(
  raw: string,
  expectedToken: string,
): SessionLockOwner | null {
  try {
    const owner = JSON.parse(raw) as Partial<SessionLockOwner> | null;
    if (
      !owner ||
      owner.version !== 1 ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid! <= 0 ||
      !(
        owner.processStartIdentity === undefined ||
        owner.processStartIdentity === null ||
        (typeof owner.processStartIdentity === "string" &&
          owner.processStartIdentity.length > 0 &&
          owner.processStartIdentity.length <= 256)
      ) ||
      owner.token !== expectedToken ||
      !LOCK_TOKEN_RE.test(owner.token) ||
      !Number.isFinite(Date.parse(owner.acquiredAt ?? "")) ||
      !(
        owner.ticket === null ||
        (Number.isSafeInteger(owner.ticket) && owner.ticket! > 0)
      )
    ) {
      return null;
    }
    return {
      ...(owner as SessionLockOwner),
      processStartIdentity: owner.processStartIdentity ?? null,
    };
  } catch {
    return null;
  }
}

function processLiveness(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ESRCH") return "dead";
    return "unknown";
  }
}

async function runProcessIdentityCommand(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout: Math.max(1, Math.min(2_000, timeoutMs)),
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
    });
    const output = stdout.trim();
    return output || null;
  } catch {
    return null;
  }
}

async function processStartIdentity(
  pid: number,
  timeoutMs: number,
  platform: NodeJS.Platform,
  command: (
    file: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<string | null>,
): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || timeoutMs <= 0) return null;
  try {
    if (platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf-8");
      const afterCommand = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const startTicks = afterCommand[19];
      return startTicks ? `linux:${startTicks}` : null;
    }
    if (platform === "win32") {
      const creationTicks = await command(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$p = Get-Process -Id ([int]$args[0]) -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks",
          String(pid),
        ],
        timeoutMs,
      );
      return creationTicks && /^\d+$/.test(creationTicks)
        ? `windows:${creationTicks}`
        : null;
    }
    const startedAt = await command(
      "ps",
      ["-o", "lstart=", "-p", String(pid)],
      timeoutMs,
    );
    return startedAt ? `ps:${startedAt}` : null;
  } catch {
    return null;
  }
}

function lockTimeoutError(lockDir: string): Error {
  return new Error(`Timed out waiting for dependency lease lock: ${lockDir}`);
}

async function probeProcessStartIdentity(
  pid: number,
  deadline: number,
  lockDir: string,
  paths: DependencyLeasePaths,
): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw lockTimeoutError(lockDir);
  const provider = paths.lockProcessStartIdentity;
  const probe = provider
    ? provider(pid, remaining)
    : processStartIdentity(
        pid,
        remaining,
        paths.lockPlatform ?? process.platform,
        paths.lockProcessIdentityCommand ?? runProcessIdentityCommand,
      );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(lockTimeoutError(lockDir)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeSessionLockOwner(
  path: string,
  owner: SessionLockOwner,
): Promise<void> {
  await writeTextFileAtomically(path, JSON.stringify(owner, null, 2) + "\n");
}

async function readSessionLockCandidates(
  lockDir: string,
  ownToken: string,
  deadline: number,
  paths: DependencyLeasePaths,
): Promise<{
  candidates: SessionLockOwner[];
  invalidOwner: boolean;
}> {
  const candidates: SessionLockOwner[] = [];
  let invalidOwner = false;

  for (const file of (await readdir(lockDir))
    .filter((entry) => entry.endsWith(".json"))
    .sort()) {
    if (Date.now() >= deadline) throw lockTimeoutError(lockDir);
    const candidateToken = basename(file, ".json");
    const candidatePath = join(lockDir, file);
    let candidate: SessionLockOwner | null;
    try {
      const candidateEntry = await lstat(candidatePath);
      if (candidateEntry.isSymbolicLink() || !candidateEntry.isFile()) {
        invalidOwner = true;
        continue;
      }
      candidate = parseSessionLockOwner(
        await readFile(candidatePath, "utf-8"),
        candidateToken,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") continue;
      throw err;
    }

    if (!candidate) {
      invalidOwner = true;
      continue;
    }
    if (candidate.token === ownToken) {
      candidates.push(candidate);
      continue;
    }

    const liveness = (paths.lockProcessLiveness ?? processLiveness)(
      candidate.pid,
    );
    if (liveness === "dead") {
      await rm(candidatePath, { force: true });
      continue;
    }
    const currentStartIdentity = await probeProcessStartIdentity(
      candidate.pid,
      deadline,
      lockDir,
      paths,
    );
    const identityMismatch =
      candidate.processStartIdentity !== null &&
      currentStartIdentity !== null &&
      candidate.processStartIdentity !== currentStartIdentity;
    if (identityMismatch) {
      // Candidate paths contain unguessable tokens and are never reused.
      // Removing this exact confirmed-stale owner cannot unlink a successor.
      await rm(candidatePath, { force: true });
      continue;
    }
    candidates.push(candidate);
  }
  return { candidates, invalidOwner };
}

async function withInterprocessSessionLock<T>(
  canonicalRoot: string,
  statePath: string,
  operation: () => Promise<T>,
  paths: DependencyLeasePaths,
): Promise<T> {
  const lockDir = sessionLockPath(statePath);
  await ensureManagedDirectory(canonicalRoot, dirname(statePath));
  await assertManagedFileOrMissing(canonicalRoot, statePath);
  await ensureManagedDirectory(canonicalRoot, lockDir);
  const startedAt = Date.now();
  const lockTimeoutMs = paths.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const lockRetryMs = paths.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS;
  const deadline = startedAt + lockTimeoutMs;
  const token = randomUUID();
  const contenderPath = join(lockDir, `${token}.json`);
  const owner: SessionLockOwner = {
    version: 1,
    pid: process.pid,
    processStartIdentity: await probeProcessStartIdentity(
      process.pid,
      deadline,
      lockDir,
      paths,
    ),
    token,
    acquiredAt: new Date().toISOString(),
    ticket: null,
  };
  await writeSessionLockOwner(contenderPath, owner);

  try {
    while (owner.ticket === null) {
      const { candidates, invalidOwner } = await readSessionLockCandidates(
        lockDir,
        token,
        deadline,
        paths,
      );
      if (!invalidOwner) {
        owner.ticket =
          Math.max(0, ...candidates.map((candidate) => candidate.ticket ?? 0)) +
          1;
        await writeSessionLockOwner(contenderPath, owner);
        break;
      }
      if (Date.now() >= deadline) throw lockTimeoutError(lockDir);
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.min(lockRetryMs, deadline - Date.now())),
      );
    }

    while (true) {
      const { candidates, invalidOwner } = await readSessionLockCandidates(
        lockDir,
        token,
        deadline,
        paths,
      );
      const blocked = candidates.some(
        (candidate) =>
          candidate.token !== token &&
          (candidate.ticket === null ||
            candidate.ticket! < owner.ticket! ||
            (candidate.ticket === owner.ticket &&
              candidate.token.localeCompare(token) < 0)),
      );
      if (!invalidOwner && !blocked) break;
      if (Date.now() >= deadline) throw lockTimeoutError(lockDir);
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.min(lockRetryMs, deadline - Date.now())),
      );
    }

    return await operation();
  } finally {
    await rm(contenderPath, { force: true });
  }
}

export function withSessionMutationLock<T>(
  canonicalRoot: string,
  statePath: string,
  operation: () => Promise<T>,
  paths: DependencyLeasePaths,
): Promise<T> {
  return withFileMutationLock(statePath, () =>
    withInterprocessSessionLock(canonicalRoot, statePath, operation, paths),
  );
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export async function canonicalLeasesRoot(
  paths: DependencyLeasePaths,
  create: boolean,
): Promise<string | null> {
  const requestedRoot = leasesRoot(paths);
  try {
    if (create) await mkdir(requestedRoot, { recursive: true });
    const canonicalRoot = await realpath(requestedRoot);
    const rootStat = await lstat(canonicalRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error(
        `Dependency leases root is not a real directory: ${requestedRoot}`,
      );
    }
    return canonicalRoot;
  } catch (err) {
    if (!create && (err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function ensureManagedDirectory(
  canonicalRoot: string,
  target: string,
): Promise<void> {
  if (!isInside(canonicalRoot, target)) {
    throw new Error(`Managed dependency path escapes lease root: ${target}`);
  }
  let current = canonicalRoot;
  const segments = relative(canonicalRoot, target)
    .split(/[\\/]+/)
    .filter(Boolean);
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(
          `Refusing symlink or non-directory in managed dependency path: ${current}`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
          throw mkdirError;
        }
      }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(
          `Refusing symlink or non-directory in managed dependency path: ${current}`,
          { cause: err },
        );
      }
    }
    const canonicalCurrent = await realpath(current);
    if (!isInside(canonicalRoot, canonicalCurrent)) {
      throw new Error(
        `Managed dependency directory resolves outside lease root: ${current}`,
      );
    }
  }
}

async function assertManagedFileOrMissing(
  canonicalRoot: string,
  path: string,
): Promise<void> {
  if (!isInside(canonicalRoot, path)) {
    throw new Error(`Managed dependency file escapes lease root: ${path}`);
  }
  const canonicalParent = await realpath(dirname(path));
  if (!isInside(canonicalRoot, canonicalParent)) {
    throw new Error(
      `Managed dependency file parent resolves outside lease root: ${path}`,
    );
  }
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(
        `Refusing symlink or non-file in managed dependency path: ${path}`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
  }
}

export async function assertNoSymlinks(
  path: string,
  skipGitDirectories: boolean,
): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) {
    throw new Error(`Dependency tree contains a symbolic link: ${path}`);
  }
  if (!entry.isDirectory()) {
    if (!entry.isFile()) {
      throw new Error(`Dependency tree contains an unsupported entry: ${path}`);
    }
    return;
  }
  for (const child of await readdir(path)) {
    if (skipGitDirectories && child === ".git") continue;
    await assertNoSymlinks(join(path, child), skipGitDirectories);
  }
}

export async function validateTemporarySource(
  sourceDir: string,
): Promise<string> {
  const sourceEntry = await lstat(sourceDir);
  if (sourceEntry.isSymbolicLink() || !sourceEntry.isDirectory()) {
    throw new Error(
      `Temporary dependency source must be a real directory: ${sourceDir}`,
    );
  }
  const canonicalSource = await realpath(sourceDir);
  const skillMdPath = join(sourceDir, "SKILL.md");
  const skillEntry = await lstat(skillMdPath);
  if (skillEntry.isSymbolicLink() || !skillEntry.isFile()) {
    throw new Error(
      `Temporary dependency SKILL.md must be a real file: ${skillMdPath}`,
    );
  }
  const canonicalSkillMd = await realpath(skillMdPath);
  if (!isInside(canonicalSource, canonicalSkillMd)) {
    throw new Error(
      `Temporary dependency SKILL.md resolves outside its source: ${skillMdPath}`,
    );
  }
  await assertNoSymlinks(canonicalSource, true);
  return canonicalSource;
}

export function safeArtifactName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "");
  return safe.slice(0, 64) || "skill";
}

export function emptySession(
  sessionId: string,
  now: string,
): DependencyLeaseSession {
  return {
    version: 1,
    sessionId,
    createdAt: now,
    updatedAt: now,
    acquisitions: {},
  };
}

export function parseSession(
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

export async function readSession(
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

export async function writeSession(
  root: string,
  session: DependencyLeaseSession,
  paths: DependencyLeasePaths,
): Promise<void> {
  const path = sessionPath(root, session.sessionId);
  const content = JSON.stringify(session, null, 2) + "\n";
  await (paths.writeState ?? writeTextFileAtomically)(path, content);
}

export async function usableAcquisition(
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

export async function findAcquiredDependencyUnlocked(
  root: string,
  sessionId: string,
  request: string,
): Promise<DependencyAcquireResult | null> {
  validateSessionId(sessionId);
  const normalizedRequest = request.trim();
  if (!normalizedRequest)
    throw new Error("Dependency reference cannot be empty.");

  const session = await readSession(root, sessionId);
  const acquisition = session?.acquisitions[requestKey(normalizedRequest)];
  if (!(await usableAcquisition(acquisition))) return null;
  return { ...acquisition!, sessionId, reused: true };
}

export async function findAcquiredDependency(
  sessionId: string,
  request: string,
  paths: DependencyLeasePaths = {},
): Promise<DependencyAcquireResult | null> {
  const root = await canonicalLeasesRoot(paths, false);
  if (!root) return null;
  return findAcquiredDependencyUnlocked(root, sessionId, request);
}
