#!/usr/bin/env node
/**
 * Enrich existing `data/skill-index/*.json` files with `tokenCount` and
 * `evalSummary` fields for every indexed skill.
 *
 * This is a one-shot migration helper for issue #188 (token count) and
 * #187 (eval scores). It clones each repo (same codepath as preindex),
 * reads each SKILL.md, computes the heuristic token count and runs the
 * evaluator, and writes the enriched index back in place.
 *
 * Use it once after landing the initial pipeline changes so the website,
 * TUI, and CLI inspect start showing values immediately without a full
 * re-ingest. `preindex` already produces the same fields end-to-end for
 * new runs.
 *
 * Usage:
 *   bun run scripts/enrich-index.ts
 *   bun run scripts/enrich-index.ts --only anthropics/skills
 */

import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { readFile } from "fs/promises";
import { cloneToTemp, cleanupTemp, parseSource } from "../src/installer";
import { estimateTokenCount } from "../src/utils/token-count";
import { evaluateSkillContent } from "../src/evaluator";
import type { RepoIndex, SkillEvalSummary } from "../src/utils/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexDir = resolve(root, "data", "skill-index");

function parseArgs() {
  const args = process.argv.slice(2);
  let only: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--only" && args[i + 1]) {
      only = args[i + 1];
      i++;
    }
  }
  return { only };
}

async function enrichSkill(
  tempDir: string,
  relPath: string,
  version: string,
): Promise<{ tokenCount: number; evalSummary?: SkillEvalSummary } | null> {
  const skillMdPath = join(tempDir, relPath, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    return null;
  }
  const tokenCount = estimateTokenCount(content);

  let evalSummary: SkillEvalSummary | undefined;
  try {
    const report = evaluateSkillContent({
      content,
      skillPath: relPath || "skill",
      skillMdPath,
    });
    evalSummary = {
      overallScore: report.overallScore,
      grade: report.grade,
      categories: report.categories.map((c) => ({
        id: c.id,
        name: c.name,
        score: c.score,
        max: c.max,
      })),
      evaluatedAt: report.evaluatedAt,
      evaluatedVersion: version || undefined,
    };
  } catch {
    // Eval is best-effort
  }

  return { tokenCount, evalSummary };
}

async function enrichFile(filePath: string): Promise<{
  file: string;
  enriched: number;
  skipped: number;
}> {
  const fileName = filePath.split("/").pop()!;
  const raw = readFileSync(filePath, "utf-8");
  const data: RepoIndex = JSON.parse(raw);
  if (!data.skills || data.skills.length === 0) {
    return { file: fileName, enriched: 0, skipped: 0 };
  }

  let source;
  try {
    source = parseSource(`github:${data.owner}/${data.repo}`);
  } catch (e) {
    console.error(`  skip: could not parse source — ${e}`);
    return { file: fileName, enriched: 0, skipped: data.skills.length };
  }

  let tempDir: string | null = null;
  let enriched = 0;
  let skipped = 0;
  try {
    tempDir = await cloneToTemp(source);
    for (const skill of data.skills) {
      const result = await enrichSkill(tempDir, skill.relPath, skill.version);
      if (!result) {
        skipped++;
        continue;
      }
      skill.tokenCount = result.tokenCount;
      if (result.evalSummary) {
        skill.evalSummary = result.evalSummary;
      }
      enriched++;
    }
  } catch (e) {
    console.error(`  skip: clone failed — ${(e as Error).message}`);
    skipped = data.skills.length;
  } finally {
    if (tempDir) await cleanupTemp(tempDir);
  }

  data.updatedAt = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  return { file: fileName, enriched, skipped };
}

async function main() {
  const { only } = parseArgs();

  const files = readdirSync(indexDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(indexDir, f));

  let onlyKey: string | null = null;
  if (only) {
    // Match either "owner/repo" or "owner_repo"
    onlyKey = only.replace("/", "_");
  }

  console.log(
    `Enriching ${files.length} index file(s) in ${indexDir}${only ? ` (filter: ${only})` : ""}\n`,
  );

  let total = 0;
  let totalEnriched = 0;
  let totalSkipped = 0;

  for (const file of files) {
    const base = file
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    if (onlyKey && base !== onlyKey) continue;
    total++;
    process.stdout.write(`  ${base} ... `);
    const result = await enrichFile(file);
    totalEnriched += result.enriched;
    totalSkipped += result.skipped;
    console.log(`${result.enriched} enriched, ${result.skipped} skipped`);
  }

  console.log(
    `\nDone: ${totalEnriched} skills enriched, ${totalSkipped} skipped across ${total} repo(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
