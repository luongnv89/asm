import { formatJSON, ansi, wordWrap } from "../formatter";
import { ingestRepo, listIndexedRepos, removeRepoIndex } from "../ingester";
import {
  getTotalSkillCount,
  getMissingMetadataFields,
  searchSkills as searchIndexSkills,
  getAllIndexedSkills,
} from "../skill-index";
import type { SearchFilters } from "../skill-index";
import {
  findOverlapPairs,
  groupOverlaps,
  MIN_OVERLAP_SCORE,
  HIGH_CONFIDENCE_THRESHOLD,
} from "../semantic-overlap";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printIndexHelp() {
  console.log(`${ansi.bold("Usage:")} asm index <subcommand> [options]

Manage the skill index for searching available skills from indexed repos.

${ansi.bold("Subcommands:")}
  ingest <repo>     Ingest a skill repository into the index
  search <query>    Search indexed skills by name or description
  list             List all indexed repositories
  remove <owner/repo>  Remove a repo from the index
  overlap          Find semantically overlapping skills in the index

${ansi.bold("Options:")}
  --json           Output as JSON
  --has <field>    Only show skills that have <field> (license, creator, version)
  --missing <field> Only show skills missing <field> (license, creator, version)
  --model-invocable Only skills the model can invoke
  --user-invocable  Only skills the user can invoke
  -y, --yes        Skip confirmation prompts
  --no-color       Disable ANSI colors
  -V, --verbose    Show debug output

${ansi.bold("Examples:")}
  asm index ingest github:obra/superpowers          ${ansi.dim("Index superpowers repo")}
  asm index search code review                       ${ansi.dim("Search for skills")}
  asm index search marketing --has license           ${ansi.dim("Only with license")}
  asm index search "" --missing creator              ${ansi.dim("Skills missing creator")}
  asm index overlap                                  ${ansi.dim("Find overlapping skills")}
  asm index overlap --threshold 0.6                  ${ansi.dim("Custom threshold")}
  asm index list                                    ${ansi.dim("List indexed repos")}
  asm index remove obra/superpowers                 ${ansi.dim("Remove from index")}`);
}

