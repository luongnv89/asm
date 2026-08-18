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
   * Exact SKILL.md text retained by filesystem scanners for downstream checks.
   * @internal Consumers should tolerate this cache being absent.
   */
  _skillMdContent?: string;
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
  /**
   * True when this skill instance is currently disabled via `asm disable`
   * (its `SKILL.md` was renamed to `SKILL.md.disabled`, so the scanner can't
   * see it — `asm list` reconstructs the row from the skill-state file).
   */
  disabled?: boolean;
}

/**
 * Persisted "disabled" state for skills toggled off via `asm disable`.
 *
 * The on-disk rename of `SKILL.md` → `SKILL.md.disabled` is the enforcement
 * mechanism; this file is the source of truth for what asm itself disabled and
 * lets `asm list` re-surface entries the scanner can no longer see.
 *
 * Structure is keyed by skill dirName → provider → scope → `true`, designed to
 * be shared with future sandbox-mode work (issue #92).
 */
export interface SkillStateFile {
  version: 1;
  disabled: Record<
    string,
    Record<string, Partial<Record<"global" | "project", true>>>
  >;
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
  /** Scope where the tracked skill was installed. Older lock entries omit this and are treated as global. */
  scope?: "global" | "project";
  /** Repo/local-source relative path to the skill directory. Empty string means repository root. */
  skillPath?: string;
  /** Absolute installed directory at the time the lock entry was written. */
  targetDir?: string;
  /** How the skill was resolved: registry, github, or local */
  sourceType?: "registry" | "github" | "local";
  /** Registry name for registry-installed skills (e.g. "code-review") */
  registryName?: string;
}

export interface LockFile {
  version: 1;
  skills: Record<string, LockEntry>;
}

export interface LibrarySkillEntry {
  name: string;
  version: string;
  source: string;
  commitHash: string;
  ref: string | null;
  skillPath: string;
  libraryPath: string;
  installedAt: string;
  sourceType?: "registry" | "github" | "local";
}

