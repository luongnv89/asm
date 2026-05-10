#!/usr/bin/env node
/**
 * Backfill repo-derived bundles into existing data/skill-index/*.json files.
 *
 * Future preindex runs create these during ingest. This script lets us refresh
 * the already checked-in index without recloning every upstream repo.
 */
import { readdir, readFile, writeFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { inferRepoBundles } from "../src/repo-bundles";
import type { RepoIndex } from "../src/utils/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexDir = join(root, "data", "skill-index");

async function main() {
  const files = (await readdir(indexDir)).filter((file) => file.endsWith(".json")).sort();
  let updated = 0;
  let bundleCount = 0;

  for (const file of files) {
    const filePath = join(indexDir, file);
    const repoIndex = JSON.parse(await readFile(filePath, "utf-8")) as RepoIndex;
    const inferred = inferRepoBundles(repoIndex);
    const next: RepoIndex = { ...repoIndex };

    if (inferred.length > 0) {
      next.bundles = inferred;
      bundleCount += inferred.length;
    } else {
      delete next.bundles;
    }

    const before = JSON.stringify(repoIndex, null, 2) + "\n";
    const after = JSON.stringify(next, null, 2) + "\n";
    if (before !== after) {
      await writeFile(filePath, after, "utf-8");
      updated++;
    }
  }

  console.log(`Refreshed repo-derived bundles: ${bundleCount} bundles across ${updated} index files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
