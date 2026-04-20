import { writeFile, mkdir, unlink, readFile } from "fs/promises";
import { join } from "path";
import {
  parseSource,
  discoverSkills,
  cloneToTemp,
  cleanupTemp,
  checkGitAvailable,
} from "./installer";
import { getIndexDir } from "./config";
import { loadAllIndices } from "./skill-index";
import { debug } from "./logger";
import { verifySkill } from "./verifier";
import { estimateTokenCount } from "./utils/token-count";
import { evaluateSkillContent } from "./evaluator";
import type {
  RepoIndex,
  IndexedSkill,
  ParsedSource,
  SkillEvalSummary,
} from "./utils/types";

export interface IngestResult {
  success: boolean;
  repoIndex: RepoIndex | null;
  error?: string;
}

export async function ensureIndexDir(): Promise<string> {
  const indexDir = getIndexDir();
  await mkdir(indexDir, { recursive: true });
  return indexDir;
}

export async function ingestRepo(sourceInput: string): Promise<IngestResult> {
  await checkGitAvailable();

  let source: ParsedSource;
  try {
    source = parseSource(sourceInput);
  } catch (err: any) {
    return { success: false, repoIndex: null, error: err.message };
  }

  if (source.isLocal) {
    return {
      success: false,
      repoIndex: null,
      error:
        "Local paths are not supported for indexing. Use a GitHub source instead.",
    };
  }

  debug(`ingester: cloning ${source.owner}/${source.repo}`);

  let tempDir: string | null = null;
  try {
    tempDir = await cloneToTemp(source);
    debug(`ingester: discovering skills in ${tempDir}`);

    const discovered = await discoverSkills(tempDir);
    debug(`ingester: found ${discovered.length} skills`);

    const skills: IndexedSkill[] = [];
    for (const skill of discovered) {
      // Read SKILL.md content for verification
      const skillMdPath = join(tempDir, skill.relPath, "SKILL.md");
      let skillMdContent = "";
      try {
        skillMdContent = await readFile(skillMdPath, "utf-8");
      } catch {
        // If we can't read SKILL.md, the skill won't pass verification
        debug(`ingester: could not read SKILL.md at ${skillMdPath}`);
      }

      const verification = verifySkill(skill, skillMdContent);
      if (!verification.verified) {
        debug(
          `ingester: ${skill.name} not verified: ${verification.reasons.join(", ")}`,
        );
      }

      // Token count: prefer the value populated during discovery; recompute
      // here as a safe fallback when discovery did not set it (e.g., older
      // discovery code paths in tests).
      const tokenCount =
        typeof skill.tokenCount === "number"
          ? skill.tokenCount
          : skillMdContent
            ? estimateTokenCount(skillMdContent)
            : undefined;

      // Eval summary — captured at index time so the website + TUI + CLI
      // inspect surfaces can show "what would I be installing" before the
      // user runs `asm install`. We intentionally drop findings/suggestions
      // from the catalog payload to keep catalog.json small.
      let evalSummary: SkillEvalSummary | undefined;
      if (skillMdContent) {
        try {
          const report = evaluateSkillContent({
            content: skillMdContent,
            skillPath: skill.relPath || skill.name,
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
            evaluatedVersion: skill.version || undefined,
          };
        } catch (err) {
          // Eval is best-effort during indexing — never fail the whole
          // ingest because one skill produced a malformed evaluator result.
          debug(`ingester: eval failed for ${skill.name}: ${err}`);
        }
      }

      skills.push({
        name: skill.name,
        description: skill.description,
        version: skill.version,
        license: skill.license,
        creator: skill.creator,
        compatibility: skill.compatibility,
        allowedTools: skill.allowedTools,
        installUrl: `github:${source.owner}/${source.repo}${source.ref ? `#${source.ref}` : ""}${skill.relPath ? `:${skill.relPath}` : ""}`,
        relPath: skill.relPath,
        verified: verification.verified,
        tokenCount,
        evalSummary,
      });
    }

    const repoIndex: RepoIndex = {
      repoUrl: source.cloneUrl,
      owner: source.owner,
      repo: source.repo,
      updatedAt: new Date().toISOString(),
      skillCount: skills.length,
      skills,
    };

    const indexDir = await ensureIndexDir();
    const outputFile = join(indexDir, `${source.owner}_${source.repo}.json`);
    await writeFile(
      outputFile,
      JSON.stringify(repoIndex, null, 2) + "\n",
      "utf-8",
    );
    debug(`ingester: wrote index to ${outputFile}`);

    return { success: true, repoIndex };
  } catch (err: any) {
    return { success: false, repoIndex: null, error: err.message };
  } finally {
    if (tempDir) {
      await cleanupTemp(tempDir);
    }
  }
}

export async function listIndexedRepos(): Promise<
  Array<{
    owner: string;
    repo: string;
    skillCount: number;
    updatedAt: string;
  }>
> {
  const indices = await loadAllIndices();
  return indices
    .map((index) => ({
      owner: index.owner,
      repo: index.repo,
      skillCount: index.skillCount,
      updatedAt: index.updatedAt,
    }))
    .sort((a, b) => b.skillCount - a.skillCount);
}

export async function removeRepoIndex(
  owner: string,
  repo: string,
): Promise<boolean> {
  const indexDir = getIndexDir();
  const filePath = join(indexDir, `${owner}_${repo}.json`);

  try {
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
