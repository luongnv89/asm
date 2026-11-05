import { formatJSON, ansi } from "../formatter";
import {
  parseSource,
  assertNoParentSegments,
  assertPathInsideRoot,
  checkGitAvailable,
  cloneToTemp,
  cleanupTemp,
  resolveSubpath,
} from "../installer";
import {
  applyFix,
  detectGitAuthor,
  formatReport,
  formatReportJSON,
  formatFixPreview,
  buildEvalMachineData,
  resolveEvalInput,
  looksLikeGithubInput,
  runWithConcurrency,
  summariseBatch,
  formatBatchSummary,
  buildBatchMachineData,
  type EvaluationReport,
  type EvalBatchItem,
  type EvalBatchResult,
  type EvalTarget,
  type EvalProvenance,
} from "../evaluator";
import { ensureEvalBuiltins, getEvalProviders } from "../eval/builtins";
import { runProvider } from "../eval/runner";
import { list as listEvalProviders } from "../eval/registry";
import {
  sortProviderReports,
  toProviderEvalReport,
  type ProviderEvalReport,
} from "../eval/summary";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";
import { errorMessage } from "../utils/errors";
import {
  checkThresholds,
  countVerdicts,
  formatThresholdSummary,
  formatVerdictLine,
  hasThresholds,
  thresholdsJSON,
  thresholdsMachine,
  verdictMachine,
  type EvalThresholds,
  type ThresholdVerdict,
} from "../eval-threshold";
import { join as joinPath } from "path";
import type { TransportMode } from "../utils/types";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

function printEvalHelp() {
  console.log(`${ansi.bold("Usage:")} asm eval <target> [options]

Evaluate a skill's SKILL.md against best practices and produce a scored quality
report with recommendations. Zero configuration — just point it at a skill
directory. Categories: structure, description quality, prompt engineering,
context efficiency, safety, testability, and naming conventions.

Accepts a local path, a GitHub shorthand, or a GitHub URL. When the target is a
collection (no SKILL.md at the root but each immediate child has one), every
child skill is evaluated and an aggregate summary is printed.

${ansi.bold("Arguments:")}
  target               Local path, github:owner/repo[#ref][:subpath], or
                       https://github.com/owner/repo[/tree/<ref>/<sub>]

${ansi.bold("Options:")}
  --fix                Apply deterministic auto-fixes to SKILL.md (creates .bak)
  --dry-run            With --fix, preview the diff without writing
  --json               Output report as JSON
  --machine            Output in stable machine-readable v1 envelope format
  --concurrency N      Cap parallel per-skill evals in batch mode (default: 4)
  --min-score N        Fail a skill whose overall score is below N (0-100)
  --min-category N     Fail a skill with any category score below N (0-10)
  --keep               Preserve the temp dir used for remote clones
  -t, --transport M    Git transport (auto|https|ssh) for remote targets
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Quality gates:")}
  --min-score and --min-category are inclusive floors ("at least N") and can be
  combined. Each skill is marked PASS or FAIL; the command exits 1 when any
  evaluated skill fails, 0 when all pass. A skill whose evaluation errors is
  reported as an error and does not change the exit code. Gate 2 of the skill
  standard (overall > 85 and every category >= 8) is:
    asm eval ./skills/ --min-score 86 --min-category 8

${ansi.bold("Exit codes:")}
  0  Evaluated (and, with a gate, every evaluated skill passed)
  1  A gate failed, or the target could not be evaluated
  2  Invalid arguments

${ansi.bold("Examples:")}
  asm eval ./my-skill                                ${ansi.dim("Score a single skill")}
  asm eval ./skills/                                 ${ansi.dim("Batch-score every skill in the dir")}
  asm eval github:mattpocock/skills:grill-me         ${ansi.dim("Fetch a remote skill and score it")}
  asm eval github:mattpocock/skills                  ${ansi.dim("Batch-score a remote collection")}
  asm eval https://github.com/mattpocock/skills/tree/main/grill-me
  asm eval ./my-skill --json                         ${ansi.dim("Output report as JSON")}
  asm eval ./my-skill --fix                          ${ansi.dim("Auto-fix deterministic issues")}
  asm eval ./my-skill --fix --dry-run                ${ansi.dim("Preview fixes as diff")}
  asm eval ./my-skill --machine                      ${ansi.dim("Machine-readable v1 envelope")}
  asm eval ./skills/ --min-score 86 --min-category 8 ${ansi.dim("Gate a collection in CI")}
  asm eval-providers list                            ${ansi.dim("List registered eval providers")}`);
}