export async function cmdIndex(args: ParsedArgs) {
  if (args.flags.help) {
    printIndexHelp();
    return;
  }

  const subcommand = args.subcommand;

  if (!subcommand) {
    error("Missing subcommand. Use: ingest, search, overlap, list, or remove");
    console.error(`Run "asm index --help" for usage.`);
    process.exit(2);
  }

  switch (subcommand) {
    case "ingest": {
      const repo = args.positional[0];
      if (!repo) {
        error("Missing required argument: <repo>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      console.error(ansi.blueBold(`Ingesting ${repo}...`));
      const result = await ingestRepo(repo);

      if (!result.success) {
        error(`Failed to ingest: ${result.error}`);
        process.exit(1);
      }

      if (result.repoIndex) {
        if (args.flags.json) {
          console.log(
            formatJSON({
              success: true,
              owner: result.repoIndex.owner,
              repo: result.repoIndex.repo,
              skillCount: result.repoIndex.skillCount,
              updatedAt: result.repoIndex.updatedAt,
            }),
          );
        } else {
          console.error(
            ansi.green(
              `Successfully indexed ${result.repoIndex.owner}/${result.repoIndex.repo}`,
            ),
          );
          console.error(`  Skills found: ${result.repoIndex.skillCount}`);
        }
      }
      break;
    }

    case "search": {
      const query = args.positional.join(" ");
      if (
        !query &&
        args.flags.has.length === 0 &&
        args.flags.missing.length === 0 &&
        !args.flags.modelInvocable &&
        !args.flags.userInvocable
      ) {
        error("Missing required argument: <query>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      const filters: SearchFilters = {};
      if (args.flags.has.length > 0) {
        filters.has = args.flags.has;
      }
      if (args.flags.missing.length > 0) {
        filters.missing = args.flags.missing;
      }
      if (args.flags.modelInvocable) filters.modelInvocable = true;
      if (args.flags.userInvocable) filters.userInvocable = true;

      const hasFilters =
        filters.has ||
        filters.missing ||
        filters.modelInvocable ||
        filters.userInvocable;
      const results = hasFilters
        ? await searchIndexSkills(query || "", 20, filters)
        : await searchIndexSkills(query);

      if (results.length === 0) {
        if (args.flags.json) {
          console.log(formatJSON([]));
        } else {
          console.info("No skills found matching your query.");
          console.error(
            ansi.dim("Try ingesting more repos with: asm index ingest <repo>"),
          );
        }
        return;
      }

      if (args.flags.json) {
        console.log(
          formatJSON(
            results.map((r) => ({
              name: r.skill.name,
              description: r.skill.description,
              version: r.skill.version,
              license: r.skill.license || "",
              creator: r.skill.creator || "",
              compatibility: r.skill.compatibility || "",
              allowedTools: r.skill.allowedTools || [],
              verified: r.skill.verified === true,
              installUrl: r.skill.installUrl,
              installCommand: `asm install ${r.skill.installUrl}`,
              repo: `${r.repo.owner}/${r.repo.repo}`,
            })),
          ),
        );
      } else {
        console.error(ansi.bold(`Found ${results.length} skills:\n`));
        for (const result of results) {
          const verifiedTag = result.skill.verified
            ? ansi.blue(" [verified]")
            : "";
          console.error(
            `${ansi.cyan(result.skill.name)} ${ansi.dim(`v${result.skill.version}`)}${verifiedTag} ${ansi.dim(`[${result.repo.owner}/${result.repo.repo}]`)}`,
          );
          for (const dl of wordWrap(result.skill.description, 80)) {
            console.error(`  ${dl}`);
          }
          const missingFields = getMissingMetadataFields(result.skill);
          if (missingFields.length > 0) {
            console.error(
              `  ${ansi.yellow(`⚠ Missing: ${missingFields.join(", ")}`)}`,
            );
          }
          console.error(
            `  ${ansi.green(`asm install ${result.skill.installUrl}`)}\n`,
          );
        }
      }
      break;
    }

    case "list": {
      const repos = await listIndexedRepos();

      if (repos.length === 0) {
        if (args.flags.json) {
          console.log(formatJSON([]));
        } else {
          console.info("No repositories indexed.");
          console.error(ansi.dim("Add repos with: asm index ingest <repo>"));
        }
        return;
      }

      const totalSkills = await getTotalSkillCount();

      if (args.flags.json) {
        console.log(formatJSON(repos));
      } else {
        console.error(
          ansi.bold(`Indexed Repositories (${totalSkills} total skills):\n`),
        );
        for (const repo of repos) {
          console.error(
            `${ansi.cyan(`${repo.owner}/${repo.repo}`)} - ${repo.skillCount} skills ${ansi.dim(`(${new Date(repo.updatedAt).toLocaleDateString()})`)}`,
          );
        }
      }
      break;
    }

    case "remove": {
      const ownerRepo = args.positional[0];
      if (!ownerRepo) {
        error("Missing required argument: <owner/repo>");
        console.error(`Run "asm index --help" for usage.`);
        process.exit(2);
      }

      const [owner, repo] = ownerRepo.split("/");
      if (!owner || !repo) {
        error("Invalid format. Use: <owner/repo>");
        process.exit(2);
      }

      if (!args.flags.yes && process.stdin.isTTY) {
        process.stderr.write(
          `${ansi.bold("Remove")} ${ansi.cyan(`${owner}/${repo}`)} ${ansi.bold("from index?")} [y/N] `,
        );
        const answer = await readLine();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.error("Aborted.");
          process.exit(0);
        }
      }

      const removed = await removeRepoIndex(owner, repo);

      if (removed) {
        console.error(ansi.green(`Removed ${owner}/${repo} from index`));
      } else {
        error(`Repository not found in index: ${owner}/${repo}`);
        process.exit(1);
      }
      break;
    }

    case "overlap": {
      // Use --threshold flag if provided, otherwise default
      const threshold = args.flags.threshold ?? MIN_OVERLAP_SCORE;
      // Cap the number of skills compared to avoid O(n²) on large indexes.
      // The default limit of 500 still finds meaningful overlaps.
      const limit = 500;

      const allSkills = await getAllIndexedSkills();

      // Cap to avoid O(n²) comparison on large indexes.
      const skillsToCompare = allSkills.slice(0, limit);

      if (skillsToCompare.length === 0) {
        if (args.flags.json) {
          console.log(formatJSON({ groups: [], pairs: [], totalSkills: 0 }));
        } else {
          console.info("No skills indexed. Run `asm index ingest` first.");
        }
        return;
      }

      // Find overlapping pairs
      const pairs = findOverlapPairs(skillsToCompare, threshold);

      if (pairs.length === 0) {
        if (args.flags.json) {
          console.log(
            formatJSON({
              groups: [],
              pairs: [],
              totalSkills: allSkills.length,
              threshold,
              message: `No overlaps found above threshold ${threshold}`,
            }),
          );
        } else {
          console.info(
            ansi.green(
              `No semantic overlaps found above threshold ${threshold} across ${allSkills.length} indexed skills (comparing top ${limit}).`,
            ),
          );
        }
        return;
      }

      // Group overlapping skills
      const groups = groupOverlaps(skillsToCompare, threshold);

      if (args.flags.json) {
        console.log(
          formatJSON({
            groups: groups.map((g) => ({
              skills: g.skills.map((s) => ({
                name: s.skill.name,
                description: s.skill.description,
                repo: `${s.repo.owner}/${s.repo.repo}`,
              })),
              maxScore: g.maxScore,
              pairCount: g.pairCount,
            })),
            pairs: pairs.map((p) => ({
              skillA: p.skillA.name,
              skillB: p.skillB.name,
              repoA: `${p.repoA.owner}/${p.repoA.repo}`,
              repoB: `${p.repoB.owner}/${p.repoB.repo}`,
              score: p.score,
              reason: p.reason,
            })),
            totalSkills: allSkills.length,
            skillsCompared: skillsToCompare.length,
            threshold,
            totalOverlappingPairs: pairs.length,
            totalOverlapGroups: groups.length,
          }),
        );
      } else {
        console.error(
          ansi.bold(
            `Found ${pairs.length} overlapping pair(s) among ${allSkills.length} indexed skills (comparing top ${limit}, threshold: ${threshold}):\n`,
          ),
        );

        if (groups.length > 0) {
          console.error(ansi.yellow(`  ${groups.length} group(s):\n`));
          for (const group of groups) {
            console.error(
              `  ${ansi.bold(`Group (max score: ${group.maxScore.toFixed(3)}, ${group.pairCount} pair(s))`)}\n`,
            );
            for (const s of group.skills) {
              const highConf =
                group.maxScore >= HIGH_CONFIDENCE_THRESHOLD
                  ? ansi.yellow(" [high overlap]")
                  : "";
              console.error(
                `    ${ansi.cyan(s.skill.name)} ${ansi.dim(`[${s.repo.owner}/${s.repo.repo}]`)}${highConf}\n`,
              );
              for (const dl of wordWrap(s.skill.description, 72)) {
                console.error(`      ${dl}`);
              }
            }
            console.error("");
          }
        }

        console.error(ansi.yellow(`  ${pairs.length} overlapping pair(s):\n`));
        for (const pair of pairs.slice(0, 20)) {
          const confidence =
            pair.score >= HIGH_CONFIDENCE_THRESHOLD
              ? ansi.red("HIGH")
              : pair.score >= MIN_OVERLAP_SCORE
                ? ansi.yellow("MED")
                : ansi.dim("LOW");
          console.error(
            `  ${confidence} ${pair.score.toFixed(3)}  ${ansi.cyan(pair.skillA.name)} ↔ ${ansi.cyan(pair.skillB.name)}\n`,
          );
          console.error(
            `        ${pair.repoA.owner}/${pair.repoA.repo}  ↔  ${pair.repoB.owner}/${pair.repoB.repo}\n`,
          );
          for (const dl of wordWrap(pair.reason, 72)) {
            console.error(`        ${dl}`);
          }
          console.error("");
        }

        if (pairs.length > 20) {
          console.error(
            ansi.dim(
              `  … and ${pairs.length - 20} more pair(s). Use --json for full list.`,
            ),
          );
        }
      }
      break;
    }

    default:
      error(`Unknown subcommand: "${subcommand}"`);
      console.error(`Run "asm index --help" for usage.`);
      process.exit(2);
  }
}

// ─── Bundle ────────────────────────────────────────────────────────────────
