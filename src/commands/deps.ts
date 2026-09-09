import {
  acquireDependency,
  cleanupStaleDependencySessions,
  findAcquiredDependency,
  releaseDependencySession,
} from "../dependency-leases";
import {
  ansi,
  formatDependencyAcquisition,
  formatDependencyDiscovery,
  formatDependencyRelease,
  formatDependencyStaleCleanup,
  formatJSON,
} from "../formatter";
import type { ParsedArgs } from "../cli";
import { resolveGetTarget } from "./get";
import { error } from "./shared";

function printDepsHelp(): void {
  console.log(`${ansi.bold("Usage:")} asm deps <subcommand> [arguments] [options]

Discover and acquire optional skill dependencies with caller-owned leases.
ASM returns a directly usable path; it does not launch or supervise the agent.

${ansi.bold("Subcommands:")}
  discover <parent>       List dependencies declared by a skill
  acquire <dependency>    Make one dependency usable for a session
  release                 Release a session and remove only lease-owned copies
  cleanup                 Recover explicitly stale sessions from earlier runs

${ansi.bold("Options:")}
  --session <id>          Caller-supplied session identity (acquire, release)
  --stale-before <time>   ISO-8601 cutoff chosen by the caller (cleanup)
  --dry-run               Classify stale sessions without releasing them
  --json                  Output a JSON object
  -s, --scope <scope>     Installed lookup scope (default: both)
  --transport <mode>      Remote clone transport: auto, https, ssh
  --no-cache              Bypass registry cache
  --no-color              Disable ANSI colors

${ansi.bold("Examples:")}
  asm deps discover parent-skill --json
  asm deps acquire code-review --session run-123 --json
  asm deps release --session run-123 --json
  asm deps cleanup --stale-before 2026-09-08T00:00:00Z --dry-run --json`);
}

function requirePositional(args: ParsedArgs, label: string): string | null {
  const value = args.positional[0];
  if (value) return value;
  error(`Missing required argument: <${label}>`);
  console.error(`Run "asm deps --help" for usage.`);
  process.exitCode = 2;
  return null;
}

function requireSession(args: ParsedArgs): string | null {
  if (args.flags.session) return args.flags.session;
  error('Missing required option: "--session <id>".');
  console.error(`Run "asm deps --help" for usage.`);
  process.exitCode = 2;
  return null;
}

function printResult(args: ParsedArgs, result: unknown, human: string): void {
  console.log(args.flags.json ? formatJSON(result) : human);
}

async function discoverDependencies(args: ParsedArgs): Promise<void> {
  const parent = requirePositional(args, "parent");
  if (!parent) return;

  const resolution = await resolveGetTarget(args, parent);
  try {
    const result = {
      name: resolution.result.name,
      source: resolution.result.source,
      dependencies: resolution.result.dependencies,
    };
    printResult(args, result, formatDependencyDiscovery(result));
  } finally {
    await resolution.cleanup?.();
  }
}

async function acquireOneDependency(args: ParsedArgs): Promise<void> {
  const request = requirePositional(args, "dependency");
  const sessionId = requireSession(args);
  if (!request || !sessionId) return;

  const existing = await findAcquiredDependency(sessionId, request);
  if (existing) {
    printResult(args, existing, formatDependencyAcquisition(existing));
    return;
  }

  const resolution = await resolveGetTarget(args, request);
  try {
    const result = await acquireDependency({
      sessionId,
      request,
      name: resolution.result.name,
      sourceDir: resolution.dir,
      tier: resolution.result.tier,
      source: resolution.result.source,
      commit: resolution.result.commit,
      temporary: resolution.cleanup !== null,
    });
    printResult(args, result, formatDependencyAcquisition(result));
  } finally {
    await resolution.cleanup?.();
  }
}

async function releaseSession(args: ParsedArgs): Promise<void> {
  const sessionId = requireSession(args);
  if (!sessionId) return;

  const result = await releaseDependencySession(sessionId);
  printResult(args, result, formatDependencyRelease(result));
  if (result.errors.length > 0) process.exitCode = 1;
}

async function cleanupStaleSessions(args: ParsedArgs): Promise<void> {
  const rawCutoff = args.flags.staleBefore;
  if (!rawCutoff) {
    error('Missing required option: "--stale-before <ISO-8601>".');
    console.error(`Run "asm deps --help" for usage.`);
    process.exitCode = 2;
    return;
  }

  const cutoff = new Date(rawCutoff);
  if (!Number.isFinite(cutoff.getTime())) {
    error('"--stale-before" must be a valid ISO-8601 timestamp.');
    process.exitCode = 2;
    return;
  }
  const result = await cleanupStaleDependencySessions(
    cutoff,
    args.flags.dryRun,
  );
  printResult(args, result, formatDependencyStaleCleanup(result));
  if (result.errors.length > 0) process.exitCode = 1;
}

export async function cmdDeps(args: ParsedArgs): Promise<void> {
  if (args.flags.help) {
    printDepsHelp();
    return;
  }

  try {
    switch (args.subcommand) {
      case "discover":
        await discoverDependencies(args);
        return;
      case "acquire":
        await acquireOneDependency(args);
        return;
      case "release":
        await releaseSession(args);
        return;
      case "cleanup":
        await cleanupStaleSessions(args);
        return;
      default:
        error(
          "Missing or unknown deps subcommand. Use: discover, acquire, release, or cleanup.",
        );
        console.error(`Run "asm deps --help" for usage.`);
        process.exitCode = 2;
    }
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
