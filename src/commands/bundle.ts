import { loadConfig } from "../config";
import { scanAllSkills } from "../scanner";
import { ansi } from "../formatter";
import {
  parseSource,
  sanitizeName,
  assertNoParentSegments,
  assertPathInsideRoot,
  checkGitAvailable,
  cloneToTemp,
  validateSkill,
  executeInstall,
  cleanupTemp,
  resolveProvider,
  buildInstallPlan,
  checkConflict,
} from "../installer";
import { checkboxPicker } from "../utils/checkbox-picker";
import {
  buildBundle,
  skillInfoToRef,
  saveBundle,
  loadBundle,
  listBundles,
  listPredefinedBundles,
  removeBundle,
} from "../bundler";
import type { BundleSkillRef } from "../utils/types";
import { join as joinPath } from "path";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printBundleHelp() {
  console.log(`${ansi.bold("Usage:")} asm bundle <subcommand> [options]

Create, install, and manage curated skill bundles. A bundle is a reusable
recipe of skills for a particular workflow, domain, or project setup.

${ansi.bold("Subcommands:")}
  create <name>          Create a new bundle from installed skills
  install <name|file>    Install all skills from a bundle (supports pre-defined names)
  list                   List all saved bundles
  list --predefined      List pre-defined bundles shipped with ASM
  show <name|file>       Show bundle details
  remove <name>          Remove a saved bundle
  modify <name>          Add/remove skills or update bundle metadata
  export <name> [file]   Export a bundle to a JSON file

${ansi.bold("Options:")}
  -s, --scope <s>      Filter: global, project, or both (default: both)
  -y, --yes            Skip confirmation prompts
  --json               Output as JSON
  --predefined         Show pre-defined bundles shipped with ASM (for list)
  --no-color           Disable ANSI colors
  -V, --verbose        Show debug output

${ansi.bold("Examples:")}
  asm bundle create my-workflow                ${ansi.dim("Create from installed skills")}
  asm bundle install my-workflow               ${ansi.dim("Install a saved bundle")}
  asm bundle install frontend-dev              ${ansi.dim("Install a pre-defined bundle")}
  asm bundle install ./bundle.json             ${ansi.dim("Install from file")}
  asm bundle list                              ${ansi.dim("Show all saved bundles")}
  asm bundle list --predefined                 ${ansi.dim("List pre-defined bundles")}
  asm bundle list --json                       ${ansi.dim("List bundles as JSON")}
  asm bundle show my-workflow                  ${ansi.dim("Show bundle details")}
  asm bundle remove my-workflow                ${ansi.dim("Remove a saved bundle")}
  asm bundle modify my-workflow --add github:u/r  ${ansi.dim("Add a skill to bundle")}
  asm bundle modify my-workflow --remove skill    ${ansi.dim("Remove a skill from bundle")}
  asm bundle export my-workflow                  ${ansi.dim("Export to ./my-workflow.json")}
  asm bundle export my-workflow out.json         ${ansi.dim("Export bundle to file")}`);
}

