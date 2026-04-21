// ─── Skill Types ────────────────────────────────────────────────────────────

export interface SkillWarning {
  category: string;
  message: string;
}

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  creator: string;
  license: string;
  compatibility: string;
  allowedTools: string[];
  dirName: string;
  path: string;
  originalPath: string;
  location: string;
  scope: "global" | "project";
  provider: string;
  providerLabel: string;
  isSymlink: boolean;
  symlinkTarget: string | null;
  realPath: string;
  fileCount?: number;
  effort?: string;
  warnings?: SkillWarning[];
  /**
   * Estimated token cost for the skill's SKILL.md content.
   * Computed as `words + spaces` (issue #188 heuristic).
   * Always render as `~N tokens` to signal it is an approximation.
   */
  tokenCount?: number;
  /**
   * Lazily-populated summary of the most recent `asm eval` run for this skill.
   * Filled in by callers that opt to enrich (e.g., the TUI detail view).
   */
  evalSummary?: SkillEvalSummary;
  /** Provider-keyed summaries for all registered eval providers. */
  evalSummaries?: Record<string, SkillEvalSummary>;
  /** Marketplace name when skill was installed via Claude plugin marketplace */
  marketplace?: string;
  /** Codex plugin metadata when skill was discovered via Codex plugin cache */
  codexPlugin?: {
    category?: string;
    hasMcpConfig?: boolean;
    pluginName?: string;
    pluginVersion?: string;
    enabled?: boolean;
  };
}

/**
 * Slim, JSON-friendly snapshot of an `asm eval` report for the
 * "before-install" decision surfaces (website cards/modal, TUI detail,
 * CLI inspect).
 *
 * Findings/suggestions are intentionally omitted — they are an authoring
 * aid, not a consumer-facing signal, and including them in catalog.json
 * would bloat the payload by ~1MB+ for a few hundred skills.
 */
export interface SkillEvalSummary {
  /** Provider id that produced the summary (e.g. `quality`). */
  providerId?: string;
  /** Provider version that produced the summary. */
  providerVersion?: string;
  /** Eval result schema version for this provider summary. */
  schemaVersion?: number;
  /** Whether the provider considered the skill a pass. */
  passed?: boolean;
  /** 0..100 normalized score across all categories. */
  overallScore: number;
  /** Letter grade for quick scanning. */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Per-category breakdown (id, name, score, max). */
  categories: Array<{
    id: string;
    name: string;
    score: number;
    max: number;
  }>;
  /** ISO-8601 timestamp of when the eval was produced. */
  evaluatedAt: string;
  /** Skill version that was evaluated (e.g. `0.2.0`). */
  evaluatedVersion?: string;
}

/** Codex plugin manifest (`.codex-plugin/plugin.json`) */
export interface CodexPluginManifest {
  name: string;
  version?: string;
  description?: string;
  skills?: string[];
  mcp?: Record<string, unknown>;
  interface?: {
    displayName?: string;
    category?: string;
    capabilities?: string[];
    branding?: Record<string, unknown>;
  };
}

// ─── Lock File Types ──────────────────────────────────────────────────────

export interface LockEntry {
  source: string;
  commitHash: string;
  ref: string | null;
  installedAt: string;
  provider: string;
  /** How the skill was resolved: registry, github, or local */
  sourceType?: "registry" | "github" | "local";
  /** Registry name for registry-installed skills (e.g. "code-review") */
  registryName?: string;
}

export interface LockFile {
  version: 1;
  skills: Record<string, LockEntry>;
}

// ─── Export Types ───────────────────────────────────────────────────────────

export interface ExportedSkill {
  name: string;
  version: string;
  dirName: string;
  provider: string;
  scope: "global" | "project";
  path: string;
  isSymlink: boolean;
  symlinkTarget: string | null;
  effort?: string;
}

export interface ExportManifest {
  version: 1;
  exportedAt: string;
  skills: ExportedSkill[];
}

// ─── Import Types ──────────────────────────────────────────────────────────

export interface ImportResult {
  skillName: string;
  provider: string;
  scope: "global" | "project";
  status: "installed" | "skipped" | "failed" | "dry-run";
  reason?: string;
  path?: string;
}

export interface ImportSummary {
  total: number;
  installed: number;
  skipped: number;
  failed: number;
  results: ImportResult[];
}

// ─── Stats Types ────────────────────────────────────────────────────────────

export interface StatsReport {
  totalSkills: number;
  byProvider: Record<string, number>;
  byScope: { global: number; project: number };
  totalDiskBytes: number;
  perSkillDiskBytes: Record<string, number>;
  duplicateGroups: number;
  duplicateInstances: number;
}

export interface RemovalPlan {
  directories: Array<{ path: string; isSymlink: boolean }>;
  ruleFiles: string[];
  agentsBlocks: Array<{ file: string; skillName: string }>;
}

// ─── Audit Types ──────────────────────────────────────────────────────────

export interface DuplicateGroup {
  key: string;
  reason: "same-dirName" | "same-frontmatterName";
  instances: SkillInfo[];
}

export interface AuditReport {
  scannedAt: string;
  totalSkills: number;
  duplicateGroups: DuplicateGroup[];
  totalDuplicateInstances: number;
}

