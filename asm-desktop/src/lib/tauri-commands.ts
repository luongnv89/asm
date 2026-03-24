import { invoke } from "@tauri-apps/api/core";

export interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface InstallSkillResponse extends CliResult {
  skillName?: string;
}

export interface UninstallSkillResponse extends CliResult {
  skillName?: string;
}

export interface SearchSkillsResponse extends CliResult {
  results?: Skill[];
}

export interface ListSkillsResponse extends CliResult {
  skills?: Skill[];
}

export interface GetConfigResponse extends CliResult {
  config?: Record<string, unknown>;
}

export interface GetSkillIndexResponse extends CliResult {
  skills?: Skill[];
}

export async function invokeAsm(args: string[]): Promise<CliResult> {
  return invoke<CliResult>("invoke_asm", { args });
}

export async function listInstalledSkills(): Promise<CliResult> {
  return invoke<CliResult>("list_installed_skills");
}

export async function searchSkills(query: string): Promise<CliResult> {
  return invoke<CliResult>("search_skills", { query });
}

export async function installSkill(name: string): Promise<CliResult> {
  return invoke<CliResult>("install_skill", { name });
}

export async function uninstallSkill(name: string): Promise<CliResult> {
  return invoke<CliResult>("uninstall_skill", { name });
}

export async function getSkillIndex(): Promise<CliResult> {
  return invoke<CliResult>("get_skill_index");
}

export async function getConfig(): Promise<CliResult> {
  return invoke<CliResult>("get_config");
}

export async function getHomeDir(): Promise<string> {
  return invoke<string>("get_home_dir");
}

export interface Skill {
  name: string;
  description?: string;
  source?: string;
  provider?: string;
  installed?: boolean;
  version?: string;
}

export function parseSkillsFromJson(json: string): Skill[] {
  try {
    const data = JSON.parse(json);
    if (Array.isArray(data)) {
      return data;
    }
    if (data.skills && Array.isArray(data.skills)) {
      return data.skills;
    }
    console.warn("Unexpected JSON format for skills:", json);
    return [];
  } catch (e) {
    console.error("Failed to parse skills JSON:", e);
    return [];
  }
}