export async function cmdBundle(args: ParsedArgs) {
  if (args.flags.help) {
    printBundleHelp();
    return;
  }

  const subcommand = args.subcommand;

  if (!subcommand) {
    error(
      "Missing subcommand. Use: create, install, list, show, remove, modify, or export",
    );
    console.error(`Run "asm bundle --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "create": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(`Usage: asm bundle create <name>`);
        process.exit(2);
      }

      // Scan installed skills
      const config = await loadConfig();
      const allSkills = await scanAllSkills(config, args.flags.scope);

      if (allSkills.length === 0) {
        error("No skills found to include in the bundle.");
        process.exit(1);
      }

      // Deduplicate by name (keep first occurrence)
      const seen = new Set<string>();
      const uniqueSkills = allSkills.filter((s) => {
        const key = s.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let selectedSkills = uniqueSkills;

      // Interactive selection if TTY and not --yes
      if (process.stdin.isTTY && !args.flags.yes) {
        const items = uniqueSkills.map((s) => ({
          label: `${s.name} v${s.version}`,
          hint: s.description
            ? s.description.slice(0, 60) +
              (s.description.length > 60 ? "..." : "")
            : `(${s.provider}/${s.scope})`,
          checked: true,
        }));

        console.error(ansi.bold(`Select skills for bundle "${bundleName}":\n`));
        const indices = await checkboxPicker({ items });

        if (indices.length === 0) {
          error("No skills selected. Bundle not created.");
          process.exit(1);
        }

        selectedSkills = indices.map((i) => uniqueSkills[i]);
      }

      // Build skill refs (read lock once and pass to all calls)
      const { readLock } = await import("../utils/lock");
      const lockData = await readLock();
      const skillRefs: BundleSkillRef[] = await Promise.all(
        selectedSkills.map((s) => skillInfoToRef(s, lockData)),
      );

      // Prompt for description (or use default)
      let description = `Bundle of ${skillRefs.length} skills`;
      let author = "unknown";
      try {
        const { execSync } = await import("child_process");
        const gitUser = execSync("git config user.name", {
          encoding: "utf-8",
        }).trim();
        if (gitUser) author = gitUser;
      } catch {
        // git not available or user.name not set; keep "unknown"
      }

      if (process.stdin.isTTY && !args.flags.yes) {
        process.stderr.write(
          `\n${ansi.bold("Description")} (optional, press Enter to skip): `,
        );
        const descAnswer = await readLine();
        if (descAnswer.trim()) {
          description = descAnswer.trim();
        }

        process.stderr.write(
          `${ansi.bold("Author")} (optional, press Enter to skip): `,
        );
        const authorAnswer = await readLine();
        if (authorAnswer.trim()) {
          author = authorAnswer.trim();
        }
      }

      const bundle = buildBundle(bundleName, description, author, skillRefs);

      const savedPath = await saveBundle(bundle);

      if (args.flags.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.error(
          ansi.green(
            `Bundle "${bundleName}" created with ${skillRefs.length} skill(s).`,
          ),
        );
        console.error(`  Saved to: ${ansi.dim(savedPath)}`);
      }
      break;
    }

    case "install": {
      const nameOrPath = args.positional[0];
      if (!nameOrPath) {
        error("Missing required argument: <name|file>");
        console.error(`Usage: asm bundle install <name|file>`);
        process.exit(2);
      }

      let bundle;
      try {
        bundle = await loadBundle(nameOrPath);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      console.error(
        `${ansi.bold("Bundle:")} ${bundle.name} (${bundle.skills.length} skills)`,
      );
      if (bundle.description) {
        console.error(`  ${ansi.dim(bundle.description)}`);
      }
      console.error("");

      // Show skills to install
      for (const skill of bundle.skills) {
        const versionTag = skill.version ? ` v${skill.version}` : "";
        console.error(
          `  ${ansi.cyan(skill.name)}${ansi.dim(versionTag)} ${ansi.dim(`-> ${skill.installUrl}`)}`,
        );
      }

      // Confirm
      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `\n${ansi.bold("Install all skills from this bundle?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      // Install each skill
      const results: Array<{
        name: string;
        status: "installed" | "skipped" | "failed";
        reason?: string;
      }> = [];

      const config = await loadConfig();
      const { provider } = await resolveProvider(
        config,
        args.flags.provider,
        false, // non-interactive for batch
      );

      const installScope: "global" | "project" =
        args.flags.scope === "global" || args.flags.scope === "project"
          ? args.flags.scope
          : "global";

      for (const skill of bundle.skills) {
        console.error(`\n  Installing ${ansi.bold(skill.name)}...`);
        try {
          // Check if git is available for remote installs
          const isRemote =
            skill.installUrl.startsWith("github:") ||
            skill.installUrl.startsWith("https://github.com/");

          if (isRemote) {
            await checkGitAvailable();
          }

          const source = parseSource(skill.installUrl);
          const isLocal = !!source.isLocal;
          let tempDir: string | null = null;

          try {
            let rootDir: string;
            let skillDir: string;

            if (!isLocal) {
              assertNoParentSegments(source, skill.installUrl);
              tempDir = await cloneToTemp(source, args.flags.transport);
              rootDir = tempDir;
              skillDir = source.subpath
                ? joinPath(tempDir, source.subpath)
                : tempDir;
              try {
                assertPathInsideRoot(tempDir, skillDir, skill.installUrl);
              } catch (guardErr) {
                await cleanupTemp(tempDir);
                tempDir = null;
                throw guardErr;
              }
            } else {
              rootDir = source.localPath!;
              skillDir = source.localPath!;
            }

            const metadata = await validateSkill(skillDir);
            const skillName = sanitizeName(
              skill.name || metadata.name || source.repo,
            );

            const plan = buildInstallPlan(
              source,
              rootDir,
              skillDir,
              skillName,
              provider,
              args.flags.force,
              installScope,
            );

            // Check if skill already exists; skip unless --force
            try {
              await checkConflict(plan.targetDir, plan.force);
            } catch (conflictErr: any) {
              if (conflictErr.message?.includes("--force")) {
                results.push({
                  name: skill.name,
                  status: "skipped",
                  reason: "Already installed. Use --force to overwrite.",
                });
                console.error(
                  `    ${ansi.dim("---")} ${skill.name} skipped (already installed)`,
                );
                continue;
              }
              throw conflictErr;
            }

            await executeInstall(plan);
            results.push({ name: skill.name, status: "installed" });
            console.error(`    ${ansi.green("+++")} ${skill.name} installed`);
          } finally {
            if (tempDir) {
              await cleanupTemp(tempDir);
            }
          }
        } catch (err: any) {
          results.push({
            name: skill.name,
            status: "failed",
            reason: err.message,
          });
          console.error(`    ${ansi.red("!!!")} ${skill.name}: ${err.message}`);
        }
      }

      // Summary
      const installed = results.filter((r) => r.status === "installed").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const failed = results.filter((r) => r.status === "failed").length;

      if (args.flags.json) {
        console.log(
          JSON.stringify(
            {
              bundleName: bundle.name,
              total: results.length,
              installed,
              skipped,
              failed,
              results,
            },
            null,
            2,
          ),
        );
      } else {
        console.error("");
        console.error(
          `${ansi.bold("Summary:")} ${results.length} total, ` +
            `${ansi.green(String(installed))} installed, ` +
            (skipped > 0 ? `${ansi.dim(String(skipped))} skipped, ` : "") +
            `${ansi.red(String(failed))} failed`,
        );
      }

      if (failed > 0) {
        process.exitCode = 1;
      }
      break;
    }

    case "list": {
      const showPredefined = Boolean(args.flags.predefined);

      if (showPredefined) {
        const predefinedBundles = await listPredefinedBundles();

        if (predefinedBundles.length === 0) {
          if (args.flags.json) {
            console.log("[]");
          } else {
            console.log("No predefined bundles found.");
          }
          return;
        }

        if (args.flags.json) {
          console.log(JSON.stringify(predefinedBundles, null, 2));
        } else {
          console.error(
            ansi.bold(`Pre-defined Bundles (${predefinedBundles.length}):\n`),
          );
          for (const bundle of predefinedBundles) {
            const tagsStr =
              bundle.tags && bundle.tags.length > 0
                ? ` ${ansi.dim(`[${bundle.tags.join(", ")}]`)}`
                : "";
            console.error(
              `  ${ansi.cyan(bundle.name)} ${ansi.dim(`(${bundle.skills.length} skills)`)}${tagsStr}`,
            );
            if (bundle.description) {
              console.error(`    ${ansi.dim(bundle.description)}`);
            }
          }
          console.error(
            `\n${ansi.dim("Install a bundle with: asm bundle install <name>")}`,
          );
        }
        return;
      }

      const bundles = await listBundles();

      if (bundles.length === 0) {
        if (args.flags.json) {
          console.log("[]");
        } else {
          console.log("No bundles found.");
          console.error(ansi.dim("Create one with: asm bundle create <name>"));
          console.error(
            ansi.dim(
              "List pre-defined bundles with: asm bundle list --predefined",
            ),
          );
        }
        return;
      }

      if (args.flags.json) {
        console.log(JSON.stringify(bundles, null, 2));
      } else {
        console.error(ansi.bold(`Saved Bundles (${bundles.length}):\n`));
        for (const bundle of bundles) {
          const tagsStr =
            bundle.tags && bundle.tags.length > 0
              ? ` ${ansi.dim(`[${bundle.tags.join(", ")}]`)}`
              : "";
          console.error(
            `  ${ansi.cyan(bundle.name)} ${ansi.dim(`(${bundle.skills.length} skills)`)}${tagsStr}`,
          );
          if (bundle.description) {
            console.error(`    ${ansi.dim(bundle.description)}`);
          }
          if (bundle.author) {
            console.error(`    ${ansi.dim(`by ${bundle.author}`)}`);
          }
        }
      }
      break;
    }

    case "show": {
      const nameOrPath = args.positional[0];
      if (!nameOrPath) {
        error("Missing required argument: <name|file>");
        console.error(`Usage: asm bundle show <name|file>`);
        process.exit(2);
      }

      let bundle;
      try {
        bundle = await loadBundle(nameOrPath);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      if (args.flags.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.error(ansi.bold(`Bundle: ${bundle.name}`));
        if (bundle.description) {
          console.error(`  ${bundle.description}`);
        }
        if (bundle.author) {
          console.error(`  ${ansi.dim(`Author: ${bundle.author}`)}`);
        }
        console.error(
          `  ${ansi.dim(`Created: ${new Date(bundle.createdAt).toLocaleString()}`)}`,
        );
        if (bundle.tags && bundle.tags.length > 0) {
          console.error(`  ${ansi.dim(`Tags: ${bundle.tags.join(", ")}`)}`);
        }
        console.error(`\n  ${ansi.bold(`Skills (${bundle.skills.length})`)}:`);
        for (const skill of bundle.skills) {
          const versionTag = skill.version ? ` v${skill.version}` : "";
          console.error(`    ${ansi.cyan(skill.name)}${ansi.dim(versionTag)}`);
          if (skill.description) {
            console.error(`      ${ansi.dim(skill.description)}`);
          }
          console.error(`      ${ansi.dim(`install: ${skill.installUrl}`)}`);
        }
      }
      break;
    }

    case "remove": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(`Usage: asm bundle remove <name>`);
        process.exit(2);
      }

      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `${ansi.bold("Remove bundle")} ${ansi.cyan(bundleName)}${ansi.bold("?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      let removed: boolean;
      try {
        removed = await removeBundle(bundleName);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      if (removed) {
        console.error(ansi.green(`Bundle "${bundleName}" removed.`));
      } else {
        error(`Bundle "${bundleName}" not found.`);
        process.exit(1);
      }
      break;
    }

    case "modify": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(
          `Usage: asm bundle modify <name> [--add <installUrl>] [--remove <skillName>] [--description <desc>] [--author <author>] [--tags <tag,...>]`,
        );
        process.exit(2);
      }

      let bundle: import("../utils/types").BundleManifest;
      try {
        bundle = await loadBundle(bundleName);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      let modified = false;

      // --add <installUrl>
      const addUrl = args.flags.add;
      if (addUrl) {
        const newSkillRef: BundleSkillRef = {
          name:
            addUrl
              .split("/")
              .pop()
              ?.replace(/\.json$/, "") ?? addUrl,
          installUrl: addUrl,
        };
        bundle.skills.push(newSkillRef);
        modified = true;
        console.error(ansi.green(`Added skill from ${addUrl}`));
      }

      // --remove <skillName>
      const removeSkill = args.flags.remove;
      if (removeSkill) {
        const before = bundle.skills.length;
        bundle.skills = bundle.skills.filter(
          (s) => s.name.toLowerCase() !== removeSkill.toLowerCase(),
        );
        if (bundle.skills.length < before) {
          modified = true;
          console.error(ansi.green(`Removed skill "${removeSkill}"`));
        } else {
          console.error(
            ansi.dim(`Skill "${removeSkill}" not found in bundle (no change)`),
          );
        }
      }

      // --description <desc>
      const newDescription = args.flags.description;
      if (newDescription !== null) {
        bundle.description = newDescription;
        modified = true;
      }

      // --author <author>
      const newAuthor = args.flags.author;
      if (newAuthor !== null) {
        bundle.author = newAuthor;
        modified = true;
      }

      // --tags <comma-separated>
      const newTags = args.flags.tags;
      if (newTags !== null) {
        bundle.tags = newTags
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        modified = true;
      }

      // Interactive flow when TTY and no flags given
      if (
        !modified &&
        process.stdin.isTTY &&
        !args.flags.yes &&
        !addUrl &&
        !removeSkill &&
        newDescription === null &&
        newAuthor === null &&
        newTags === null
      ) {
        console.error(ansi.bold(`Modifying bundle "${bundle.name}"`));
        console.error(
          `  Current skills: ${bundle.skills.map((s) => s.name).join(", ")}`,
        );
        console.error(`  Description: ${bundle.description}`);
        console.error(`  Author: ${bundle.author}`);
        console.error(`  Tags: ${bundle.tags?.join(", ") ?? "(none)"}`);
        console.error(``);

        process.stderr.write(
          `${ansi.bold("New description")} (Enter to keep current): `,
        );
        const descInput = await readLine();
        if (descInput.trim()) {
          bundle.description = descInput.trim();
          modified = true;
        }

        process.stderr.write(
          `${ansi.bold("New author")} (Enter to keep current): `,
        );
        const authorInput = await readLine();
        if (authorInput.trim()) {
          bundle.author = authorInput.trim();
          modified = true;
        }

        process.stderr.write(
          `${ansi.bold("New tags (comma-separated)")} (Enter to keep current): `,
        );
        const tagsInput = await readLine();
        if (tagsInput.trim()) {
          bundle.tags = tagsInput
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
          modified = true;
        }
      }

      if (!modified) {
        console.error(ansi.dim("No changes made to bundle."));
        break;
      }

      // Validate resulting bundle has at least one skill
      if (bundle.skills.length === 0) {
        error("Bundle must contain at least one skill after modification.");
        process.exit(1);
      }

      const savedPath = await saveBundle(bundle);

      if (args.flags.json) {
        console.log(JSON.stringify(bundle, null, 2));
      } else {
        console.error(
          ansi.green(
            `Bundle "${bundle.name}" updated (${bundle.skills.length} skill(s)).`,
          ),
        );
        console.error(`  Saved to: ${ansi.dim(savedPath)}`);
      }
      break;
    }

    case "export": {
      const bundleName = args.positional[0];
      if (!bundleName) {
        error("Missing required argument: <name>");
        console.error(`Usage: asm bundle export <name> [output-file]`);
        process.exit(2);
      }

      let bundle: import("../utils/types").BundleManifest;
      try {
        bundle = await loadBundle(bundleName);
      } catch (err: any) {
        error(err.message);
        process.exit(1);
      }

      const outputFile =
        (args.positional[1] as string | undefined) ?? `./${bundleName}.json`;

      const { resolve: resolvePath } = await import("path");
      const absOutputPath = resolvePath(outputFile);

      // Check if file exists (unless --force)
      if (!args.flags.force) {
        const { access: fsAccess } = await import("fs/promises");
        try {
          await fsAccess(absOutputPath);
          // File exists — prompt or error
          if (process.stdin.isTTY && !args.flags.yes) {
            process.stderr.write(
              `File ${ansi.bold(absOutputPath)} already exists. Overwrite? [y/N] `,
            );
            const answer = await readLine();
            if (
              answer.toLowerCase() !== "y" &&
              answer.toLowerCase() !== "yes"
            ) {
              console.error("Aborted.");
              process.exit(0);
            }
          } else if (!args.flags.yes) {
            error(
              `File "${absOutputPath}" already exists. Use --force to overwrite.`,
            );
            process.exit(1);
          }
        } catch {
          // File does not exist — proceed
        }
      }

      const { writeFile: fsWriteFile } = await import("fs/promises");
      await fsWriteFile(
        absOutputPath,
        JSON.stringify(bundle, null, 2) + "\n",
        "utf-8",
      );

      if (args.flags.json) {
        console.log(
          JSON.stringify(
            { exported: true, path: absOutputPath, bundle },
            null,
            2,
          ),
        );
      } else {
        console.error(ansi.green(`Exported to ${absOutputPath}`));
      }
      break;
    }

    default:
      error(
        `Unknown subcommand: "${subcommand}". Use: create, install, list, show, remove, modify, or export`,
      );
      console.error(`Run "asm bundle --help" for usage.`);
      process.exit(2);
  }
}

// ─── Publish ────────────────────────────────────────────────────────────────