// ─── Config Types ───────────────────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  label: string;
  global: string;
  project: string;
  enabled: boolean;
}

export interface CustomPathConfig {
  path: string;
  label: string;
  scope: "global" | "project";
}

export interface UserPreferences {
  defaultScope: Scope;
  defaultSort: SortBy;
  selectedTools?: string[];
}

export interface AppConfig {
  version: number;
  providers: ProviderConfig[];
  customPaths: CustomPathConfig[];
  preferences: UserPreferences;
}

// ─── Install Types ─────────────────────────────────────────────────────────

export type TransportMode = "https" | "ssh" | "auto";
export type InstallMethod = "default" | "vercel";

export interface ParsedSource {
  owner: string;
  repo: string;
  ref: string | null;
  subpath: string | null;
  cloneUrl: string;
  sshCloneUrl: string;
  isLocal?: boolean;
  localPath?: string;
}

export interface InstallPlan {
  source: ParsedSource;
  tempDir: string;
  sourceDir: string;
  targetDir: string;
  skillName: string;
  force: boolean;
  providerName: string;
  providerLabel: string;
  scope: "global" | "project";
}

export interface InstallResult {
  success: boolean;
  path: string;
  name: string;
  version: string;
  provider: string;
  source: string;
  error?: string;
}

export interface InstallOptions {
  provider: string | null;
  name: string | null;
  force: boolean;
  yes: boolean;
  path: string | null;
  all: boolean;
  transport: TransportMode;
  method: InstallMethod;
}

export interface DiscoveredSkill {
  relPath: string;
  name: string;
  version: string;
  description: string;
  effort?: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  /**
   * Estimated token count for the SKILL.md content. Populated by
   * `discoverSkills` so downstream consumers (ingester) don't have to
   * re-read the file.
   */
  tokenCount?: number;
}

// ─── Skill Index Types ───────────────────────────────────────────────────────

export interface SkillIndexResource {
  source: string;
  url: string;
  owner: string;
  repo: string;
  description: string;
  maintainer: string;
  enabled: boolean;
}

export interface SkillIndexResources {
  updatedAt: string;
  repos: SkillIndexResource[];
}

export interface IndexedSkill {
  name: string;
  description: string;
  version: string;
  license: string;
  creator: string;
  compatibility: string;
  allowedTools: string[];
  installUrl: string;
  relPath: string;
  verified?: boolean;
  /**
   * Estimated token count for the SKILL.md content
   * (`words + spaces` heuristic — see `src/utils/token-count.ts`).
   */
  tokenCount?: number;
  /**
   * Slim eval summary captured at index time for "before-install"
   * surfaces (website + TUI + CLI inspect).
   */
  evalSummary?: SkillEvalSummary;
  /** Provider-keyed summaries for all registered eval providers. */
  evalSummaries?: Record<string, SkillEvalSummary>;
}

export interface RepoIndex {
  repoUrl: string;
  owner: string;
  repo: string;
  updatedAt: string;
  skillCount: number;
  skills: IndexedSkill[];
}

// ─── Security Audit Types ────────────────────────────────────────────────

export interface SourceAnalysis {
  owner: string;
  repo: string;
  profileUrl: string;
  reposUrl: string;
  isOrganization: boolean | null;
  publicRepos: number | null;
  accountAge: string | null;
  fetchError: string | null;
}

export interface CodeScanMatch {
  file: string;
  line: number;
  match: string;
  severity: "critical" | "warning" | "info";
}

export interface CodeScanCategory {
  category: string;
  description: string;
  matches: CodeScanMatch[];
}

export interface PermissionRequest {
  type: "filesystem" | "shell" | "network" | "code-execution" | "environment";
  evidence: Array<{ file: string; line: number; match: string }>;
  reason: string;
}

export type SecurityVerdict = "safe" | "caution" | "warning" | "dangerous";

export interface SecurityAuditReport {
  scannedAt: string;
  skillName: string;
  skillPath: string;
  source: SourceAnalysis | null;
  codeScans: CodeScanCategory[];
  permissions: PermissionRequest[];
  totalFiles: number;
  totalLines: number;
  verdict: SecurityVerdict;
  verdictReason: string;
}

// ─── Bundle Types ─────────────────────────────────────────────────────────

export interface BundleSkillRef {
  name: string;
  installUrl: string;
  description?: string;
  version?: string;
}

export interface BundleManifest {
  version: 1;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  skills: BundleSkillRef[];
  tags?: string[];
}

export interface BundleValidation {
  valid: boolean;
  errors: string[];
}

// ─── Publish Types ───────────────────────────────────────────────────────────

export interface PublishResult {
  success: boolean;
  manifest: import("../registry").RegistryManifest | null;
  prUrl: string | null;
  error: string | null;
  securityVerdict: "pass" | "warning" | "dangerous";
  securityReport: SecurityAuditReport;
  fallback?: boolean;
  fallbackReason?: string;
}

// ─── UI Types ───────────────────────────────────────────────────────────────

export type Scope = "global" | "project" | "both";
export type SortBy = "name" | "version" | "location";
export type ViewState =
  | "dashboard"
  | "detail"
  | "confirm"
  | "help"
  | "config"
  | "audit";
