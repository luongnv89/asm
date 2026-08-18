/**
 * Estimated token count for skill content.
 *
 * Uses the heuristic from issue #188: number of words + number of spaces.
 * This is a deliberately simple approximation — it does NOT match any specific
 * model tokenizer (BPE, tiktoken, etc.). It is a fast, dependency-free signal
 * meant to give users a rough sense of the context cost before installing a
 * skill.
 *
 * Always render the result as `~N tokens` (with the leading `~`) so users
 * understand it is an approximation.
 */

/**
 * Compute the estimated token count for a string of skill content.
 *
 * Formula: number of words (sequences of non-whitespace characters) +
 *          number of space characters (literal U+0020 only).
 *
 * Notes:
 *   - Empty / whitespace-only input → 0.
 *   - Newlines and tabs are whitespace separators but do NOT count toward
 *     the "spaces" portion (only literal space characters do).
 *   - Multiple consecutive spaces each count individually.
 */
export function estimateTokenCount(content: string): number {
  if (!content) return 0;
  const words = content
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean).length;
  let spaces = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 32) spaces++;
  }
  return words + spaces;
}

/**
 * Format a token count for display.
 *
 * Always prefixed with `~` to signal an approximation (per issue #188
 * acceptance criteria).
 *
 * Examples:
 *   - estimateTokenCount("hello world") = 3   → "~3 tokens"
 *   - 1234                              → "~1.2k tokens"
 *   - 12_345                            → "~12k tokens"
 *   - 1_934_000                         → "~1.9M tokens"
 */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "~0 tokens";
  if (count < 1000) return `~${count} tokens`;
  if (count < 10_000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, "");
    return `~${k}k tokens`;
  }
  if (count < 1_000_000) return `~${Math.round(count / 1000)}k tokens`;
  const m = (count / 1_000_000).toFixed(1).replace(/\.0$/, "");
  return `~${m}M tokens`;
}

/**
 * Estimated **resident** token cost of an installed skill.
 *
 * Resident cost is the part of a skill that an agent pays for on *every*
 * message: the frontmatter `description`, which is inlined into the system
 * prompt so the agent can decide whether the skill should fire. It is a
 * different number from `SkillInfo.tokenCount` — the whole `SKILL.md` body —
 * which is only paid when the skill actually fires.
 *
 * Conflating the two overstates the always-on context budget by an order of
 * magnitude, so this is the single shared definition: both the
 * `asm stats --tokens` budget report and the `asm audit residency` report
 * import it rather than re-deriving it (issues #421, #423).
 */
export function residentTokens(skill: { description?: string }): number {
  return estimateTokenCount(skill.description ?? "");
}

/**
 * Estimated **body** token cost of an installed skill — the full `SKILL.md`.
 *
 * Prefers the scanner-computed `tokenCount` (issue #188) and falls back to 0
 * when a caller constructed the record without one.
 */
export function bodyTokens(skill: { tokenCount?: number }): number {
  const n = skill.tokenCount;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}
