/**
 * Install pipeline — source parsing, cloning, validation, execution, provider
 * selection, and cross-tool linking.
 *
 * Split into two physical files for maintainability (issue #455):
 *   - `installer-core.ts` — source parsing, cloning, validation, execution
 *   - `installer-link.ts` — provider selection, npx support, cross-tool links
 *
 * Re-export everything here so existing imports continue to work.
 */

export {
  // ── Source parsing ──
  isLocalPath,
  isExistingLocalDir,
  parseLocalSource,
  parseSource,
  hasParentPathSegment,
  assertNoParentSegments,
  assertPathInsideRoot,
  resolveSubpath,
  sanitizeName,
  getInstallNameFromPath,
  findDuplicateInstallNames,
  // ── Install pipeline ──
  checkGitAvailable,
  isAuthError,
  cloneToTemp,
  validateSkill,
  discoverSkills,
  installScriptDependencies,
  type SecurityWarning,
  scanForWarnings,
  classifyWarningRisk,
  executeInstall,
  executeInstallAllProviders,
  cleanupTemp,
} from "./installer-core";

export {
  // ── npx support ──
  resolveNpxCli,
  checkNpxAvailable,
  executeNpxSkillsAdd,
  buildRepoUrl,
  // ── Provider selection ──
  resolveProvider,
  buildInstallPlan,
  checkConflict,
  // ── Cross-tool linking ──
  type CrossToolLinkInfo,
  checkCrossToolLink,
  linkExistingSkill,
} from "./installer-link";
