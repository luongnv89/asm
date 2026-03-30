import { readFile, writeFile, mkdir, copyFile, rename } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { debug } from "./logger";
import type {
  AppConfig,
  ProviderConfig,
  SkillIndexResources,
} from "./utils/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOME = homedir();

// Module-level HOME override for test isolation. Set via setConfigDirForTesting()
// so that config.test.ts can redirect all I/O to a temp directory without
// interfering with concurrent test workers that share the real user config.
let _testHome: string | undefined;

/** For testing only: treat `home` as the user home dir for all config paths. */
export function setConfigDirForTesting(home: string | undefined): void {
  _testHome = home;
}

function configDir(): string {
  return join(_testHome ?? HOME, ".config", "agent-skill-manager");
}

function configPath(): string {
  return join(configDir(), "config.json");
}

function lockPath(): string {
  return join(configDir(), ".skill-lock.json");
}

function indexDir(): string {
  return join(configDir(), "skill-index");
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  // ── Priority providers (ordered by usage frequency) ──
  {
    name: "claude",
    label: "Claude Code",
    global: "~/.claude/skills",
    project: ".claude/skills",
    enabled: true,
  },
  {
    name: "agents",
    label: "Agents",
    global: "~/.agents/skills",
    project: ".agents/skills",
    enabled: true,
  },
  {
    name: "codex",
    label: "Codex",
    global: "~/.codex/skills",
    project: ".codex/skills",
    enabled: true,
  },
  {
    name: "opencode",
    label: "OpenCode",
    global: "~/.config/opencode/skills",
    project: ".opencode/skills",
    enabled: true,
  },
  {
    name: "openclaw",
    label: "OpenClaw",
    global: "~/.openclaw/skills",
    project: ".openclaw/skills",
    enabled: true,
  },
  {
    name: "cursor",
    label: "Cursor",
    global: "~/.cursor/rules",
    project: ".cursor/rules",
    enabled: true,
  },
  {
    name: "copilot",
    label: "GitHub Copilot",
    global: "~/.github/instructions",
    project: ".github/instructions",
    enabled: true,
  },
  {
    name: "windsurf",
    label: "Windsurf",
    global: "~/.windsurf/rules",
    project: ".windsurf/rules",
    enabled: true,
  },
  {
    name: "antigravity",
    label: "Google Antigravity",
    global: "~/.antigravity/skills",
    project: ".antigravity/skills",
    enabled: true,
  },
  {
    name: "gemini",
    label: "Gemini CLI",
    global: "~/.gemini/skills",
    project: ".gemini/skills",
    enabled: true,
  },
  // ── Remaining providers ──
  {
    name: "cline",
    label: "Cline",
    global: "~/Documents/Cline/Rules",
    project: ".clinerules",
    enabled: true,
  },
  {
    name: "roocode",
    label: "Roo Code",
    global: "~/.roo/rules",
    project: ".roo/rules",
    enabled: true,
  },
  {
    name: "continue",
    label: "Continue",
    global: "~/.continue/rules",
    project: ".continue/rules",
    enabled: true,
  },
  {
    name: "aider",
    label: "Aider",
    global: "~/.aider/skills",
    project: ".aider/skills",
    enabled: true,
  },
  {
    name: "zed",
    label: "Zed",
    global: "~/.config/zed/prompt_overrides",
    project: ".zed/rules",
    enabled: true,
  },
  {
    name: "augment",
    label: "Augment",
    global: "~/.augment/rules",
    project: ".augment/rules",
    enabled: true,
  },
  {
    name: "amp",
    label: "Amp",
    global: "~/.amp/skills",
    project: ".amp/skills",
    enabled: true,
  },
];

export function getDefaultConfig(): AppConfig {
  return {
    version: 1,
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p })),
    customPaths: [],
    preferences: {
      defaultScope: "both",
      defaultSort: "name",
    },
  };
}

export function getConfigPath(): string {
  return configPath();
}

export function getLockPath(): string {
  return lockPath();
}

export function getIndexDir(): string {
  return indexDir();
}

export function getBundledIndexDir(): string {
  // In built dist/: __dirname is dist/, data/ is at ../data/
  // In dev (src/): __dirname is src/, data/ is at ../data/
  return resolve(__dirname, "..", "data", "skill-index");
}

export function getSkillIndexResourcesPath(): string {
  return resolve(__dirname, "..", "data", "skill-index-resources.json");
}

export async function loadSkillIndexResources(): Promise<SkillIndexResources> {
  const resourcesPath = getSkillIndexResourcesPath();
  const raw = await readFile(resourcesPath, "utf-8");
  return JSON.parse(raw) as SkillIndexResources;
}

export function resolveProviderPath(pathTemplate: string): string {
  if (pathTemplate.startsWith("~/")) {
    return join(HOME, pathTemplate.slice(2));
  }
  if (pathTemplate.startsWith("/")) {
    return pathTemplate;
  }
  // Relative path — resolve from cwd (project-level)
  return resolve(pathTemplate);
}

function mergeWithDefaults(config: Partial<AppConfig>): AppConfig {
  const defaults = getDefaultConfig();
  const providers = config.providers || [];

  // Add any new default providers that don't exist in the saved config
  const existingNames = new Set(providers.map((p) => p.name));
  for (const defaultProvider of defaults.providers) {
    if (!existingNames.has(defaultProvider.name)) {
      providers.push({ ...defaultProvider });
    }
  }

  return {
    version: config.version ?? defaults.version,
    providers,
    customPaths: config.customPaths ?? [],
    preferences: {
      defaultScope:
        config.preferences?.defaultScope ?? defaults.preferences.defaultScope,
      defaultSort:
        config.preferences?.defaultSort ?? defaults.preferences.defaultSort,
      selectedTools: config.preferences?.selectedTools,
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const cp = configPath();
  debug(`config: checking ${cp}`);

  let raw: string;
  try {
    raw = await readFile(cp, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // Config doesn't exist — silently use defaults (caller is responsible for saving)
      debug("config: using defaults (file not found)");
      return getDefaultConfig();
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    debug(`config: loaded from ${cp}`);
    return mergeWithDefaults(parsed);
  } catch {
    // Parse error — backup corrupted file before resetting
    const backupPath = cp + ".bak";
    debug(`config: parse error, backing up to ${backupPath}`);
    await copyFile(cp, backupPath);
    console.error(
      `Warning: Config file was corrupted. Backup saved to ${backupPath}. Using defaults.`,
    );
    const config = getDefaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const cp = configPath();
  await mkdir(configDir(), { recursive: true });
  const tmp = cp + ".tmp";
  await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await rename(tmp, cp);
}

export async function saveSelectedTools(toolNames: string[]): Promise<void> {
  const cp = configPath();
  process.stderr.write(
    `[DEBUG-SST] configPath inside saveSelectedTools: ${cp}\n`,
  );
  const config = await loadConfig();
  config.preferences.selectedTools = toolNames;
  process.stderr.write(
    `[DEBUG-SST] about to saveConfig with selectedTools=${JSON.stringify(config.preferences.selectedTools)}\n`,
  );
  await saveConfig(config);
  // Verify what was actually written
  try {
    const written = await readFile(cp, "utf-8");
    const parsed = JSON.parse(written);
    process.stderr.write(
      `[DEBUG-SST] after save, file selectedTools=${JSON.stringify(parsed.preferences?.selectedTools)}\n`,
    );
  } catch (e) {
    process.stderr.write(`[DEBUG-SST] after save, failed to read file: ${e}\n`);
  }
}
