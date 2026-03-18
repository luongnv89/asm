import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { debug } from "./logger";
import type { AppConfig, ProviderConfig } from "./utils/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".config", "agent-skill-manager");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const INDEX_DIR = join(CONFIG_DIR, "skill-index");

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    name: "claude",
    label: "Claude Code",
    global: "~/.claude/skills",
    project: ".claude/skills",
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
    name: "openclaw",
    label: "OpenClaw",
    global: "~/.openclaw/skills",
    project: ".openclaw/skills",
    enabled: true,
  },
  {
    name: "agents",
    label: "Agents",
    global: "~/.agents/skills",
    project: ".agents/skills",
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
  return CONFIG_PATH;
}

export function getIndexDir(): string {
  return INDEX_DIR;
}

export function getBundledIndexDir(): string {
  // In built dist/: __dirname is dist/, data/ is at ../data/
  // In dev (src/): __dirname is src/, data/ is at ../data/
  return resolve(__dirname, "..", "data", "skill-index");
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
    },
  };
}

export async function loadConfig(): Promise<AppConfig> {
  debug(`config: checking ${CONFIG_PATH}`);

  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      // Config doesn't exist — silently use defaults
      debug("config: using defaults (file not found)");
      const config = getDefaultConfig();
      await saveConfig(config);
      return config;
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    debug(`config: loaded from ${CONFIG_PATH}`);
    return mergeWithDefaults(parsed);
  } catch {
    // Parse error — backup corrupted file before resetting
    const backupPath = CONFIG_PATH + ".bak";
    debug(`config: parse error, backing up to ${backupPath}`);
    await copyFile(CONFIG_PATH, backupPath);
    console.error(
      `Warning: Config file was corrupted. Backup saved to ${backupPath}. Using defaults.`,
    );
    const config = getDefaultConfig();
    await saveConfig(config);
    return config;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
