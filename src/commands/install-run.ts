/**
 * `asm install` command body.
 * Split from commands/install.ts (issue #455); helpers live in
 * `install-inspect.ts`.
 */

import { loadConfig, getLibrarySkillsDir } from "../config";
import { scanAllSkills } from "../scanner";
import { ansi } from "../formatter";
import {
  parseSource,
  isLocalPath,
  isExistingLocalDir,
  sanitizeName,
  assertNoParentSegments,
  assertPathInsideRoot,
  hasParentPathSegment,
  checkGitAvailable,
  cloneToTemp,
  validateSkill,
  discoverSkills,
  cleanupTemp,
  resolveProvider,
  resolveSubpath,
  findDuplicateInstallNames,
  getInstallNameFromPath,
  checkNpxAvailable,
  executeNpxSkillsAdd,
  buildRepoUrl,
  linkExistingSkill,
} from "../installer";
import type { InstallResult, ProviderConfig } from "../utils/types";
import { checkboxPicker } from "../utils/checkbox-picker";
import {
  isBareOrScopedName,
  isScopedName,
  resolveFromRegistry,
} from "../registry";
import type { ResolutionSource } from "../registry";
import { writeLockEntry, getCommitHash } from "../utils/lock";
import {
  formatMachineOutput,
  formatMachineError,
  ErrorCodes,
  redirectConsoleToStderr,
} from "../utils/machine";
import { relative as relativePath } from "path";
import { toPortableRelativePath } from "../utils/fs";
import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";
import type { SkillInspection } from "./install-inspect";
import {
  printInstallHelp,
  inspectSkillForInstall,
  displaySkillInspection,
  executeSkillInstall,
  installSelectedLibrarySkill,
} from "./install-inspect";

