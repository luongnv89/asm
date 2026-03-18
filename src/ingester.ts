import { writeFile, mkdir, unlink } from "fs/promises";
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
import type { RepoIndex, IndexedSkill, ParsedSource } from "./utils/types";

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

  debug(`ingester: cloning ${source.owner}/${source.repo}`);

  let tempDir: string | null = null;
  try {
    tempDir = await cloneToTemp(source);
    debug(`ingester: discovering skills in ${tempDir}`);

    const discovered = await discoverSkills(tempDir);
    debug(`ingester: found ${discovered.length} skills`);

    const skills: IndexedSkill[] = discovered.map((skill) => ({
      name: skill.name,
      description: skill.description,
      version: skill.version,
      installUrl: `github:${source.owner}/${source.repo}${source.ref ? `#${source.ref}` : ""}${skill.relPath ? `:${skill.relPath}` : ""}`,
      relPath: skill.relPath,
    }));

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
