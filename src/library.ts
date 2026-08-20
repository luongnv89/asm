/**
 * Skill library — a provider-independent local store of skills that can be
 * activated into any provider's skills directory.
 *
 * Split into two physical files for maintainability (issue #455):
 *   - `library-core.ts`   — lock IO, listing, activation, install, staging primitives
 *   - `library-update.ts` — the `asm library update` pipeline
 *
 * Re-export everything here so existing imports continue to work.
 */

export {
  // ── Types ──
  type InstallLibrarySkillPlan,
  type LibraryPaths,
  type LibrarySkillInfo,
  type LibraryUpdateResult,
  type LibraryUpdateSummary,
  type DeactivateLibrarySkillInput,
  type DeactivateLibrarySkillResult,
  // ── Lock file ──
  emptyLibraryLock,
  readLibraryLock,
  writeLibraryLock,
  // ── Listing ──
  listLibrarySkills,
  findLibrarySkill,
  // ── Activation ──
  deactivateLibrarySkill,
  activateLibrarySkill,
  // ── Install ──
  installLibrarySkill,
} from "./library-core";

export { updateLibrarySkill, updateLibrarySkills } from "./library-update";
