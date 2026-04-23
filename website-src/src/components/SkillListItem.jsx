import { memo } from "react";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { Badge } from "./ui/badge.jsx";
import { cn } from "../lib/cn.js";
import {
  evalScoreClass,
  formatTokens,
  highlightMatches,
  encodeSkillId,
} from "../lib/utils.js";

/**
 * Compact sidebar row for a skill. Inherits the badge/eval-tone/
 * highlight vocabulary of the legacy catalog card but in a
 * single-row layout suited to a scrollable left pane. Clicking
 * navigates to `/skills/:id` while preserving the current
 * `location.search` so active filters survive the selection.
 *
 * The `active` prop flips the selected visual (left-rail accent +
 * contrasting background) so the user never loses the currently
 * focused skill while scrolling.
 */
function SkillListItem({
  skill,
  active,
  searchQuery,
  searchTerms,
  locationSearch,
}) {
  const nameHtml = highlightMatches(skill.name, searchQuery, searchTerms);
  const descHtml = highlightMatches(
    skill.description,
    searchQuery,
    searchTerms,
  );
  const usesTools =
    skill.hasTools === true ||
    (Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0);
  const isOfficial = skill.owner === "anthropics";
  const isVerified = skill.verified === true;
  const isFeatured = skill.featured === true;
  const evalTone = skill.evalSummary
    ? evalScoreClass(skill.evalSummary.overallScore)
    : null;

  return (
    <Link
      to={{
        pathname: `/skills/${encodeSkillId(skill.id)}`,
        search: locationSearch,
      }}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative block rounded-md border px-3 py-2 transition-colors",
        active
          ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]"
          : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--brand)] hover:bg-[var(--bg-hover)]",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[var(--brand)]"
        />
      )}
      <span
        className={cn(
          "block text-sm font-semibold break-words",
          active ? "text-[var(--brand)]" : "text-[var(--fg)]",
        )}
        dangerouslySetInnerHTML={{ __html: nameHtml }}
      />
      <div className="mt-1 text-[10px] text-[var(--fg-muted)] truncate">
        {skill.owner}/{skill.repo}
      </div>
      <p
        className="mt-1 text-xs text-[var(--fg-dim)] line-clamp-2 leading-snug"
        dangerouslySetInnerHTML={{ __html: descHtml }}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {isFeatured && <Badge tone="featured">★</Badge>}
        {isOfficial && <Badge tone="official">official</Badge>}
        {isVerified && <Badge tone="verified">✓</Badge>}
        {skill.evalSummary && (
          <Badge
            tone={evalTone || "default"}
            title={`asm eval score: ${skill.evalSummary.overallScore}/100 (${skill.evalSummary.grade})`}
          >
            {skill.evalSummary.overallScore} {skill.evalSummary.grade}
          </Badge>
        )}
        {typeof skill.tokenCount === "number" && (
          <Badge tone="tokens" title="Estimated tokens in SKILL.md">
            {formatTokens(skill.tokenCount)}
          </Badge>
        )}
        {usesTools && (
          <Badge tone="warn" title="This skill uses tools" className="gap-1">
            <Wrench className="h-3 w-3" aria-hidden="true" />
          </Badge>
        )}
        {skill.categories?.slice(0, 2).map((c) => (
          <Badge key={c} tone="cat">
            {c}
          </Badge>
        ))}
      </div>
    </Link>
  );
}

export default memo(SkillListItem);