export async function cmdInstall(args: ParsedArgs) {
  if (args.flags.help) {
    printInstallHelp();
    return;
  }

  const restoreConsole = args.flags.machine
    ? redirectConsoleToStderr()
    : undefined;

  const startTime = performance.now();
  const explicitForce = args.flags.force;
  let sourceStr = args.subcommand;
  if (!sourceStr) {
    error("Missing required argument: <source>");
    console.error(`Run "asm install --help" for usage.`);
    process.exit(2);
  }

  let tempDir: string | null = null;
  let resolutionSource: ResolutionSource = "github";
  const totalSteps = 8;
  let currentStep = 0;
  const stepHeader = (label: string) => {
    currentStep++;
    return `\n${ansi.cyan(`[Step ${currentStep}/${totalSteps}]`)} ${ansi.bold(label)}`;
  };

  // SIGINT/SIGTERM cleanup handler
  const cleanup = () => {
    if (tempDir) {
      cleanupTemp(tempDir).finally(() => process.exit(1));
    } else {
      process.exit(1);
    }
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // Disambiguate path-shaped inputs that look like scoped names: if
    // `<cwd>/<sourceStr>` is an existing directory, treat it as a local path
    // (matches the `./` prefixed form). See issue #249.
    if (!isLocalPath(sourceStr) && (await isExistingLocalDir(sourceStr))) {
      sourceStr = `./${sourceStr}`;
    }

    // Step 0: Registry resolution for bare/scoped names
    if (isBareOrScopedName(sourceStr)) {
      console.info(
        `\n${ansi.cyan("●")} Resolving "${ansi.bold(sourceStr)}" from registry...`,
      );

      const { resolved, multipleMatches, suggestions } =
        await resolveFromRegistry(sourceStr, {
          noCache: args.flags.noCache,
        });

      if (resolved) {
        // Single match — use the resolved manifest
        resolutionSource = "registry";
        const m = resolved.manifest;
        const repoPath = m.repository.replace("https://github.com/", "");
        sourceStr = m.skill_path
          ? `github:${repoPath}#${m.commit}:${m.skill_path}`
          : `github:${repoPath}#${m.commit}`;
        console.info(
          `  ${ansi.green("✓")} Resolved: ${ansi.bold(`${m.author}/${m.name}`)} @ ${m.commit.slice(0, 7)}`,
        );
      } else if (multipleMatches.length > 0) {
        // Multiple authors publish this name — disambiguate
        console.info(
          `\n  ${ansi.yellow("⚠")} Multiple skills found for "${ansi.bold(sourceStr)}":`,
        );

        const top = multipleMatches.slice(0, 5);
        for (let idx = 0; idx < top.length; idx++) {
          const m = top[idx];
          console.info(
            `    ${ansi.cyan(`${idx + 1}.`)} ${ansi.bold(`${m.author}/${m.name}`)} — ${m.description}`,
          );
        }

        if (!process.stdin.isTTY) {
          error(
            `Ambiguous skill name "${sourceStr}". Use a scoped name: asm install author/name`,
          );
          process.exit(2);
        }

        const prompt = `\n  Select a skill [1-${top.length}]: `;
        process.stderr.write(prompt);
        const response = await new Promise<string>((resolve) => {
          let data = "";
          let done = false;
          const timer = setTimeout(() => {
            if (!done) {
              done = true;
              process.stdin.removeListener("data", onData);
              resolve(data.trim());
            }
          }, 30_000);
          function onData(chunk: string | Buffer) {
            data = chunk.toString().trim();
            if (!done) {
              done = true;
              clearTimeout(timer);
              process.stdin.removeListener("data", onData);
              resolve(data);
            }
          }
          process.stdin.setEncoding("utf-8");
          process.stdin.on("data", onData);
        });

        const choice = parseInt(response, 10);
        if (isNaN(choice) || choice < 1 || choice > top.length) {
          error("Invalid selection. Aborting.");
          process.exit(2);
        }

        const selected = top[choice - 1];
        resolutionSource = "registry";
        const selectedRepoPath = selected.repository.replace(
          "https://github.com/",
          "",
        );
        sourceStr = selected.skill_path
          ? `github:${selectedRepoPath}#${selected.commit}:${selected.skill_path}`
          : `github:${selectedRepoPath}#${selected.commit}`;
        console.info(
          `  ${ansi.green("✓")} Selected: ${ansi.bold(`${selected.author}/${selected.name}`)} @ ${selected.commit.slice(0, 7)}`,
        );
      } else if (isScopedName(sourceStr)) {
        // Scoped name not found in registry — error (no fallback)
        error(`Skill "${sourceStr}" not found in the registry.`);
        if (suggestions.length > 0) {
          console.error(
            `\n  Did you mean: ${suggestions.map((s) => ansi.cyan(s)).join(", ")}?`,
          );
        }
        process.exit(1);
      } else {
        // Bare name not in registry — fall back to existing behavior
        console.info(
          `  ${ansi.dim("Not found in registry — trying existing sources...")}`,
        );
        resolutionSource = "pre-indexed";
      }
    }

    // Step 1: Parse source
    console.info(stepHeader("Parsing source"));
    let source = parseSource(sourceStr);
    if (!source.isLocal) {
      assertNoParentSegments(source, sourceStr);
      if (hasParentPathSegment(args.flags.path)) {
        throw new Error(
          `Invalid source: the subpath in "${args.flags.path}" escapes the repository.`,
        );
      }
    }
    const isLocal = !!source.isLocal;

    if (isLocal) {
      // Local path — validate it exists and is a directory
      const localPath = source.localPath!;
      console.info(`  ${ansi.dim(`local: ${localPath}`)}`);
      const { stat: fsStat } = await import("fs/promises");
      try {
        const stats = await fsStat(localPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path is not a directory: ${localPath}`);
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          throw new Error(`Path does not exist: ${localPath}`, { cause: err });
        }
        throw err;
      }
    } else {
      // Remote — resolve subpath via git ls-remote
      await checkGitAvailable();
      source = await resolveSubpath(source);
      console.info(`  ${ansi.dim(sourceStr)}`);
    }

    if (args.flags.library && args.flags.method === "vercel") {
      throw new Error(
        "--library cannot be combined with --method vercel because the Vercel installer writes to provider skill folders. Use the default method for library installs.",
      );
    }

    // Vercel method: delegate to npx skills add and then continue with
    // standard asm install to register in asm's local inventory
    if (args.flags.method === "vercel") {
      console.info(stepHeader("Installing via Vercel skills CLI"));
      await checkNpxAvailable();

      const repoUrl = buildRepoUrl(source);
      const skillName = args.flags.path || null;
      console.info(
        `  ${ansi.dim(`npx skills add ${repoUrl}${skillName ? ` --skill ${skillName}` : ""}`)}`,
      );

      const { stdout, stderr } = await executeNpxSkillsAdd(repoUrl, skillName);
      if (stdout.trim()) {
        console.info(`  ${ansi.dim(stdout.trim())}`);
      }
      if (stderr.trim()) {
        console.error(`  ${ansi.dim(stderr.trim())}`);
      }
      console.info(`  ${ansi.green("✓")} Vercel skills CLI install completed`);

      // Now continue with the standard asm install flow so the skill is
      // also tracked in asm's local inventory via the normal pipeline.
      // The --force flag is implicitly set since npx may have already
      // placed files that asm would see as a conflict.
      args.flags.force = true;
      console.info(
        `  ${ansi.dim("Continuing with asm install to register in local inventory...")}`,
      );
    }

    // Step 2: Select provider (before cloning — no wasted time if user cancels)
    const config = await loadConfig();
    let provider: ProviderConfig;
    let allProviders: ProviderConfig[] | null = null;
    let installScope: "global" | "project" = "global";

    if (args.flags.library) {
      console.info(stepHeader("Selecting library"));
      const inspectionProvider =
        config.providers.find((p) => p.enabled) ?? config.providers[0];
      if (!inspectionProvider) {
        throw new Error("No providers configured.");
      }
      provider = inspectionProvider;
      console.info(`  ${ansi.dim(`library: ${getLibrarySkillsDir()}`)}`);
    } else {
      console.info(stepHeader("Selecting provider"));
      const resolved = await resolveProvider(
        config,
        args.flags.provider,
        !!process.stdin.isTTY,
      );
      provider = resolved.provider;
      allProviders = resolved.allProviders;

      // Step 3: Select scope (global or project)
      console.info(stepHeader("Selecting scope"));

      if (args.flags.scope === "global" || args.flags.scope === "project") {
        // Explicit --scope flag provided
        installScope = args.flags.scope;
        console.info(
          `  ${ansi.dim(`scope: ${installScope}`)}${installScope === "global" ? ` (${provider.global})` : ` (${provider.project})`}`,
        );
      } else if (!process.stdin.isTTY || args.flags.yes) {
        // Non-interactive mode: default to global
        installScope = "global";
        console.info(
          `  ${ansi.dim(`scope: global (default)`)} (${provider.global})`,
        );
      } else {
        // Interactive: prompt user to choose
        const scopeItems = [
          {
            label: `Global (${provider.global})`,
            hint: "Available in all projects",
            checked: true,
          },
          {
            label: `Project (${provider.project})`,
            hint: "Available only in this project",
            checked: false,
          },
        ];
        console.info(""); // blank line before picker
        const scopeIndices = await checkboxPicker({ items: scopeItems });
        if (scopeIndices.length === 0) {
          throw new Error("No scope selected. Aborting.");
        }
        // Use the first selected scope (single-select behavior)
        installScope = scopeIndices[0] === 0 ? "global" : "project";
        console.info(
          `  Selected: ${ansi.bold(installScope)} ${ansi.dim(`(${installScope === "global" ? provider.global : provider.project})`)}`,
        );
      }
    }

    // Step 4: Clone repository (or read local source)
    if (isLocal) {
      console.info(stepHeader("Reading local source"));
      console.info(`  ${ansi.dim(source.localPath!)}`);
      // For local sources, use the local path directly — no temp dir needed
      tempDir = null;
    } else {
      console.info(stepHeader("Cloning repository"));
      const transport = args.flags.transport;
      const displayUrl =
        transport === "ssh"
          ? source.sshCloneUrl
          : transport === "https"
            ? source.cloneUrl
            : `${source.cloneUrl} ${ansi.dim("(auto)")}`;
      console.info(
        `  ${displayUrl}${source.ref ? ` ${ansi.dim(`(ref: ${source.ref})`)}` : ""}${source.subpath ? ` ${ansi.dim(`(path: ${source.subpath})`)}` : ""}`,
      );
      tempDir = await cloneToTemp(source, transport);
    }

    // The base directory to scan for skills
    const scanBaseDir = isLocal ? source.localPath! : tempDir!;

    // Step 5: Scan for skills
    console.info(stepHeader("Scanning for skills"));
    const { join: joinPath } = await import("path");
    const results: InstallResult[] = [];

    // Effective path: explicit --path flag takes precedence over URL-derived subpath
    const effectivePath = args.flags.path || source.subpath;

    // Discover skills based on source type
    let selectedDirs: Array<{ skillDir: string; nameOverride: string | null }> =
      [];

    // Decide whether to walk subdirectories. Discovery may be:
    //   - rooted at scanBaseDir (whole repo, no subpath/--path)
    //   - rooted at scanBaseDir/effectivePath (subpath that contains a folder
    //     of skills) when --all is set; relPaths are prefixed with
    //     effectivePath so downstream joinPath(scanBaseDir, relPath) resolves
    //     correctly without changing discoverSkills' contract.
    let needsDiscovery = false;
    let discoveryRoot = scanBaseDir;
    let discoveryPrefix = "";
    let isRootSkill = false;

    if (effectivePath) {
      // Case 1: path specified — install specific subdirectory
      const skillDir = joinPath(scanBaseDir, effectivePath);
      if (!isLocal) {
        try {
          assertPathInsideRoot(scanBaseDir, skillDir, sourceStr);
        } catch (guardErr) {
          if (tempDir) {
            await cleanupTemp(tempDir);
            tempDir = null;
          }
          throw guardErr;
        }
      }
      let foundSkill = false;
      try {
        await validateSkill(skillDir);
        foundSkill = true;
      } catch {
        // No SKILL.md at the resolved path. With --all, treat the path as a
        // collection of skills (mirror whole-repo --all behavior, scoped to
        // this subpath). Without --all, surface the original error so the
        // caller knows the path is wrong.
        if (!args.flags.all) {
          throw new Error(
            `No SKILL.md found at path "${effectivePath}" in the repository.`,
          );
        }
        // Confirm the directory exists before falling back to discovery so we
        // don't silently report "No skills found" for a typo'd path.
        const { stat: fsStat } = await import("fs/promises");
        try {
          const s = await fsStat(skillDir);
          if (!s.isDirectory()) {
            throw new Error(
              `No SKILL.md found at path "${effectivePath}" in the repository.`,
            );
          }
        } catch (statErr: any) {
          if (statErr && statErr.code === "ENOENT") {
            throw new Error(
              `No SKILL.md found at path "${effectivePath}" in the repository.`,
              { cause: statErr },
            );
          }
          throw statErr;
        }
        needsDiscovery = true;
        discoveryRoot = skillDir;
        discoveryPrefix = effectivePath;
      }
      if (foundSkill) {
        console.info(`  Found skill at ${ansi.bold(effectivePath)}`);
        selectedDirs = [{ skillDir, nameOverride: args.flags.name }];
      }
    } else {
      try {
        await validateSkill(scanBaseDir);
        isRootSkill = true;
      } catch {
        // Not a root-level skill
      }

      if (isRootSkill && !args.flags.all) {
        // Case 2: SKILL.md at root — default single-skill install
        const metadata = await validateSkill(scanBaseDir);
        console.info(
          `  Found: ${ansi.bold(metadata.name)} v${metadata.version}`,
        );
        selectedDirs = [
          { skillDir: scanBaseDir, nameOverride: args.flags.name },
        ];
      } else if (isRootSkill && args.flags.all) {
        // Root skill plus nested skills: discover full repo for --all
        needsDiscovery = true;
      } else {
        // Case 3: Multi-skill directory/repo — discover skills in subdirectories
        needsDiscovery = true;
      }
    }

    if (needsDiscovery) {
      if (discoveryPrefix) {
        console.info(
          `  No SKILL.md at ${ansi.bold(discoveryPrefix)}. Scanning subdirectories...`,
        );
      } else if (isRootSkill) {
        console.info(
          `  Root SKILL.md found. Scanning for additional skills in subdirectories...`,
        );
      } else {
        console.info(`  No SKILL.md at root. Scanning subdirectories...`);
      }
      const rawDiscovered = await discoverSkills(discoveryRoot);
      // Rebase relPaths so they remain relative to scanBaseDir (the join
      // site below assumes that). Use forward slashes literally to match
      // discoverSkills' separator convention; joinPath would inject "\" on
      // Windows and break consistency with the rest of the file.
      const discovered = discoveryPrefix
        ? rawDiscovered.map((s) => ({
            ...s,
            relPath: `${discoveryPrefix}/${s.relPath}`,
          }))
        : rawDiscovered;

      if (discovered.length === 0) {
        throw new Error(
          discoveryPrefix
            ? `No skills found under path "${discoveryPrefix}". Skills must have a SKILL.md file.`
            : "No skills found in this repository. Skills must have a SKILL.md file.",
        );
      }

      console.info(
        `  Found ${ansi.bold(String(discovered.length))} skill(s):\n`,
      );
      for (let i = 0; i < discovered.length; i++) {
        const num = ansi.cyan(
          `  ${String(i + 1).padStart(String(discovered.length).length)})`,
        );
        console.info(
          `${num} ${ansi.bold(discovered[i].name)} ${ansi.dim(`v${discovered[i].version}`)} ${ansi.dim(`(${discovered[i].relPath})`)}`,
        );
        if (discovered[i].description) {
          console.info(`     ${ansi.dim(discovered[i].description)}`);
        }
      }

      // Step 6: Select skills
      console.info(stepHeader("Selecting skills"));
      currentStep--; // will be re-incremented by stepHeader for next step

      let selectedPaths: string[];

      if (args.flags.all && (args.flags.yes || !process.stdin.isTTY)) {
        // Non-interactive --all: auto-select everything
        selectedPaths = discovered.map((s) => s.relPath);
        console.info(
          `  Selected all ${ansi.bold(String(selectedPaths.length))} skills`,
        );
      } else if (process.stdin.isTTY) {
        // Interactive checkbox picker
        if (discovered.length === 1) {
          // Single skill: auto-select without showing picker
          selectedPaths = [discovered[0].relPath];
          console.info(
            `  Auto-selected: ${ansi.bold(discovered[0].name)} ${ansi.dim(`v${discovered[0].version}`)}`,
          );
        } else {
          const pickerItems = discovered.map((s) => ({
            label: s.name,
            hint: `v${s.version}${s.description ? "  " + s.description : ""}`,
            checked: !!args.flags.all,
          }));

          console.info(""); // blank line before picker
          const selectedIndices = await checkboxPicker({
            items: pickerItems,
          });

          if (selectedIndices.length === 0) {
            throw new Error("No skills selected. Aborting.");
          }

          selectedPaths = selectedIndices.map((i) => discovered[i].relPath);
          console.info(
            `  Selected ${ansi.bold(String(selectedPaths.length))} skill(s)`,
          );
        }
      } else {
        error(
          `Repository contains ${discovered.length} skills. Use --path <subdir> to pick one or --all to install all.\n` +
            `Available skills:\n${discovered.map((s) => `  --path ${s.relPath}`).join("\n")}`,
        );
        process.exit(2);
        return; // unreachable but helps TypeScript
      }

      // Duplicate detection must key on the *install target directory* name,
      // which inspectSkillForInstall derives from the path basename (and falls
      // back to source.repo for the root skill, whose relPath is ""). Keying on
      // frontmatter names would both miss real collisions (two skills sharing a
      // basename → same target dir, silent overwrite) and flag false ones (two
      // dirs sharing a frontmatter name → distinct target dirs). The root "" is
      // special-cased because getInstallNameFromPath("") throws on an empty name.
      const duplicateInstallNames = findDuplicateInstallNames(
        selectedPaths,
        (relPath) =>
          relPath === ""
            ? sanitizeName(source.repo)
            : getInstallNameFromPath(relPath),
      );
      if (duplicateInstallNames.length > 0) {
        const lines = duplicateInstallNames
          .map(
            (dup) =>
              `  - ${dup.name}: ${dup.paths.map((p) => `"${p}"`).join(", ")}`,
          )
          .join("\n");
        const error = new Error(
          `Duplicate skill names detected in selection:\n${lines}\n` +
            "Choose one path per skill name or install with --path.",
        ) as Error & {
          duplicates?: Array<{ name: string; paths: string[] }>;
        };
        error.duplicates = duplicateInstallNames;
        throw error;
      }

      selectedDirs = selectedPaths.map((relPath) => ({
        skillDir: joinPath(scanBaseDir, relPath),
        nameOverride: selectedPaths.length === 1 ? args.flags.name : null,
      }));

      // Adjust step counter: we used the "Selecting skills" step
      currentStep++;
    }

    // Step 7: Inspect selected skills (security scan + NEW/UPDATE status)
    console.info(stepHeader("Inspecting skills"));
    const existingSkills = await scanAllSkills(config, "both");
    const inspections: SkillInspection[] = [];
    const isBatch = selectedDirs.length > 1;

    for (let i = 0; i < selectedDirs.length; i++) {
      const { skillDir, nameOverride } = selectedDirs[i];
      const inspection = await inspectSkillForInstall(
        args,
        source,
        scanBaseDir,
        skillDir,
        nameOverride,
        config,
        provider,
        existingSkills,
        installScope,
      );

      inspections.push(inspection);
      displaySkillInspection(
        inspection,
        sourceStr,
        provider,
        allProviders,
        isBatch,
        isBatch ? { index: i + 1, total: selectedDirs.length } : undefined,
      );
    }

    // Show batch summary header
    if (isBatch) {
      console.info("");
      console.info(`  ${ansi.bold("Install settings:")}`);
      console.info(`    ${ansi.bold("Source:")}      ${sourceStr}`);
      if (allProviders) {
        console.info(
          `    ${ansi.bold("Tool:")}    All (${allProviders.map((p) => p.label).join(", ")})`,
        );
      } else {
        console.info(
          `    ${ansi.bold("Tool:")}    ${provider.label} (${provider.name})`,
        );
      }

      console.info(
        `    ${ansi.bold("Scope:")}      ${installScope === "project" ? "Project" : "Global"}`,
      );

      // Show risk summary
      const highCount = inspections.filter(
        (i) => i.riskLevel === "high",
      ).length;
      const medCount = inspections.filter(
        (i) => i.riskLevel === "medium",
      ).length;
      const safeCount = inspections.filter(
        (i) => i.riskLevel === "safe",
      ).length;
      const riskParts: string[] = [];
      if (safeCount > 0) riskParts.push(ansi.green(`${safeCount} Safe`));
      if (medCount > 0) riskParts.push(ansi.yellow(`${medCount} Medium Risk`));
      if (highCount > 0) riskParts.push(ansi.red(`${highCount} High Risk`));
      console.info(`    ${ansi.bold("Risk:")}        ${riskParts.join(", ")}`);
    }

    // Step 8: Confirm & Install
    console.info(stepHeader("Installing"));

    // Cross-tool link choice: if a skill exists in another tool, offer
    // "Link" (symlink) vs "Reinstall" (fresh copy) before confirming (issue #322).
    const linkChoices: Map<number, "link" | "reinstall"> = new Map();
    const hasLinkAvailable = inspections.some(
      (i) => i.installStatus === "LINK_AVAILABLE" && i.crossToolLink,
    );

    if (hasLinkAvailable && !args.flags.yes) {
      if (!process.stdin.isTTY) {
        // In non-interactive mode with LINK_AVAILABLE, default to Link
        for (let i = 0; i < inspections.length; i++) {
          if (inspections[i].installStatus === "LINK_AVAILABLE") {
            linkChoices.set(i, "link");
          }
        }
      } else {
        for (let i = 0; i < inspections.length; i++) {
          const inspection = inspections[i];
          if (
            inspection.installStatus !== "LINK_AVAILABLE" ||
            !inspection.crossToolLink
          ) {
            continue;
          }

          const ct = inspection.crossToolLink!;
          console.info(
            `\n  ${ansi.yellow("⚠")} ${ansi.bold(inspection.metadata.name)} is already installed in ${ct.existingProviderLabel}.`,
          );
          console.info(`    Existing: ${ansi.dim(ct.existingPath)}`);
          console.info(
            `\n  ${ansi.cyan("Option 1")} — ${ansi.bold("Reinstall")}: Download fresh from index (gets latest version)`,
          );
          console.info(
            `  ${ansi.cyan("Option 2")} — ${ansi.bold("Link")}: Symlink from existing install (no download, shares files)`,
          );
          process.stderr.write(`  Choose (1/2): `);
          const answer = await readLine();
          if (answer === "2" || answer.toLowerCase() === "link") {
            linkChoices.set(i, "link");
            console.info(
              `  ${ansi.green("✓")} Selected: Link from ${ct.existingProviderLabel}`,
            );
          } else {
            linkChoices.set(i, "reinstall");
            console.info(`  ${ansi.green("✓")} Selected: Reinstall from index`);
          }
        }
      }
    }

    // Confirmation prompt
    if (!args.flags.yes) {
      // Skip confirmation for skills that are being linked (already decided)
      const needsConfirmation = inspections.some(
        (inspection, idx) =>
          inspection.installStatus !== "LINK_AVAILABLE" ||
          linkChoices.get(idx) === "reinstall",
      );

      if (needsConfirmation) {
        const hasHighRisk = inspections.some((i) => i.riskLevel === "high");

        if (!process.stdin.isTTY) {
          error(
            "Cannot prompt for confirmation in non-interactive mode. Use --yes to skip.",
          );
          process.exit(2);
        }

        const countLabel = isBatch
          ? `${inspections.length} skills`
          : `"${inspections[0].metadata.name}"`;
        const promptText = hasHighRisk
          ? `\n  ${ansi.red("[!]")} ${ansi.bold(`Install ${countLabel}? Some have high-risk patterns.`)} [y/N] `
          : `\n  ${ansi.bold(`Install ${countLabel}?`)} [Y/n] `;
        process.stderr.write(promptText);
        const answer = await readLine();
        if (hasHighRisk) {
          if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
            console.error("Aborted.");
            process.exit(0);
          }
        } else {
          if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
            console.error("Aborted.");
            process.exit(0);
          }
        }
      }
    }

    // Get commit hash from cloned repo before installations (temp dir is cleaned up later)
    const commitHash = tempDir ? await getCommitHash(tempDir) : null;

    // Execute installations
    const failures: Array<{ name: string; error: string }> = [];
    for (let i = 0; i < inspections.length; i++) {
      const inspection = inspections[i];
      const progress = isBatch
        ? ansi.dim(`[${i + 1}/${inspections.length}]`) + " "
        : "  ";

      // Handle Link choice: skip clone/copy, just symlink from existing install
      if (linkChoices.get(i) === "link" && inspection.crossToolLink) {
        const ct = inspection.crossToolLink!;
        try {
          console.info(
            `${progress}Linking ${ansi.bold(inspection.metadata.name)} from ${ct.existingProviderLabel}...`,
          );
          const targetPath = await linkExistingSkill(
            inspection.skillName,
            ct.existingPath,
            provider.name,
            installScope,
            config,
            args.flags.force,
          );
          results.push({
            success: true,
            path: targetPath,
            name: inspection.metadata.name,
            version: inspection.metadata.version,
            provider: `Linked from ${ct.existingProviderLabel}`,
            source: `link:${ct.existingPath}`,
          });
          console.info(
            `${progress}${ansi.green("✓")} ${inspection.metadata.name} linked to ${ansi.dim(targetPath)}`,
          );

          // Write lock entry for tracking
          try {
            await writeLockEntry(inspection.metadata.name, {
              source: `link:${ct.existingPath}`,
              commitHash: "linked",
              ref: null,
              installedAt: new Date().toISOString(),
              provider: provider.name,
              sourceType: "local",
            });
          } catch {
            // Lock write failure is non-fatal
          }
        } catch (linkErr: any) {
          failures.push({
            name: inspection.metadata.name,
            error: linkErr.message,
          });
          console.error(
            `${progress}${ansi.red("✗")} ${ansi.bold(inspection.metadata.name)} — ${ansi.red(linkErr.message)}`,
          );
        }
        continue;
      }

      try {
        console.info(
          `${progress}Installing ${ansi.bold(inspection.metadata.name)}...`,
        );
        const result = args.flags.library
          ? await installSelectedLibrarySkill({
              inspection,
              source,
              isLocal,
              resolutionSource,
              commitHash,
              scanBaseDir,
              force: explicitForce,
            })
          : await executeSkillInstall(inspection.plan, allProviders);
        results.push(result);
        console.info(
          `${progress}${ansi.green("✓")} ${inspection.metadata.name} installed to ${ansi.dim(result.path)}`,
        );

        // Write lock entry for tracking
        if (!args.flags.library) {
          try {
            const sourceStr = isLocal
              ? `local:${source.localPath}`
              : `github:${source.owner}/${source.repo}`;
            const sourceType = isLocal
              ? ("local" as const)
              : resolutionSource === "registry"
                ? ("registry" as const)
                : ("github" as const);
            await writeLockEntry(result.name, {
              source: sourceStr,
              commitHash: commitHash || "unknown",
              ref: source.ref || "main",
              installedAt: new Date().toISOString(),
              provider: inspection.plan.providerName,
              scope: inspection.plan.scope,
              skillPath: toPortableRelativePath(
                relativePath(
                  inspection.plan.tempDir,
                  inspection.plan.sourceDir,
                ),
              ),
              targetDir: inspection.plan.targetDir,
              sourceType,
              ...(resolutionSource === "registry"
                ? { registryName: result.name }
                : {}),
            });
          } catch {
            // Lock write failure is non-fatal
          }
        }
      } catch (installErr: any) {
        failures.push({
          name: inspection.metadata.name,
          error: installErr.message,
        });
        console.error(
          `${progress}${ansi.red("✗")} ${ansi.bold(inspection.metadata.name)} — ${ansi.red(installErr.message)}`,
        );
      }
    }

    // Report summary
    // Remove signal handlers
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    if (failures.length > 0) {
      console.error(
        `\n${ansi.yellow(`${failures.length} skill(s) failed to install:`)}`,
      );
      for (const f of failures) {
        console.error(`  ${ansi.red("✗")} ${f.name}: ${f.error}`);
      }
      if (args.flags.library) {
        process.exitCode = 1;
      }
    }

    if (args.flags.machine) {
      restoreConsole?.();
      const enriched = results.map((r) => ({
        name: r.name,
        path: r.path,
        version: r.version,
        provider: r.provider,
        source: r.source,
        resolution_source: resolutionSource,
      }));
      console.log(
        formatMachineOutput(
          "install",
          enriched.length === 1 ? enriched[0] : enriched,
          startTime,
        ),
      );
    } else if (args.flags.json) {
      const enriched = results.map((r) => ({
        ...r,
        resolutionSource: resolutionSource,
      }));
      console.log(
        JSON.stringify(enriched.length === 1 ? enriched[0] : enriched, null, 2),
      );
    } else if (results.length === 1) {
      console.error(
        ansi.green(
          `\nDone! Installed "${results[0].name}" to ${results[0].path}`,
        ),
      );
    } else if (results.length > 0) {
      console.error(
        `\n${ansi.green(`Done! Installed ${results.length} skill(s) successfully.`)}`,
      );
    }
  } catch (err: any) {
    // Remove signal handlers
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);

    if (args.flags.machine) {
      restoreConsole?.();
      console.log(
        formatMachineError(
          "install",
          ErrorCodes.INSTALL_FAILED,
          err.message,
          startTime,
          err?.duplicates ? { duplicates: err.duplicates } : undefined,
        ),
      );
    } else if (args.flags.json) {
      const payload: Record<string, unknown> = {
        success: false,
        error: err.message,
      };
      if (err?.duplicates) {
        payload.duplicates = err.duplicates;
      }
      console.log(JSON.stringify(payload, null, 2));
    } else {
      error(err.message);
    }
    process.exit(1);
  } finally {
    if (tempDir) {
      await cleanupTemp(tempDir);
    }
    restoreConsole?.();
  }
}
