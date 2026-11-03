import { ansi } from "../formatter";
import {
  listLibrarySkills,
  updateLibrarySkills,
  type LibrarySkillInfo,
} from "../library";
import { loadLibrarySkills, type LibrarySkill } from "../library-skills";
import {
  effectiveSkillTags,
  loadSkillTagState,
  matchesAllTags,
  parseTagInputs,
} from "../skill-tags";

import { error } from "./shared";
import type { ParsedArgs } from "../cli";

/** A `library list` row plus the tags resolved for it. */
type LibraryListRow = LibrarySkillInfo & { tags: string[] };

function printLibraryHelp() {
  console.log(`${ansi.bold("Usage:")} asm library <subcommand> [options]

Manage centrally installed library skills.

${ansi.bold("Subcommands:")}
  list                 List skills installed in the local library
  update <skill>       Update one local library skill
  update --all         Update all local library skills

${ansi.bold("Options:")}
  --tag <tag[,tag]>   Require every tag; repeatable, list only
  --json              Output as JSON
  -V, --verbose       Show debug output

${ansi.bold("Examples:")}
  asm library list                  ${ansi.dim("List local library skills")}
  asm library list --tag docs       ${ansi.dim("List library skills tagged docs")}
  asm library update brainstorming  ${ansi.dim("Update one local library skill")}
  asm library update --all --json   ${ansi.dim("Update all and output as JSON")}`);
}

/**
 * Lock rows plus each row's effective tags.
 *
 * Tags are the SKILL.md frontmatter tags merged with the local
 * `skill-tags.json` overlay (`effectiveSkillTags`). The overlay is keyed by
 * canonical path, so the lookup uses the `realPath` from `loadLibrarySkills`:
 * an activated library skill is symlinked into a provider directory and its
 * scanned tag record resolves to the same canonical library path.
 *
 * Rows whose library copy is gone (`missing`) are kept — `library list` has
 * always shown them — but expose `tags: []`: there is no SKILL.md to read and
 * no directory to resolve, so an overlay entry cannot be keyed soundly. Such
 * rows therefore never match a `--tag` filter.
 */
async function listLibraryRows(): Promise<LibraryListRow[]> {
  const [lockRows, librarySkills, tagState] = await Promise.all([
    listLibrarySkills(),
    loadLibrarySkills(),
    loadSkillTagState(),
  ]);
  const libraryByDir = new Map<string, LibrarySkill>();
  for (const skill of librarySkills) libraryByDir.set(skill.dirName, skill);

  return lockRows.map((row) => {
    const librarySkill = libraryByDir.get(row.dirName);
    const tags = librarySkill
      ? effectiveSkillTags(
          librarySkill.tags,
          tagState.skills[librarySkill.realPath],
        )
      : [];
    return { ...row, tags };
  });
}

export async function cmdLibrary(args: ParsedArgs) {
  if (args.flags.help) {
    printLibraryHelp();
    return;
  }

  if (args.subcommand === "update") {
    await cmdLibraryUpdate(args);
    return;
  }

  if (args.subcommand === "list") {
    const parsedTags = parseTagInputs(args.flags.tagFilters);
    if (parsedTags.invalid.length > 0) {
      error(
        `Invalid tag value(s): ${parsedTags.invalid.map((tag) => JSON.stringify(tag)).join(", ")}.`,
      );
      process.exitCode = 2;
      return;
    }

    let rows = await listLibraryRows();
    if (parsedTags.tags.length > 0) {
      rows = rows.filter((row) => matchesAllTags(row.tags, parsedTags.tags));
    }

    if (args.flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    printLibraryList(rows);
    return;
  }

  error(
    "Missing or unknown library subcommand. Use: asm library list or asm library update",
  );
  console.error(`Run "asm library --help" for usage.`);
  process.exit(2);
}

function printLibraryList(rows: LibraryListRow[]) {
  if (rows.length === 0) {
    console.log(ansi.dim("No skills installed in the local library."));
    return;
  }

  const widths = {
    name: Math.max("Name".length, ...rows.map((r) => r.name.length)),
    version: Math.max("Version".length, ...rows.map((r) => r.version.length)),
    source: Math.max("Source".length, ...rows.map((r) => r.source.length)),
    path: Math.max("Path".length, ...rows.map((r) => r.skillPath.length)),
    status: "Status".length,
  };
  const formatRow = (
    name: string,
    version: string,
    source: string,
    path: string,
    status: string,
  ) =>
    [
      name.padEnd(widths.name),
      version.padEnd(widths.version),
      source.padEnd(widths.source),
      path.padEnd(widths.path),
      status.padEnd(widths.status),
    ].join("  ");

  const lines = [
    ansi.bold(formatRow("Name", "Version", "Source", "Path", "Status")),
    ...rows.map((row) =>
      formatRow(
        row.name,
        row.version,
        row.source,
        row.skillPath,
        row.missing ? "missing" : "ok",
      ),
    ),
  ];
  console.log(lines.join("\n"));
}

function printLibraryUpdateHuman(
  summary: Awaited<ReturnType<typeof updateLibrarySkills>>,
) {
  for (const result of summary.results) {
    if (result.status === "updated") {
      console.log(
        `${ansi.green("✓")} ${result.name}: ${
          result.oldVersion ?? "unknown"
        } -> ${result.newVersion ?? "unknown"}`,
      );
    } else if (result.status === "skipped") {
      console.log(
        `${ansi.yellow("-")} ${result.name}: ${result.reason ?? "skipped"}`,
      );
    } else {
      console.log(
        `${ansi.red("x")} ${result.name}: ${result.reason ?? "failed"}`,
      );
    }
  }

  console.log(
    `${summary.updatedCount} updated, ${summary.skippedCount} skipped, ${summary.failedCount} failed`,
  );
}

export async function cmdLibraryUpdate(args: ParsedArgs) {
  const names = [...args.positional];

  if (!args.flags.all && names.length === 0) {
    error(
      "Missing skill name. Use: asm library update <skill> or asm library update --all",
    );
    process.exit(2);
  }
  if (args.flags.all && names.length > 0) {
    error(
      "Use either asm library update <skill> or asm library update --all, not both.",
    );
    process.exit(2);
  }

  const summary = await updateLibrarySkills(args.flags.all ? null : names);

  if (args.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printLibraryUpdateHuman(summary);
  }

  if (summary.failedCount > 0) {
    process.exit(1);
  }
}
