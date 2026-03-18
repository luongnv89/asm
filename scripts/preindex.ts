#!/usr/bin/env bun

/**
 * Pre-index script: clones all repos from the curated list and generates
 * index JSON files into data/skill-index/ so they ship with the npm package.
 *
 * Usage: bun run scripts/preindex.ts
 */

import { resolve, join } from "path";
import { mkdirSync } from "fs";
import { copyFile } from "fs/promises";
import { ingestRepo } from "../src/ingester";
import { getIndexDir } from "../src/config";

const root = resolve(import.meta.dir, "..");
const outputDir = resolve(root, "data", "skill-index");

// Curated repos from README — same order as the table
const CURATED_REPOS = [
  "github:anthropics/skills",
  "github:obra/superpowers",
  "github:affaan-m/everything-claude-code",
  "github:msitarzewski/agency-agents",
  "github:nextlevelbuilder/ui-ux-pro-max-skill",
  "github:sickn33/antigravity-awesome-skills",
  "github:coreyhaines31/marketingskills",
  "github:agentskills/agentskills",
  "github:Leonxlnx/taste-skill",
  "github:Affitor/affiliate-skills",
  "github:luongnv89/skills",
];

async function main() {
  // Ensure output directory exists and is clean
  mkdirSync(outputDir, { recursive: true });

  console.log(`Pre-indexing ${CURATED_REPOS.length} repos into ${outputDir}\n`);

  let succeeded = 0;
  let failed = 0;

  for (const repo of CURATED_REPOS) {
    process.stdout.write(`  ${repo} ... `);
    const result = await ingestRepo(repo);

    if (result.success && result.repoIndex) {
      // ingestRepo writes to ~/.config/..., we need to copy to data/
      const srcFile = join(
        getIndexDir(),
        `${result.repoIndex.owner}_${result.repoIndex.repo}.json`,
      );
      const destFile = join(
        outputDir,
        `${result.repoIndex.owner}_${result.repoIndex.repo}.json`,
      );
      await copyFile(srcFile, destFile);
      console.log(`${result.repoIndex.skillCount} skills`);
      succeeded++;
    } else {
      console.log(`FAILED: ${result.error}`);
      failed++;
    }
  }

  console.log(
    `\nDone: ${succeeded} succeeded, ${failed} failed, output in data/skill-index/`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main();
