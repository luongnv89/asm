import { formatJSON, ansi, wordWrap } from "../formatter";
import { ingestRepo, listIndexedRepos, removeRepoIndex } from "../ingester";
import {
  getTotalSkillCount,
  getMissingMetadataFields,
  searchSkills as searchIndexSkills,
} from "../skill-index";
import type { SearchFilters } from "../skill-index";

import { error, readLine } from "./shared";
import type { ParsedArgs } from "../cli";

function printIndexHelp() {
  console.log(`${ansi.bold("Usage:")} asm index <subcommand> [options]

Manage the skill index for searching available skills from indexed repos.

${ansi.bold("Subcommands:")}
  ingest <repo>     Ingest a skill repository into the index
  search <query>   Search indexed skills by name or description
  list             List all indexed repositories
  remove <owner/repo>  Remove a repo from the index

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
    error("Missing subcommand. Use: ingest, search, list, or remove");
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

    default:
      error(`Unknown subcommand: "${subcommand}"`);
      console.error(`Run "asm index --help" for usage.`);
      process.exit(2);
  }
}

// ─── Bundle ────────────────────────────────────────────────────────────────
