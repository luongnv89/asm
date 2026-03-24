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

export async function securityAudit(name: string): Promise<CliResult> {
  return invoke<CliResult>("security_audit", { name });
}

export async function isSkillSymlink(name: string): Promise<boolean> {
  return invoke<boolean>("is_skill_symlink", { skillName: name });
}

export interface Skill {
  name: string;
  description?: string;
  source?: string;
  provider?: string;
  installed?: boolean;
  version?: string;
  category?: string;
  repository?: string;
  author?: string;
  license?: string;
  tools?: string[];
  path?: string;
}

export interface CategoryOption {
  value: string;
  label: string;
}

export const CATEGORIES: CategoryOption[] = [
  { value: "all", label: "All Categories" },
  { value: "ai-agents", label: "AI Agents" },
  { value: "backend", label: "Backend" },
  { value: "coding", label: "Coding" },
  { value: "design", label: "Design" },
  { value: "devops", label: "DevOps" },
  { value: "finance", label: "Finance" },
  { value: "frontend", label: "Frontend" },
  { value: "git", label: "Git" },
  { value: "marketing", label: "Marketing" },
  { value: "mobile", label: "Mobile" },
  { value: "productivity", label: "Productivity" },
  { value: "research", label: "Research" },
  { value: "security", label: "Security" },
  { value: "testing", label: "Testing" },
  { value: "writing", label: "Writing" },
  { value: "general", label: "General" },
];

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