export interface LibraryLockFile {
  version: 1;
  skills: Record<string, LibrarySkillEntry>;
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

/**
 * A skill that exists both locally (at the import target) and in the manifest
 * source, with differing content. Timestamps are the latest file
 * mtime found in each tree, so "newer" reflects the most recent edit.
 */
export interface ImportConflict {
  skillName: string;
  provider: string;
  scope: "global" | "project";
  /** The local version — the directory the import would overwrite. */
  targetDir: string;
  /** The imported version — the source install the manifest resolves to. */
  sourcePath: string;
  /** ISO timestamp of the last modification in the local tree. */
  localModified: string;
  /** ISO timestamp of the last modification in the imported tree. */
  importedModified: string;
  newer: "local" | "imported" | "same";
}

export type ImportConflictChoice = "keep-local" | "use-imported" | "skip";

export interface ImportResult {
  skillName: string;
  provider: string;
  scope: "global" | "project";
  status: "installed" | "skipped" | "failed" | "dry-run";
  reason?: string;
  path?: string;
  /** Present when this skill was detected as a conflict. */
  conflict?: ImportConflict;
}

export interface ImportSummary {
  total: number;
  installed: number;
  skipped: number;
  failed: number;
  /** Number of results that carried conflict information. */
  conflicts: number;
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
  /**
   * Estimated tokens the installed set costs on *every* message — the sum of
   * each skill's frontmatter `description` (issue #421). Distinct from
   * `totalBodyTokens`, which is only paid when a skill fires.
   */
  totalResidentTokens: number;
  /** Estimated tokens across every installed `SKILL.md` body (issue #421). */
  totalBodyTokens: number;
}

/** One provider or scope row of the attention-budget report (issue #421). */
export interface TokenBudgetGroup {
  /** Provider name (`claude`, `codex`, …) or scope (`global`, `project`). */
  key: string;
  /** Human label for the key (e.g. `Claude Code`). */
  label: string;
  skills: number;
  residentTokens: number;
  bodyTokens: number;
}

/** One entry of the "heaviest resident descriptions" ranking (issue #421). */
export interface ResidentSkillCost {
  name: string;
  dirName: string;
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  path: string;
  residentTokens: number;
  bodyTokens: number;
}

/**
 * Attention-budget view over the *installed* set — `asm stats --tokens`.
 *
 * Resident cost (frontmatter descriptions, paid every message) is reported
 * separately from body cost (full `SKILL.md`, paid only when a skill fires).
 */
export interface TokenBudgetReport {
  totalSkills: number;
  totalResidentTokens: number;
  totalBodyTokens: number;
  /** Median resident cost across installed skills — the outlier baseline. */
  medianResidentTokens: number;
  byProvider: TokenBudgetGroup[];
  byScope: TokenBudgetGroup[];
  heaviestResident: ResidentSkillCost[];
}

// ─── Residency Audit Types (issue #423) ─────────────────────────────────

/** Why a skill was flagged as a demotion candidate. */
export type ResidencyReasonId =
  | "expensive-description"
  | "redundant-activation";

export interface ResidencyReason {
  id: ResidencyReasonId;
  /** One-line human explanation, e.g. `4.1x the median description`. */
  detail: string;
}

/**
 * A signal the residency audit *would* rank on, and whether its data exists.
 *
 * Signals whose data source is not implemented yet (trigger collision — #18,
 * usage counts — #354) are reported as unavailable so the report degrades
 * instead of failing.
 */
export interface ResidencySignal {
  id: string;
  label: string;
  available: boolean;
  /** Why the signal is unavailable, when it is. */
  reason?: string;
}

/** One provider/scope location where a candidate is currently resident. */
export interface ResidencyInstance {
  provider: string;
  providerLabel: string;
  scope: "global" | "project";
  path: string;
  /** True when this instance is a symlink into the ASM library. */
  libraryLinked: boolean;
}

/**
 * The concrete, non-throwing ASM command that demotes a candidate.
 *
 * `deactivate` is only ever emitted for a single instance that is a live
 * symlink into the ASM library — `deactivateLibrarySkill` throws on anything
 * else. Everything else gets `disable`, which is universal and reversible.
 */
export interface ResidencyAction {
  kind: "deactivate" | "disable";
  command: string;
  hint: string;
  /**
   * Second demotion destination: the reference tier. Present when the skill
   * can be pulled in on demand with `asm get` instead of staying resident.
   */
  reference?: ResidencyActionReference;
}

/** Zero-residency alternative offered alongside a demotion command (issue #422). */
export interface ResidencyActionReference {
  /** `asm get <skill>` — read the body at the point of use, pay no residency. */
  command: string;
  hint: string;
}

export interface ResidencyCandidate {
  name: string;
  dirName: string;
  /** Resident tokens the representative instance costs on every message. */
  residentTokens: number;
  /** Resident tokens summed across every place this skill is installed. */
  totalResidentTokens: number;
  /** Body tokens summed across every place this skill is installed. */
  bodyTokens: number;
  /** Ranking weight — currently `totalResidentTokens`. */
  score: number;
  instances: ResidencyInstance[];
  reasons: ResidencyReason[];
  action: ResidencyAction;
}

export interface ResidencyReport {
  scannedAt: string;
  totalSkills: number;
  totalResidentTokens: number;
  medianResidentTokens: number;
  /**
   * Installed skills ASM does not manage (plugin marketplaces / Codex plugin
   * cache). They still cost residency but no ASM command demotes them, so
   * they are counted, never listed as candidates.
   */
  unmanagedSkills: number;
  candidates: ResidencyCandidate[];
  signals: ResidencySignal[];
}

export interface RemovalPlan {
  directories: Array<{ path: string; isSymlink: boolean }>;
  ruleFiles: string[];
  agentsBlocks: Array<{ file: string; skillName: string }>;
}

export interface RemovalOptions {
  providerFilter?: string;
  scopeFilter?: Scope;
}

export interface RelocationInfo {
  needed: boolean;
  fromProvider: string;
  fromPath: string;
  toProvider: string;
  toPath: string;
  /**
   * Other surviving instances (not at toPath) whose symlinks must be
   * repointed to toPath after the real folder is renamed there. May be
   * empty when only one other provider remains.
   */
  repointPaths?: string[];
  /**
   * When true, skip the rename step (the target already holds a real
   * folder) and only repoint surviving symlinks. The removed provider's
   * real folder is deleted via the standard removal path.
   */
  repointOnly?: boolean;
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
  library: boolean;
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
   * Pin to the top of the catalog list across every sort mode. Reserved for
   * first-party ASM skills that should always surface first (e.g. the
   * eval-driven skill-improver workflow).
   */
  featured?: boolean;
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

export interface RepoBundleSource {
  owner: string;
  repo: string;
  repoUrl: string;
  relPath?: string;
}

export interface RepoIndexBundle extends BundleManifest {
  sourceRepo: RepoBundleSource;
  inferred?: boolean;
  explicit?: boolean;
}

export interface RepoIndex {
  repoUrl: string;
  owner: string;
  repo: string;
  updatedAt: string;
  skillCount: number;
  skills: IndexedSkill[];
  /** Repo-derived bundles created from explicit bundle metadata or inference. */
  bundles?: RepoIndexBundle[];
}

// ─── Stats / Visualization Types ──────────────────────────────────────────

/** Per-repo aggregated statistics for the catalog index. */
export interface RepoStatsReport {
  owner: string;
  repo: string;
  repoUrl: string;
  skillCount: number;
  categories: Record<string, number>;
  verifiedCount: number;
  totalTokens: number;
  avgEvalScore?: number;
}

/** Per-author (owner) aggregated statistics across all indexed repos. */
export interface AuthorStatsReport {
  owner: string;
  totalSkills: number;
  repos: string[];
  categories: Record<string, number>;
  verifiedCount: number;
  totalTokens: number;
  avgEvalScore?: number;
  topSkills: Array<{ name: string; repo: string }>;
}

/** Aggregated stats across all indexed repos and authors. */
export interface IndexStatsReport {
  totalRepos: number;
  totalSkills: number;
  totalAuthors: number;
  categoryDistribution: Record<string, number>;
  verifiedCount: number;
  totalTokens: number;
  avgTokensPerSkill: number;
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

// ─── Reference Tier Types (issue #422) ─────────────────────────────────────

/** Which rung of the resolution ladder produced a `asm get` body. */
export type GetTier =
  | "installed"
  | "library"
  | "index"
  | "registry"
  | "remote"
  | "local";

/**
 * Security verdict attached to a remotely fetched body. This is the same scan
 * `asm install` runs before writing anything (`scanForWarnings`), reported
 * rather than enforced — `asm get` only prints text, it installs nothing.
 */
export interface GetSecurityVerdict {
  /** `high` | `medium` | `safe` — same mapping the install preview uses. */
  risk: "high" | "medium" | "safe";
  /** Number of raw warnings the scan produced. */
  warnings: number;
  /** Distinct warning categories, e.g. `Shell commands`, `External URLs`. */
  categories: string[];
}

/**
 * Result of resolving a skill for the zero-residency reference tier.
 *
 * Assembled field by field — never spread from a `SkillInfo`, whose
 * `_skillMdContent` cache is deliberately non-enumerable.
 */
export interface GetResult {
  name: string;
  description: string;
  /** Which rung of the ladder answered. */
  tier: GetTier;
  /** Provenance: an absolute path for local tiers, a `github:` ref for remote. */
  source: string;
  /** Resolved commit SHA when the body came from a clone; null otherwise. */
  commit: string | null;
  /** Estimated token cost of the body (issue #188 heuristic). */
  tokenCount: number;
  /** Present only for remotely fetched bodies. */
  security: GetSecurityVerdict | null;
  /** The exact SKILL.md text. */
  content: string;
}
