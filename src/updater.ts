/**
 * Outdated detection and skill update.
 *
 * Split into two physical files for maintainability (issue #455):
 *   - `updater-core.ts` — remote commit resolution, source classification, checkOutdated
 *   - `updater-updates.ts` — updateSkill, updateSkills, formatters
 *
 * Re-export everything here so existing imports continue to work.
 */

export {
  type OutdatedStatus,
  type OutdatedEntry,
  type OutdatedSummary,
  getLatestRemoteCommit,
  resolveSourceType,
  sourceToCloneUrl,
  extractOwnerRepo,
  shortHash,
  type _CheckOutdatedTestOverrides,
  checkOutdated,
  type UpdateResult,
  type UpdateSummary,
} from "./updater-core";

export {
  type _UpdateTestOverrides,
  type _UpdateSkillsTestOverrides,
  updateSkill,
  updateSkills,
  formatOutdatedTable,
  formatOutdatedJSON,
  formatOutdatedMachine,
  formatUpdateJSON,
  formatUpdateMachine,
} from "./updater-updates";
