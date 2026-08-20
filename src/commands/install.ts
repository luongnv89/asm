/**
 * `asm install` — entry point.
 *
 * Split into two physical files for maintainability (issue #455):
 *   - `install-inspect.ts` — help text, skill inspection, install executors
 *   - `install-run.ts`     — the `cmdInstall` command body
 *
 * Re-export here so existing imports continue to work.
 */

export { cmdInstall } from "./install-run";