/**
 * If a `runProvider()` result carries an error-shaped finding (the runner's
 * error-wrap path), re-throw so the existing catch block in `cmdEval` keeps
 * producing the same SKILL_NOT_FOUND machine envelope + exit 1 it did before
 * the framework was wired in.
 *
 * The runner emits `code: "provider-threw" | "timeout" | "aborted"` — any of
 * those is treated as a thrown error for output parity.
 */

function unwrapRunnerErrorOrThrow(result: {
  findings: { severity: string; message: string; code?: string }[];
}): void {
  const err = result.findings.find(
    (f) =>
      f.severity === "error" &&
      (f.code === "provider-threw" ||
        f.code === "timeout" ||
        f.code === "aborted"),
  );
  if (err) throw new Error(err.message);
}

/**
 * Shared remote-acquisition primitive — clones a GitHub shorthand or URL into
 * a temp dir via the installer pipeline, resolves any subpath, then hands the
 * root back with a cleanup hook and the provenance (`sourceRef`, `commitSha`)
 * its callers report. Used by `cmdEval` and by `cmdGet` (issue #422).
 */

export async function fetchRemoteSkillDir(
  input: string,
  transport: TransportMode,
  keep: boolean,
): Promise<{
  rootDir: string;
  /** The clone root. `rootDir` is `tempDir` or a directory inside it. */
  tempDir: string;
  cleanup: () => Promise<void>;
  sourceRef: string;
  commitSha: string | null;
}> {
  await checkGitAvailable();
  let source = parseSource(input);
  if (source.isLocal) {
    // Defensive: looksLikeGithubInput should have filtered this, but guard
    // against future regressions so the local-path branch is the only entry.
    throw new Error(
      `fetchRemoteSkillDir received a local path: "${input}". This is a bug — local paths should use the non-remote branch.`,
    );
  }
  assertNoParentSegments(source, input);
  source = await resolveSubpath(source);

  const tempDir = await cloneToTemp(source, transport);

  // `source.subpath` may point at a subdirectory inside the repo. Use that as
  // the root when present so the eval pipeline treats the subdir as the skill.
  const rootDir = source.subpath ? joinPath(tempDir, source.subpath) : tempDir;

  try {
    assertPathInsideRoot(tempDir, rootDir, input);
  } catch (guardErr) {
    await cleanupTemp(tempDir);
    throw guardErr;
  }

  // Commit SHA — best-effort; we do not fail the whole eval if git can't resolve it.
  let commitSha: string | null = null;
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "git",
      ["-C", tempDir, "rev-parse", "HEAD"],
      { timeout: 5_000 },
    );
    const sha = stdout.trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) commitSha = sha;
  } catch {
    // ignore — provenance is optional
  }

  const sourceRef = `github:${source.owner}/${source.repo}${
    source.ref ? `#${source.ref}` : ""
  }${source.subpath ? `:${source.subpath}` : ""}`;

  const cleanup = async () => {
    if (keep) return;
    await cleanupTemp(tempDir);
  };

  return { rootDir, tempDir, cleanup, sourceRef, commitSha };
}

async function runSingleEval(target: EvalTarget): Promise<{
  report: (EvaluationReport & { providers: ProviderEvalReport[] }) | null;
  error: string | null;
}> {
  ensureEvalBuiltins();
  try {
    const ctx = {
      skillPath: target.skillPath,
      skillMdPath: target.skillMdPath,
    };
    const results = (
      await Promise.all(
        sortProviderReports(getEvalProviders()).map(async (provider) => {
          const applicable = await provider.applicable(ctx, {});
          if (!applicable.ok) return null;
          return runProvider(provider, ctx);
        }),
      )
    ).filter((result): result is NonNullable<typeof result> => result !== null);

    const quality = results.find((result) => result.providerId === "quality");
    if (!quality) {
      throw new Error("quality provider did not produce a result");
    }
    unwrapRunnerErrorOrThrow(quality);
    const report = quality.raw as EvaluationReport;
    return {
      report: {
        ...report,
        providers: sortProviderReports(results.map(toProviderEvalReport)),
      },
      error: null,
    };
  } catch (err) {
    return { report: null, error: errorMessage(err) };
  }
}

export async function cmdEval(args: ParsedArgs) {
  if (args.flags.help) {
    printEvalHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;
  const startTime = performance.now();

  // Path is the first positional (carried as `subcommand` by parseArgs).
  const rawInput = args.subcommand;
  if (!rawInput) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "eval",
          ErrorCodes.INVALID_ARGUMENT,
          "Missing required argument: <skill-path>",
          startTime,
        ),
      );
      process.exit(2);
    }
    error("Missing required argument: <skill-path>");
    console.error(`Run "asm eval --help" for usage.`);
    process.exit(2);
  }

  // ─── --fix path: single-skill only (scope limit) ────────────────────────
  //
  // Auto-fix is intentionally restricted to a single skill for now. A batch
  // --fix rollout would need per-skill diff aggregation, independent backup
  // handling, and a --continue-on-error surface — none of which either issue
  // #193 or #194 asks for. Keep the diff minimal; surface a clear error when
  // the user points --fix at a collection or a remote input.
  const thresholds: EvalThresholds = {
    minScore: args.flags.minScore,
    minCategory: args.flags.minCategory,
  };
  const gate = hasThresholds(thresholds);

  if (args.flags.fix) {
    if (gate) {
      const msg =
        "--min-score and --min-category cannot be combined with --fix. Run --fix first, then gate with a separate `asm eval`.";
      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineError(
            "eval",
            ErrorCodes.INVALID_ARGUMENT,
            msg,
            startTime,
          ),
        );
        process.exit(2);
      }
      error(msg);
      process.exit(2);
    }
    if (looksLikeGithubInput(rawInput)) {
      const msg =
        "--fix is only supported for local skill paths. Clone the repo first or run `asm install` to materialise it locally.";
      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineError(
            "eval",
            ErrorCodes.INVALID_ARGUMENT,
            msg,
            startTime,
          ),
        );
        process.exit(2);
      }
      error(msg);
      process.exit(2);
    }
    try {
      const gitAuthor = await detectGitAuthor();
      const fix = await applyFix(rawInput, {
        dryRun: args.flags.dryRun,
        gitAuthor,
      });

      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineOutput(
            "eval",
            buildEvalMachineData(fix.report, fix),
            startTime,
          ),
        );
        return;
      }

      if (args.flags.json) {
        console.log(
          JSON.stringify(
            {
              report: fix.report,
              fix: {
                dryRun: fix.dryRun,
                applied: fix.applied,
                skipped: fix.skipped,
                backupPath: fix.backupPath,
                diff: fix.diff,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(formatReport(fix.report));
      console.log("");
      console.log(formatFixPreview(fix));
      return;
    } catch (err) {
      if (args.flags.machine) {
        restoreConsole?.();
        console.log(
          formatMachineError(
            "eval",
            ErrorCodes.SKILL_NOT_FOUND,
            errorMessage(err),
            startTime,
          ),
        );
        process.exit(1);
      }
      error(errorMessage(err));
      process.exit(1);
    }
    return;
  }

  // ─── Non-fix path: unified resolver + single-or-batch eval ──────────────
  let resolved: Awaited<ReturnType<typeof resolveEvalInput>> | null = null;

  try {
    resolved = await resolveEvalInput(rawInput, {
      fetchRemote: (input: string) =>
        fetchRemoteSkillDir(input, args.flags.transport, args.flags.keep),
    });
  } catch (err) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "eval",
          ErrorCodes.SKILL_NOT_FOUND,
          errorMessage(err),
          startTime,
        ),
      );
      process.exit(1);
    }
    error(errorMessage(err));
    process.exit(1);
  }

  try {
    // Single-skill path — preserve byte-identical output locked in by existing tests.
    if (!resolved.isCollection && resolved.targets.length === 1) {
      const target = resolved.targets[0];
      const { report, error: runErr } = await runSingleEval(target);
      if (!report) {
        throw new Error(runErr ?? "eval failed");
      }
      const verdict = gate ? checkThresholds(report, thresholds) : null;
      // exitCode, not exit(): output below must flush and `finally` must run.
      if (verdict && !verdict.passed) process.exitCode = 1;

      if (args.flags.machine) {
        restoreConsole?.();
        // Attach provenance for remote inputs via the machine data surface —
        // the machine envelope is versioned so adding fields is safe.
        const data = buildEvalMachineData(report, null);
        const augmented = resolved.provenance.remote
          ? {
              ...data,
              provenance: {
                input: resolved.provenance.input,
                remote: true,
                source_ref: resolved.provenance.sourceRef ?? null,
                commit_sha: resolved.provenance.commitSha ?? null,
                temp_path: resolved.provenance.tempPath ?? null,
              },
            }
          : data;
        const gated = verdict
          ? {
              ...augmented,
              thresholds: thresholdsMachine(thresholds),
              threshold: verdictMachine(verdict),
            }
          : augmented;
        console.log(formatMachineOutput("eval", gated, startTime));
        return;
      }

      if (args.flags.json) {
        // Local path: preserve byte-identical EvaluationReport shape locked in
        // by cli.test.ts (eval --json shape test). Remote path: extend with a
        // provenance block so #193's AC ("source URL + resolved SHA + temp
        // path in output") is met for the JSON surface too.
        if (resolved.provenance.remote) {
          console.log(
            JSON.stringify(
              {
                ...report,
                provenance: {
                  input: resolved.provenance.input,
                  remote: true,
                  sourceRef: resolved.provenance.sourceRef ?? null,
                  commitSha: resolved.provenance.commitSha ?? null,
                  tempPath: resolved.provenance.tempPath ?? null,
                },
                ...gateJSON(verdict, thresholds),
              },
              null,
              2,
            ),
          );
        } else if (verdict) {
          console.log(
            JSON.stringify(
              { ...report, ...gateJSON(verdict, thresholds) },
              null,
              2,
            ),
          );
        } else {
          console.log(formatReportJSON(report));
        }
        return;
      }

      console.log(formatReport(report));
      if (verdict) {
        console.log("");
        console.log(formatVerdictLine(report, verdict, thresholds));
      }
      if (resolved.provenance.remote) {
        printRemoteProvenance(resolved.provenance);
      }
      return;
    }

    // Collection path — concurrency-bounded iteration + aggregate summary.
    const concurrency = args.flags.concurrency || 4;
    if (resolved.targets.length === 0) {
      throw new Error(
        `No skills to evaluate at "${rawInput}" — the resolved location has no SKILL.md in itself or its immediate children.`,
      );
    }
    const items: EvalBatchItem[] = await runWithConcurrency(
      resolved.targets,
      concurrency,
      async (target) => {
        const { report, error: runErr } = await runSingleEval(target);
        return {
          label: target.label,
          skillPath: target.skillPath,
          report,
          error: runErr,
        };
      },
    );
    const aggregate = summariseBatch(items);
    const batch: EvalBatchResult = {
      provenance: resolved.provenance,
      aggregate,
      results: items,
    };
    // Per-skill verdicts (null for skills whose eval errored), only when gated.
    const verdicts: (ThresholdVerdict | null)[] | null = gate
      ? items.map((i) =>
          i.report ? checkThresholds(i.report, thresholds) : null,
        )
      : null;
    const counts = verdicts
      ? countVerdicts(
          items.map((i, idx) => ({ label: i.label, verdict: verdicts[idx] })),
        )
      : null;
    if (counts && counts.failed > 0) process.exitCode = 1;

    if (args.flags.machine) {
      restoreConsole?.();
      const data = buildBatchMachineData(batch);
      const gated =
        verdicts && counts
          ? {
              ...data,
              thresholds: thresholdsMachine(thresholds),
              aggregate: {
                ...data.aggregate,
                threshold_passed: counts.passed,
                threshold_failed: counts.failed,
              },
              results: data.results.map((r, idx) => ({
                ...r,
                threshold: verdicts[idx] ? verdictMachine(verdicts[idx]) : null,
              })),
            }
          : data;
      console.log(formatMachineOutput("eval", gated, startTime));
      return;
    }

    if (args.flags.json) {
      console.log(
        JSON.stringify(
          {
            provenance: batch.provenance,
            aggregate:
              counts !== null
                ? {
                    ...batch.aggregate,
                    thresholdPassed: counts.passed,
                    thresholdFailed: counts.failed,
                  }
                : batch.aggregate,
            ...(verdicts ? { thresholds: thresholdsJSON(thresholds) } : {}),
            results: batch.results.map((r, idx) => ({
              label: r.label,
              skillPath: r.skillPath,
              error: r.error,
              report: r.report,
              ...(verdicts ? { threshold: verdicts[idx] } : {}),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    // Human-readable text: print each report then the summary footer.
    for (const [idx, item] of batch.results.entries()) {
      if (item.report) {
        console.log(formatReport(item.report));
        const verdict = verdicts?.[idx];
        if (verdict) {
          console.log("");
          console.log(formatVerdictLine(item.report, verdict, thresholds));
        }
      } else {
        console.log(`Skill evaluation: ${item.skillPath}`);
        console.log(
          `  ${ansi.red("error:")} ${item.error ?? "unknown failure"}`,
        );
      }
      console.log("");
    }
    console.log(formatBatchSummary(batch));
    if (counts) console.log(formatThresholdSummary(counts, thresholds));
    if (resolved.provenance.remote && !args.flags.verbose) {
      // formatBatchSummary already prints provenance for remote inputs, so
      // we deliberately skip the extra print here to avoid duplication.
    }
  } catch (err) {
    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "eval",
          ErrorCodes.SKILL_NOT_FOUND,
          errorMessage(err),
          startTime,
        ),
      );
      process.exit(1);
    }
    error(errorMessage(err));
    process.exit(1);
  } finally {
    if (resolved) {
      try {
        await resolved.cleanup();
      } catch {
        // best-effort cleanup — do not swallow the outer error.
      }
    }
  }
}

/** `--json` fields added only when a gate flag is set (additive, #773). */
function gateJSON(
  verdict: ThresholdVerdict | null,
  thresholds: EvalThresholds,
): Record<string, unknown> {
  if (!verdict) return {};
  return { thresholds: thresholdsJSON(thresholds), threshold: verdict };
}

function printRemoteProvenance(provenance: EvalProvenance): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(ansi.dim("Fetched remote skill:"));
  if (provenance.sourceRef)
    lines.push(ansi.dim(`  Source:  ${provenance.sourceRef}`));
  if (provenance.commitSha)
    lines.push(ansi.dim(`  Commit:  ${provenance.commitSha}`));
  if (provenance.tempPath)
    lines.push(ansi.dim(`  Temp:    ${provenance.tempPath}`));
  console.log(lines.join("\n"));
}

// ─── Eval providers ─────────────────────────────────────────────────────────

function printEvalProvidersHelp() {
  console.log(`${ansi.bold("Usage:")} asm eval-providers <subcommand> [options]

