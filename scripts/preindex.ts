#!/usr/bin/env node

/**
 * Pre-index script: clones all repos from the curated list and generates
 * index JSON files into data/skill-index/ so they ship with the npm package.
 *
 * Reads the curated repo list from data/skill-index-resources.json.
 *
 * Usage: node --experimental-strip-types scripts/preindex.ts
 */

import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, readFileSync } from "fs";
import { copyFile } from "fs/promises";
import { ingestRepo } from "../src/ingester";
import { getIndexDir } from "../src/config";
import type { SkillIndexResources } from "../src/utils/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "data", "skill-index");
const resourcesPath = resolve(root, "data", "skill-index-resources.json");

function loadResources(): string[] {
  const raw = readFileSync(resourcesPath, "utf-8");
  const data: SkillIndexResources = JSON.parse(raw);
  return data.repos.filter((r) => r.enabled).map((r) => r.source);
}

async function main() {
  const repos = loadResources();

  // Ensure output directory exists and is clean
  mkdirSync(outputDir, { recursive: true });

  console.log(`Pre-indexing ${repos.length} repos into ${outputDir}\n`);

  let succeeded = 0;
  let failed = 0;

  for (const repo of repos) {
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
