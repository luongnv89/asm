import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import CopyButton from "./CopyButton.jsx";
import { Badge } from "./ui/badge.jsx";
import { Card } from "./ui/card.jsx";
import { cn } from "../lib/cn.js";
import {
  evalScoreClass,
  formatTokens,
  highlightMatches,
  encodeSkillId,
} from "../lib/utils.js";

/**
 * Single catalog card. Click or Enter opens the detail view at
 * `/skills/:id`. Parity target: `renderCard` in the legacy index.html.
 *
 * Built on shadcn's `<Card>` and `<Badge>` primitives so future design
 * iterations (#228) can restyle via the shadcn theme tokens.
 */
export default function SkillCard({ skill, searchQuery, searchTerms }) {
  const cmd = "asm install " + skill.installUrl;
  const usesTools =
    skill.hasTools === true ||
    (Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0);
  const toolsTitle =
    Array.isArray(skill.allowedTools) && skill.allowedTools.length > 0
      ? "Tool access: " + skill.allowedTools.join(", ")
      : "This skill uses tools";
  const isOfficial = skill.owner === "anthropics";
  const isVerified = skill.verified === true;
  const isFeatured = skill.featured === true;

  const nameHtml = highlightMatches(skill.name, searchQuery, searchTerms);
  const descHtml = highlightMatches(
    skill.description,
    searchQuery,
    searchTerms,
  );

  const evalTone = skill.evalSummary
    ? evalScoreClass(skill.evalSummary.overallScore)
    : null;

  return (
    <Card
      className={cn(
        "group relative flex flex-col gap-2 p-4 hover:border-[var(--brand)] transition-colors",
        isFeatured && "ring-1 ring-amber-500/30",
      )}
    >
      <Link
        to={`/skills/${encodeSkillId(skill.id)}`}
        className="absolute inset-0 z-0"
        aria-label={`Open details for ${skill.name}`}
      />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <span
          className="font-semibold text-[var(--fg)] text-sm break-words"
          dangerouslySetInnerHTML={{ __html: nameHtml }}
        />
        <span className="text-[11px] text-[var(--fg-muted)] whitespace-nowrap">
          {skill.owner}/{skill.repo}
        </span>
      </div>
      <p
        className="relative z-10 text-xs text-[var(--fg-dim)] line-clamp-3 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: descHtml }}
      />
      <div className="relative z-10 flex flex-wrap gap-1">
        {isFeatured && <Badge tone="featured">★ featured</Badge>}
        {isOfficial && <Badge tone="official">official</Badge>}
        {isVerified && <Badge tone="verified">✓ verified</Badge>}
        {skill.evalSummary && (
          <Badge
            tone={evalTone || "default"}
            title={`asm eval score: ${skill.evalSummary.overallScore}/100 (${skill.evalSummary.grade})`}
          >
            eval {skill.evalSummary.overallScore} {skill.evalSummary.grade}
          </Badge>
        )}
        {typeof skill.tokenCount === "number" && (
          <Badge
            tone="tokens"
            title="Estimated tokens in SKILL.md (rough approximation)"
          >
            {formatTokens(skill.tokenCount)}
          </Badge>
        )}
        {skill.categories?.map((c) => (
          <Badge key={c} tone="cat">
            {c}
          </Badge>
        ))}
        {usesTools && (
          <Badge tone="warn" title={toolsTitle} className="gap-1">
            <Wrench className="h-3 w-3" />
            uses tools
          </Badge>
        )}
        {skill.version && skill.version !== "0.0.0" && (
          <span className="ml-auto text-[10px] text-[var(--fg-muted)]">
            v{skill.version}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-auto flex items-center gap-2 pt-2 border-t border-[var(--border)]">
        <code className="flex-1 text-[11px] text-[var(--fg-dim)] truncate font-mono">
          {cmd}
        </code>
        <CopyButton
          text={cmd}
          label="copy install"
          size="sm"
          ariaLabel={`Copy install command for ${skill.name}`}
        />
      </div>
    </Card>
  );
}