Manage evaluation providers registered with the ${ansi.bold("asm eval")} framework.
Providers implement the ${ansi.bold("EvalProvider")} contract (see src/eval/types.ts) and
are resolved by id and semver range.

${ansi.bold("Subcommands:")}
  list                 List every registered (id, version) provider

${ansi.bold("Options:")}
  --json               Output as JSON (list)
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm eval-providers list              ${ansi.dim("Show registered providers")}
  asm eval-providers list --json       ${ansi.dim("Machine-readable listing")}`);
}

export async function cmdEvalProviders(args: ParsedArgs) {
  if (args.flags.help) {
    printEvalProvidersHelp();
    return;
  }

  const subcommand = args.subcommand;
  if (!subcommand) {
    error("Missing subcommand. Use: list");
    console.error(`Run "asm eval-providers --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "list": {
      ensureEvalBuiltins();
      const providers = listEvalProviders();

      if (args.flags.json) {
        console.log(
          formatJSON(
            providers.map((p) => ({
              id: p.id,
              version: p.version,
              schemaVersion: p.schemaVersion,
              description: p.description,
              requires: p.requires ?? [],
            })),
          ),
        );
        return;
      }

      if (providers.length === 0) {
        console.log("No eval providers registered.");
        return;
      }

      // Build a plain-text table. Widths are computed from the data so the
      // columns align whether we print one provider or ten.
      const headers = [
        "id",
        "version",
        "schemaVersion",
        "description",
        "requires",
      ];
      const rows = providers.map((p) => [
        p.id,
        p.version,
        String(p.schemaVersion),
        p.description,
        p.requires && p.requires.length > 0 ? p.requires.join(",") : "-",
      ]);
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => r[i]!.length)),
      );
      const renderRow = (cells: string[]) =>
        cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
      console.log(ansi.bold(renderRow(headers)));
      console.log(widths.map((w) => "-".repeat(w)).join("  "));
      for (const row of rows) {
        console.log(renderRow(row));
      }
      return;
    }
    default:
      error(`Unknown eval-providers subcommand: "${subcommand}". Use: list`);
      console.error(`Run "asm eval-providers --help" for usage.`);
      process.exit(2);
  }
}

// ─── Link ───────────────────────────────────────────────────────────────────
