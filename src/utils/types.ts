export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  dirName: string;
  path: string;
  originalPath: string;
  location: "global-claude" | "global-agents" | "project-claude" | "project-agents";
  scope: "global" | "project";
  isSymlink: boolean;
  symlinkTarget: string | null;
  fileCount: number;
}

export interface RemovalPlan {
  directories: Array<{ path: string; isSymlink: boolean }>;
  ruleFiles: string[];
  agentsBlocks: Array<{ file: string; skillName: string }>;
}

export type Scope = "global" | "project" | "both";
export type SortBy = "name" | "version" | "location";

export type ViewState = "dashboard" | "detail" | "confirm" | "help";
